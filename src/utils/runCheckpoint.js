'use strict';
/**
 * runCheckpoint — execution idempotency guard and stage-level recovery engine.
 *
 * Stores a per-pipeline+story checkpoint file under logs/runs/.
 * Each file is the authoritative run record for a given pipeline+storyId pair
 * and is overwritten in place as the run progresses.
 *
 * Provides:
 *   • Duplicate-execution detection (skip if already COMPLETED with same input)
 *   • Stage-level resume (resume from the last completed stage on retry)
 *   • ALM protection (Jira/Zephyr apply stage is cached; not re-executed on retry)
 *   • Force-rerun bypass (opts.force skips all guards)
 *
 * Checkpoint schema (schemaVersion 1):
 * {
 *   schemaVersion:   1,
 *   runId:           string   — unique per attempt
 *   storyId:         string   — Jira key, headSha, etc.
 *   pipeline:        string   — 'agent-chain' | 'agent-pipeline' | 'dev-change'
 *   startedAt:       ISO string
 *   completedAt:     ISO string | null
 *   currentStage:    string | null
 *   completedStages: string[]
 *   status:          'STARTED' | 'RUNNING' | 'FAILED' | 'COMPLETED' | 'ABORTED'
 *   planHash:        string | null   — sha256 fingerprint of the input
 *   stageResults:    { [stageName]: cachedResult, _final?: finalOutput }
 *   metadata: {
 *     degradedAgents: string[],
 *     lastError:      string | null,
 *     retryCount:     number,
 *     forcedRerun:    boolean
 *   }
 * }
 *
 * File location: {RUNS_DIR}/{sanitised-pipeline}_{sanitised-storyId}.json
 * Override: set RUN_CHECKPOINT_DIR env var.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const RUN_STATUS = Object.freeze({
  STARTED:   'STARTED',
  RUNNING:   'RUNNING',
  FAILED:    'FAILED',
  COMPLETED: 'COMPLETED',
  ABORTED:   'ABORTED'
});

// Read RUNS_DIR at call time so tests can override via process.env.
function _runsDir() {
  return process.env.RUN_CHECKPOINT_DIR
    || path.resolve(__dirname, '..', '..', 'logs', 'runs');
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Remove filesystem-unsafe characters; collapse repeated dashes. */
function _sanitise(s) {
  if (!s || typeof s !== 'string') return 'unknown';
  return s.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-{2,}/g, '-').slice(0, 80);
}

/**
 * Return the absolute path to the checkpoint file for a given pipeline+storyId.
 * @param {string} pipeline
 * @param {string} storyId
 * @returns {string}
 */
function checkpointPath(pipeline, storyId) {
  return path.join(_runsDir(), `${_sanitise(pipeline)}_${_sanitise(storyId)}.json`);
}

function _generateRunId(pipeline, storyId) {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${_sanitise(pipeline)}_${_sanitise(storyId)}_${ts}${rnd}`;
}

/**
 * Compute a short SHA-256 fingerprint of any input value.
 * Returns `'sha256:<16 hex chars>'` or null when input is falsy.
 */
function computePlanHash(input) {
  if (!input) return null;
  try {
    const content = typeof input === 'string' ? input : JSON.stringify(input);
    return 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
  } catch (_) {
    return null;
  }
}

// ── Low-level I/O ─────────────────────────────────────────────────────────────

function _ensureDir() {
  try { fs.mkdirSync(_runsDir(), { recursive: true }); } catch (_) {}
}

/**
 * Read and parse the checkpoint for a given pipeline+storyId.
 * Returns null when the file is absent or cannot be parsed (treated as no checkpoint).
 */
function load(pipeline, storyId) {
  const file = checkpointPath(pipeline, storyId);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Persist the checkpoint. Failures are silently swallowed — checkpoint writes
 * must never interrupt a pipeline execution.
 */
function _write(cp) {
  _ensureDir();
  const file = checkpointPath(cp.pipeline, cp.storyId);
  try {
    fs.writeFileSync(file, JSON.stringify(cp, null, 2) + '\n', 'utf8');
  } catch (_) { /* best-effort */ }
}

// ── Lifecycle API ─────────────────────────────────────────────────────────────

/**
 * Create a fresh checkpoint. Any prior checkpoint for the same pipeline+storyId
 * is overwritten.
 *
 * @param {string}  pipeline
 * @param {string}  storyId
 * @param {object}  [opts]
 * @param {string}  [opts.planHash]  — input fingerprint
 * @param {boolean} [opts.force]     — true when invoked with --force
 * @returns {object} checkpoint
 */
function create(pipeline, storyId, opts = {}) {
  const cp = {
    schemaVersion:   1,
    runId:           _generateRunId(pipeline, storyId),
    storyId,
    pipeline,
    startedAt:       new Date().toISOString(),
    completedAt:     null,
    currentStage:    null,
    completedStages: [],
    status:          RUN_STATUS.STARTED,
    planHash:        opts.planHash || null,
    stageResults:    {},
    metadata: {
      degradedAgents: [],
      lastError:      null,
      retryCount:     0,
      forcedRerun:    !!opts.force
    }
  };
  _write(cp);
  return cp;
}

/**
 * Transition to RUNNING and record the current stage.
 * @param {object} cp    — checkpoint (mutated in place)
 * @param {string} stage
 * @returns {object} cp
 */
function markRunning(cp, stage) {
  cp.status       = RUN_STATUS.RUNNING;
  cp.currentStage = stage;
  _write(cp);
  return cp;
}

/**
 * Record a completed stage and cache its result for resume.
 * @param {object} cp
 * @param {string} stage
 * @param {*}      result — agent output to cache
 * @returns {object} cp
 */
function markStageComplete(cp, stage, result) {
  if (!cp.completedStages.includes(stage)) cp.completedStages.push(stage);
  cp.stageResults[stage] = result;
  cp.currentStage = stage;
  _write(cp);
  return cp;
}

/**
 * Mark COMPLETED and persist the final pipeline output.
 * @param {object} cp
 * @param {*}      [finalResult] — full pipeline result (stored for skip-on-duplicate)
 * @returns {object} cp
 */
function markCompleted(cp, finalResult) {
  cp.status      = RUN_STATUS.COMPLETED;
  cp.completedAt = new Date().toISOString();
  cp.currentStage = null;
  if (finalResult !== undefined) cp.stageResults._final = finalResult;
  _write(cp);
  return cp;
}

/**
 * Mark FAILED and record the error message.
 * @param {object}       cp
 * @param {Error|string} err
 * @returns {object} cp
 */
function markFailed(cp, err) {
  cp.status = RUN_STATUS.FAILED;
  cp.metadata.lastError = err instanceof Error ? err.message : String(err || 'unknown error');
  _write(cp);
  return cp;
}

/**
 * Mark ABORTED (e.g. by timeout or external signal).
 * @param {object} cp
 * @param {string} [reason]
 * @returns {object} cp
 */
function markAborted(cp, reason) {
  cp.status = RUN_STATUS.ABORTED;
  cp.metadata.lastError = String(reason || 'aborted');
  _write(cp);
  return cp;
}

// ── Idempotency guard ─────────────────────────────────────────────────────────

/**
 * Determine whether to skip, resume, or start a fresh run.
 *
 * Decision table:
 *   force=true                    → { skip: false, reason: 'forced' }
 *   no file                       → { skip: false, reason: 'fresh' }
 *   file exists, missing fields   → { skip: false, reason: 'corrupt' }
 *   COMPLETED + same planHash     → { skip: true,  reason: 'already-completed' }
 *   COMPLETED + different hash    → { skip: false, reason: 'input-changed' }
 *   STARTED | RUNNING | FAILED | ABORTED → { skip: false, reason: 'resume' }
 *
 * @param {string}  pipeline
 * @param {string}  storyId
 * @param {string|null} planHash  — pass null to skip hash comparison
 * @param {boolean} force
 * @returns {{ skip: boolean, checkpoint: object|null, reason: string }}
 */
function checkExisting(pipeline, storyId, planHash, force) {
  if (force) return { skip: false, checkpoint: null, reason: 'forced' };

  const cp = load(pipeline, storyId);
  if (!cp)               return { skip: false, checkpoint: null, reason: 'fresh' };
  if (!cp.runId || !cp.status) return { skip: false, checkpoint: null, reason: 'corrupt' };

  if (cp.status === RUN_STATUS.COMPLETED) {
    // planHash=null means caller wants status-based check only
    if (planHash !== null && cp.planHash !== planHash) {
      return { skip: false, checkpoint: null, reason: 'input-changed' };
    }
    return { skip: true, checkpoint: cp, reason: 'already-completed' };
  }

  // Incomplete run — offer resume
  return { skip: false, checkpoint: cp, reason: 'resume' };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  RUN_STATUS,
  get RUNS_DIR() { return _runsDir(); },
  checkpointPath,
  computePlanHash,
  load,
  create,
  markRunning,
  markStageComplete,
  markCompleted,
  markFailed,
  markAborted,
  checkExisting
};
