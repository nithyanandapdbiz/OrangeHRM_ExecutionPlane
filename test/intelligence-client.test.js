'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const IntelligenceClient = require('../clients/intelligence.client');

// Temporarily set/restore env vars around a single construction.
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('throws when NO auth is configured (neither OAuth2 client creds nor CUSTOMER_JWT)', () => {
  withEnv({ CUSTOMER_JWT: undefined, CLIENT_ID: undefined, CLIENT_SECRET: undefined, CLIENT_SECRET_REF: undefined }, () => {
    assert.throws(() => new IntelligenceClient(), /Intelligence auth required/);
  });
});

test('accepts OAuth2 client credentials as auth (no CUSTOMER_JWT needed)', () => {
  withEnv({ CUSTOMER_JWT: undefined, CLIENT_ID: 'orangehrm', CLIENT_SECRET: 's3cr3t' }, () => {
    const c = new IntelligenceClient();
    assert.equal(c.clientId, 'orangehrm');
    assert.ok(c.tokenUrl.endsWith('/oauth/token'));
  });
});

const OAUTH = { CLIENT_ID: 'orangehrm', CLIENT_SECRET: 's3cr3t' };

test('normalises baseUrl by stripping a trailing slash', () => {
  withEnv({ ...OAUTH, INTELLIGENCE_API_URL: 'https://ip.example/' }, () => {
    assert.equal(new IntelligenceClient().baseUrl, 'https://ip.example');
  });
});

test('applies safe defaults for baseUrl and customerId', () => {
  withEnv({ ...OAUTH, INTELLIGENCE_API_URL: undefined, CUSTOMER_ID: undefined }, () => {
    const c = new IntelligenceClient();
    assert.equal(c.baseUrl, 'http://localhost:3001');
    assert.equal(c.customerId, 'orangehrm');
  });
});

test('_headers carry the OAuth2 bearer, content-type and customer id', async () => {
  await withEnv({ ...OAUTH, CUSTOMER_ID: 'acme' }, async () => {
    const c = new IntelligenceClient();
    c._getBearer = async () => 'oauth-access-token';   // stub the token exchange
    const h = await c._headers();
    assert.equal(h.Authorization, 'Bearer oauth-access-token');
    assert.equal(h['X-Customer-ID'], 'acme');
    assert.equal(h['Content-Type'], 'application/json');
    assert.ok(h['X-Request-Time'], 'request time header present for traceability');
  });
});
