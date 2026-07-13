'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const cli = require('../scripts/discover');

test('parseArgs handles --k=v, --k v, boolean flags and positionals', () => {
  const a = cli.parseArgs(['--url=https://x', '--depth', '5', '--ci', 'extra', '--strategy', 'dfs']);
  assert.strictEqual(a.url, 'https://x');
  assert.strictEqual(a.depth, '5');
  assert.strictEqual(a.ci, true);
  assert.strictEqual(a.strategy, 'dfs');
  assert.deepStrictEqual(a._, ['extra']);
});

test('parseArgs treats a bare --flag before another --flag as boolean', () => {
  const a = cli.parseArgs(['--resume', '--url', 'https://x']);
  assert.strictEqual(a.resume, true);
  assert.strictEqual(a.url, 'https://x');
});

test('resolveConfig precedence: args > env > rc > defaults', () => {
  const rc = { baseUrl: 'https://rc', maxPages: 10, strategy: 'dfs' };
  const env = { DISCOVERY_URL: 'https://env', DISCOVERY_PAGES: '20' };
  const args = { url: 'https://args' };
  const cfg = cli.resolveConfig(args, env, rc);
  assert.strictEqual(cfg.baseUrl, 'https://args');   // arg wins
  assert.strictEqual(cfg.maxPages, 20);              // env wins over rc
  assert.strictEqual(cfg.strategy, 'dfs');           // rc wins over default
  assert.strictEqual(cfg.maxDepth, 3);               // default
});

test('resolveConfig parses numbers and headless=false', () => {
  const cfg = cli.resolveConfig({ depth: '7', pages: '99', headless: 'false' }, {}, {});
  assert.strictEqual(cfg.maxDepth, 7);
  assert.strictEqual(cfg.maxPages, 99);
  assert.strictEqual(cfg.headless, false);
});

test('buildRunBody maps config to the /discovery/run payload', () => {
  const cfg = cli.resolveConfig({ url: 'https://x', depth: '2', pages: '5', strategy: 'bfs' }, {}, {});
  const body = cli.buildRunBody(cfg);
  assert.deepStrictEqual(
    { baseUrl: body.baseUrl, maxDepth: body.maxDepth, maxPages: body.maxPages, strategy: body.strategy, domain: body.domain },
    { baseUrl: 'https://x', maxDepth: 2, maxPages: 5, strategy: 'bfs', domain: 'hr' });
});

test('splitArtifacts maps the artifacts object into discrete files', () => {
  const artifacts = {
    metadata: { routes: 1 },
    applicationModel: { routes: [] },
    navGraph: { nodes: [], edges: [] },
    knowledgeGraph: { nodes: [], edges: [] },
    workflows: [{ name: 'w' }],
    contracts: [{ method: 'GET' }],
    intelligence: { businessRules: [{ id: 'BR-1' }], coverage: { application: 90 }, risk: { severity: 'low' }, recommendations: [], reports: { executive: {} }, aiReadiness: { version: '1.0' } },
    pageObjects: [{ name: 'LoginPage.js', content: 'class {}' }],
    contractTests: [{ name: 't.spec.js', content: 'test' }],
    report: '<html>ok</html>',
  };
  const files = cli.splitArtifacts(artifacts).map((f) => f.path);
  for (const expected of ['metadata.json', 'application-model.json', 'knowledge-graph.json', 'business-rules.json', 'coverage.json', 'risk.json', 'ai-readiness.json', 'report.html']) {
    assert.ok(files.includes(expected), `missing ${expected}`);
  }
  assert.ok(files.some((f) => f.includes('LoginPage.js')));
  assert.ok(files.some((f) => f.includes('t.spec.js')));
});

test('splitArtifacts is safe on an empty/partial artifacts object', () => {
  assert.deepStrictEqual(cli.splitArtifacts({}), []);
  assert.strictEqual(cli.splitArtifacts({ metadata: { a: 1 } }).length, 1);
});

test('http retries transient 5xx then succeeds (mocked client)', async () => {
  let calls = 0;
  cli.__setHttpClient(async () => { calls++; return calls < 3 ? { status: 503, data: {} } : { status: 200, data: { ok: true } }; });
  const r = await cli.http('get', 'http://x', { retries: 3 });
  cli.__setHttpClient(null);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls, 3, 'retried twice then succeeded');
});

test('http gives up after the retry budget and throws', async () => {
  let calls = 0;
  cli.__setHttpClient(async () => { calls++; throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => cli.http('get', 'http://x', { retries: 1 }), /ECONNREFUSED/);
  cli.__setHttpClient(null);
  assert.strictEqual(calls, 2, 'initial + 1 retry');
});
