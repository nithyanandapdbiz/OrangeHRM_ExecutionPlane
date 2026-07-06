'use strict';
/**
 * discovery.controller.js — REST endpoints for the Discovery subsystem.
 *
 * Routes (mounted externally; typically gated by authGuard + rateLimiter):
 *   GET  /discovery/summary           → latest runs overview
 *   GET  /discovery/runs              → paginated list
 *   GET  /discovery/runs/:runId       → checkpoint + summary for one run
 *   POST /discovery/run               → spawn a new run (async, HMAC-protected)
 *   POST /discovery/cancel/:runId     → signal an in-flight run to stop
 *
 * These handlers are plain Express-style (req, res) functions so they can
 * plug into the existing router without changing routes.js.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const logger = require('../utils/logger');
const {
  listCheckpoints, readCheckpointSafe
} = require('../core/discovery.state');

const ROOT       = path.resolve(__dirname, '..', '..');
const LOCK_FILE  = path.join(ROOT, 'logs', '.discovery.lock');
const SUMMARY    = path.join(ROOT, 'custom-report', 'discovery', 'summary.json');

function sendJson(res, body, status = 200) {
  res.status(status).json(body);
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

async function getSummary(req, res) {
  try {
    const latest = readJsonSafe(SUMMARY);
    const runs   = await listCheckpoints();
    sendJson(res, {
      latest: latest || null,
      runCount: runs.length,
      lastRunIds: runs.slice(-10).reverse()
    });
  } catch (err) {
    logger.error(`discovery.summary: ${err.message}`);
    sendJson(res, { error: 'internal' }, 500);
  }
}

async function listRuns(req, res) {
  try {
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const ids      = await listCheckpoints();
    const sorted   = ids.sort().reverse();
    const start    = (page - 1) * pageSize;
    const slice    = sorted.slice(start, start + pageSize);
    const items    = [];
    for (const runId of slice) {
      const cp = await readCheckpointSafe(runId);
      items.push({
        runId,
        lastStage: cp ? cp.lastStage : null,
        ok: !!cp,
        updatedAt: cp ? cp.updatedAt : null
      });
    }
    sendJson(res, { page, pageSize, total: sorted.length, items });
  } catch (err) {
    logger.error(`discovery.listRuns: ${err.message}`);
    sendJson(res, { error: 'internal' }, 500);
  }
}

async function getRun(req, res) {
  const runId = String(req.params.runId || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(runId)) return sendJson(res, { error: 'bad-run-id' }, 400);
  try {
    const cp = await readCheckpointSafe(runId);
    if (!cp) return sendJson(res, { error: 'not-found' }, 404);
    // Strip huge payloads from the response — keep summary-level
    const am = cp.appModel || {};
    sendJson(res, {
      runId,
      lastStage:   cp.lastStage,
      updatedAt:   cp.updatedAt,
      config:      cp.config,
      warnings:    (cp.warnings || []).slice(0, 100),
      errors:      (cp.errors   || []).slice(0, 100),
      zephyrTestCaseKeys:  cp.zephyrTestCaseKeys || [],
      summary: {
        routes:    (am.routes    || []).length,
        forms:     (am.forms     || []).length,
        contracts: (am.contracts || []).length,
        entities:  (am.entities  || []).length,
        services:  (am.services  || []).length
      }
    });
  } catch (err) {
    logger.error(`discovery.getRun(${runId}): ${err.message}`);
    sendJson(res, { error: 'internal' }, 500);
  }
}

// ── Concurrency lock (file-based, best-effort) ────────────────────────
function acquireLock(runId) {
  try { fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true }); } catch (_) {}
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ runId, pid: process.pid, ts: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    return false;
  }
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }

// ── HMAC verification — if DISCOVERY_RUN_SECRET set, require signature ──
function verifyHmac(req) {
  const secret = process.env.DISCOVERY_RUN_SECRET;
  if (!secret) return true; // if unset, relies on authGuard above
  const sig = req.headers['x-discovery-signature'] || '';
  const raw = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) { return false; }
}

async function runDiscoveryEndpoint(req, res) {
  if (!verifyHmac(req)) return sendJson(res, { error: 'invalid-signature' }, 401);

  const body = req.body || {};
  const baseUrl = body.baseUrl;
  if (!baseUrl || typeof baseUrl !== 'string') return sendJson(res, { error: 'missing-base-url' }, 400);

  const runId = body.runId || `disc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  if (!acquireLock(runId)) {
    return sendJson(res, { error: 'busy', hint: 'another discovery run is in progress' }, 409);
  }

  const args = ['scripts/run-discovery.js', '--base-url', baseUrl];
  if (body.maxDepth)   args.push('--max-depth', String(body.maxDepth));
  if (body.maxPages)   args.push('--max-pages', String(body.maxPages));
  if (body.username)   args.push('--username',  String(body.username));
  if (body.password)   args.push('--password',  String(body.password));
  if (body.headless === false) args.push('--headless=false');
  if (body.resume)     args.push('--resume', String(body.resume));
  if (body.skipPom)       args.push('--skip-pom');
  if (body.skipSpecs)     args.push('--skip-specs');
  if (body.skipContracts) args.push('--skip-contracts');
  if (body.skipPerf)      args.push('--skip-perf');
  if (body.skipSec)       args.push('--skip-sec');
  if (body.dryRun)        args.push('--dry-run');

  const logDir = path.join(ROOT, 'logs', 'discovery', runId);
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  const logStream = fs.createWriteStream(path.join(logDir, 'stdout.log'), { flags: 'a' });
  const errStream = fs.createWriteStream(path.join(logDir, 'stderr.log'), { flags: 'a' });

  const env = { ...process.env, DISCOVERY_RUN_ID: runId };
  const child = spawn(process.execPath, args, {
    cwd: ROOT, env, detached: false, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(errStream);
  child.on('exit', (code) => {
    logger.info(`discovery.api: run ${runId} exited with code ${code}`);
    releaseLock();
  });
  child.on('error', (err) => {
    logger.error(`discovery.api: run ${runId} spawn error: ${err.message}`);
    releaseLock();
  });

  sendJson(res, { accepted: true, runId, pid: child.pid }, 202);
}

async function cancelRun(req, res) {
  const runId = String(req.params.runId || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(runId)) return sendJson(res, { error: 'bad-run-id' }, 400);
  // Mark a cancellation flag the runner can poll
  const dir = path.join(ROOT, 'logs', 'discovery', runId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CANCEL'), String(Date.now()));
    sendJson(res, { cancelled: true, runId });
  } catch (err) {
    sendJson(res, { error: 'internal', message: err.message }, 500);
  }
}

module.exports = {
  getSummary,
  listRuns,
  getRun,
  runDiscovery: runDiscoveryEndpoint,
  cancelRun
};
