'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const config   = require('../lib/config');

const base = {
  INTELLIGENCE_API_URL: 'http://localhost:3001',
  CLIENT_ID: 'orangehrm', CLIENT_SECRET: 'sec', JIRA_BASE_URL: 'https://orangehrm.atlassian.net',
  JIRA_PROJECT_KEY: 'OHRM', JIRA_EMAIL: 'qa@orangehrm.example', JIRA_API_TOKEN: 'token',
};

test('valid config passes validation', () => {
  const r = config.validate(base);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('missing required field fails fast with a clear error', () => {
  const env = { ...base }; delete env.JIRA_API_TOKEN;
  const r = config.validate(env);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /JIRA_API_TOKEN is required/.test(e)));
});

test('invalid URL is rejected', () => {
  const r = config.validate({ ...base, JIRA_BASE_URL: 'not a url' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /JIRA_BASE_URL is not a valid URL/.test(e)));
});

test('Model B: a RAW AI provider key is forbidden (references only)', () => {
  // Raw AI credentials never enter the EP — tenants supply AI_CREDENTIAL_REF instead.
  for (const v of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROK_API_KEY', 'FUTUREPROVIDER_API_KEY', 'AI_API_KEY']) {
    const r = config.validate({ ...base, [v]: 'sk-leak' });
    assert.equal(r.ok, false, `${v} should be rejected`);
    assert.ok(r.errors.some((e) => new RegExp(`${v} must NOT be set`).test(e)), `${v} error missing`);
  }
});

test('Model B: tenant-owned AI SELECTION is allowed (provider/model/refs)', () => {
  const r = config.validate({
    ...base,
    AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-4-5', AI_FALLBACK_MODEL: 'claude-3-5-haiku',
    AI_MAX_TOKENS: '4096', AI_TEMPERATURE: '0.2', AI_CREDENTIAL_REF: 'kv://tenant/anthropic',
    PROMPT_PACK: 'orangehrm-hr', KNOWLEDGE_REF: 'kv://tenant/kb',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('legit execution vars (incl ambient AI_AGENT / Windows PROMPT) are NOT rejected', () => {
  const r = config.validate({ ...base, AI_AGENT: '1', PROMPT: '$P$G', GITHUB_TOKEN: 'x', ZAP_API_KEY: 'x' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('type coercion: booleans and ints', () => {
  const c = config.get({ ...base, PW_HEADLESS: 'true', PORT: '4000', RUN_PERF: 'false' });
  assert.equal(c.PW_HEADLESS, true);
  assert.equal(c.PORT, 4000);
  assert.equal(c.RUN_PERF, false);
});

test('defaults applied when unset', () => {
  const c = config.get(base);
  assert.equal(c.PLATFORM_DIR, '.');
  assert.equal(c.PW_HEADLESS, false);
  assert.equal(c.PORT, 3000);
});

test('describe() never exposes secret values', () => {
  const d = config.describe({ ...base, API_SECRET: 'super-secret' });
  assert.equal(d.CLIENT_SECRET, '***present***');
  assert.equal(d.JIRA_API_TOKEN, '***present***');
  assert.equal(d.API_SECRET, '***present***');
  assert.equal(JSON.stringify(d).includes('super-secret'), false);
  assert.equal(JSON.stringify(d).includes('jwt'), false);
});
