'use strict';
/**
 * devChange.controller.js — REST endpoints for the dev-change reconciliation
 * subsystem. Mounted at /dev-change. Auth-gated by the existing authGuard
 * middleware (same as other observability endpoints).
 *
 * Endpoints:
 *   POST /dev-change/analyse                     trigger run async (returns jobId)
 *   GET  /dev-change/jobs/:id                    job status + report URL
 *   GET  /dev-change/decisions                   recent agent decisions (paginated)
 *   GET  /dev-change/quarantine                  pending-review artifacts
 *   POST /dev-change/quarantine/:id/approve      mark a quarantine entry approved
 *   GET  /dev-change/cycles                      list recent dev-change cycles
 *   GET  /dev-change/cycles/:headSha             cycle metadata + entries + status
 *   POST /dev-change/cycles/:headSha/execute     trigger execution of an existing cycle
 *   POST /dev-change/cycles/:headSha/companion/promote  promote companion entries
 *   GET  /dev-change/patterns                    learned patterns (when enabled)
 *
 * Heavy work runs in a detached child_process so the request returns
 * immediately. Job state is kept in an in-memory Map; the canonical
 * record on disk is logs/dev-change/<headSha>-report.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'logs', 'dev-change');
const QUARANTINE_FILE = path.join(LOG_DIR, 'quarantine.json');
const PATTERNS_FILE = path.join(LOG_DIR, 'patterns.json');
const CYCLE_FILE = path.join(ROOT, '.dev-change-cycle.json');

// In-memory job registry — cleared on process restart. The on-disk report
// remains the source of truth for completed jobs.
const jobs = new Map();

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (_e) { /* noop */ } }
function readJSONSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return fallback; }
}
function writeJSONSafe(p, obj) {
  try { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); return true; }
  catch (_e) { return false; }
}

function newJobId() {
  return `devchange-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ─── POST /dev-change/analyse ───────────────────────────────────────────────
function postAnalyse(req, res) {
  const body = req.body || {};
  const baseSha = String(body.baseSha || body.base || '').trim();
  const headSha = String(body.headSha || body.head || '').trim();
  if (!baseSha || !headSha) {
    return res.status(400).json({ error: 'baseSha and headSha are required' });
  }

  const flags = [`--base=${baseSha}`, `--head=${headSha}`];
  if (body.dryRun) flags.push('--dry-run');
  if (body.noAi) flags.push('--no-ai');
  if (body.skipExecution !== false) flags.push('--skip-execution');
  if (body.skipAuthoring) flags.push('--skip-authoring');
  if (body.skipReflection) flags.push('--skip-reflection');
  if (body.headless) flags.push('--headless');
  if (Number.isFinite(body.autoApproveThreshold)) {
    flags.push(`--auto-approve-threshold=${body.autoApproveThreshold}`);
  }

  const id = newJobId();
  const job = {
    id, baseSha, headSha,
    status: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    reportFile: null,
    error: null,
    flags
  };
  jobs.set(id, job);

  // Spawn detached so HTTP request returns immediately.
  try {
    const cli = path.join(ROOT, 'scripts', 'run-dev-change-pipeline.js');
    const child = spawn(process.execPath, [cli, ...flags], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    job.pid = child.pid;
    job.status = 'running';
    child.on('exit', (code) => {
      job.exitCode = code;
      job.status = code === 0 ? 'succeeded' : (code === 2 ? 'review-required' : 'failed');
      job.finishedAt = new Date().toISOString();
      const sha7 = headSha.slice(0, 7);
      const report = path.join(LOG_DIR, `${sha7}-report.json`);
      if (fs.existsSync(report)) job.reportFile = path.relative(ROOT, report);
    });
    child.on('error', (err) => {
      job.status = 'failed';
      job.error = String(err && err.message || err);
      job.finishedAt = new Date().toISOString();
    });
    child.unref();
  } catch (err) {
    job.status = 'failed';
    job.error = String(err && err.message || err);
    job.finishedAt = new Date().toISOString();
  }

  return res.status(202).json({ jobId: id, status: job.status });
}

// ─── GET /dev-change/jobs/:id ───────────────────────────────────────────────
function getJob(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  return res.json(job);
}

// ─── GET /dev-change/decisions ──────────────────────────────────────────────
function getDecisions(req, res) {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) limit = 50;
  const agentName = (typeof req.query.agentName === 'string' && req.query.agentName.trim())
    ? req.query.agentName.trim() : null;

  // Decision-log persistence is not wired up in this deployment. Optionally
  // load a decision-log module if one is present, but never hard-depend on it
  // so a missing module can't crash the endpoint. When absent, return an
  // empty (no-op) result set.
  let entries = [];
  try {
    const logPath = path.join(ROOT, 'src', 'services', 'decisionLog.service.js');
    if (fs.existsSync(logPath)) {
      const log = require(logPath);
      if (log && typeof log.readDecisions === 'function') {
        entries = log.readDecisions({ limit, agentName }) || [];
      }
    }
  } catch (_e) { entries = []; }

  const devChangeAgents = new Set([
    'changeIntelligence', 'testDiscovery', 'testAuthoring',
    'testCycleCurator', 'executionReflection',
    'adversarial', 'critic'
  ]);
  const filtered = agentName ? entries : entries.filter((e) => devChangeAgents.has(e.agentName));
  return res.json({ total: filtered.length, entries: filtered });
}

// ─── GET /dev-change/quarantine ─────────────────────────────────────────────
function getQuarantine(req, res) {
  const data = readJSONSafe(QUARANTINE_FILE, { entries: [] });
  return res.json({ total: (data.entries || []).length, entries: data.entries || [] });
}

// ─── POST /dev-change/quarantine/:id/approve ────────────────────────────────
function postQuarantineApprove(req, res) {
  const id = req.params.id;
  const data = readJSONSafe(QUARANTINE_FILE, { entries: [] });
  const list = Array.isArray(data.entries) ? data.entries : [];
  const idx = list.findIndex((e) => e && (e.id === id || e.testCaseKey === id));
  if (idx < 0) return res.status(404).json({ error: 'quarantine entry not found' });
  list[idx].approved = true;
  list[idx].approvedAt = new Date().toISOString();
  list[idx].approvedBy = (req.headers['x-user'] || 'unknown');
  data.entries = list;
  writeJSONSafe(QUARANTINE_FILE, data);
  return res.json({ ok: true, entry: list[idx] });
}

// ─── GET /dev-change/cycles ─────────────────────────────────────────────────
function listCycles(req, res) {
  ensureDir(LOG_DIR);
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR)
      .filter((f) => /-report\.json$/.test(f))
      .map((f) => {
        const full = path.join(LOG_DIR, f);
        let stat = null; try { stat = fs.statSync(full); } catch (_e) { /* noop */ }
        const data = readJSONSafe(full, {});
        return {
          headSha: (data.headSha || f.replace('-report.json', '')),
          baseSha: data.baseSha || null,
          mainCycleKey: data.mainCycle && data.mainCycle.key,
          companionCycleKey: data.companionCycle && data.companionCycle.key,
          dryRun: !!data.dryRun,
          aiUsed: !!data.aiUsed,
          recordedAt: data.recordedAt || (stat ? new Date(stat.mtimeMs).toISOString() : null),
          reportFile: path.relative(ROOT, full)
        };
      })
      .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')));
  } catch (_e) { /* noop */ }
  return res.json({ total: files.length, cycles: files.slice(0, 100) });
}

// ─── GET /dev-change/cycles/:headSha ────────────────────────────────────────
function getCycle(req, res) {
  const sha = String(req.params.headSha || '').slice(0, 40);
  const sha7 = sha.slice(0, 7);
  const report = path.join(LOG_DIR, `${sha7}-report.json`);
  if (!fs.existsSync(report)) {
    return res.status(404).json({ error: 'cycle report not found', headSha: sha });
  }
  const data = readJSONSafe(report, null);
  if (!data) return res.status(500).json({ error: 'failed to parse report' });
  return res.json(data);
}

// ─── POST /dev-change/cycles/:headSha/execute ───────────────────────────────
function postExecute(req, res) {
  const sha = String(req.params.headSha || '').slice(0, 40);
  const cycle = readJSONSafe(CYCLE_FILE, null);
  if (!cycle) return res.status(404).json({ error: '.dev-change-cycle.json not found' });
  if (cycle.headSha && cycle.headSha !== sha) {
    return res.status(409).json({ error: 'head sha mismatch with current cycle file', expected: cycle.headSha });
  }
  // Resolve specs and spawn Playwright.
  let mapping;
  try {
    const em = require('../services/executionMapping.service');
    mapping = em.resolveSpecsForCycle(CYCLE_FILE);
  } catch (err) {
    return res.status(500).json({ error: 'spec resolution failed', detail: String(err && err.message || err) });
  }
  if (!mapping || !mapping.valid) {
    return res.status(400).json({ error: 'cycle spec resolution invalid', mapping });
  }
  if (!mapping.allSpecPaths.length) {
    return res.json({ ok: true, executed: false, reason: 'no specs mapped' });
  }
  try {
    const child = spawn('npx', ['playwright', 'test', ...mapping.allSpecPaths], {
      cwd: ROOT, detached: true, stdio: 'ignore', shell: true, env: process.env
    });
    child.unref();
    return res.status(202).json({ ok: true, executed: true, pid: child.pid, specs: mapping.allSpecPaths.length });
  } catch (err) {
    return res.status(500).json({ error: 'failed to spawn playwright', detail: String(err && err.message || err) });
  }
}

// ─── POST /dev-change/cycles/:headSha/companion/promote ─────────────────────
function postPromoteCompanion(req, res) {
  const sha = String(req.params.headSha || '').slice(0, 40);
  const sha7 = sha.slice(0, 7);
  const report = path.join(LOG_DIR, `${sha7}-report.json`);
  const data = readJSONSafe(report, null);
  if (!data) return res.status(404).json({ error: 'cycle report not found' });
  if (!data.companionCycle) return res.status(400).json({ error: 'no companion cycle on this run' });

  data.companionCycle.promoted = true;
  data.companionCycle.promotedAt = new Date().toISOString();
  data.companionCycle.promotedBy = (req.headers['x-user'] || 'unknown');
  writeJSONSafe(report, data);
  return res.json({ ok: true, companion: data.companionCycle });
}

// ─── GET /dev-change/patterns ───────────────────────────────────────────────
function getPatterns(req, res) {
  const data = readJSONSafe(PATTERNS_FILE, { patterns: [] });
  return res.json({ total: (data.patterns || []).length, patterns: data.patterns || [] });
}

module.exports = {
  postAnalyse,
  getJob,
  getDecisions,
  getQuarantine,
  postQuarantineApprove,
  listCycles,
  getCycle,
  postExecute,
  postPromoteCompanion,
  getPatterns,
  _internals: { jobs }
};
