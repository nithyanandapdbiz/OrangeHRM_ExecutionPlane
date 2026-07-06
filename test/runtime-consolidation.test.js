'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Single-runtime fitness functions (Phase 1 — shared infrastructure consolidation).
// Only rules that are TRUE today are asserted; config/secrets/ALM clients are NOT
// duplicates (src/core/config = perf/sec tool config; src/utils/secrets = HashiCorp
// Vault) and are re-homed, not merged (ADR-0002) — so they are not asserted here.

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'test', 'tests']); // tests legitimately reference the patterns
const walk = (d, acc = []) => {
  const full = path.join(ROOT, d);
  if (!fs.existsSync(full)) return acc;
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = path.join(d, e.name);
    if (e.isDirectory()) walk(rel, acc);
    else if (e.name.endsWith('.js')) acc.push(rel.split(path.sep).join('/'));
  }
  return acc;
};
const files = walk('.');

test('FF: exactly ONE logger implementation (winston.createLogger)', () => {
  const impls = files.filter((f) => /winston\.createLogger\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepStrictEqual(impls, ['lib/logger.js'], `expected only lib/logger.js, got: ${impls.join(', ')}`);
});

test('FF: exactly ONE retry implementation', () => {
  const impls = files.filter((f) => /function\s+retry\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepStrictEqual(impls, ['lib/retry.js'], `expected only lib/retry.js, got: ${impls.join(', ')}`);
});

test('FF: legacy logger/retry are re-export shims (no duplicate logic)', () => {
  for (const shim of ['src/utils/logger.js', 'src/utils/retry.js']) {
    const src = fs.readFileSync(path.join(ROOT, shim), 'utf8');
    assert.match(src, /module\.exports\s*=\s*require\(/, `${shim} must be a re-export shim`);
    assert.ok(!/winston\.createLogger|function\s+retry/.test(src), `${shim} must contain no implementation`);
  }
});

test('FF: the single logger/retry are actually shared (identity)', () => {
  assert.strictEqual(require('../src/utils/logger'), require('../lib/logger'));
  assert.strictEqual(require('../src/utils/retry'), require('../lib/retry'));
});
