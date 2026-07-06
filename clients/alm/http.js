'use strict';
/**
 * Shared ALM HTTP transport — OrangeHRM Execution Plane.
 *
 * A small, dependency-light request layer used by BOTH the Jira and the Zephyr
 * adapters so retry/backoff, rate-limit handling, timeout, error normalisation
 * and audit logging are implemented ONCE and identically. Keeps the provider
 * clients focused on endpoint/field mapping.
 *
 * Cross-cutting concerns provided here:
 *   • exponential backoff on 429 / 5xx, honouring the `Retry-After` header
 *   • per-request timeout
 *   • structured error normalisation → AlmError { status, code, message, detail }
 *   • audit logging (method + path + status + attempt) via lib/logger
 *   • cursor/offset pagination helper (paginate)
 */
const axios = require('axios');
const logger = require('../../lib/logger');

class AlmError extends Error {
  constructor(provider, { status, code, message, detail } = {}) {
    super(message || `${provider} request failed`);
    this.name = 'AlmError';
    this.provider = provider;
    this.status = status ?? 0;
    this.code = code || 'ALM_ERROR';
    this.detail = detail ?? null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a provider-scoped HTTP client.
 * @param {object} opts
 * @param {string} opts.provider   short name used in logs/errors (e.g. 'Jira')
 * @param {string} opts.baseURL    fully-qualified API base
 * @param {object} opts.headers    default headers (auth, content-type)
 * @param {number} [opts.timeout]  per-request timeout (ms)
 * @param {number} [opts.maxRetries] transient-failure retries (default 3)
 */
function createHttp(opts) {
  const provider = opts.provider;
  const maxRetries = Number.isInteger(opts.maxRetries) ? opts.maxRetries : 3;
  const instance = axios.create({
    baseURL: opts.baseURL,
    headers: opts.headers,
    timeout: opts.timeout ?? 15000,
    validateStatus: () => true, // we branch on status ourselves
  });

  function isRetryable(status) {
    return status === 429 || (status >= 500 && status <= 599);
  }

  function backoffMs(attempt, retryAfterHeader) {
    const ra = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30000);
    return Math.min(500 * 2 ** attempt, 8000); // 500ms, 1s, 2s, 4s, 8s (capped)
  }

  function normalise(resp) {
    const status = resp?.status ?? 0;
    const data = resp?.data;
    // Jira: { errorMessages: [], errors: {} } — Zephyr: { message } / { errorCode }
    const message =
      (Array.isArray(data?.errorMessages) && data.errorMessages.join('; ')) ||
      data?.message ||
      data?.error ||
      (data && typeof data === 'string' ? data.slice(0, 300) : '') ||
      `HTTP ${status}`;
    const code =
      status === 401 ? 'UNAUTHORIZED' :
      status === 403 ? 'FORBIDDEN' :
      status === 404 ? 'NOT_FOUND' :
      status === 429 ? 'RATE_LIMITED' :
      status >= 500 ? 'UPSTREAM_ERROR' : 'REQUEST_FAILED';
    return new AlmError(provider, { status, code, message, detail: data?.errors ?? null });
  }

  /**
   * Issue a request with retry/backoff. Returns response data on 2xx, throws AlmError otherwise.
   * @param {import('axios').AxiosRequestConfig} config
   */
  async function request(config) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let resp;
      try {
        resp = await instance.request(config);
      } catch (networkErr) {
        // timeout / DNS / connection reset — retry as transient
        lastErr = new AlmError(provider, { status: 0, code: 'NETWORK', message: networkErr.message });
        logger.warn(`[${provider}] ${config.method?.toUpperCase()} ${config.url} network error (attempt ${attempt + 1}/${maxRetries + 1}): ${networkErr.message}`);
        if (attempt < maxRetries) { await sleep(backoffMs(attempt)); continue; }
        throw lastErr;
      }

      if (resp.status >= 200 && resp.status < 300) {
        logger.info(`[${provider}] ${config.method?.toUpperCase()} ${config.url} → ${resp.status}`);
        return resp.data;
      }

      if (isRetryable(resp.status) && attempt < maxRetries) {
        const wait = backoffMs(attempt, resp.headers?.['retry-after']);
        logger.warn(`[${provider}] ${config.method?.toUpperCase()} ${config.url} → ${resp.status}, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(wait);
        continue;
      }

      lastErr = normalise(resp);
      logger.warn(`[${provider}] ${config.method?.toUpperCase()} ${config.url} → ${resp.status} ${lastErr.code}: ${lastErr.message}`);
      throw lastErr;
    }
    throw lastErr;
  }

  const get = (url, params) => request({ method: 'get', url, params });
  const post = (url, data, params) => request({ method: 'post', url, data, params });
  const put = (url, data, params) => request({ method: 'put', url, data, params });
  const patch = (url, data, params) => request({ method: 'patch', url, data, params });
  const del = (url, params) => request({ method: 'delete', url, params });

  /**
   * Generic pagination driver. Repeatedly calls `fetchPage(startAt)` until the
   * page indicates completion. Works for both Jira (isLast/total/startAt) and
   * Zephyr (isLast/next) style responses.
   * @param {(startAt:number)=>Promise<{values:any[], isLast:boolean, nextStartAt:number}>} fetchPage
   */
  async function paginate(fetchPage, { hardCap = 5000 } = {}) {
    const out = [];
    let startAt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await fetchPage(startAt);
      const values = page.values || [];
      out.push(...values);
      if (page.isLast || values.length === 0 || out.length >= hardCap) break;
      startAt = page.nextStartAt;
    }
    return out;
  }

  return { request, get, post, put, patch, del, paginate, provider };
}

module.exports = { createHttp, AlmError };
