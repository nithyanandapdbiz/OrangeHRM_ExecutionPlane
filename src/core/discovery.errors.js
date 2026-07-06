'use strict';
/**
 * discovery.errors.js — distinct error classes for the discovery / checkpoint /
 * circuit-breaker subsystems, so callers (CI, API middleware, dashboards) can
 * branch on failure class without regex-matching messages.
 *
 * Each class extends AppError and carries a stable `code` plus optional
 * structured `details`, mirroring the errorHandler.js convention.
 */
const AppError = require('./errorHandler');

/** A circuit breaker is open — the wrapped call was short-circuited. */
class CircuitOpenError extends AppError {
  constructor(message, opts = {}) {
    super(message, 503, {
      code: 'CIRCUIT_OPEN',
      recoveryHint: opts.recoveryHint ||
        'The dependency is failing repeatedly; wait for the cooldown to elapse and retry.',
      ...opts
    });
  }
}

/** A persisted checkpoint file could not be parsed / is corrupt. */
class CheckpointCorruptError extends AppError {
  constructor(message, opts = {}) {
    super(message, 422, {
      code: 'CHECKPOINT_CORRUPT',
      recoveryHint: opts.recoveryHint ||
        'Delete the corrupt checkpoint file under logs/runs/ and re-run from the start.',
      ...opts
    });
  }
}

/** A resume attempt did not match the expected checkpoint state / schema. */
class ResumeStateMismatchError extends AppError {
  constructor(message, opts = {}) {
    super(message, 409, {
      code: 'RESUME_STATE_MISMATCH',
      recoveryHint: opts.recoveryHint ||
        'Start a fresh run (do not resume) — the stored checkpoint is missing or incompatible.',
      ...opts
    });
  }
}

module.exports = {
  CircuitOpenError,
  CheckpointCorruptError,
  ResumeStateMismatchError,
};
