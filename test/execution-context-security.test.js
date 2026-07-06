'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const ec = require('../lib/execution-context');

const SAVED = { ref: process.env.AI_CREDENTIAL_REF, key: process.env.CONTEXT_SIGNING_KEY, env: process.env.NODE_ENV };
afterEach(() => {
  ['AI_CREDENTIAL_REF', 'CONTEXT_SIGNING_KEY', 'NODE_ENV'].forEach((k) => {
    const v = { AI_CREDENTIAL_REF: SAVED.ref, CONTEXT_SIGNING_KEY: SAVED.key, NODE_ENV: SAVED.env }[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
});

const base = { executionId: 'e', correlationId: 'c', timestamp: '2026-07-03T00:00:00Z' };

test('reference schemes: kv:// accepted, arbitrary URI rejected', () => {
  assert.doesNotThrow(() => ec.assertRefScheme('x', 'kv://a/b'));
  assert.doesNotThrow(() => ec.assertRefScheme('x', 'vault://a'));
  assert.throws(() => ec.assertRefScheme('x', 'http://evil/'), /approved reference scheme/);
  process.env.AI_CREDENTIAL_REF = 'http://evil/steal';
  assert.throws(() => ec.build(base), /approved reference scheme/);
});

test('context carries a nonce + integrity checksum', () => {
  const ctx = ec.build(base);
  assert.match(ctx.security.nonce, /^[0-9a-f]{32}$/);
  assert.match(ctx.security.integrity, /^sha256:[0-9a-f]{64}$/);
});

test('integrity verifies; tampering is detected', () => {
  const ctx = ec.build(base);
  assert.strictEqual(ec.verifyIntegrity(ctx).integrityValid, true);
  // tamper: clone + change the AI model (frozen original can't mutate)
  const tampered = JSON.parse(JSON.stringify(ctx));
  tampered.ai.model = 'attacker-model';
  assert.strictEqual(ec.verifyIntegrity(tampered).integrityValid, false);
});

test('HMAC signature present + verifies when a signing key is set; forgery fails', () => {
  process.env.CONTEXT_SIGNING_KEY = 'super-secret-signing-key';
  const ctx = ec.build(base);
  assert.match(ctx.security.signature, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.strictEqual(ec.verifyIntegrity(ctx, 'super-secret-signing-key').ok, true);
  assert.strictEqual(ec.verifyIntegrity(ctx, 'wrong-key').signatureValid, false);
});

test('strict schema rejects unknown top-level properties', () => {
  const ctx = ec.build(base);
  assert.strictEqual(ec.validate(ctx).ok, true, JSON.stringify(ec.validate(ctx).errors));
  const injected = { ...JSON.parse(JSON.stringify(ctx)), evilPayload: { drop: 'tables' } };
  const r = ec.validate(injected);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /unknown top-level property rejected: evilPayload/.test(e)));
});

test('production rejects plaintext HTTP Intelligence URL (localhost dev allowed)', () => {
  process.env.NODE_ENV = 'production';
  process.env.CLIENT_ID = process.env.CLIENT_ID || 'orangehrm'; process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || 'sec';
  const url = process.env.INTELLIGENCE_API_URL;
  process.env.INTELLIGENCE_API_URL = 'http://intelligence.example.com';
  delete require.cache[require.resolve('../clients/intelligence.client')];
  const IntelligenceClient = require('../clients/intelligence.client');
  assert.throws(() => new IntelligenceClient(), /must use https:\/\/ in production/);
  process.env.INTELLIGENCE_API_URL = 'http://localhost:3001';
  assert.doesNotThrow(() => new IntelligenceClient()); // localhost dev is allowed even in prod
  if (url === undefined) delete process.env.INTELLIGENCE_API_URL; else process.env.INTELLIGENCE_API_URL = url;
});
