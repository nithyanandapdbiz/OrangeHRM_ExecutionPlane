'use strict';
/**
 * Single retry implementation for the Execution Plane (consolidated from the
 * former src/utils/retry). Exponential-free, fixed-delay async retry.
 */
async function retry(fn, retries = 3, delay = 1500) {
  try {
    return await fn();
  } catch (e) {
    if (retries <= 0) throw e;
    await new Promise((r) => setTimeout(r, delay));
    return retry(fn, retries - 1, delay);
  }
}

module.exports = { retry };
