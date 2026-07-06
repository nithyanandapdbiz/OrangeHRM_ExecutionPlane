'use strict';
/**
 * Classify Changes — OrangeHRM Execution Plane.
 *
 * Inspects the changed files (git diff against a base ref) and classifies them into
 * scopes (page-object, spec/feature, step-definition, locator, runtime, config, docs)
 * so downstream heal/scoped-QA jobs know what to run. Emits GitHub Actions outputs
 * (affected_pages, change_types) when run in CI, and a JSON summary to stdout.
 *
 * Usage:  node scripts/classify-changes.js [--base <ref>]
 */
const { execSync } = require('child_process');
const fs = require('fs');

function changedFiles(base) {
  try {
    const ref = base || process.env.GITHUB_BASE_REF || 'HEAD~1';
    const out = execSync(`git diff --name-only ${ref}...HEAD`, { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    try {
      return execSync('git diff --name-only HEAD', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    } catch { return []; }
  }
}

function classify(files) {
  const types = new Set();
  const pages = new Set();
  for (const f of files) {
    if (/tests\/pages\//.test(f))            { types.add('page-object'); pages.add(f.replace(/.*\/([^/]+)\.js$/, '$1')); }
    if (/\.feature$/.test(f))                 types.add('feature');
    if (/tests\/step-definitions\//.test(f))  types.add('step-definition');
    if (/tests\/locators\//.test(f))          types.add('locator');
    if (/src\/runtime\//.test(f))             types.add('runtime');
    if (/config\/|\.env/.test(f))             types.add('config');
    if (/\.md$/.test(f) || /docs\//.test(f))  types.add('docs');
    if (/clients\/|routes\/|runners\/|lib\//.test(f)) types.add('runtime-core');
  }
  return { changeTypes: [...types], affectedPages: [...pages] };
}

function main() {
  const args = process.argv.slice(2);
  const bIdx = args.indexOf('--base');
  const files = changedFiles(bIdx >= 0 ? args[bIdx + 1] : null);
  const result = { changedCount: files.length, ...classify(files) };

  console.log(JSON.stringify(result, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `affected_pages=${result.affectedPages.join(',')}\n` +
      `change_types=${result.changeTypes.join(',')}\n`);
  }
  process.exit(0);
}

main();
