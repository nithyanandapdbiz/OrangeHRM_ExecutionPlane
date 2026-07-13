'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || 'test-secret';
process.env.DISCOVERY_POLL_INTERVAL_MS = '5';   // keep the worker poll loop fast
process.env.DISCOVERY_POLL_TIMEOUT_MS = '2000';

// ── Inject test doubles BEFORE the controller is required ────────────────────
const appCrawler = require('../src/discovery/appCrawler');
const IntelligenceClient = require('../clients/intelligence.client');
const execStore = require('../src/discovery/discoveryExecutionStore');

const SURFACE = {
  target: { baseUrl: 'https://demo', appName: 'demo' },
  appSurface: {
    routes: [{ url: 'https://demo/login', path: '/login', title: 'Login', statusCode: 200, depth: 0 }],
    pages: [{ url: 'https://demo/login', path: '/login', forms: [{ name: 'f', method: 'POST', fields: [{ name: 'email', type: 'text', selectorHints: { name: 'email' }, required: true }] }] }],
    endpoints: [{ method: 'POST', url: 'https://demo/api/login', requestBody: { email: 'a@b.com' }, responseBody: { ok: true }, status: 200, durationMs: 10 }],
  },
  meta: { crawlStats: { routes: 1, pagesWithForms: 1, endpoints: 1, durationMs: 5 } },
};

function mockCrawl(surface = SURFACE) { appCrawler.crawl = async () => surface; }
function mockIntel({ discover, status = 'completed', artifacts = { metadata: { routes: 1 } } } = {}) {
  IntelligenceClient.prototype.discover = discover || (async () => ({ success: true, data: { runId: 'IP-1', status: 'queued' } }));
  IntelligenceClient.prototype.getDiscoveryStatus = async () => ({ success: true, data: { discovery: { status } } });
  IntelligenceClient.prototype.downloadArtifacts = async () => ({ success: true, data: { artifacts } });
  IntelligenceClient.prototype.cancelDiscovery = async () => ({ success: true, data: {} });
}

const ctrl = require('../src/api/discovery.controller');

test('execution store lifecycle: queued → running → completed', () => {
  execStore._reset();
  const v = execStore.create({ runId: 'r1', baseUrl: 'https://demo' });
  assert.strictEqual(v.status, 'queued');
  execStore.markRunning('r1');
  assert.strictEqual(execStore.get('r1').status, 'running');
  execStore.complete('r1', { artifacts: { metadata: { routes: 2 } }, artifactSummary: { routes: 2 } });
  const done = execStore.get('r1');
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.progress, 100);
  const art = execStore.getArtifacts('r1');
  assert.ok(art.ready && art.artifacts.metadata.routes === 2);
});

test('artifacts are 409-not-ready until completion', () => {
  execStore._reset();
  execStore.create({ runId: 'r2', baseUrl: 'https://demo' });
  const art = execStore.getArtifacts('r2');
  assert.strictEqual(art.ready, false);
  assert.strictEqual(art.status, 'queued');
});

test('worker happy path: crawl → scrub → delegate → poll → download → complete', async () => {
  execStore._reset();
  mockCrawl();
  mockIntel({ status: 'completed' });
  const run = execStore.create({ runId: 'w1', baseUrl: 'https://demo' });
  await ctrl.runDiscoveryWorker(run.runId, { baseUrl: 'https://demo' });
  const v = execStore.get('w1');
  assert.strictEqual(v.status, 'completed');
  assert.strictEqual(v.ipRunId, 'IP-1');
  assert.ok(execStore.getArtifacts('w1').ready);
});

test('worker fails when the Intelligence Plane rejects the submission', async () => {
  execStore._reset();
  mockCrawl();
  mockIntel({ discover: async () => ({ success: false, status: 403, reason: 'tier' }) });
  const run = execStore.create({ runId: 'w2', baseUrl: 'https://demo' });
  await ctrl.runDiscoveryWorker(run.runId, { baseUrl: 'https://demo' });
  const v = execStore.get('w2');
  assert.strictEqual(v.status, 'failed');
  assert.match(v.error, /rejected discovery/i);
});

test('worker fails when IP synthesis ends non-completed', async () => {
  execStore._reset();
  mockCrawl();
  mockIntel({ status: 'failed' });
  const run = execStore.create({ runId: 'w3', baseUrl: 'https://demo' });
  await ctrl.runDiscoveryWorker(run.runId, { baseUrl: 'https://demo' });
  assert.strictEqual(execStore.get('w3').status, 'failed');
});

test('cancellation short-circuits the worker before completion', async () => {
  execStore._reset();
  // Crawl blocks until cancelled so we can flip the flag mid-run.
  appCrawler.crawl = async () => { execStore.cancel('w4'); return SURFACE; };
  mockIntel({ status: 'completed' });
  const run = execStore.create({ runId: 'w4', baseUrl: 'https://demo' });
  await ctrl.runDiscoveryWorker(run.runId, { baseUrl: 'https://demo' });
  assert.strictEqual(execStore.get('w4').status, 'cancelled');
});
