'use strict';
/**
 * withTimeout — Promise.race utility for per-call and per-pipeline timeout enforcement.
 *
 * Environment variables (read at call time, not module load):
 *   AGENT_TIMEOUT_MS    — per-AI-call ceiling (default: 60000 ms, 0 = disabled)
 *   PIPELINE_TIMEOUT_MS — full pipeline ceiling (default: 300000 ms, 0 = disabled)
 */
const { TimeoutError } = require('../core/errorHandler');

/** Returns AGENT_TIMEOUT_MS as a number; 0 means disabled. */
function agentTimeoutMs() {
  const v = parseInt(process.env.AGENT_TIMEOUT_MS || '60000', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Returns PIPELINE_TIMEOUT_MS as a number; 0 means disabled. */
function pipelineTimeoutMs() {
  const v = parseInt(process.env.PIPELINE_TIMEOUT_MS || '300000', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Race `promise` against a wall-clock timeout.
 *
 * If `ms` ≤ 0 the function is a transparent pass-through — `promise` is
 * returned unchanged.
 *
 * When the timer fires first, `onTimeout` is called as a best-effort side
 * effect (e.g. `controller.abort()`) before the TimeoutError is thrown.
 * Any exception thrown by `onTimeout` is silently swallowed.
 *
 * The timer is always cleared in the `finally` block to prevent leaks when
 * `promise` resolves or rejects before the timeout.
 *
 * @param {Promise}   promise
 * @param {number}    ms           — timeout in milliseconds; ≤0 = disabled
 * @param {string}    label        — description included in the error message
 * @param {function}  [onTimeout]  — optional side-effect callback on timeout
 * @returns {Promise}
 */
async function withTimeout(promise, ms, label, onTimeout) {
  if (!ms || ms <= 0) return promise;

  let timerId;
  const gate = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch (_) { /* best-effort */ }
      }
      reject(new TimeoutError(
        `Timed out after ${ms}ms: ${label}`,
        { recoveryHint: 'Increase AGENT_TIMEOUT_MS or PIPELINE_TIMEOUT_MS, or reduce the workload scope.' }
      ));
    }, ms);
  });

  try {
    return await Promise.race([promise, gate]);
  } finally {
    clearTimeout(timerId);
  }
}

module.exports = { withTimeout, agentTimeoutMs, pipelineTimeoutMs };
