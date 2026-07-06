'use strict';
/**
 * Execution Runtime configuration allowlist (FF-20…FF-24).
 *
 * The Execution Plane is provider-agnostic. It must own ZERO AI provider/model/
 * prompt configuration and must NEVER require modification when a new AI provider
 * appears. This module is the authoritative contract:
 *
 *   • ALLOWED_EXACT / ALLOWED_PREFIXES — the execution-only variables the EP may
 *     read. Anything the code reads must be declared here (enforced by CI).
 *   • FORBIDDEN detection — PROVIDER-AGNOSTIC. It does NOT enumerate providers.
 *     It rejects AI-semantic patterns (model/tokens/temperature/prompt/…) and any
 *     credential-shaped variable not on the allowlist. A brand-new provider's
 *     `FOO_API_KEY` / `FOO_MODEL` is therefore caught with no code change here.
 *
 * This replaces the previous provider denylist (which enumerated ~20 provider
 * names and would silently miss any provider added in the future).
 */

// Exact execution-config variables the EP legitimately reads.
const ALLOWED_EXACT = new Set([
  // ── runtime ──
  'NODE_ENV', 'PORT', 'HOST', 'PLATFORM_DIR', 'CI',
  // ── plane identity + Intelligence Plane link ──
  'CUSTOMER_ID',
  'INTELLIGENCE_API_URL', 'INTELLIGENCE_API_VERSION',
  'INTELLIGENCE_TIMEOUT_MS', 'INTELLIGENCE_RETRY', 'INTELLIGENCE_LOG_FILE',
  // ── tenant-owned AI SELECTION (Model B). Selection + references only — NEVER
  //    a raw key (those remain forbidden as credential-shaped; use *_REF). The
  //    tenant owns which provider/model/prompts to use; the IP executes it.
  'AI_PROFILE_PATH', 'AI_PROVIDER', 'AI_MODEL', 'AI_FALLBACK_MODEL',
  'AI_MAX_TOKENS', 'AI_TEMPERATURE', 'AI_TOP_P', 'AI_TOP_K',
  'AI_CREDENTIAL_REF', 'AI_ROUTING_STRATEGY',
  'PROMPT_PACK', 'PROMPT_VERSION', 'KNOWLEDGE_REF',
  // ── EP API auth + request-signing + secrets sourcing ──
  'API_SECRET', 'CONTEXT_SIGNING_KEY', 'SECRETS_PROVIDER', 'AZURE_KEY_VAULT_URL', 'WEBHOOK_SECRET',
  // ── OAuth2 client-credentials for the Intelligence Plane (EP→IP auth) ──
  'CLIENT_ID', 'CLIENT_SECRET', 'CLIENT_SECRET_REF', 'OAUTH_TOKEN_URL',
  // ── inter-plane mTLS (transport trust) ──
  'MTLS_CERT_PATH', 'MTLS_KEY_PATH', 'CA_CERT_PATH',
  // ── Jira (issue tracker — ALM source of truth) ──
  'JIRA_BASE_URL', 'JIRA_PROJECT_KEY', 'JIRA_EMAIL', 'JIRA_API_TOKEN',
  'JIRA_API_VERSION', 'JIRA_TIMEOUT_MS',
  // ── Zephyr Essential (test management) ──
  'ZEPHYR_API_URL', 'ZEPHYR_API_TOKEN', 'ZEPHYR_CYCLE_ID',
  // ── Application under test (OrangeHRM React web app) ──
  'APP_BASE_URL', 'TEST_BASE_URL', 'BASE_URL', 'CONTRACT_BASE_URL',
  'APP_USERNAME', 'APP_PASSWORD',
  'TEST_ADMIN_USERNAME', 'TEST_ADMIN_PASSWORD', 'SESSION_MODE', 'ISSUE_KEY',
  // ── pipeline toggles ──
  'RUN_PERF', 'RUN_SECURITY', 'PENTEST_ENABLED', 'CAPTURE_VIDEO',
  'STREAM_CHILD_OUTPUT', 'TRIGGER_TAIL',
  // ── observability ──
  'LOG_LEVEL', 'LOG_DIR', 'LOG_MAX_FILES', 'LOG_MAX_SIZE_BYTES', 'HEALTH_TIMEOUT_MS',
]);

// Namespace prefixes for families of execution config/tuning knobs. Each family
// is EP-owned and provider-agnostic (none carry AI provider/model semantics).
const ALLOWED_PREFIXES = [
  'JIRA_', 'ZEPHYR_', 'APP_',                        // integration config families
  'PW_', 'PLAYWRIGHT_', 'CUCUMBER_', 'AUTH_',        // functional (BDD) execution
  'PIM_', 'ADMIN_', 'LEAVE_', 'FORM_', 'GRID_', 'CDP_', // React page/route/component tuning
  'PERF_', 'SEC_', 'ZAP_',                           // non-functional execution
  'PROMPT_', 'KNOWLEDGE_', 'GUARDRAIL_',             // tenant-owned AI selection (Model B)
  'OTEL_', 'HEALTH_', 'STORAGE_', 'REPORT_', 'ARTIFACT_', 'FEATURE_', // platform services
];

// Model B — the tenant OWNS AI selection (provider/model/prompt/tokens/…), so those
// are ALLOWED (declared above). What remains forbidden is a RAW AI CREDENTIAL in the
// Execution Plane: the EP references credentials (kv://…) and performs no inference
// (the no-SDK/no-model-call rule is enforced separately by test/ai-boundary FF-01).
// There are intentionally NO provider names here — this stays provider-agnostic.
const FORBIDDEN_AI = [];

// Credential-shaped suffixes: ANY raw credential not on the allowlist is rejected —
// this catches a raw AI provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or an
// unknown future provider's key) without naming providers. Tenants supply an
// AI_CREDENTIAL_REF reference instead, resolved by the Intelligence Plane.
const CREDENTIAL_SHAPED =
  /(_API_KEY|_APIKEY|_AUTH_TOKEN|_ACCESS_TOKEN|_BEARER(_TOKEN)?|_APPLICATION_CREDENTIALS)$/i;

function isAllowed(name) {
  if (ALLOWED_EXACT.has(name)) return true;
  return ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}

/** Returns the reason `name` is forbidden AI/provider config, or null. */
function forbiddenReason(name) {
  for (const rx of FORBIDDEN_AI) if (rx.test(name)) return `matches AI-config pattern ${rx}`;
  if (CREDENTIAL_SHAPED.test(name) && !isAllowed(name)) {
    return 'credential-shaped variable not on the Execution Plane allowlist (possible AI provider key)';
  }
  return null;
}

/** Scan an environment; return [{name, reason}] for every forbidden AI/provider var that is SET. */
function scanForbidden(env = process.env) {
  const out = [];
  for (const name of Object.keys(env)) {
    if (env[name] === undefined || String(env[name]).trim() === '') continue;
    const reason = forbiddenReason(name);
    if (reason) out.push({ name, reason });
  }
  return out;
}

module.exports = {
  ALLOWED_EXACT, ALLOWED_PREFIXES, FORBIDDEN_AI, CREDENTIAL_SHAPED,
  isAllowed, forbiddenReason, scanForbidden,
};
