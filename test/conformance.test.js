'use strict';
/**
 * Enterprise ExecutionPlane Conformance — build-failing fitness functions.
 *
 * Proves that this tenant implementation conforms to the DBIZ Enterprise
 * ExecutionPlane Standard (the certified Reference-Tenant architecture): connector
 * SPI isolation, an identical ExecutionContext contract, the same identity model,
 * a single tenant-identity source, provider-agnostic AI governance, and no legacy
 * platform terminology. These rules FAIL THE BUILD on any conformance regression,
 * making this repository usable as a second certified Reference Tenant.
 *
 * Every assertion is derived from the executable implementation — not documentation.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// ── C1 — Connector SPI isolation ─────────────────────────────────────────────
// Business logic (routes/) must depend on the ALM facade only, never on a concrete
// vendor connector. Same rule the Reference Tenant enforces (one connector seam).
test('C1: business logic (routes/) imports only the connector facade, never a vendor client', () => {
  for (const f of walk('routes')) {
    const src = read(f);
    assert.ok(!/require\(['"][^'"]*clients\/jira\.client['"]\)/.test(src),
      `${f} imports clients/jira.client directly — must go through clients/alm.client`);
    assert.ok(!/require\(['"][^'"]*clients\/zephyr\.client['"]\)/.test(src),
      `${f} imports clients/zephyr.client directly — must go through clients/alm.client`);
  }
});

// ── C2 — Connector SPI contracts satisfied ───────────────────────────────────
test('C2: vendor connectors implement the capability contracts (IssueTracker / TestManagement)', () => {
  const { assertIssueTracker } = require('../clients/alm/tracker.contract');
  const { assertTestManagement } = require('../clients/alm/testmanagement.contract');
  const Jira = require('../clients/jira.client');
  const Zephyr = require('../clients/zephyr.client');
  assert.doesNotThrow(() => assertIssueTracker(Jira.prototype, 'JiraClient'));
  assert.doesNotThrow(() => assertTestManagement(Zephyr.prototype, 'ZephyrClient'));

  // The facade exposes the historical, provider-agnostic caller surface.
  const AlmClient = require('../clients/alm.client');
  const surface = ['checkConnectivity', 'fetchWorkItem', 'createTestCase',
    'batchCreateTestCases', 'createTestRun', 'updateTestResults', 'completeTestRun', 'createBug'];
  for (const m of surface) {
    assert.strictEqual(typeof AlmClient.prototype[m], 'function', `AlmClient must expose ${m}()`);
  }
});

// ── C3 — ExecutionContext contract identical to the standard ─────────────────
test('C3: ExecutionContext is the standard V1 contract (exact top-level key set)', () => {
  process.env.JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://x.atlassian.net';
  process.env.JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'OHRM';
  const ec = require('../lib/execution-context');
  const ctx = ec.build({
    executionId: 'e-1', correlationId: 'c-1',
    timestamp: new Date('2026-01-01T00:00:00Z').toISOString(), business: { storyId: 'OHRM-1' },
  });
  const STANDARD_KEYS = ['version', 'metadata', 'tenant', 'identity', 'security', 'ai', 'business', 'connectors', 'telemetry'];
  assert.deepStrictEqual(Object.keys(ctx).sort(), [...STANDARD_KEYS].sort(),
    'ExecutionContext top-level keys must match the Reference-Tenant contract exactly');
  assert.strictEqual(ctx.version, 'v1', 'ExecutionContext version must be v1');
  assert.ok(ctx.metadata.executionId && ctx.metadata.correlationId && ctx.metadata.timestamp);
  assert.ok(ctx.tenant.id && ctx.tenant.name && ctx.tenant.domain, 'tenant identity must be present');
  assert.ok(/^sha256:/.test(ctx.security.integrity), 'security.integrity (SHA-256) required');
  assert.ok(ctx.security.credentialRefs.ai == null || /^(kv|vault|akv|asm|sm):\/\//.test(ctx.security.credentialRefs.ai),
    'AI credential must be a reference (kv://…), never a raw key');
  assert.ok(Object.isFrozen(ctx), 'ExecutionContext must be immutable (deep-frozen)');
});

// ── C4 — Identity model conformance (no tenant-side signing / static JWT) ─────
test('C4: identity model — EP authenticates via OAuth2 client-credentials and mints/holds no signing key', () => {
  const pkg = require('../package.json');
  assert.ok(!(pkg.dependencies?.jsonwebtoken || pkg.devDependencies?.jsonwebtoken),
    'jsonwebtoken must not be a dependency — the tenant does not mint JWTs (DBiz issues them at /oauth/token)');
  const platform = [...walk('clients'), ...walk('lib'), ...walk('middleware'), ...walk('routes'), 'server.js'];
  for (const f of platform) {
    const src = read(f);
    assert.ok(!/process\.env\.JWT_SECRET/.test(src), `${f} references JWT_SECRET — tenant must not sign JWTs`);
  }
  const client = read('clients/intelligence.client.js');
  assert.match(client, /process\.env\.CLIENT_ID/, 'the Intelligence client must authenticate via OAuth2 client-credentials');
  assert.match(client, /\/oauth\/token/, 'the Intelligence client must exchange client-credentials at /oauth/token');
  assert.ok(!/process\.env\.CUSTOMER_JWT/.test(client), 'CUSTOMER_JWT is deprecated — the client must not consume it');
});

// ── C5 — Single source of tenant identity ────────────────────────────────────
test('C5: tenant business identity lives ONLY in config/customer.json and is config-sourced', () => {
  const customer = require('../config/customer.json');
  for (const k of ['customerId', 'customerName', 'domain']) {
    assert.ok(customer[k], `config/customer.json must define ${k}`);
  }
  // Platform code must READ the tenant identity from config, not hardcode it.
  const ec = read('lib/execution-context.js');
  assert.match(ec, /name:\s*customer\.customerName/, 'ExecutionContext tenant name must be sourced from config/customer.json');
  // The tenant block must bind name to the config value, never a string literal.
  assert.ok(!/\bname:\s*['"][A-Za-z]/.test(ec.split('tenant:')[1] || ''),
    'ExecutionContext must not hardcode a tenant name string literal');
});

// ── C6 — No legacy platform terminology (Reference-Tenant eradication) ────────
test('C6: platform layer contains no legacy pre-standard terminology', () => {
  const { PATTERNS } = require('../scripts/legacy-terms');
  const platform = [
    ...walk('clients'), ...walk('lib'), ...walk('middleware'), ...walk('routes'),
    ...walk('runners'), 'server.js',
  ];
  const violations = [];
  for (const f of platform) {
    const src = read(f);
    for (const rx of PATTERNS) if (rx.test(src)) { violations.push(`${f} :: ${rx}`); break; }
  }
  assert.deepStrictEqual(violations, [], `legacy terminology in platform layer:\n${violations.join('\n')}`);
});

// ── C7 — Provider-agnostic AI governance (TPS) ───────────────────────────────
test('C7: TPS — a raw AI credential is rejected; no raw AI key is allowlisted', () => {
  const allow = require('../lib/config-allowlist');
  const forbidden = allow.scanForbidden({ ANTHROPIC_API_KEY: 'sk-ant-should-be-rejected' });
  assert.ok(forbidden.some((f) => f.name === 'ANTHROPIC_API_KEY'),
    'a raw AI provider key must be rejected by the provider-agnostic allowlist');
  // The tenant supplies a reference, not a key: AI_CREDENTIAL_REF is allowed, keys are not.
  assert.ok(allow.isAllowed('AI_CREDENTIAL_REF'), 'AI_CREDENTIAL_REF (reference) must be allowed');
  assert.ok(!allow.isAllowed('OPENAI_API_KEY'), 'a raw provider key must never be allowlisted');
});
