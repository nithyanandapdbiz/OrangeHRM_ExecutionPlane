'use strict';
/**
 * discoveryExecutionStore.js — Execution-Plane async run store for discovery.
 *
 * A discovery run is long-running (browser crawl + remote synthesis), so the
 * HTTP request must never block. The controller accepts the request (202), this
 * store tracks lifecycle, and status/artifacts are polled separately.
 *
 * Durability: transitions mirror to the existing discovery checkpoint store
 * (src/core/discovery.state.js). Generated artefacts returned by the Intelligence
 * Plane are persisted under logs/discovery/<runId>/artifacts.json.
 *
 * Lifecycle: queued → crawling → synthesising → downloading → completed | failed | cancelled
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const state = require('../core/discovery.state');

const ROOT = path.resolve(__dirname, '..', '..');
const RUN_DIR = (runId) => path.join(ROOT, 'logs', 'discovery', runId);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STAGE_PROGRESS = {
  queued: 0, crawling: 25, scrubbing: 45, synthesising: 65, downloading: 88,
  completed: 100, failed: 100, cancelled: 100,
};

const runs = new Map();
const now = () => new Date().toISOString();

// F2: bounded retention — TTL + capacity caps. Active runs are never evicted; artefacts
// are persisted to disk so eviction is lossless. Configurable via env.
const RETENTION = {
  ttlMs:        parseInt(process.env.DISCOVERY_RUN_TTL_MS || String(24 * 60 * 60 * 1000), 10),
  maxCompleted: parseInt(process.env.DISCOVERY_MAX_COMPLETED_RUNS || '100', 10),
  maxFailed:    parseInt(process.env.DISCOVERY_MAX_FAILED_RUNS || '50', 10),
};
let evictedCount = 0;
function terminalTime(rec) { return Date.parse(rec.completedAt || rec.updatedAt || rec.startedAt) || 0; }
function evict(nowMs = Date.now()) {
  for (const rec of [...runs.values()]) {
    if (TERMINAL.has(rec.status) && nowMs - terminalTime(rec) > RETENTION.ttlMs) {
      runs.delete(rec.runId); evictedCount++;
      logger.info(`[discoveryExecStore] evicted (ttl) runId=${rec.runId}`);
    }
  }
  const capBy = (statuses, cap) => {
    const list = [...runs.values()].filter((r) => statuses.includes(r.status)).sort((a, b) => terminalTime(a) - terminalTime(b));
    while (list.length > cap) {
      const r = list.shift(); runs.delete(r.runId); evictedCount++;
      logger.info(`[discoveryExecStore] evicted (capacity:${statuses.join('/')}) runId=${r.runId}`);
    }
  };
  capBy(['completed'], RETENTION.maxCompleted);
  capBy(['failed', 'cancelled'], RETENTION.maxFailed);
}
function metrics() {
  const all = [...runs.values()];
  return {
    retained: all.length,
    active: all.filter((r) => !TERMINAL.has(r.status)).length,
    completed: all.filter((r) => r.status === 'completed').length,
    failed: all.filter((r) => r.status === 'failed' || r.status === 'cancelled').length,
    evicted: evictedCount,
  };
}

function newRunId() {
  return `disc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function publicView(rec) {
  if (!rec) return null;
  return {
    runId: rec.runId, status: rec.status, stage: rec.stage, substage: rec.substage || null, progress: rec.progress,
    currentUrl: rec.currentUrl || null, pagesCrawled: rec.pagesCrawled || 0,
    baseUrl: rec.baseUrl, ipRunId: rec.ipRunId || null,
    startedAt: rec.startedAt, updatedAt: rec.updatedAt, completedAt: rec.completedAt || null,
    attempts: rec.attempts, error: rec.error || null,
    crawlStats: rec.crawlStats || null, artifactSummary: rec.artifactSummary || null,
  };
}

async function persist(rec) {
  try {
    await state.writeCheckpoint(rec.runId, rec.stage || rec.status, {
      config: { baseUrl: rec.baseUrl, ipRunId: rec.ipRunId },
      warnings: [], errors: rec.error ? [rec.error] : [],
    });
  } catch (e) { logger.warn(`[discoveryExecStore] persist failed ${rec.runId}: ${e.message}`); }
}

function create({ runId = null, baseUrl } = {}) {
  evict(); // F2: reclaim expired/over-capacity terminal runs before admitting a new one
  const id = runId || newRunId();
  const rec = {
    runId: id, baseUrl, status: 'queued', stage: 'queued', progress: 0,
    startedAt: now(), updatedAt: now(), completedAt: null, attempts: 0,
    ipRunId: null, error: null, crawlStats: null, artifactSummary: null,
    cancelRequested: false,
  };
  runs.set(id, rec);
  persist(rec);
  logger.info(`[discoveryExecStore] created runId=${id} baseUrl=${baseUrl}`);
  return publicView(rec);
}

function setStage(runId, stage, extra = {}) {
  const rec = runs.get(runId);
  if (!rec) return;
  // Never resurrect a terminal/cancelled run — only record trailing metadata.
  if (rec.cancelRequested || TERMINAL.has(rec.status)) {
    if (extra.ipRunId) rec.ipRunId = extra.ipRunId;
    if (extra.crawlStats) rec.crawlStats = extra.crawlStats;
    rec.updatedAt = now();
    return;
  }
  rec.status = TERMINAL.has(stage) ? stage : (stage === 'queued' ? 'queued' : 'running');
  rec.stage = stage;
  rec.progress = STAGE_PROGRESS[stage] ?? rec.progress;
  if (extra.ipRunId) rec.ipRunId = extra.ipRunId;
  if (extra.crawlStats) rec.crawlStats = extra.crawlStats;
  if (extra.substage !== undefined) rec.substage = extra.substage;
  if (extra.currentUrl !== undefined) rec.currentUrl = extra.currentUrl;
  if (extra.pagesCrawled !== undefined) rec.pagesCrawled = extra.pagesCrawled;
  rec.updatedAt = now();
  persist(rec);
}

function markRunning(runId) {
  const rec = runs.get(runId);
  if (!rec || rec.cancelRequested || TERMINAL.has(rec.status)) return;
  rec.attempts += 1;
  setStage(runId, 'crawling');
}

function complete(runId, { artifacts, artifactSummary } = {}) {
  const rec = runs.get(runId);
  if (!rec) return;
  try {
    fs.mkdirSync(RUN_DIR(runId), { recursive: true });
    fs.writeFileSync(path.join(RUN_DIR(runId), 'artifacts.json'), JSON.stringify(artifacts || {}, null, 2));
  } catch (e) { logger.warn(`[discoveryExecStore] artifact persist failed ${runId}: ${e.message}`); }
  rec.status = 'completed'; rec.stage = 'completed'; rec.progress = 100;
  rec.completedAt = now(); rec.updatedAt = now();
  rec.artifactSummary = artifactSummary || null;
  persist(rec);
  logger.info(`[discoveryExecStore] completed runId=${runId}`);
}

function fail(runId, err) {
  const rec = runs.get(runId);
  if (!rec) return;
  rec.status = 'failed'; rec.stage = 'failed'; rec.progress = 100;
  rec.completedAt = now(); rec.updatedAt = now();
  rec.error = typeof err === 'string' ? err : (err?.message || 'unknown error');
  persist(rec);
  logger.error(`[discoveryExecStore] failed runId=${runId}: ${rec.error}`);
}

function cancel(runId) {
  const rec = runs.get(runId);
  if (!rec) return null;
  if (TERMINAL.has(rec.status)) return publicView(rec);
  rec.cancelRequested = true;
  rec.status = 'cancelled'; rec.stage = 'cancelled';
  rec.completedAt = now(); rec.updatedAt = now();
  persist(rec);
  return publicView(rec);
}

function isCancelled(runId) {
  const rec = runs.get(runId);
  return !rec || rec.cancelRequested === true;
}

function get(runId) { return publicView(runs.get(runId)); }

function getArtifacts(runId) {
  const rec = runs.get(runId);
  if (!rec) return null;
  if (rec.status !== 'completed') return { ready: false, status: rec.status };
  try {
    const raw = fs.readFileSync(path.join(RUN_DIR(runId), 'artifacts.json'), 'utf8');
    return { ready: true, status: 'completed', artifacts: JSON.parse(raw) };
  } catch (e) { return { ready: false, status: 'completed', error: `artifacts unreadable: ${e.message}` }; }
}

function list() { return [...runs.values()].map(publicView); }
function _reset() { runs.clear(); evictedCount = 0; }

module.exports = {
  create, setStage, markRunning, complete, fail, cancel, isCancelled,
  get, getArtifacts, list, newRunId, publicView, _reset, RUN_DIR,
  evict, metrics, RETENTION,
};
