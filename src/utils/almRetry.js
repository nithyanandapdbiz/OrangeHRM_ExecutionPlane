'use strict';
/**
 * almRetry.js — drop-in axios wrapper for ALM (Jira + Zephyr) REST calls.
 *
 * Exports the same .get / .post / .patch / .put / .delete interface as
 * axios, adding transparent retry with exponential back-off on transient
 * errors.  Swap `require('axios')` for `require('../utils/almRetry')` in
 * any Jira/Zephyr client and retry behaviour is applied automatically.
 *
 * Retry policy:
 *   - Max 3 attempts (1 original + 2 retries)
 *   - Retriable status codes: 429, 500, 502, 503, 504
 *   - Delay: Retry-After header (if present) else 1s → 2s → 4s (exponential)
 *   - Non-retriable errors (4xx except 429, network errors) propagate immediately
 */

const axios = require('axios');

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS     = 3;
const BASE_DELAY_MS    = 1000;

function isRetriable(err) {
  return !!(err.response && RETRIABLE_STATUS.has(err.response.status));
}

function retryAfterMs(err) {
  const header = err.response && err.response.headers && err.response.headers['retry-after'];
  if (!header) return null;
  const seconds = Number(header);
  if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  const epochMs = Date.parse(header);
  if (!isNaN(epochMs)) return Math.max(0, epochMs - Date.now());
  return null;
}

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || attempt === MAX_ATTEMPTS) throw err;
      const delay = retryAfterMs(err) !== null
        ? retryAfterMs(err)
        : BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

module.exports = {
  get:    (url, config)       => withRetry(() => axios.get(url, config)),
  post:   (url, data, config) => withRetry(() => axios.post(url, data, config)),
  patch:  (url, data, config) => withRetry(() => axios.patch(url, data, config)),
  put:    (url, data, config) => withRetry(() => axios.put(url, data, config)),
  delete: (url, config)       => withRetry(() => axios.delete(url, config)),
};
