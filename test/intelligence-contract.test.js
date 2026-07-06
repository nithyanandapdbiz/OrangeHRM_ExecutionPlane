'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// TD-15: pin the EP→IP wire contract. A local server stands in for the
// Intelligence Plane and captures exactly what the real IntelligenceClient sends,
// so any drift in method/path/headers/body — or a regression in the pre-boundary
// PII scrub — fails CI instead of leaking silently in production.

const OAUTH_TOKEN = 'srv.oauth.access.token';
let server, captured, IntelligenceClient;

before(async () => {
  // OAuth2 client-credentials (CUSTOMER_JWT is deprecated).
  process.env.CLIENT_ID = 'orangehrm';
  process.env.CLIENT_SECRET = 's3cr3t';
  delete process.env.CUSTOMER_JWT;
  process.env.CUSTOMER_ID = 'orangehrm';

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // Serve the OAuth2 token exchange (does not count as a captured API call).
      if (req.url === '/oauth/token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: OAUTH_TOKEN, token_type: 'Bearer', expires_in: 900 }));
        return;
      }
      captured = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stage: 'pipeline', agents: ['planner', 'reviewer'] }));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.INTELLIGENCE_API_URL = `http://127.0.0.1:${server.address().port}`;

  // Require AFTER env is set — the client reads config in its constructor.
  IntelligenceClient = require('../clients/intelligence.client');
});

after(() => new Promise((r) => server.close(r)));

test('POSTs to /api/pipeline with the agreed body shape', async () => {
  const client = new IntelligenceClient();
  const res = await client.pipeline('S-1', 'Employee Login & PIM Add-Employee', 'A plain description', 'hr');

  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(res.data.agents, ['planner', 'reviewer']);
  assert.strictEqual(captured.method, 'POST');
  assert.strictEqual(captured.url, '/api/pipeline');
  // Business fields remain at top level (backward compatible) alongside the context.
  for (const k of ['domain', 'storyDescription', 'storyId', 'storyTitle']) {
    assert.ok(k in captured.body, `body should carry business field ${k}`);
  }
  assert.strictEqual(captured.body.storyId, 'S-1');
  assert.strictEqual(captured.body.domain, 'hr');
});

test('Model B: ships a versioned ExecutionContext carrying tenant-owned AI selection', async () => {
  const client = new IntelligenceClient({ correlationId: 'run-xyz' });
  await client.pipeline('S-9', 'Title', 'Desc', 'hr');

  const ctx = captured.body.executionContext;
  assert.ok(ctx, 'executionContext must be present');
  assert.strictEqual(ctx.version, 'v1');
  assert.strictEqual(ctx.metadata.correlationId, 'run-xyz');
  assert.strictEqual(ctx.tenant.id, 'orangehrm');
  // Tenant OWNS AI selection:
  assert.ok(ctx.ai.provider, 'ai.provider must be set by the tenant');
  assert.ok(ctx.ai.model, 'ai.model must be set by the tenant');
  // Credentials are REFERENCES, never raw keys:
  assert.match(ctx.security.credentialRefs.ai, /:\/\//, 'AI credential must be a reference');
  assert.ok(!/^sk-/.test(ctx.security.credentialRefs.ai), 'must not be a raw key');
});

test('sends the required auth + tenant headers', async () => {
  const client = new IntelligenceClient();
  await client.plan('S-2', 'Title', 'Desc');

  assert.strictEqual(captured.url, '/api/plan');
  assert.strictEqual(captured.headers['authorization'], `Bearer ${OAUTH_TOKEN}`);
  assert.match(captured.headers['content-type'], /application\/json/);
  assert.strictEqual(captured.headers['x-customer-id'], 'orangehrm');
  assert.match(captured.headers['x-request-time'], /^\d{4}-\d{2}-\d{2}T/); // ISO-8601
});

test('propagates the correlation id as X-Request-Id when provided', async () => {
  const client = new IntelligenceClient({ correlationId: 'run-ohrm-1-abc' });
  await client.plan('S-4', 'Title', 'Desc');
  assert.strictEqual(captured.headers['x-request-id'], 'run-ohrm-1-abc');
});

test('omits X-Request-Id when no correlation id is set', async () => {
  const client = new IntelligenceClient();
  await client.plan('S-5', 'Title', 'Desc');
  assert.strictEqual(captured.headers['x-request-id'], undefined);
});

test('scrubs PII before it crosses the boundary', async () => {
  const client = new IntelligenceClient();
  const res = await client.plan('S-3', 'Customer john.doe@example.com', 'Call 555-12-3456 re SSN 123-45-6789');

  // The IP server must never receive the raw email/SSN.
  const seen = JSON.stringify(captured.body);
  assert.ok(!seen.includes('john.doe@example.com'), 'email must be redacted');
  assert.ok(!seen.includes('123-45-6789'), 'SSN must be redacted');
  assert.ok(res.fieldsRedacted.length > 0, 'client should report redacted fields');
});
