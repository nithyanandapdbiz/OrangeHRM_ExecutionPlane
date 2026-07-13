'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// The Intelligence client requires OAuth2 credentials at construction.
process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || 'test-secret';

const IntelligenceClient = require('../clients/intelligence.client');
const { scrub } = require('../middleware/pii-scrubber');

function stubbed() {
  const c = new IntelligenceClient({ correlationId: 'corr-1' });
  const calls = [];
  c._call = async (endpoint, payload) => { calls.push({ m: 'POST', endpoint, payload }); return { success: true, data: { runId: 'IP-1', status: 'queued' } }; };
  c._get  = async (endpoint) => { calls.push({ m: 'GET', endpoint }); return { success: true, data: { discovery: { status: 'completed' } } }; };
  return { c, calls };
}

test('discover() posts the application surface to /api/discovery', async () => {
  const { c, calls } = stubbed();
  const r = await c.discover({ target: { baseUrl: 'https://x' }, appSurface: { routes: [{}], pages: [], endpoints: [] } });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.runId, 'IP-1');
  assert.strictEqual(calls[0].endpoint, '/api/discovery');
  assert.ok(calls[0].payload.appSurface, 'app surface forwarded');
});

test('status / artifacts / cancel / retry hit the correct endpoints + verbs', async () => {
  const { c, calls } = stubbed();
  await c.getDiscoveryStatus('IP-9');
  await c.downloadArtifacts('IP-9');
  await c.cancelDiscovery('IP-9');
  await c.retryDiscovery('IP-9');
  assert.deepStrictEqual(calls.map((x) => `${x.m} ${x.endpoint}`), [
    'GET /api/discovery/IP-9',
    'GET /api/discovery/IP-9/artifacts',
    'POST /api/discovery/IP-9/cancel',
    'POST /api/discovery/IP-9/retry',
  ]);
});

test('run ids are URL-encoded in discovery endpoints', async () => {
  const { c, calls } = stubbed();
  await c.getDiscoveryStatus('a b/c');
  assert.strictEqual(calls[0].endpoint, '/api/discovery/a%20b%2Fc');
});

test('PII scrubber redacts sensitive values from a discovery package before egress', () => {
  const pkg = {
    target: { baseUrl: 'https://demo' },
    appSurface: {
      routes: [{ url: 'https://demo/profile', title: 'jane.doe@example.com' }],
      pages: [{ url: 'https://demo/profile', forms: [] }],
      endpoints: [{
        method: 'POST', url: 'https://demo/api/login',
        requestHeaders: { authorization: 'Bearer secret-token' },
        requestBody: { email: 'jane.doe@example.com', ssn: '123-45-6789', password: 'hunter2' },
        responseBody: { phone: '415-555-1212' }, status: 200,
      }],
    },
  };
  const { scrubbed, fieldsRedacted } = scrub(pkg);
  const flat = JSON.stringify(scrubbed);
  assert.ok(!flat.includes('jane.doe@example.com'), 'email redacted');
  assert.ok(!flat.includes('123-45-6789'), 'ssn redacted');
  assert.ok(!flat.includes('hunter2'), 'password redacted');
  assert.ok(!flat.includes('415-555-1212'), 'phone redacted');
  assert.ok(fieldsRedacted.length > 0, 'reports redacted fields');
});
