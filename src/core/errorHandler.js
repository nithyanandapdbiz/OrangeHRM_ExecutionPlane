'use strict';

/**
 * AppError — base error with HTTP-status + actionable recovery hint.
 *
 * Subclasses carry distinct `code` values so callers (CI, API middleware,
 * dashboards) can branch on failure class without regex-matching messages.
 */
class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [status=500]
   * @param {object} [opts]
   * @param {string} [opts.code]         - stable error code e.g. "TIMEOUT"
   * @param {string} [opts.recoveryHint] - one-line actionable remediation
   * @param {object} [opts.details]      - freeform structured details
   */
  constructor(message, status = 500, opts = {}) {
    super(message);
    this.name         = this.constructor.name;
    this.status       = status;
    this.code         = opts.code || 'APP_ERROR';
    this.recoveryHint = opts.recoveryHint || null;
    this.details      = opts.details || null;
  }

  toJSON() {
    return {
      name:         this.name,
      message:      this.message,
      status:       this.status,
      code:         this.code,
      recoveryHint: this.recoveryHint,
      details:      this.details
    };
  }
}

/** Process exceeded wall-clock limit. Often recoverable by retrying with more time. */
class TimeoutError extends AppError {
  constructor(message, opts = {}) {
    super(message, 504, {
      code: 'TIMEOUT',
      recoveryHint: opts.recoveryHint ||
        'Increase the timeout via environment variable or reduce workload scope.',
      ...opts
    });
  }
}

/** Child process exited with a non-zero exit code (ran to completion but failed). */
class NonZeroExitError extends AppError {
  constructor(message, opts = {}) {
    super(message, 500, {
      code: 'NON_ZERO_EXIT',
      recoveryHint: opts.recoveryHint ||
        'Inspect the tool stdout/stderr for the actual failure and re-run.',
      ...opts
    });
  }
}

/** Failed to spawn the child process at all (binary missing, permission denied). */
class SpawnError extends AppError {
  constructor(message, opts = {}) {
    super(message, 500, {
      code: 'SPAWN_FAILED',
      recoveryHint: opts.recoveryHint ||
        'Verify the binary is installed and on PATH (e.g. run `where k6` / `where npx`).',
      ...opts
    });
  }
}

/** External dependency (Jira, Zephyr, ZAP) not reachable. */
class UpstreamError extends AppError {
  constructor(message, opts = {}) {
    super(message, 502, {
      code: 'UPSTREAM_UNAVAILABLE',
      recoveryHint: opts.recoveryHint ||
        'Verify credentials and connectivity to the upstream service.',
      ...opts
    });
  }
}

/** Precondition for a pipeline stage was not met. */
class PreconditionError extends AppError {
  constructor(message, opts = {}) {
    super(message, 412, {
      code: 'PRECONDITION_FAILED',
      recoveryHint: opts.recoveryHint ||
        'Run the prior stage or ensure required inputs exist.',
      ...opts
    });
  }
}

// ─── Dev-Change Reconciliation (Section 23) ─────────────────────────────────
// Additive subclasses for the dev-change subsystem. Carry distinct codes so
// CI / dashboards / API middleware can branch on failure class without
// regex-matching messages, mirroring the pattern of the classes above.

/** A dev-change agent failed to produce a usable analysis (rule-based + AI both unable to recover). */
class DevChangeAnalysisError extends AppError {
  constructor(message, opts = {}) {
    super(message, 500, {
      code: 'DEV_CHANGE_ANALYSIS_FAILED',
      recoveryHint: opts.recoveryHint ||
        'Re-run with --no-ai to force the rule-based fallback, or inspect logs/dev-change/<sha>-report.json.',
      ...opts
    });
  }
}

/** A dev-change run exceeded the configured token / cost budget for a single execution. */
class DevChangeBudgetError extends AppError {
  constructor(message, opts = {}) {
    super(message, 429, {
      code: 'DEV_CHANGE_BUDGET_EXCEEDED',
      recoveryHint: opts.recoveryHint ||
        'Raise DEV_CHANGE_MAX_TOKENS_PER_RUN, narrow the diff, or disable optional agents (e.g. --skip-adversarial).',
      ...opts
    });
  }
}

/** Output from a dev-change agent failed schema validation AND post-validation sanitisation. */
class DevChangeValidationError extends AppError {
  constructor(message, opts = {}) {
    super(message, 422, {
      code: 'DEV_CHANGE_VALIDATION_FAILED',
      recoveryHint: opts.recoveryHint ||
        'Inspect agent output in logs/agent-decisions.json; the artifact will be quarantined to the companion cycle.',
      ...opts
    });
  }
}

/**
 * An alert-policy circuit breaker blocked an AI enrichment call.
 * canRetry is always false — retrying the same call under the same policy
 * yields the same result.
 */
class PolicyViolationError extends AppError {
  constructor({ type, scope, threshold, actual, action } = {}) {
    const msg = scope
      ? `Policy violation [${scope}]: ${type} — actual=${actual} exceeds threshold=${threshold}`
      : `Policy violation: ${type} blocked by ${action || 'BLOCK'} policy`;
    super(msg, 429, {
      code:         'POLICY_VIOLATION',
      recoveryHint: 'Raise the relevant budget cap env var or change the ALERT_POLICY_<TYPE> setting.',
      details:      { type, scope: scope || 'call', threshold, actual, action: action || 'BLOCK' }
    });
    this.alertType  = type;
    this.alertScope = scope || 'call';
    this.threshold  = threshold;
    this.actual     = actual;
    this.canRetry   = false;
  }
}

/**
 * Startup validation failed — required env vars missing, malformed, or
 * connectivity checks failed. Pipeline execution must not proceed.
 * Carries a structured `report` property for programmatic inspection.
 */
class ValidationError extends AppError {
  constructor(message, report, opts = {}) {
    const failed = (report && Array.isArray(report.checks))
      ? report.checks.filter(c => c.status === 'fail').map(c => c.name)
      : [];
    super(message, 400, {
      code:         'STARTUP_VALIDATION_FAILED',
      recoveryHint: opts.recoveryHint ||
        'Fix the listed configuration issues, verify credentials, and restart the pipeline.',
      details:      { report, failedChecks: failed }
    });
    this.report = report || { valid: false, checks: [] };
  }
}

module.exports = AppError;
module.exports.AppError          = AppError;
module.exports.TimeoutError      = TimeoutError;
module.exports.NonZeroExitError  = NonZeroExitError;
module.exports.SpawnError        = SpawnError;
module.exports.UpstreamError     = UpstreamError;
module.exports.PreconditionError = PreconditionError;
module.exports.ValidationError   = ValidationError;
module.exports.DevChangeAnalysisError   = DevChangeAnalysisError;
module.exports.DevChangeBudgetError     = DevChangeBudgetError;
module.exports.DevChangeValidationError = DevChangeValidationError;
module.exports.PolicyViolationError     = PolicyViolationError;
