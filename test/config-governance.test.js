'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const allowlist = require('../lib/config-allowlist');

// ── Configuration governance fitness functions (FF-20…FF-30) ──────────────────
// Enforce the provider-agnostic, allowlist-based configuration contract in CI.

const ROOT = path.resolve(__dirname, '..');
const CODE_DIRS = ['server.js', 'routes', 'clients', 'runners', 'lib', 'middleware'];
const SCRIPT_ENTRY = ['scripts/trigger.js', 'scripts/tail-logs.js', 'scripts/config-check.js'];

function walkJs(target, out) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return out;
  const st = fs.statSync(full);
  if (st.isFile()) { if (full.endsWith('.js')) out.push(full); return out; }
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (e.isDirectory()) walkJs(path.join(target, e.name), out);
    else if (e.name.endsWith('.js')) out.push(path.join(full, e.name));
  }
  return out;
}

// Strip block + line comments so documentation examples (e.g. `process.env.X`)
// are not mistaken for real reads.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function envVarsReadBy(files) {
  const vars = new Set();
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) vars.add(m[1]);
  }
  return vars;
}

// FF-21: every environment variable the live code reads must be on the allowlist.
test('FF-21: every process.env var read by live code is on the allowlist', () => {
  const files = [...CODE_DIRS, ...SCRIPT_ENTRY].flatMap((t) => walkJs(t, []));
  const undeclared = [...envVarsReadBy(files)].filter((v) => !allowlist.isAllowed(v));
  assert.deepStrictEqual(undeclared, [], `Undeclared env vars (add to lib/config-allowlist): ${undeclared.join(', ')}`);
});

// FF-22/23/24 (Model B): the EP may OWN AI selection, but must never read a RAW AI
// credential (references only) and must perform no inference (SDK/model-call ban is
// FF-01). Here we assert no raw-credential var is read by EP code.
test('FF-22/23/24: EP code reads no RAW AI credential (references only)', () => {
  const files = [...CODE_DIRS, ...SCRIPT_ENTRY].flatMap((t) => walkJs(t, []));
  const rawCreds = [...envVarsReadBy(files)].filter((v) => allowlist.forbiddenReason(v));
  assert.deepStrictEqual(rawCreds, [], `raw AI credential vars must not be read in the EP: ${rawCreds.join(', ')}`);
});

// FF-25: .env.example documents only allowlisted vars and no RAW AI credential.
test('FF-25: .env.example contains only allowlisted variables (no raw AI credential)', () => {
  const ex = path.join(ROOT, '.env.example');
  if (!fs.existsSync(ex)) return;
  const keys = fs.readFileSync(ex, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^#\s*/, '').trim())        // include commented-out optional examples
    .map((l) => (l.match(/^([A-Z0-9_]+)=/) || [])[1])
    .filter(Boolean);
  const bad = keys.filter((k) => allowlist.forbiddenReason(k));
  assert.deepStrictEqual(bad, [], `.env.example must not contain AI config: ${bad.join(', ')}`);
  const undeclared = keys.filter((k) => !allowlist.isAllowed(k));
  assert.deepStrictEqual(undeclared, [], `.env.example has non-allowlisted vars: ${undeclared.join(', ')}`);
});

// FF-15: the startup guard must NOT enumerate provider names (no denylist).
test('FF-15: startup-guard uses pattern detection, not a provider denylist', () => {
  const guard = fs.readFileSync(path.join(ROOT, 'middleware/startup-guard.js'), 'utf8');
  for (const provider of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI', 'BEDROCK', 'COHERE', 'MISTRAL']) {
    assert.ok(!guard.includes(provider), `startup-guard must not hardcode provider name "${provider}"`);
  }
});

// FF-26: the allowlist itself must contain no provider-specific entry.
test('FF-26: the allowlist enumerates no AI provider', () => {
  const declared = [...allowlist.ALLOWED_EXACT, ...allowlist.ALLOWED_PREFIXES].join(' ');
  for (const p of ['ANTHROPIC', 'OPENAI', 'CLAUDE', 'GEMINI', 'BEDROCK', 'VERTEX', 'OLLAMA', 'MISTRAL']) {
    assert.ok(!declared.toUpperCase().includes(p), `allowlist must not mention provider "${p}"`);
  }
});
