'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ec = require('../lib/execution-context');

// Model B: the EP builds an immutable, versioned ExecutionContext owning tenant AI
// selection, with credentials as references (never raw keys).

test('builds a versioned, immutable context with mandatory metadata', () => {
  const ctx = ec.build({
    executionId: 'ex-1', correlationId: 'run-1', timestamp: '2026-07-02T00:00:00Z',
    business: { storyId: 'S-1' },
  });
  assert.strictEqual(ctx.version, 'v1');
  assert.strictEqual(ctx.metadata.executionId, 'ex-1');
  assert.strictEqual(ctx.metadata.source, 'orangehrm-execution-plane');
  assert.strictEqual(ctx.business.storyId, 'S-1');
  assert.throws(() => { ctx.ai.model = 'x'; }, 'context must be frozen/immutable');
});

test('carries tenant-owned AI selection from config/ai-profile.json', () => {
  const ctx = ec.build({ executionId: 'e', correlationId: 'c', timestamp: 't' });
  assert.ok(ctx.ai.provider, 'provider owned by tenant');
  assert.ok(ctx.ai.model, 'model owned by tenant');
  assert.ok(ctx.ai.parameters && typeof ctx.ai.parameters === 'object');
});

test('AI credential is a reference, never a raw key', () => {
  const ctx = ec.build({ executionId: 'e', correlationId: 'c', timestamp: 't' });
  assert.match(ctx.security.credentialRefs.ai, /:\/\//);
});

test('assertReference rejects a raw key but accepts a kv:// reference', () => {
  assert.throws(() => ec.assertReference('cred', 'sk-ant-abcdef0123456789abcdef0123456789'), /must be a reference/);
  assert.doesNotThrow(() => ec.assertReference('cred', 'kv://tenant/ai/anthropic'));
});

test('validate() enforces mandatory fields + reference-only credential', () => {
  const good = ec.build({ executionId: 'e', correlationId: 'c', timestamp: 't', business: {} });
  assert.strictEqual(ec.validate(good).ok, true, JSON.stringify(ec.validate(good).errors));

  const bad = { version: 'v1', metadata: {}, tenant: {}, ai: {} };
  const r = ec.validate(bad);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length >= 3);
});
