'use strict';
/**
 * alertPolicy — policy engine for telemetry-alert enforcement.
 *
 * Maps each alert type to one of: ALLOW | WARN | THROTTLE | BLOCK
 *
 * Policy overrides (env vars):
 *   ALERT_POLICY_HIGH_COST_CALL=BLOCK
 *   ALERT_POLICY_LARGE_TOKEN_USAGE=THROTTLE
 *   ALERT_POLICY_PROMPT_INJECTION_SUSPECTED=WARN   (to downgrade default BLOCK)
 *   ... etc.
 *
 * Budget caps (0 = disabled):
 *   COST_CAP_PER_CALL_USD      per-call cost ceiling in USD
 *   COST_CAP_PER_STORY_USD     per-story accumulated cost ceiling in USD
 *   COST_CAP_PER_PIPELINE_USD  per-pipeline accumulated cost ceiling in USD
 *   MAX_TOKENS_PER_CALL        per-call total-token ceiling
 *   MAX_TOKENS_PER_STORY       per-story accumulated token ceiling
 *   MAX_TOKENS_PER_PIPELINE    per-pipeline accumulated token ceiling
 *
 * Throttle delay:
 *   THROTTLE_DELAY_MS  milliseconds to pause when action is THROTTLE (default 1000)
 */

const { PolicyViolationError } = require('../core/errorHandler');

// ── Default policies ────────────────────────────────────────────────────────
// Conservative defaults: most are WARN so existing workloads are unaffected.
// Only PROMPT_INJECTION_SUSPECTED blocks by default (security concern).
const POLICY_DEFAULTS = {
  HIGH_COST_CALL:             'WARN',
  LARGE_TOKEN_USAGE:          'WARN',
  PROMPT_EXPLOSION:           'WARN',
  HIGH_LATENCY:               'WARN',
  EXCESSIVE_RETRIES:          'WARN',
  PROMPT_INJECTION_SUSPECTED: 'BLOCK'
};

const VALID_ACTIONS = new Set(['ALLOW', 'WARN', 'THROTTLE', 'BLOCK']);

/**
 * Return the effective policy action for an alert type.
 * Reads ALERT_POLICY_<TYPE> env var at call time; falls back to POLICY_DEFAULTS.
 * @param {string} alertType
 * @returns {'ALLOW'|'WARN'|'THROTTLE'|'BLOCK'}
 */
function getPolicy(alertType) {
  const envKey = `ALERT_POLICY_${alertType}`;
  const envVal = process.env[envKey];
  if (envVal) {
    const upper = envVal.trim().toUpperCase();
    if (VALID_ACTIONS.has(upper)) return upper;
  }
  return POLICY_DEFAULTS[alertType] || 'WARN';
}

// ── Budget cap readers (read env at call time, not at module load) ───────────

function _floatEnv(name)  { return parseFloat(process.env[name] || '0') || 0; }
function _intEnv(name)    { return parseInt(process.env[name]   || '0', 10) || 0; }

function callCostCap()      { return _floatEnv('COST_CAP_PER_CALL_USD'); }
function storyCostCap()     { return _floatEnv('COST_CAP_PER_STORY_USD'); }
function pipelineCostCap()  { return _floatEnv('COST_CAP_PER_PIPELINE_USD'); }
function callTokenCap()     { return _intEnv('MAX_TOKENS_PER_CALL'); }
function storyTokenCap()    { return _intEnv('MAX_TOKENS_PER_STORY'); }
function pipelineTokenCap() { return _intEnv('MAX_TOKENS_PER_PIPELINE'); }
function throttleDelayMs()  { return _intEnv('THROTTLE_DELAY_MS') || 1000; }

/**
 * Enforce configured alert policies for one enrichJSON call.
 *
 * Evaluation order:
 *   1. Per-alert-type policy  (ALLOW / WARN / THROTTLE / BLOCK)
 *   2. Per-call budget caps   (COST_CAP_PER_CALL_USD, MAX_TOKENS_PER_CALL)
 *   3. Accumulated budgets    (story / pipeline via store._budget)
 *
 * Outcome:
 *   - BLOCK or any cap exceeded → throws PolicyViolationError (first violation wins)
 *   - THROTTLE → awaits THROTTLE_DELAY_MS before resolving
 *   - ALLOW / WARN → resolves immediately with no side effects
 *
 * @param {object[]}    alerts  — alert objects produced by checkAlerts() + context checks
 * @param {object}      telRec  — telemetry record for this call (estimatedCost, totalTokens, …)
 * @param {object|null} store   — AsyncLocalStorage store; carries _budget accumulator
 * @returns {Promise<void>}
 * @throws {PolicyViolationError}
 */
async function enforce(alerts, telRec, store) {
  let shouldThrottle   = false;
  let firstViolation   = null;

  // ── 1. Per-alert-type policy ────────────────────────────────────────
  for (const alert of alerts) {
    const action = getPolicy(alert.type);
    if (action === 'ALLOW' || action === 'WARN') continue;
    if (action === 'THROTTLE') { shouldThrottle = true; continue; }
    if (action === 'BLOCK' && !firstViolation) {
      firstViolation = { type: alert.type, action: 'BLOCK', threshold: alert.threshold, actual: alert.actual };
    }
  }

  // ── 2. Per-call budget caps ─────────────────────────────────────────
  if (!firstViolation) {
    const cap = callCostCap();
    if (cap > 0 && telRec.estimatedCost > cap) {
      firstViolation = { type: 'COST_CAP_EXCEEDED', scope: 'call', threshold: cap, actual: telRec.estimatedCost, action: 'BLOCK' };
    }
  }
  if (!firstViolation) {
    const cap = callTokenCap();
    if (cap > 0 && telRec.totalTokens > cap) {
      firstViolation = { type: 'TOKEN_CAP_EXCEEDED', scope: 'call', threshold: cap, actual: telRec.totalTokens, action: 'BLOCK' };
    }
  }

  // ── 3. Accumulated (story / pipeline) budget caps ───────────────────
  if (!firstViolation && store && store._budget) {
    const projCost   = store._budget.cost   + telRec.estimatedCost;
    const projTokens = store._budget.tokens + telRec.totalTokens;

    if (!firstViolation) {
      const cap = storyCostCap();
      if (cap > 0 && projCost > cap) {
        firstViolation = { type: 'COST_CAP_EXCEEDED', scope: 'story', threshold: cap, actual: projCost, action: 'BLOCK' };
      }
    }
    if (!firstViolation) {
      const cap = storyTokenCap();
      if (cap > 0 && projTokens > cap) {
        firstViolation = { type: 'TOKEN_CAP_EXCEEDED', scope: 'story', threshold: cap, actual: projTokens, action: 'BLOCK' };
      }
    }
    if (!firstViolation) {
      const cap = pipelineCostCap();
      if (cap > 0 && projCost > cap) {
        firstViolation = { type: 'COST_CAP_EXCEEDED', scope: 'pipeline', threshold: cap, actual: projCost, action: 'BLOCK' };
      }
    }
    if (!firstViolation) {
      const cap = pipelineTokenCap();
      if (cap > 0 && projTokens > cap) {
        firstViolation = { type: 'TOKEN_CAP_EXCEEDED', scope: 'pipeline', threshold: cap, actual: projTokens, action: 'BLOCK' };
      }
    }
  }

  // ── Apply violation ─────────────────────────────────────────────────
  if (firstViolation) {
    throw new PolicyViolationError(firstViolation);
  }

  // ── Apply throttle ──────────────────────────────────────────────────
  if (shouldThrottle) {
    await new Promise(r => setTimeout(r, throttleDelayMs()));
  }
}

module.exports = {
  enforce,
  getPolicy,
  callCostCap,
  storyCostCap,
  pipelineCostCap,
  callTokenCap,
  storyTokenCap,
  pipelineTokenCap,
  throttleDelayMs,
  POLICY_DEFAULTS,
  VALID_ACTIONS
};
