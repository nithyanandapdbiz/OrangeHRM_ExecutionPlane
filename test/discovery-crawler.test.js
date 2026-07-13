'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normaliseUrl, hostOf, pathOf, isInScope, DEFAULTS } = require('../src/discovery/appCrawler');

test('normaliseUrl strips hash and (by default) query for stable dedupe', () => {
  assert.strictEqual(normaliseUrl('https://x/a?b=1#frag'), 'https://x/a');
  assert.strictEqual(normaliseUrl('https://x/a?b=1#frag', { ignoreQuery: false }), 'https://x/a?b=1');
});

test('normaliseUrl removes trailing slash except root', () => {
  assert.strictEqual(normaliseUrl('https://x/a/b/'), 'https://x/a/b');
  assert.strictEqual(normaliseUrl('https://x/'), 'https://x/');
});

test('normaliseUrl drops tracking params and sorts the rest (query kept)', () => {
  const n = normaliseUrl('https://x/a?z=2&utm_source=g&a=1', { ignoreQuery: false });
  assert.strictEqual(n, 'https://x/a?a=1&z=2');
});

test('two query variants collapse to one dedupe key when ignoreQuery', () => {
  assert.strictEqual(normaliseUrl('https://x/list?page=1'), normaliseUrl('https://x/list?page=2'));
});

test('hostOf / pathOf parse robustly', () => {
  assert.strictEqual(hostOf('https://demo.example.com/web/x'), 'demo.example.com');
  assert.strictEqual(pathOf('https://demo.example.com/web/x'), '/web/x');
  assert.strictEqual(hostOf('not-a-url'), '');
});

test('isInScope enforces the host allow-list', () => {
  const hosts = new Set(['demo.example.com']);
  assert.strictEqual(isInScope('https://demo.example.com/a', hosts), true);
  assert.strictEqual(isInScope('https://evil.com/a', hosts), false);
});

test('DEFAULTS expose enterprise crawl knobs', () => {
  assert.ok(DEFAULTS.maxDepth >= 1);
  assert.ok(['bfs', 'dfs'].includes(DEFAULTS.strategy));
  assert.ok(Array.isArray(DEFAULTS.menuSelectors) && DEFAULTS.menuSelectors.length > 0);
  assert.strictEqual(DEFAULTS.verifyAuth, true);
});
