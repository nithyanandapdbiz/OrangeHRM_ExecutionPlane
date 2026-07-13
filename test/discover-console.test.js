'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('../scripts/discover');

test('PIPELINE is ordered and covers EP + IP stages', () => {
  const keys = cli.PIPELINE.map(([k]) => k);
  assert.deepStrictEqual(keys.slice(0, 2), ['crawling', 'scrubbing']);
  assert.ok(keys.includes('report'));
  assert.ok(keys.includes('intelligence'));
  assert.strictEqual(keys[keys.length - 1], 'completed');
});

test('currentKey maps IP sub-stage during synthesising', () => {
  assert.strictEqual(cli.currentKey('crawling'), 'crawling');
  assert.strictEqual(cli.currentKey('synthesising', 'app-model-synthesise'), 'app-model-synthesise');
  assert.strictEqual(cli.currentKey('synthesising', undefined), 'contract-extract');
});

test('buildChecklist marks done / active / pending correctly', () => {
  const c = cli.buildChecklist('synthesising', 'report', null);
  const byLabel = Object.fromEntries(c.map((x) => [x.label, x.state]));
  assert.strictEqual(byLabel['Crawling (browser)'], 'done');
  assert.strictEqual(byLabel['Report Generation'], 'active');
  assert.strictEqual(byLabel['Packaging + Download'], 'pending');
});

test('buildChecklist marks everything done on completion', () => {
  const c = cli.buildChecklist('completed', null, 'completed');
  assert.ok(c.every((x) => x.state === 'done'));
});

test('buildChecklist marks the failing stage on failure', () => {
  const c = cli.buildChecklist('synthesising', 'report', 'failed');
  assert.strictEqual(c.find((x) => x.label === 'Report Generation').state, 'fail');
});

test('moduleFromUrl extracts the OrangeHRM module', () => {
  assert.strictEqual(cli.moduleFromUrl('https://x/web/index.php/pim/viewEmployeeList'), 'pim');
  assert.strictEqual(cli.moduleFromUrl('https://x/admin/users'), 'admin');
  assert.strictEqual(cli.moduleFromUrl('not-a-url'), '-');
});

test('humanBytes formats B / KB / MB', () => {
  assert.strictEqual(cli.humanBytes(500), '500 B');
  assert.strictEqual(cli.humanBytes(2048), '2.0 KB');
  assert.strictEqual(cli.humanBytes(2 * 1048576), '2.0 MB');
  assert.strictEqual(cli.humanBytes(null), '?');
});

test('artifactTree renders files with sizes and subdir counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-tree-'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), '{}');
  fs.mkdirSync(path.join(dir, 'reports'));
  fs.writeFileSync(path.join(dir, 'reports', 'executive.json'), '{"a":1}');
  const lines = cli.artifactTree(dir).join('\n');
  assert.match(lines, /metadata\.json/);
  assert.match(lines, /reports\//);
  assert.match(lines, /executive\.json/);
  assert.match(lines, /\bB\b|KB/); // a size is shown
  fs.rmSync(dir, { recursive: true, force: true });
});

test('splitArtifacts writes per-report files under reports/', () => {
  const files = cli.splitArtifacts({ intelligence: { reports: { executive: { s: 1 }, qa: { s: 2 } } } }).map((f) => f.path);
  assert.ok(files.some((f) => f.includes(path.join('reports', 'executive.json'))));
  assert.ok(files.some((f) => f.includes(path.join('reports', 'qa.json'))));
  assert.ok(files.includes('reports.json'));
});
