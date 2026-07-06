'use strict';
/**
 * Dev-Change Pipeline — OrangeHRM Execution Plane.
 *
 * Orchestrates a reconciliation run after an application dev change: resolves the
 * affected scope from the diff, then triggers the QA pipeline for the given Jira
 * issue (delegating to scripts/trigger.js). Thin orchestrator — the heavy lifting
 * lives in the server pipeline (routes/run.js) and the Intelligence Plane.
 *
 * Usage:  node scripts/run-dev-change-pipeline.js --issue <OHRM-key> [--base <ref>]
 */
const { spawnSync } = require('child_process');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function run(script, args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  return r.status ?? 0;
}

function main() {
  const issue = arg('--issue', process.env.ISSUE_KEY || 'OHRM-1');
  const base = arg('--base', null);

  console.log(`[dev-change] Resolving affected scope${base ? ` (base ${base})` : ''}…`);
  run('resolve-scope.js', base ? ['--base', base] : []);

  console.log(`[dev-change] Triggering QA pipeline for ${issue}…`);
  const code = run('trigger.js', [issue]);

  console.log(`[dev-change] Pipeline finished (exit ${code})`);
  process.exit(code);
}

main();
