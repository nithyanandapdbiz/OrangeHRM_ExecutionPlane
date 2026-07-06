'use strict';
/**
 * circuitBreaker.js — minimal in-memory per-key circuit breaker.
 *
 * States:
 *   closed    — pass-through; failures counted within windowMs
 *   open      — fail-fast for cooldownMs
 *   half-open — next call is a probe; success → closed, failure → open again
 *
 * Not persisted — restart resets it. That's fine because the orchestrator
 * persists its own progress via discovery.state.js.
 */

const logger = require('../utils/logger');
const { CircuitOpenError } = require('./discovery.errors');

class CircuitBreaker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold=3]
   * @param {number} [opts.windowMs=60000]
   * @param {number} [opts.cooldownMs=300000]
   * @param {string} [opts.name='breaker']
   */
  constructor(opts = {}) {
    this.failureThreshold = Number(opts.failureThreshold) || 3;
    this.windowMs         = Number(opts.windowMs)         || 60_000;
    this.cooldownMs       = Number(opts.cooldownMs)       || 300_000;
    this.name             = opts.name || 'breaker';
    /** @type {Map<string, { failures: number[], state: string, openedAt: number|null }>} */
    this._keys = new Map();
  }

  _get(key) {
    let rec = this._keys.get(key);
    if (!rec) {
      rec = { failures: [], state: 'closed', openedAt: null };
      this._keys.set(key, rec);
    }
    return rec;
  }

  /** Human-readable state for a key, after cooldown transitions. */
  state(key) {
    const rec = this._get(key);
    if (rec.state === 'open' && (rec.openedAt !== null && rec.openedAt !== undefined)) {
      if ((Date.now() - rec.openedAt) >= this.cooldownMs) {
        rec.state = 'half-open';
      }
    }
    return rec.state;
  }

  /** Force the breaker for a key back to closed. */
  reset(key) {
    this._keys.set(key, { failures: [], state: 'closed', openedAt: null });
  }

  /**
   * Execute fn() under the breaker. Throws CircuitOpenError if open.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async exec(key, fn) {
    const rec = this._get(key);
    const s = this.state(key);
    if (s === 'open') {
      throw new CircuitOpenError(`Circuit open for ${this.name}:${key}`, {
        details: { key, openedAt: rec.openedAt, cooldownMs: this.cooldownMs }
      });
    }
    try {
      const result = await fn();
      if (s === 'half-open') {
        this.reset(key);
        logger.info(`circuit ${this.name}:${key} recovered → closed`);
      } else {
        // Prune old failures outside the rolling window
        const cutoff = Date.now() - this.windowMs;
        rec.failures = rec.failures.filter(t => t >= cutoff);
      }
      return result;
    } catch (err) {
      const now = Date.now();
      rec.failures.push(now);
      const cutoff = now - this.windowMs;
      rec.failures = rec.failures.filter(t => t >= cutoff);
      if (rec.failures.length >= this.failureThreshold) {
        rec.state = 'open';
        rec.openedAt = now;
        logger.warn(`circuit ${this.name}:${key} OPEN (${rec.failures.length} failures in ${this.windowMs}ms)`);
      }
      throw err;
    }
  }
}

module.exports = { CircuitBreaker };
