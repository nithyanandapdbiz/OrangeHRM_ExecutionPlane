'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Unit tests for the ALM facade (clients/alm.client.js). AlmClient composes the
// Jira + Zephyr clients and exposes the stable method surface that callers
// (run.js / health.js / scripts) depend on — the same names the historical ALM client surface exposed.
// No real network calls: the composed clients' .http transports are stubbed.

const AlmClient = require('../clients/alm.client');

const ENV = {
  JIRA_BASE_URL: 'https://orangehrm.atlassian.net',
  JIRA_EMAIL: 'qa@orangehrm.example',
  JIRA_API_TOKEN: 'jira-token',
  JIRA_PROJECT_KEY: 'OHRM',
  ZEPHYR_API_TOKEN: 'zephyr-token',
};

function stubHttp(responder = {}) {
  const calls = [];
  const wrap = (method) => async (url, dataOrParams, params) => {
    calls.push({ method, url, data: dataOrParams, params });
    const fn = responder[method];
    return fn ? fn(url, dataOrParams, params) : {};
  };
  return {
    calls, get: wrap('get'), post: wrap('post'), put: wrap('put'),
    paginate: async (fetchPage) => (await fetchPage(0)).values || [],
  };
}

test('exposes the stable facade surface (caller-compatible method names)', () => {
  const alm = new AlmClient(ENV);
  for (const m of ['checkConnectivity', 'fetchWorkItem', 'createTestCase',
    'batchCreateTestCases', 'createTestRun', 'updateTestResults',
    'completeTestRun', 'createBug']) {
    assert.strictEqual(typeof alm[m], 'function', `missing facade method ${m}`);
  }
});

test('delegates fetchWorkItem to Jira and caches the issue id for Zephyr linking', async () => {
  const alm = new AlmClient(ENV);
  alm.jira.http = stubHttp({
    get: async () => ({ id: '10001', key: 'OHRM-1', fields: { summary: 'S', issuetype: { name: 'Story' }, status: { name: 'To Do' } } }),
  });
  const story = await alm.fetchWorkItem('OHRM-1');
  assert.strictEqual(story.key, 'OHRM-1');
  assert.strictEqual(alm._issueIdByKey.get('OHRM-1'), '10001');
});

test('delegates createBug to the Jira tracker', async () => {
  const alm = new AlmClient(ENV);
  alm.jira.http = stubHttp({ post: async (url) => (url === '/issue' ? { id: '5', key: 'OHRM-5' } : {}) });
  const bug = await alm.createBug('X fails', 'steps', null, 'High');
  assert.strictEqual(bug.key, 'OHRM-5');
});

test('createTestRun / updateTestResults degrade gracefully when Zephyr is disabled', async () => {
  const env = { ...ENV }; delete env.ZEPHYR_API_TOKEN;
  const alm = new AlmClient(env);
  assert.strictEqual(alm.zephyr.enabled, false);

  const run = await alm.createTestRun('run', ['OHRM-T1']);
  assert.deepStrictEqual(run, { id: null, key: null, name: 'run' });

  const upd = await alm.updateTestResults(null, [{ passed: true }]);
  assert.deepStrictEqual(upd, { ok: false, synced: 0, passed: 0, failed: 0 });

  const cases = await alm.batchCreateTestCases('OHRM-1', [{ title: 'tc' }]);
  assert.deepStrictEqual(cases, []);
});

test('createTestRun delegates to Zephyr when enabled', async () => {
  const alm = new AlmClient(ENV);
  alm.zephyr.http = stubHttp({
    get: async () => ({ values: [] }),
    post: async (url) => (url === '/folders' ? { id: 1 } : { id: 'C1', key: 'OHRM-C1' }),
  });
  const run = await alm.createTestRun('Employee Login', ['OHRM-T1']);
  assert.strictEqual(run.key, 'OHRM-C1');
});
