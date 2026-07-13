'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ZephyrGovernance, governanceFor, resolveGovernanceConfig, mapStatus, stageLabel,
} = require('../src/discovery/zephyrGovernance');

// ── Fake ALM client that records calls (no network) ────────────────────────────
function fakeAlm({ zephyrEnabled = true } = {}) {
  const calls = { fetchWorkItem: [], createTestRun: [], createTestCase: [], updateTestResults: [], completeTestRun: [], addComment: [] };
  return {
    zephyrEnabled,
    calls,
    async fetchWorkItem(key) { calls.fetchWorkItem.push(key); return { key, id: 10001 }; },
    async createTestRun(name) { calls.createTestRun.push(name); return { id: 1, key: 'ORHRM-R99', name: `[Cycle] ${name}` }; },
    async createTestCase(parent, tc) { calls.createTestCase.push({ parent, tc }); return { id: 2, key: 'ORHRM-T99', title: tc.title }; },
    async updateTestResults(cycleKey, results) { calls.updateTestResults.push({ cycleKey, results }); return { ok: true, synced: results.length, passed: results.filter((r) => r.passed).length, failed: 0, executions: ['ORHRM-E99'] }; },
    async completeTestRun(cycleKey) { calls.completeTestRun.push(cycleKey); },
    async addComment(key, text) { calls.addComment.push({ key, text }); return { ok: true }; },
  };
}

const cfg = (over = {}) => resolveGovernanceConfig({ enabled: true, story: 'ORHRM-42', project: 'ORHRM', ...over }, {});

// ── Status mapping ─────────────────────────────────────────────────────────────
test('mapStatus maps Discovery lifecycle to Zephyr statuses', () => {
  assert.strictEqual(mapStatus('queued'), 'Not Executed');
  assert.strictEqual(mapStatus('running'), 'In Progress');
  assert.strictEqual(mapStatus('crawling'), 'In Progress');
  assert.strictEqual(mapStatus('completed'), 'Pass');
  assert.strictEqual(mapStatus('failed'), 'Fail');
  assert.strictEqual(mapStatus('cancelled'), 'Blocked');
  assert.strictEqual(mapStatus('nonsense'), 'Not Executed');
});

test('stageLabel humanises EP stages and IP sub-stages', () => {
  assert.strictEqual(stageLabel('crawling', '12 page(s)'), 'Crawling — 12 page(s)');
  assert.strictEqual(stageLabel('synthesising', 'app-model-synthesise'), 'Knowledge Graph');
  assert.strictEqual(stageLabel('synthesising', 'report'), 'Report Generation');
  assert.strictEqual(stageLabel('downloading'), 'Artifact Upload');
});

// ── Config resolution / backward compatibility ─────────────────────────────────
test('resolveGovernanceConfig defaults governance OFF', () => {
  const c = resolveGovernanceConfig({}, {});
  assert.strictEqual(c.enabled, false);
});

test('resolveGovernanceConfig honours env + auto flags', () => {
  const c = resolveGovernanceConfig({ enabled: true }, {
    ZEPHYR_PROJECT: 'ORHRM', ISSUE_KEY: 'ORHRM-7', AUTO_CREATE_CYCLE: 'false', AUTO_SYNC_STATUS: 'true',
  });
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.project, 'ORHRM');
  assert.strictEqual(c.story, 'ORHRM-7');
  assert.strictEqual(c.autoCreateCycle, false);
  assert.strictEqual(c.autoSyncStatus, true);
  assert.strictEqual(c.autoCreateExecution, true); // unset → default true
});

test('governanceFor returns null when disabled (standalone lifecycle preserved)', () => {
  assert.strictEqual(governanceFor({}), null);
  assert.strictEqual(governanceFor({ zephyr: { enabled: false } }), null);
  assert.ok(governanceFor({ zephyr: { enabled: true } }, { alm: fakeAlm() }) instanceof ZephyrGovernance);
});

// ── begin() — create cycle + link story ────────────────────────────────────────
test('begin creates the cycle, resolves the story and posts a start comment', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  const snap = await g.begin({ discoveryRunId: 'disc-1', baseUrl: 'https://app.example.com/x', browser: 'chromium (headed)' });
  assert.strictEqual(alm.calls.fetchWorkItem[0], 'ORHRM-42');
  assert.strictEqual(alm.calls.createTestRun.length, 1);
  assert.strictEqual(snap.cycleKey, 'ORHRM-R99');
  assert.strictEqual(snap.zephyrStatus, 'In Progress');
  assert.strictEqual(snap.story, 'ORHRM-42');
  assert.strictEqual(alm.calls.addComment.length, 1);
  assert.match(alm.calls.addComment[0].text, /Discovery execution started/);
});

test('begin reuses an existing cycle and skips create when autoCreateCycle=false', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg({ cycle: 'ORHRM-R50', autoCreateCycle: false }), { alm });
  const snap = await g.begin({ discoveryRunId: 'disc-2', baseUrl: 'https://app' });
  assert.strictEqual(alm.calls.createTestRun.length, 0);
  assert.strictEqual(snap.cycleKey, 'ORHRM-R50');
});

// ── syncStage — comments + status transitions ──────────────────────────────────
test('syncStage posts a stage comment and advances the Zephyr status', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'disc-3', baseUrl: 'https://app' });
  const before = alm.calls.addComment.length;
  const snap = await g.syncStage('synthesising', 'synthesising', 'report');
  assert.strictEqual(alm.calls.addComment.length, before + 1);
  assert.match(alm.calls.addComment[before].text, /Report Generation/);
  assert.strictEqual(snap.zephyrStatus, 'In Progress');
});

test('autoSyncStatus=false suppresses stage comments', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg({ autoSyncStatus: false }), { alm });
  await g.begin({ discoveryRunId: 'disc-4', baseUrl: 'https://app' });
  const before = alm.calls.addComment.length;
  await g.syncStage('crawling', 'crawling', '5 pages');
  assert.strictEqual(alm.calls.addComment.length, before); // no new comment
});

// ── complete() — authoritative execution + evidence ────────────────────────────
test('complete creates a Pass execution with metrics comment and uploads evidence', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'disc-5', baseUrl: 'https://app' });
  await g.syncStage('crawling', 'crawling', '12 pages');
  const snap = await g.complete({
    metadata: { routes: 12, coverage: 93.3, riskSeverity: 'medium', knowledgeGraphNodes: 200 },
    artifactFiles: ['metadata.json', 'reports/executive.json'],
    ipRunId: 'ip-77',
  });
  assert.strictEqual(alm.calls.createTestCase.length, 1);
  assert.strictEqual(alm.calls.updateTestResults.length, 1);
  const exec = alm.calls.updateTestResults[0].results[0];
  assert.strictEqual(exec.passed, true);
  assert.strictEqual(exec.statusName, 'Pass');
  assert.match(exec.comment, /Coverage: 93.3%/);
  assert.match(exec.comment, /Timeline:/);
  assert.strictEqual(alm.calls.completeTestRun.length, 1);
  assert.strictEqual(snap.zephyrStatus, 'Pass');
  assert.strictEqual(snap.executionKey, 'ORHRM-E99');
  assert.strictEqual(snap.evidence.uploaded, true);
  assert.strictEqual(snap.evidence.count, 2);
});

// ── fail() — never left IN PROGRESS ────────────────────────────────────────────
test('fail creates a Fail execution and posts the error', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'disc-6', baseUrl: 'https://app' });
  const snap = await g.fail({ error: 'Intelligence Plane synthesis failed', ipRunId: 'ip-9' });
  const exec = alm.calls.updateTestResults[0].results[0];
  assert.strictEqual(exec.passed, false);
  assert.strictEqual(exec.statusName, 'Fail');
  assert.match(exec.comment, /Intelligence Plane synthesis failed/);
  assert.strictEqual(snap.zephyrStatus, 'Fail');
});

test('cancel maps to Blocked', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'disc-7', baseUrl: 'https://app' });
  const snap = await g.cancel({});
  assert.strictEqual(snap.zephyrStatus, 'Blocked');
  assert.strictEqual(alm.calls.updateTestResults[0].results[0].statusName, 'Blocked');
});

// ── retry() — audit history ────────────────────────────────────────────────────
test('retry records count/reason and honours new-execution policy', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg({ retryPolicy: 'new-execution' }), { alm });
  await g.begin({ discoveryRunId: 'disc-8', baseUrl: 'https://app' });
  await g.complete({ metadata: {}, artifactFiles: [] });
  assert.ok(g.snapshot().executionKey);
  const snap = await g.retry({ reason: 'timeout' });
  assert.strictEqual(snap.retryCount, 1);
  assert.strictEqual(snap.executionKey, null); // reset for a fresh execution
  assert.match(alm.calls.addComment.at(-1).text, /Retry #1/);
});

// ── Zephyr disabled (no token) — still comments, skips execution ────────────────
test('when Zephyr is disabled, governance still comments but creates no execution', async () => {
  const alm = fakeAlm({ zephyrEnabled: false });
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'disc-9', baseUrl: 'https://app' });
  await g.complete({ metadata: { routes: 3 }, artifactFiles: ['metadata.json'] });
  assert.strictEqual(alm.calls.createTestRun.length, 0);
  assert.strictEqual(alm.calls.updateTestResults.length, 0);
  assert.ok(alm.calls.addComment.length >= 2); // start + evidence comments still posted
});

// ── No story — no comments, but no crash ───────────────────────────────────────
test('without a story, governance degrades gracefully (no comments, no throw)', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(resolveGovernanceConfig({ enabled: true, project: 'ORHRM' }, {}), { alm });
  await g.begin({ discoveryRunId: 'disc-10', baseUrl: 'https://app' });
  const snap = await g.complete({ metadata: {}, artifactFiles: [] });
  assert.strictEqual(alm.calls.addComment.length, 0);
  assert.strictEqual(snap.story, null);
  assert.strictEqual(snap.zephyrStatus, 'Pass');
});
