'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ── Sovereign AI Boundary fitness function (FF-01) ────────────────────────────
// The Execution Plane runs in the customer tenant and MUST NEVER perform AI
// inference. All agents and intelligence live in the Intelligence Plane; the EP
// reaches them only via clients/intelligence.client.js over HTTP. This test fails
// the build if any AI SDK import, model call, or local AI/agent module re-enters
// the repository. It is the automated enforcement of ADR-0001 / Principle P1.

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'reports', 'custom-report', 'test-results',
  'coverage', 'logs', '.auth', '.cache', 'allure-results', 'allure-report',
]);
// This test file necessarily contains the forbidden patterns as strings.
const SELF = path.join(__dirname, 'ai-boundary.test.js');

// Forbidden: AI SDK imports, client instantiation, model calls, local AI modules.
const FORBIDDEN = [
  /require\(\s*['"]@?anthropic(-ai)?(\/[^'"]*)?['"]\s*\)/i,
  /require\(\s*['"]openai['"]\s*\)/i,
  /require\(\s*['"]@ai-sdk[^'"]*['"]\s*\)/i,
  /require\(\s*['"][^'"]*\/(ai|claude|openai|aiEnrich)['"]\s*\)/i,
  /\bnew\s+Anthropic\s*\(/,
  /\bnew\s+OpenAI\s*\(/,
  /\.messages\.create\s*\(/,
  /\.chat\.completions\b/,
  /['"]anthropic-version['"]/i,
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const full = path.join(dir, entry.name);
      if (full !== SELF) out.push(full);
    }
  }
  return out;
}

test('FF-01: no AI SDK imports or model calls exist in the Execution Plane', () => {
  const offenders = [];
  for (const file of walk(ROOT, [])) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rx of FORBIDDEN) {
        if (rx.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
          break;
        }
      }
    });
  }
  assert.deepStrictEqual(
    offenders, [],
    `Sovereign boundary violation — AI code in the Execution Plane:\n${offenders.join('\n')}\n` +
    'All AI/agent code belongs in DBiz_IntelligencePlane; the EP reaches it only via the Intelligence gateway.'
  );
});

test('FF-01: no src/agents or src/orchestrator directory exists', () => {
  for (const dir of ['src/agents', 'src/orchestrator']) {
    assert.ok(!fs.existsSync(path.join(ROOT, dir)), `${dir} must not exist in the Execution Plane`);
  }
});
