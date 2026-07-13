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

const logger = require('../utils/logger');
const {
  listCheckpoints, readCheckpointSafe
} = require('../core/discovery.state');
const appCrawler = require('../discovery/appCrawler');
const execStore  = require('../discovery/discoveryExecutionStore');
const { scrub }  = require('../../middleware/pii-scrubber');
const IntelligenceClient = require('../../clients/intelligence.client');
const { governanceFor } = require('../discovery/zephyrGovernance');

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

const POLL_INTERVAL_MS = parseInt(process.env.DISCOVERY_POLL_INTERVAL_MS || '2000', 10);
const POLL_TIMEOUT_MS  = parseInt(process.env.DISCOVERY_POLL_TIMEOUT_MS  || '600000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sovereign-Split worker. The Execution Plane crawls the customer app locally,
 * scrubs PII, and delegates ALL AI synthesis to the Intelligence Plane. No AI
 * reasoning, prompt-building or artefact generation ever happens here.
 */
// Best-effort governance mirror: never let a Zephyr/Jira hiccup fail a run.
async function govSync(gov, runId, fn) {
  if (!gov) return;
  try {
    const snap = await fn(gov);
    if (snap) execStore.mergeGovernance(runId, snap);
  } catch (e) { logger.warn(`[discovery] governance sync failed ${runId}: ${e.message}`); }
}

// Names of the artefacts present, for the Zephyr/Jira evidence manifest.
function artifactManifest(a = {}) {
  const names = [];
  const add = (name, ok) => { if (ok) names.push(name); };
  add('metadata.json', a.metadata);
  add('application-model.json', a.applicationModel);
  add('navigation-graph.json', a.navGraph);
  add('knowledge-graph.json', a.knowledgeGraph);
  add('workflows.json', a.workflows);
  add('contracts.json', a.contracts);
  const intel = a.intelligence || {};
  add('business-rules.json', intel.businessRules);
  add('coverage.json', intel.coverage);
  add('risk.json', intel.risk);
  add('recommendations.json', intel.recommendations);
  add('ai-readiness.json', intel.aiReadiness);
  for (const k of ['executive', 'architect', 'qa', 'developer']) add(`reports/${k}.json`, intel.reports && intel.reports[k]);
  if (Array.isArray(a.pageObjects) && a.pageObjects.length) names.push(`page-objects/ (${a.pageObjects.length})`);
  if (Array.isArray(a.contractTests) && a.contractTests.length) names.push(`contract-tests/ (${a.contractTests.length})`);
  if (typeof a.report === 'string' && a.report) names.push('report.html');
  return names;
}

async function runDiscoveryWorker(runId, body) {
  const intel = new IntelligenceClient({ correlationId: runId });
  // Zephyr Essential native workflow (config-gated). null → unchanged standalone lifecycle.
  const gov = governanceFor(body);
  let ipRunIdOuter = null;
  try {
    // 0 — Governance: create cycle + link Jira story (Discovery Requested → Create Cycle)
    await govSync(gov, runId, (g) => g.begin({
      discoveryRunId: runId, baseUrl: body.baseUrl,
      browser: body.headless === false ? 'chromium (headed)' : 'chromium (headless)',
    }));

    // 1 — Deterministic browser crawl (Execution-Plane responsibility)
    execStore.markRunning(runId);
    const captured = await appCrawler.crawl({
      baseUrl: body.baseUrl,
      maxDepth: body.maxDepth, maxPages: body.maxPages,
      username: body.username, password: body.password,
      headless: body.headless !== false,
      isCancelled: () => execStore.isCancelled(runId),
      // Surface the live page count during the (long) crawl so the CLI shows progress.
      onProgress: (p) => { try { execStore.setStage(runId, 'crawling', { substage: `${p.routes} page(s)`, currentUrl: p.url, pagesCrawled: p.routes }); } catch { /* best-effort */ } },
    });
    execStore.setStage(runId, 'crawling', { crawlStats: captured.meta.crawlStats });
    await govSync(gov, runId, (g) => g.syncStage('crawling', 'crawling', `${captured.meta.crawlStats?.routes ?? captured.meta.crawlStats?.pages ?? ''} pages discovered`.trim()));
    if (execStore.isCancelled(runId)) { await govSync(gov, runId, (g) => g.cancel({})); return; }

    // 2 — PII scrub BEFORE anything leaves the tenant boundary
    execStore.setStage(runId, 'scrubbing');
    await govSync(gov, runId, (g) => g.syncStage('scrubbing', 'scrubbing'));
    const { scrubbed, fieldsRedacted } = scrub({ target: captured.target, appSurface: captured.appSurface, meta: captured.meta });
    if (fieldsRedacted.length) logger.warn(`[discovery] PII redacted before egress: ${fieldsRedacted.join(', ')}`);

    // 3 — Delegate synthesis to the Intelligence Plane (authenticated OAuth2)
    execStore.setStage(runId, 'synthesising');
    await govSync(gov, runId, (g) => g.syncStage('synthesising', 'synthesising'));
    const submit = await intel.discover({ ...scrubbed, domain: body.domain });
    if (!submit.success) throw new Error(`Intelligence Plane rejected discovery: ${submit.reason || submit.status}`);
    const ipRunId = submit.data.runId;
    ipRunIdOuter = ipRunId;
    execStore.setStage(runId, 'synthesising', { ipRunId });
    logger.info(`[discovery] ${runId} → IP run ${ipRunId}`);

    // 4 — Poll IP status until terminal
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let ipStatus = 'running';
    let lastSubstage = null;
    while (Date.now() < deadline) {
      if (execStore.isCancelled(runId)) { await intel.cancelDiscovery(ipRunId).catch(() => {}); await govSync(gov, runId, (g) => g.cancel({ ipRunId })); return; }
      await sleep(POLL_INTERVAL_MS);
      const st = await intel.getDiscoveryStatus(ipRunId);
      if (!st.success) continue;
      ipStatus = st.data.discovery.status;
      // Surface the IP synthesis sub-stage (contract-extract → app-model-synthesise →
      // generate-artefacts → report → intelligence) so the CLI shows progress live.
      const substage = st.data.discovery.stage;
      execStore.setStage(runId, 'synthesising', { ipRunId, substage });
      // Governance: comment only on a distinct sub-stage transition (not every poll).
      if (substage && substage !== lastSubstage) {
        lastSubstage = substage;
        await govSync(gov, runId, (g) => g.syncStage('synthesising', 'synthesising', substage));
      }
      if (['completed', 'failed', 'cancelled'].includes(ipStatus)) break;
    }
    if (ipStatus !== 'completed') throw new Error(`Intelligence Plane synthesis ${ipStatus}`);

    // 5 — Download generated artefacts
    execStore.setStage(runId, 'downloading', { ipRunId });
    await govSync(gov, runId, (g) => g.syncStage('downloading', 'downloading'));
    const art = await intel.downloadArtifacts(ipRunId);
    if (!art.success) throw new Error(`artifact download failed: ${art.reason || art.status}`);

    // 6 — Governance: finalise Zephyr execution + evidence BEFORE flipping terminal,
    //     so the polling CLI observes the completed cycle/execution atomically.
    await govSync(gov, runId, (g) => g.complete({
      metadata: art.data.artifacts?.metadata || {},
      artifactFiles: artifactManifest(art.data.artifacts),
      ipRunId,
    }));

    // 7 — Persist + complete
    execStore.complete(runId, {
      artifacts: art.data.artifacts,
      artifactSummary: art.data.artifacts?.metadata || null,
    });
  } catch (err) {
    // Governance failure sync first (execution → FAIL, never left IN PROGRESS).
    await govSync(gov, runId, (g) => g.fail({ error: err.message, ipRunId: ipRunIdOuter }));
    execStore.fail(runId, err);
  }
}

async function runDiscoveryEndpoint(req, res) {
  if (!verifyHmac(req)) return sendJson(res, { error: 'invalid-signature' }, 401);

  const body = req.body || {};
  const baseUrl = body.baseUrl;
  if (!baseUrl || typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl)) {
    return sendJson(res, { error: 'missing-or-invalid-base-url' }, 400);
  }

  const run = execStore.create({ runId: body.runId, baseUrl });
  setImmediate(() => runDiscoveryWorker(run.runId, body));

  sendJson(res, {
    accepted: true, runId: run.runId, status: run.status,
    links: {
      status:    `/discovery/runs/${run.runId}`,
      artifacts: `/discovery/runs/${run.runId}/artifacts`,
      cancel:    `/discovery/cancel/${run.runId}`,
    },
  }, 202);
}

/** Live run status from the async execution store. */
async function getRunStatus(req, res) {
  const runId = String(req.params.runId || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(runId)) return sendJson(res, { error: 'bad-run-id' }, 400);
  const view = execStore.get(runId);
  if (!view) return getRun(req, res); // fall back to checkpoint history
  return sendJson(res, view);
}

/** Generated artefacts (409 until the run completes). */
async function getArtifacts(req, res) {
  const runId = String(req.params.runId || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(runId)) return sendJson(res, { error: 'bad-run-id' }, 400);
  const r = execStore.getArtifacts(runId);
  if (!r) return sendJson(res, { error: 'not-found' }, 404);
  if (!r.ready) return sendJson(res, { error: `artefacts not ready — run is ${r.status}`, status: r.status }, 409);
  return sendJson(res, { runId, artifacts: r.artifacts });
}

async function cancelRun(req, res) {
  const runId = String(req.params.runId || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(runId)) return sendJson(res, { error: 'bad-run-id' }, 400);
  const view = execStore.cancel(runId);
  if (!view) {
    // Legacy fallback: drop a CANCEL flag for any file-based runner.
    const dir = path.join(ROOT, 'logs', 'discovery', runId);
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'CANCEL'), String(Date.now())); } catch (_) {}
    return sendJson(res, { cancelled: true, runId });
  }
  return sendJson(res, view);
}

module.exports = {
  getSummary,
  listRuns,
  getRun,
  getRunStatus,
  getArtifacts,
  runDiscovery: runDiscoveryEndpoint,
  runDiscoveryWorker,
  cancelRun,
};
