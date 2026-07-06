'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { parseCucumberReport } = require('../runners/playwright.runner');

function writeTemp(name, data) {
  const p = path.join(os.tmpdir(), `ep-test-${process.pid}-${name}`);
  fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  return p;
}

test('returns null when the report file does not exist', () => {
  assert.equal(parseCucumberReport(path.join(os.tmpdir(), 'does-not-exist-xyz.json')), null);
});

test('parses an empty report ([]) to an empty result set', () => {
  const p = writeTemp('empty.json', []);
  try { assert.deepEqual(parseCucumberReport(p), []); } finally { fs.unlinkSync(p); }
});

test('maps scenarios to pass/fail with duration and error', () => {
  const report = [{
    uri: 'features/x.feature',
    elements: [
      { type: 'scenario', name: 'passes',
        steps: [{ result: { status: 'passed', duration: 1e6 } }, { result: { status: 'passed', duration: 2e6 } }] },
      { type: 'scenario', name: 'fails',
        steps: [{ result: { status: 'passed', duration: 1e6 } },
                { result: { status: 'failed', duration: 5e6, error_message: 'boom' } }] },
      { type: 'background', name: 'bg', steps: [{ result: { status: 'passed', duration: 1e6 } }] },
    ],
  }];
  const p = writeTemp('mixed.json', report);
  try {
    const results = parseCucumberReport(p);
    assert.equal(results.length, 2, 'background is excluded; 2 scenarios remain');
    const pass = results.find(r => r.title === 'passes');
    const fail = results.find(r => r.title === 'fails');
    assert.equal(pass.passed, true);
    assert.equal(pass.durationMs, 3);          // (1e6 + 2e6) / 1e6
    assert.equal(fail.passed, false);
    assert.match(fail.error, /boom/);
    assert.equal(fail.file, 'features/x.feature');
  } finally { fs.unlinkSync(p); }
});

test('returns null on malformed JSON', () => {
  const p = path.join(os.tmpdir(), `ep-test-${process.pid}-bad.json`);
  fs.writeFileSync(p, '{ not valid json', 'utf8');
  try { assert.equal(parseCucumberReport(p), null); } finally { fs.unlinkSync(p); }
});
