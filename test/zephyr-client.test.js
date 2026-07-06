'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Unit tests for the NEW Zephyr Essential client (clients/zephyr.client.js). No
// real network calls — this.http is replaced with a recording stub.

const ZephyrClient = require('../clients/zephyr.client');
const { assertTestManagement } = require('../clients/alm/testmanagement.contract');

const ENV = {
  JIRA_PROJECT_KEY: 'OHRM',
  ZEPHYR_API_TOKEN: 'zephyr-token',
  ZEPHYR_API_URL: 'https://api.zephyrscale.smartbear.com/v2',
};

function stubHttp(responder = {}) {
  const calls = [];
  const wrap = (method) => async (url, dataOrParams, params) => {
    calls.push({ method, url, data: dataOrParams, params });
    const fn = responder[method];
    return fn ? fn(url, dataOrParams, params) : {};
  };
  return { calls, get: wrap('get'), post: wrap('post'), put: wrap('put') };
}

test('construction requires JIRA_PROJECT_KEY (Zephyr is Jira-project-scoped)', () => {
  assert.throws(() => new ZephyrClient({ ZEPHYR_API_TOKEN: 't' }), /JIRA_PROJECT_KEY is required/);
});

test('constructs with ZEPHYR_* env and exposes the test-management surface', () => {
  const client = new ZephyrClient(ENV);
  assert.strictEqual(client.projectKey, 'OHRM');
  assert.strictEqual(client.enabled, true);
  for (const m of ['checkConnectivity', 'createTestCase', 'batchCreateTestCases',
    'createTestCycle', 'updateTestResults', 'completeTestCycle', 'ensureFolder']) {
    assert.strictEqual(typeof client[m], 'function', `missing method ${m}`);
  }
});

test('satisfies the TestManagement contract (assertTestManagement)', () => {
  assert.doesNotThrow(() => assertTestManagement(ZephyrClient.prototype, 'ZephyrClient'));
});

test('is disabled (and refuses writes) without ZEPHYR_API_TOKEN', async () => {
  const client = new ZephyrClient({ JIRA_PROJECT_KEY: 'OHRM' });
  assert.strictEqual(client.enabled, false);
  const conn = await client.checkConnectivity();
  assert.strictEqual(conn.connected, false);
  await assert.rejects(() => client.createTestCycle('run'), /ZEPHYR_API_TOKEN is not set/);
});

test('createTestCycle applies the configured run prefix and posts to /testcycles', async () => {
  const client = new ZephyrClient(ENV);
  client.http = stubHttp({
    get: async () => ({ values: [] }),                 // no existing folder
    post: async (url) => (url === '/folders' ? { id: 7 } : { id: 'C1', key: 'OHRM-C1' }),
  });

  const cycle = await client.createTestCycle('Employee Login', ['OHRM-T1', 'OHRM-T2']);
  assert.strictEqual(cycle.key, 'OHRM-C1');
  const post = client.http.calls.find((c) => c.url === '/testcycles');
  assert.ok(post, 'a test cycle POST must be sent');
  assert.match(post.data.name, /\[AgenticQA\]/);
  assert.match(post.data.name, /Employee Login/);
  assert.strictEqual(post.data.projectKey, 'OHRM');
});

test('updateTestResults maps passed/failed to configured Pass/Fail statuses', async () => {
  const client = new ZephyrClient(ENV);
  const executions = [];
  client.http = stubHttp({ post: async (url, body) => { if (url === '/testexecutions') executions.push(body); return {}; } });

  const res = await client.updateTestResults('OHRM-C1', [
    { title: 'a', passed: true, testCaseKey: 'OHRM-T1' },
    { title: 'b', passed: false, error: 'boom', testCaseKey: 'OHRM-T2' },
  ]);

  assert.strictEqual(res.passed, 1);
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(res.synced, 2);
  assert.strictEqual(executions[0].statusName, 'Pass');
  assert.strictEqual(executions[1].statusName, 'Fail');
  assert.strictEqual(executions[0].testCycleKey, 'OHRM-C1');
});

test('updateTestResults short-circuits on an empty result set', async () => {
  const client = new ZephyrClient(ENV);
  const res = await client.updateTestResults('OHRM-C1', []);
  assert.deepStrictEqual(res, { ok: true, synced: 0, passed: 0, failed: 0 });
});

test('completeTestCycle fetches the cycle + Done status id and PUTs a full object', async () => {
  const client = new ZephyrClient(ENV);
  client.http = stubHttp({
    get: async (url) => {
      if (String(url).startsWith('/testcycles/')) return { id: 1, key: 'OHRM-C1', name: 'Cyc', project: { id: 9 }, status: { id: 100 } };
      if (url === '/statuses') return { values: [{ id: 555, name: 'Done', statusType: 'TEST_CYCLE' }] };
      return {};
    },
    put: async () => ({}),
  });
  await client.completeTestCycle('OHRM-C1');
  const put = client.http.calls.find((c) => c.method === 'put');
  assert.ok(put, 'a PUT must be sent to close the cycle');
  assert.strictEqual(put.url, '/testcycles/OHRM-C1');
  // Update is a full-replace with the Done status as a { id } object (statusName is
  // ignored by the API on update).
  assert.strictEqual(put.data.status.id, 555);
  assert.strictEqual(put.data.key, 'OHRM-C1');
  assert.strictEqual(put.data.name, 'Cyc');
  assert.strictEqual(put.data.project.id, 9);
});

test('_resolveStatusId caches by (statusType, name)', async () => {
  const client = new ZephyrClient(ENV);
  let calls = 0;
  client.http = stubHttp({ get: async () => { calls++; return { values: [{ id: 7, name: 'Done' }] }; } });
  const a = await client._resolveStatusId('Done', 'TEST_CYCLE');
  const b = await client._resolveStatusId('done', 'TEST_CYCLE'); // case-insensitive, cached
  assert.strictEqual(a, 7);
  assert.strictEqual(b, 7);
  assert.strictEqual(calls, 1, 'second lookup must hit the cache');
});
