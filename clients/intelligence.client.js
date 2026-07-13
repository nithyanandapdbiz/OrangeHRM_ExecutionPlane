'use strict';
/**
 * Intelligence API Client — OrangeHRM Execution Plane
 *
 * Every call:
 *   1. Runs the PII scrubber on the payload — zero PII crosses the boundary
 *   2. Obtains a Bearer token via OAuth2 client-credentials and attaches it
 *   3. Sends HTTPS to DBiz Intelligence API
 *
 * AUTH (sole method): the EP presents its per-tenant CLIENT_ID + CLIENT_SECRET at
 * POST /oauth/token (RFC 6749 client_credentials) and receives a SHORT-LIVED JWT,
 * cached and auto-refreshed here. The IP resolves the tenant from the token `sub`.
 * (The legacy static CUSTOMER_JWT is DEPRECATED and no longer supported.)
 *
 * DBiz receives: story title + description (already scrubbed).
 * DBiz NEVER receives: Jira API token, Zephyr token, app credentials, SSN, salary, etc.
 */
const axios  = require('axios');
const logger = require('../lib/logger');
const { scrub } = require('../middleware/pii-scrubber');
const executionContext = require('../lib/execution-context');
const customer = require('../config/customer.json'); // tenant identity/domain — no hardcoding

const DEFAULT_DOMAIN = customer.domain;

const DEFAULT_TIMEOUT = 600_000; // 10 min — pipeline can take time with all 4 stages

class IntelligenceClient {
  constructor(opts = {}) {
    this.baseUrl    = (process.env.INTELLIGENCE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    // Zero-Trust transport: reject plaintext HTTP in production (localhost dev only).
    if (process.env.NODE_ENV === 'production'
        && /^http:\/\//i.test(this.baseUrl)
        && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(this.baseUrl)) {
      throw new Error('INTELLIGENCE_API_URL must use https:// in production — plaintext HTTP is only permitted for localhost development');
    }
    // ── Authentication — OAuth2 client-credentials (sole method; CUSTOMER_JWT deprecated) ──
    this.clientId     = process.env.CLIENT_ID || null;
    this.clientSecret = process.env.CLIENT_SECRET || (process.env.CLIENT_SECRET_REF ? require('../lib/secrets').get('CLIENT_SECRET') : null);
    this.tokenUrl     = (process.env.OAUTH_TOKEN_URL || `${this.baseUrl}/oauth/token`);
    this._token       = null;   // cached short-lived access token
    this._tokenExp    = 0;      // epoch seconds when the cached token expires
    this.customerId   = process.env.CUSTOMER_ID || customer.customerId;
    // Correlation id (the pipeline runId) so a single logical run can be traced
    // end-to-end across the Execution and Intelligence planes (ADR-0007, TD-14).
    this.correlationId = opts.correlationId || null;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Intelligence auth required: set CLIENT_ID + CLIENT_SECRET (OAuth2 client-credentials from DBiz)');
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  // Resolve a Bearer token via OAuth2 client-credentials (cached, auto-refreshed
  // ~30s before expiry).
  async _getBearer() {
    const now = Math.floor(Date.now() / 1000);
    if (this._token && now < this._tokenExp - 30) return this._token;
    const resp = await axios.post(this.tokenUrl,
      { grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    const tok = resp.data?.access_token;
    if (!tok) throw new Error('OAuth2 token exchange returned no access_token');
    this._token = tok;
    this._tokenExp = now + (Number(resp.data.expires_in) || 900);
    logger.info(`[IntelAPI] OAuth2 token obtained (expires in ${resp.data.expires_in || 900}s)`);
    return tok;
  }

  async _headers() {
    const bearer = await this._getBearer();
    const headers = {
      'Authorization':  `Bearer ${bearer}`,
      'Content-Type':   'application/json',
      'X-Customer-ID':  this.customerId,
      'X-Request-Time': new Date().toISOString(),
    };
    if (this.correlationId) headers['X-Request-Id'] = this.correlationId;
    return headers;
  }

  async _call(endpoint, payload) {
    // PRIMARY PII SCRUB — happens before any byte leaves the customer tenant
    const { scrubbed, fieldsRedacted } = scrub(payload);

    if (fieldsRedacted.length > 0) {
      logger.warn(`[PII-SCRUBBER] ⚠  Redacted before boundary crossing: ${fieldsRedacted.join(', ')}`);
      logger.info('[PII-SCRUBBER] ✅ Payload sanitised — zero PII will cross the boundary');
    } else {
      logger.info('[PII-SCRUBBER] ✅ No PII detected in payload');
    }

    // Model B: the EP is the authoritative owner of tenant AI selection. Ship the
    // immutable, versioned ExecutionContext so the shared IP runtime executes from
    // it (provider/model/prompt/credential-REFERENCES). Business fields remain at
    // top level for backward compatibility until the IP consumes the context.
    const ctx = executionContext.build({
      executionId:   this.correlationId || `ctx-${new Date().toISOString()}`,
      correlationId: this.correlationId,
      timestamp:     new Date().toISOString(),
      business:      scrubbed,
    });
    const body = { ...scrubbed, executionContext: ctx };

    try {
      const resp = await axios.post(`${this.baseUrl}${endpoint}`, body, {
        headers: await this._headers(),
        timeout: DEFAULT_TIMEOUT,
      });
      return { success: true, data: resp.data, fieldsRedacted };

    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;

      if (status === 401) {
        const blocked = detail?.blocked === true;
        logger.error(`[IntelAPI] 401 ${blocked ? 'TOKEN REVOKED' : 'Unauthorized'} — ${detail?.error}`);
        return { success: false, status: 401, blocked, reason: detail?.error || 'Unauthorized' };
      }
      if (status === 429) {
        logger.warn(`[IntelAPI] 429 Rate limited — retry after ${err.response.headers['retry-after']}s`);
        return { success: false, status: 429, reason: detail?.error || 'Rate limit exceeded', retryAfter: err.response.headers['retry-after'] };
      }
      if (status === 403) {
        // 403 covers two distinct cases: a deactivated/unknown tenant (resolveTenant)
        // and a tier feature gate (requireFeature). Distinguish them for the operator.
        const msg = detail?.error || '';
        const deactivated = /deactivat|unknown tenant|not enabled for tenant/i.test(msg);
        logger.error(`[IntelAPI] 403 ${deactivated ? 'Tenant/domain not permitted' : 'Feature not available on current tier'} — ${msg}`);
        return {
          success: false,
          status: 403,
          reason: msg || (deactivated ? 'Tenant or domain not permitted' : 'Feature not available on tier'),
          category: deactivated ? 'account-or-domain' : 'tier',
        };
      }
      logger.error(`[IntelAPI] ${endpoint} failed: ${err.message}`);
      return { success: false, status: status || 0, reason: err.message };
    }
  }

  // ── Public methods ────────────────────────────────────────────────────────

  async plan(storyId, storyTitle, storyDescription, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/plan  story="${storyTitle}"`);
    return this._call('/api/plan', { storyId, storyTitle, storyDescription, domain });
  }

  async generate(storyId, storyTitle, storyDescription, plan, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/generate  story="${storyTitle}"`);
    return this._call('/api/generate', { storyId, storyTitle, storyDescription, plan, domain });
  }

  async compliance(storyId, storyTitle, storyDescription, plan, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/compliance  story="${storyTitle}"`);
    return this._call('/api/compliance', { storyId, storyTitle, storyDescription, plan, domain });
  }

  async security(storyId, storyTitle, storyDescription, plan, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/security  story="${storyTitle}"`);
    return this._call('/api/security', { storyId, storyTitle, storyDescription, plan, domain });
  }

  async review(testCases) {
    logger.info(`[IntelAPI] POST /api/review  cases=${testCases?.length ?? 0}`);
    return this._call('/api/review', { testCases });
  }

  async pipeline(storyId, storyTitle, storyDescription, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/pipeline  story="${storyTitle}"`);
    return this._call('/api/pipeline', { storyId, storyTitle, storyDescription, domain });
  }

  async performance(storyId, storyTitle, storyDescription, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/performance  story="${storyTitle}"`);
    return this._call('/api/performance', { storyId, storyTitle, storyDescription, domain });
  }

  async pentest(storyId, storyTitle, storyDescription, domain = DEFAULT_DOMAIN) {
    logger.info(`[IntelAPI] POST /api/pentest  story="${storyTitle}"`);
    return this._call('/api/pentest', { storyId, storyTitle, storyDescription, domain });
  }

  async checkHealth() {
    try {
      const r = await axios.get(`${this.baseUrl}/health`, { timeout: 5000, validateStatus: () => true });
      return { reachable: r.status === 200, status: r.status, data: r.data };
    } catch (e) {
      return { reachable: false, error: e.message };
    }
  }

  // ── Authenticated GET helper (mirrors _call error handling; no body → no scrub) ─
  async _get(endpoint, { timeout = DEFAULT_TIMEOUT } = {}) {
    try {
      const resp = await axios.get(`${this.baseUrl}${endpoint}`, { headers: await this._headers(), timeout });
      return { success: true, data: resp.data };
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
      if (status === 404) return { success: false, status: 404, reason: detail?.error || 'Not found' };
      if (status === 409) return { success: false, status: 409, reason: detail?.error || 'Not ready', pending: true, runStatus: detail?.status };
      if (status === 401) return { success: false, status: 401, blocked: detail?.blocked === true, reason: detail?.error || 'Unauthorized' };
      if (status === 403) return { success: false, status: 403, reason: detail?.error || 'Forbidden' };
      logger.error(`[IntelAPI] GET ${endpoint} failed: ${err.message}`);
      return { success: false, status: status || 0, reason: err.message };
    }
  }

  // ── Discovery (Sovereign Split: EP crawls locally, IP synthesises) ──────────

  /**
   * Submit a PII-scrubbed application surface for AI synthesis. The IP runs the
   * discovery agents asynchronously and returns a runId to poll.
   * @param {{ target: object, appSurface: object, meta?: object }} pkg
   * @returns {Promise<{ success, data?: { runId, status, links } }>}
   */
  async discover(pkg) {
    const routes = pkg?.appSurface?.routes?.length ?? 0;
    logger.info(`[IntelAPI] POST /api/discovery  routes=${routes}`);
    return this._call('/api/discovery', pkg);
  }

  /** Poll a discovery run's status. */
  async getDiscoveryStatus(runId) {
    return this._get(`/api/discovery/${encodeURIComponent(runId)}`);
  }

  /** Download generated artefacts (409 pending until the run completes). */
  async downloadArtifacts(runId) {
    return this._get(`/api/discovery/${encodeURIComponent(runId)}/artifacts`);
  }

  /** Request cooperative cancellation of a run. */
  async cancelDiscovery(runId) {
    logger.info(`[IntelAPI] POST /api/discovery/${runId}/cancel`);
    return this._call(`/api/discovery/${encodeURIComponent(runId)}/cancel`, {});
  }

  /** Re-queue a failed/cancelled run. */
  async retryDiscovery(runId) {
    logger.info(`[IntelAPI] POST /api/discovery/${runId}/retry`);
    return this._call(`/api/discovery/${encodeURIComponent(runId)}/retry`, {});
  }
}

module.exports = IntelligenceClient;
