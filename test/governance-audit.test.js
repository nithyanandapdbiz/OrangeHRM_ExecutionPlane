'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ZephyrGovernance, resolveGovernanceConfig, computeCompliance, fmtDur,
} = require('../src/discovery/zephyrGovernance');
const cli = require('../scripts/discover');

// ── Fake ALM (records calls, no network) ───────────────────────────────────────
function fakeAlm() {
  const calls = { addComment: [], updateTestResults: [] };
  return {
    zephyrEnabled: true, calls,
    async fetchWorkItem(key) { return { key, id: 1 }; },
    async createTestRun(name) { return { id: 1, key: 'ORHRM-R1', name }; },
    async createTestCase(_p, tc) { return { id: 2, key: 'ORHRM-T1', title: tc.title }; },
    async updateTestResults(cycleKey, results) { calls.updateTestResults.push({ cycleKey, results }); return { ok: true, synced: 1, passed: 1, failed: 0, executions: ['ORHRM-E1'] }; },
    async completeTestRun() {},
    async addComment(key, text) { calls.addComment.push({ key, text }); return { ok: true }; },
  };
}
const cfg = (o = {}) => resolveGovernanceConfig({ enabled: true, story: 'ORHRM-42', project: 'ORHRM', ...o }, {});
const FULL_META = { routes: 12, components: 40, contracts: 6, workflows: 5, knowledgeGraphNodes: 200, knowledgeGraphEdges: 500, businessRules: 8, pageObjects: 12, contractTests: 6, coverage: 93.3, riskSeverity: 'medium', recommendations: 4 };
const FULL_FILES = ['reports/executive.json', 'reports/architect.json', 'reports/qa.json', 'reports/developer.json', 'report.html', 'knowledge-graph.json', 'navigation-graph.json', 'coverage.json', 'risk.json', 'business-rules.json', 'recommendations.json', 'page-objects/ (12)', 'contracts.json', 'contract-tests/ (6)'];

// ── Phase 1 — timeline ─────────────────────────────────────────────────────────
test('timeline records structured lifecycle events with ts/stage/result', async () => {
  const g = new ZephyrGovernance(cfg(), { alm: fakeAlm() });
  await g.begin({ discoveryRunId: 'r1', baseUrl: 'https://app' });
  await g.syncStage('crawling', 'crawling', '12 pages');
  await g.syncStage('synthesising', 'synthesising', 'report');
  const snap = await g.complete({ metadata: FULL_META, artifactFiles: FULL_FILES, ipRunId: 'ip1' });
  const events = snap.timeline.map((e) => e.event);
  assert.ok(events.includes('Discovery Requested'));
  assert.ok(events.includes('Zephyr Cycle Created'));
  assert.ok(events.includes('Zephyr Execution Created'));
  assert.ok(events.includes('Evidence Uploaded'));
  assert.ok(events.includes('PASS'));
  for (const e of snap.timeline) {
    assert.match(e.ts, /^\d{4}-\d\d-\d\dT/);       // ISO timestamp
    assert.strictEqual(typeof e.elapsedMs, 'number');
    assert.strictEqual(e.actor, 'discovery-platform');
  }
});

// ── Phase 8 — compliance ───────────────────────────────────────────────────────
test('computeCompliance = PASS when all required artefacts present', () => {
  const c = computeCompliance(FULL_META, FULL_FILES);
  assert.strictEqual(c.result, 'PASS');
  assert.strictEqual(c.missing.length, 0);
  assert.strictEqual(c.required.length, 14);
});

test('computeCompliance = PARTIAL with warnings when artefacts missing', () => {
  const c = computeCompliance({ routes: 1 }, ['reports/executive.json']);
  assert.strictEqual(c.result, 'PARTIAL');
  assert.ok(c.missing.includes('QA Report'));
  assert.ok(c.missing.includes('Knowledge Graph'));
  assert.ok(c.warnings.every((w) => /missing/i.test(w)));
});

test('governanceResult = PARTIAL on completed-but-incomplete; FAIL on failed run', async () => {
  const partial = await new ZephyrGovernance(cfg(), { alm: fakeAlm() });
  await partial.begin({ discoveryRunId: 'r2', baseUrl: 'https://app' });
  const ps = await partial.complete({ metadata: { routes: 1 }, artifactFiles: ['metadata.json'] });
  assert.strictEqual(ps.governanceResult, 'PARTIAL');
  assert.strictEqual(ps.zephyrStatus, 'Pass'); // execution still Pass — compliance is a separate axis

  const failed = new ZephyrGovernance(cfg(), { alm: fakeAlm() });
  await failed.begin({ discoveryRunId: 'r3', baseUrl: 'https://app' });
  const fs2 = await failed.fail({ error: 'boom' });
  assert.strictEqual(fs2.governanceResult, 'FAIL');
});

// ── Phase 5 — metrics ──────────────────────────────────────────────────────────
test('metrics capture timings, comment count and governance duration', async () => {
  const g = new ZephyrGovernance(cfg(), { alm: fakeAlm() });
  await g.begin({ discoveryRunId: 'r4', baseUrl: 'https://app' });
  await g.syncStage('crawling', 'crawling', '3 pages');
  const snap = await g.complete({ metadata: FULL_META, artifactFiles: FULL_FILES });
  const m = snap.metrics;
  assert.strictEqual(typeof m.cycleCreateMs, 'number');
  assert.strictEqual(typeof m.executionCreateMs, 'number');
  assert.strictEqual(typeof m.governanceDurationMs, 'number');
  assert.ok(m.commentCount >= 2);
  assert.strictEqual(m.failures, 0);
});

test('fmtDur formats ms and seconds', () => {
  assert.strictEqual(fmtDur(42), '42 ms');
  assert.strictEqual(fmtDur(1500), '1.5 s');
  assert.strictEqual(fmtDur(null), '—');
});

// ── Phase 4 — structured Markdown comment ──────────────────────────────────────
test('final Jira comment is structured Markdown with a stage table', async () => {
  const alm = fakeAlm();
  const g = new ZephyrGovernance(cfg(), { alm });
  await g.begin({ discoveryRunId: 'r5', baseUrl: 'https://app' });
  await g.syncStage('crawling', 'crawling', '12 pages');
  await g.complete({ metadata: FULL_META, artifactFiles: FULL_FILES });
  const md = alm.calls.addComment.at(-1).text;
  assert.match(md, /## ✅ Discovery Execution/);
  assert.match(md, /\| Stage \| Status \| Duration \|/);
  assert.match(md, /### Discovery Summary/);
  assert.match(md, /Coverage: 93.3%/);
});

test('comment log is captured for offline audit replay', async () => {
  const g = new ZephyrGovernance(cfg(), { alm: fakeAlm() });
  await g.begin({ discoveryRunId: 'r6', baseUrl: 'https://app' });
  await g.syncStage('crawling', 'crawling', '5 pages');
  const snap = await g.complete({ metadata: FULL_META, artifactFiles: FULL_FILES });
  assert.ok(snap.commentLog.length >= 2);
  assert.ok(snap.commentLog.every((c) => typeof c.text === 'string' && c.ts));
});

// ── Phases 2/3/7 — CLI governance package (evidence / governance / audit) ───────
function statusWith(zephyr) {
  return { runId: 'r7', status: 'completed', ipRunId: 'ip7', baseUrl: 'https://app', elapsedS: 42, startedAt: '2026-07-13T09:14:03.000Z', completedAt: '2026-07-13T09:15:42.000Z', zephyr };
}
function fakeZephyrSnap() {
  return {
    enabled: true, story: 'ORHRM-42', tenant: 'orangehrm', project: 'ORHRM', release: 'R1',
    cycleKey: 'ORHRM-R1', executionKey: 'ORHRM-E1', zephyrStatus: 'Pass', governanceResult: 'PASS',
    comments: 3, commentLog: [{ ts: '2026-07-13T09:14:04.000Z', stage: null, text: 'started' }],
    timeline: [{ ts: '2026-07-13T09:14:03.000Z', elapsedMs: 0, actor: 'discovery-platform', stage: null, event: 'Discovery Requested', result: 'ok' }],
    compliance: { result: 'PASS', required: [], present: [], missing: [], warnings: [] },
    metrics: { cycleCreateMs: 12, executionCreateMs: 30, commentMs: 5, commentCount: 3, evidenceUploadMs: 4, retryCount: 0, failures: 0, skipped: 0, governanceDurationMs: 99000 },
    evidence: { mode: 'jira-comment', uploaded: true, count: 3 }, retryCount: 0, retryPolicy: 'same-execution',
    correlationIds: { discoveryRunId: 'r7', ipRunId: 'ip7' },
  };
}

test('buildEvidenceManifest hashes every written artefact (Phase 3)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-ev-'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), '{"a":1}');
  fs.mkdirSync(path.join(dir, 'reports'));
  fs.writeFileSync(path.join(dir, 'reports', 'qa.json'), '{"q":2}');
  const ev = cli.buildEvidenceManifest(dir);
  const names = ev.map((e) => e.filename).sort();
  assert.deepStrictEqual(names, ['metadata.json', 'reports/qa.json']);
  for (const e of ev) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.ok(e.size > 0);
    assert.strictEqual(e.status, 'present');
    assert.match(e.generatedAt, /T/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeGovernancePackage persists governance/evidence/audit with hashes + correlation IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-pkg-'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), '{"routes":12}');
  fs.mkdirSync(path.join(dir, 'reports'));
  fs.writeFileSync(path.join(dir, 'reports', 'executive.json'), '{"e":1}');
  const pkg = cli.writeGovernancePackage('r7', statusWith(fakeZephyrSnap()), { metadata: { routes: 12 } }, dir);

  // files on disk
  assert.ok(fs.existsSync(path.join(dir, 'governance.json')));
  assert.ok(fs.existsSync(path.join(dir, 'evidence.json')));
  assert.ok(fs.existsSync(path.join(dir, 'audit-report.json')));

  // governance.json
  const gov = JSON.parse(fs.readFileSync(path.join(dir, 'governance.json'), 'utf8'));
  assert.strictEqual(gov.runId, 'r7');
  assert.strictEqual(gov.jira, 'ORHRM-42');
  assert.strictEqual(gov.zephyr.cycle, 'ORHRM-R1');
  assert.strictEqual(gov.zephyr.execution, 'ORHRM-E1');
  assert.strictEqual(gov.zephyr.status, 'Pass');
  assert.strictEqual(gov.governanceResult, 'PASS');
  assert.ok(Array.isArray(gov.timeline) && gov.timeline.length >= 1);
  assert.strictEqual(gov.evidence.length, 2); // metadata + executive (package files not yet written at scan)

  // audit-report.json — self-contained, hashes + correlation IDs
  const audit = JSON.parse(fs.readFileSync(path.join(dir, 'audit-report.json'), 'utf8'));
  assert.strictEqual(audit.executionMetadata.runId, 'r7');
  assert.strictEqual(audit.correlationIds.ipRunId, 'ip7');
  assert.match(audit.packageHash, /^[0-9a-f]{64}$/);
  assert.ok(audit.hashes['reports/executive.json']);
  assert.strictEqual(audit.tenant, 'orangehrm');
  assert.strictEqual(pkg.evidence.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Backward compatibility ─────────────────────────────────────────────────────
test('no governance package fields leak when governance disabled', () => {
  // resolveConfig without --zephyr → buildRunBody omits the zephyr block entirely
  const body = cli.buildRunBody(cli.resolveConfig({ url: 'https://x' }, {}, {}));
  assert.strictEqual(body.zephyr, undefined);
});
