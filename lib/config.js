'use strict';
/**
 * Centralised, validated configuration for the Execution Plane.
 *
 * WHY: configuration was read via scattered `process.env.*` with ad-hoc defaults
 * and no validation, so a misconfiguration surfaced deep inside a 16-minute run
 * instead of failing fast at boot. This module is the single source of truth:
 * a declarative schema → resolved, type-coerced values + a validation report.
 *
 * It is intentionally ADDITIVE — existing modules keep working unchanged. New
 * code should prefer `config.get()`; `scripts/config-check.js` validates at boot/CI.
 * Secret values are never returned by `describe()` and never logged.
 */
require('dotenv').config();

const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int  = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

const allowlist = require('./config-allowlist');

// Declarative schema. `required` is validated; `secret` is never echoed.
// NOTE: there are intentionally NO AI provider/model entries here. Forbidden AI
// config is rejected generically (provider-agnostic) via lib/config-allowlist.
const SCHEMA = {
  INTELLIGENCE_API_URL:     { type: 'url',    required: true,  default: 'http://localhost:3001' },
  INTELLIGENCE_API_VERSION: { type: 'string', required: false, default: 'v1' },
  INTELLIGENCE_TIMEOUT_MS:  { type: 'int',    required: false, default: 600000 },
  INTELLIGENCE_RETRY:       { type: 'int',    required: false, default: 0 },
  // Intelligence Plane auth: OAuth2 client-credentials (CUSTOMER_JWT is deprecated).
  // The startup guard enforces that CLIENT_ID + CLIENT_SECRET are present.
  CLIENT_ID:            { type: 'string', required: false },
  CLIENT_SECRET:        { type: 'string', required: false, secret: true },
  CUSTOMER_ID:         { type: 'string', required: false }, // tenant id — sourced from config/customer.json when unset
  JIRA_BASE_URL:       { type: 'url',    required: true },
  JIRA_PROJECT_KEY:    { type: 'string', required: true },
  JIRA_EMAIL:          { type: 'string', required: true },
  JIRA_API_TOKEN:      { type: 'string', required: true,  secret: true },
  ZEPHYR_API_URL:      { type: 'url',    required: false, default: 'https://api.zephyrscale.smartbear.com/v2' },
  ZEPHYR_API_TOKEN:    { type: 'string', required: false, secret: true },
  APP_BASE_URL:        { type: 'url',    required: false },
  APP_USERNAME:        { type: 'string', required: false, secret: true },
  APP_PASSWORD:        { type: 'string', required: false, secret: true },
  PLATFORM_DIR:        { type: 'string', required: false, default: '.' },
  PW_HEADLESS:         { type: 'bool',   required: false, default: false },
  RUN_PERF:            { type: 'bool',   required: false, default: true },
  RUN_SECURITY:        { type: 'bool',   required: false, default: true },
  PORT:                { type: 'int',    required: false, default: 3000 },
  API_SECRET:          { type: 'string', required: false, secret: true },
  SECRETS_PROVIDER:    { type: 'string', required: false, default: 'env' },
};

function coerce(spec, raw) {
  if (raw === undefined) return spec.default;
  switch (spec.type) {
    case 'bool': return bool(raw, spec.default);
    case 'int':  return int(raw, spec.default);
    default:     return raw;
  }
}

/** Validate an environment against the schema. Pure — accepts an env object. */
function validate(env = process.env) {
  const errors = [];
  const warnings = [];
  for (const [key, spec] of Object.entries(SCHEMA)) {
    const raw = env[key];
    if (spec.required && (raw === undefined || raw === '') && spec.default === undefined) {
      errors.push(`${key} is required but not set`);
    }
    if (spec.type === 'url' && raw) {
      try { new URL(raw); } catch { errors.push(`${key} is not a valid URL: ${raw}`); }
    }
  }
  // Provider-agnostic sovereign-split enforcement: reject ANY AI provider/model/
  // prompt config or credential-shaped variable not on the Execution Plane allowlist.
  for (const { name, reason } of allowlist.scanForbidden(env)) {
    errors.push(`${name} must NOT be set (sovereign-split contract: ${reason})`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Resolved, type-coerced configuration (defaults applied). */
function get(env = process.env) {
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMA)) {
    if (spec.forbidden) continue;
    out[key] = coerce(spec, env[key]);
  }
  return Object.freeze(out);
}

/** Non-secret view safe to log: secrets shown only as present/absent. */
function describe(env = process.env) {
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMA)) {
    if (spec.forbidden) continue;
    out[key] = spec.secret ? (env[key] ? '***present***' : '(unset)') : coerce(spec, env[key]);
  }
  return out;
}

module.exports = { SCHEMA, validate, get, describe };
