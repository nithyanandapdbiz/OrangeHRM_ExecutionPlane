'use strict';
/**
 * discovery.state.js — checkpoint read/write for the discovery pipeline.
 *
 * Each run writes atomically to tests/discovery/state/<runId>.json after every
 * stage so `--resume=<runId>` can skip completed stages.
 *
 * File shape (schema version 1):
 *   {
 *     version:    1,
 *     runId:      "<uuid-like>",
 *     startedAt:  "ISO8601",
 *     updatedAt:  "ISO8601",
 *     lastStage:  "discoveryCrawl",    // last completed stage name
 *     config:     { ... },
 *     appModel:   { ... },
 *     virtualStory: { ... } | null,
 *     errors:     [],
 *     warnings:   []
 *   }
 */

const fs   = require('fs');
const path = require('path');
const {
  CheckpointCorruptError,
  ResumeStateMismatchError
} = require('./discovery.errors');

const CHECKPOINT_VERSION = 1;
const ROOT     = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ROOT, 'tests', 'discovery', 'state');
const CORRUPT_DIR = path.join(STATE_DIR, 'corrupt');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
}

function checkpointPath(runId) {
  if (!runId || !/^[A-Za-z0-9_\-]+$/.test(runId)) {
    throw new ResumeStateMismatchError(`Invalid runId for checkpoint: ${runId}`);
  }
  return path.join(STATE_DIR, `${runId}.json`);
}

/**
 * Validate a parsed checkpoint object. Pure — returns boolean.
 */
function validateCheckpoint(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.version !== CHECKPOINT_VERSION) return false;
  if (typeof raw.runId !== 'string' || !raw.runId) return false;
  if (typeof raw.startedAt !== 'string') return false;
  if ((raw.errors !== null && raw.errors !== undefined) && !Array.isArray(raw.errors)) return false;
  if ((raw.warnings !== null && raw.warnings !== undefined) && !Array.isArray(raw.warnings)) return false;
  return true;
}

/**
 * Atomic write: JSON.stringify → tmp file → rename.
 */
async function writeCheckpoint(runId, stage, payload = {}) {
  ensureDir(STATE_DIR);
  const file = checkpointPath(runId);
  const prior = await readCheckpointSafe(runId);
  const next = {
    version:   CHECKPOINT_VERSION,
    runId,
    startedAt: (prior && prior.startedAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastStage: stage || (prior && prior.lastStage) || null,
    config:      payload.config      !== undefined ? payload.config      : (prior && prior.config)      || null,
    appModel:    payload.appModel    !== undefined ? payload.appModel    : (prior && prior.appModel)    || {},
    virtualStory: payload.virtualStory !== undefined ? payload.virtualStory : (prior && prior.virtualStory) || null,
    artefacts:   payload.artefacts   !== undefined ? payload.artefacts   : (prior && prior.artefacts)   || {},
    zephyrTestCaseKeys:  payload.zephyrTestCaseKeys  !== undefined ? payload.zephyrTestCaseKeys  : (prior && prior.zephyrTestCaseKeys)  || [],
    errors:      Array.isArray(payload.errors)   ? payload.errors   : (prior && prior.errors)   || [],
    warnings:    Array.isArray(payload.warnings) ? payload.warnings : (prior && prior.warnings) || []
  };

  // F3: unique temp file per write so concurrent same-runId checkpoints never share a
  // temp path (the cause of intermittent ENOENT on rename). Rename is retried once, then
  // falls back to a direct write. Checkpoint CONTENT is unchanged (determinism preserved).
  const tmp = `${file}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify(next, null, 2);
  await fs.promises.writeFile(tmp, body, 'utf8');
  try {
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try { await fs.promises.rename(tmp, file); }
    catch { await fs.promises.writeFile(file, body, 'utf8'); await fs.promises.unlink(tmp).catch(() => {}); }
  }
  return { path: file, state: next };
}

/**
 * Read + validate. Throws CheckpointCorruptError / ResumeStateMismatchError on problems.
 */
async function readCheckpoint(runId) {
  const file = checkpointPath(runId);
  if (!fs.existsSync(file)) {
    throw new ResumeStateMismatchError(`No checkpoint found for runId=${runId}`, {
      details: { file }
    });
  }
  let raw;
  try {
    raw = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (e) {
    throw new CheckpointCorruptError(`Checkpoint JSON unparseable: ${e.message}`, {
      details: { file }
    });
  }
  if (!validateCheckpoint(raw)) {
    throw new ResumeStateMismatchError(`Checkpoint schema mismatch (expected v${CHECKPOINT_VERSION})`, {
      details: { file, got: raw.version }
    });
  }
  return raw;
}

/** Best-effort read for internal merge; returns null on any error. */
async function readCheckpointSafe(runId) {
  try {
    return await readCheckpoint(runId);
  } catch (_) {
    return null;
  }
}

/** Move a corrupt checkpoint into state/corrupt/ and return its new path. */
async function quarantineCheckpoint(runId) {
  ensureDir(CORRUPT_DIR);
  const src = checkpointPath(runId);
  if (!fs.existsSync(src)) return null;
  const dst = path.join(CORRUPT_DIR, `${runId}.${Date.now()}.json`);
  await fs.promises.rename(src, dst);
  return dst;
}

/** List every runId with a valid checkpoint, newest-first by mtime. */
async function listCheckpoints() {
  ensureDir(STATE_DIR);
  const entries = [];
  for (const f of await fs.promises.readdir(STATE_DIR)) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    const full = path.join(STATE_DIR, f);
    try {
      const st = await fs.promises.stat(full);
      if (!st.isFile()) continue;
      entries.push({ runId: f.replace(/\.json$/, ''), mtimeMs: st.mtimeMs, path: full });
    } catch (_) { /* skip */ }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

module.exports = {
  CHECKPOINT_VERSION,
  STATE_DIR,
  writeCheckpoint,
  readCheckpoint,
  readCheckpointSafe,
  validateCheckpoint,
  quarantineCheckpoint,
  listCheckpoints,
  checkpointPath
};
