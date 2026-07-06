'use strict';
/**
 * run-and-sync.js — Run functional tests + sync results to Zephyr Essential.
 *
 * The platform is BDD-only (no standalone Playwright spec files), so this script
 * delegates to scripts/run-bdd-and-sync.js, which runs the Cucumber suite and syncs
 * results to a Zephyr test cycle (Jira story for traceability). Retained as a stable
 * entry point for orchestrators that invoke `run-and-sync.js`.
 *
 * The supported end-to-end entry point is `npm run e2e` (server pipeline:
 * routes/run.js → clients/alm.client.js → Jira + Zephyr).
 *
 * Usage:  node scripts/run-and-sync.js
 * Env:    JIRA_BASE_URL, JIRA_PROJECT_KEY, JIRA_EMAIL, JIRA_API_TOKEN, ISSUE_KEY
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Functional Run + Zephyr Test Cycle Sync            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (!process.env.JIRA_API_TOKEN) { console.error('  ERROR: JIRA_API_TOKEN not set in .env'); process.exit(1); }
  if (!process.env.JIRA_BASE_URL)  { console.error('  ERROR: JIRA_BASE_URL not set in .env');  process.exit(1); }

  // BDD-only architecture: delegate the run + Zephyr sync to run-bdd-and-sync.js.
  console.log('  BDD mode: delegating to run-bdd-and-sync.js\n');
  try {
    execSync('node scripts/run-bdd-and-sync.js', {
      cwd: ROOT, stdio: 'inherit', shell: true,
      env: { ...process.env, SKIP_BDD_RUN: process.env.SKIP_PLAYWRIGHT_RUN || 'false' },
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

if (require.main === module) {
  main().catch(err => { console.error(`\n  RUN+SYNC ERROR: ${err.message}\n`); process.exit(1); });
}

module.exports = { main };
