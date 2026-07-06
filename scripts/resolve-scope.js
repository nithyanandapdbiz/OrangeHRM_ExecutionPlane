'use strict';
/**
 * Resolve Scope — OrangeHRM Execution Plane.
 *
 * From the set of changed files, resolves which BDD feature tags / OrangeHRM modules
 * are in scope for a targeted (scoped) QA run, so CI runs only the affected suite.
 * Emits a GitHub Actions `scope_tags` output and a JSON summary.
 *
 * Usage:  node scripts/resolve-scope.js [--base <ref>]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Map source areas to OrangeHRM module scope tags.
const MODULE_HINTS = [
  { rx: /login|auth/i,        tag: '@login' },
  { rx: /pim|employee/i,      tag: '@pim' },
  { rx: /admin|user/i,        tag: '@admin' },
  { rx: /leave/i,             tag: '@leave' },
  { rx: /recruit/i,           tag: '@recruitment' },
  { rx: /dashboard/i,         tag: '@dashboard' },
];

function changedFiles(base) {
  try {
    const ref = base || process.env.GITHUB_BASE_REF || 'HEAD~1';
    return execSync(`git diff --name-only ${ref}...HEAD`, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

function main() {
  const args = process.argv.slice(2);
  const bIdx = args.indexOf('--base');
  const files = changedFiles(bIdx >= 0 ? args[bIdx + 1] : null);

  const tags = new Set();
  for (const f of files) {
    for (const h of MODULE_HINTS) if (h.rx.test(f)) tags.add(h.tag);
  }
  // Fallback: whole-suite if we cannot narrow (or nothing relevant changed).
  const scopeTags = tags.size ? [...tags] : ['@AI_SDLC'];
  const result = { changedCount: files.length, scopeTags };

  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `scope_tags=${scopeTags.join(' or ')}\n`);
  }
  process.exit(0);
}

main();
