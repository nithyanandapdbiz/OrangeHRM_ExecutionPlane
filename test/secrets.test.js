'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const secrets = require('../lib/secrets');

// TD-08: the secrets seam must default to the env provider (no behaviour change)
// and select Key Vault only on explicit opt-in.

const ORIG = process.env.SECRETS_PROVIDER;
afterEach(() => {
  if (ORIG === undefined) delete process.env.SECRETS_PROVIDER;
  else process.env.SECRETS_PROVIDER = ORIG;
});

test('defaults to the env provider', () => {
  delete process.env.SECRETS_PROVIDER;
  assert.strictEqual(secrets.providerName(), 'env');
  assert.strictEqual(secrets.provider().name, 'env');
});

test('env provider reads straight from process.env', () => {
  delete process.env.SECRETS_PROVIDER;
  process.env.__SECRET_TEST = 'shhh';
  assert.strictEqual(secrets.get('__SECRET_TEST'), 'shhh');
  delete process.env.__SECRET_TEST;
});

test('env provider hydrate is a no-op', async () => {
  delete process.env.SECRETS_PROVIDER;
  const r = await secrets.hydrate();
  assert.strictEqual(r.provider, 'env');
  assert.deepStrictEqual(r.hydrated, []);
});

test('selects the keyvault provider on explicit opt-in', () => {
  process.env.SECRETS_PROVIDER = 'keyvault';
  assert.strictEqual(secrets.provider().name, 'keyvault');
});

test('keyvault hydrate fails fast without a vault URL', async () => {
  process.env.SECRETS_PROVIDER = 'keyvault';
  const saved = process.env.AZURE_KEY_VAULT_URL;
  delete process.env.AZURE_KEY_VAULT_URL;
  await assert.rejects(() => secrets.hydrate(), /AZURE_KEY_VAULT_URL/);
  if (saved !== undefined) process.env.AZURE_KEY_VAULT_URL = saved;
});

test('an unknown provider falls back to env', () => {
  process.env.SECRETS_PROVIDER = 'nonsense';
  assert.strictEqual(secrets.provider().name, 'env');
});

test('publishes the expected secret contract', () => {
  assert.ok(secrets.SECRET_NAMES.includes('CLIENT_SECRET'));
  assert.ok(secrets.SECRET_NAMES.includes('JIRA_API_TOKEN'));
});
