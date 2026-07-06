#!/usr/bin/env node
'use strict';
/**
 * diag-zephyr.js — Zephyr Scale (Essential) connectivity diagnostic
 * ─────────────────────────────────────────────────────────────────────────────
 * Probes the Zephyr Essential test-management API (and the Jira project it is
 * scoped to) so you can confirm credentials and reachability before running the
 * pipeline. Uses the sanctioned ZephyrClient (clients/zephyr.client.js) — the
 * ZEPHYR_API_TOKEN never leaves this process and is never sent to the DBiz
 * Intelligence Plane.
 *
 * Checks:
 *   1. Required env present (ZEPHYR_API_URL / ZEPHYR_API_TOKEN / JIRA_PROJECT_KEY)
 *   2. ZephyrClient.checkConnectivity()  → GET /testcases probe
 *   3. Folder resolution for the AgenticQA folder
 *   4. Optional: list a few existing test cases in the project
 *
 * Usage:
 *   node scripts/diag-zephyr.js
 *   node scripts/diag-zephyr.js --json
 *
 * Required env: ZEPHYR_API_TOKEN, JIRA_PROJECT_KEY  (ZEPHYR_API_URL optional)
 */

require('dotenv').config();
const ZephyrClient = require('../clients/zephyr.client');

const JSON_OUT = process.argv.includes('--json');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m'
};

function line(ok, label, detail) {
  const mark = ok === true ? `${C.green}✓${C.reset}` : ok === false ? `${C.red}✗${C.reset}` : `${C.yellow}○${C.reset}`;
  console.log(`  ${mark} ${label}${detail ? ` ${C.dim}— ${detail}${C.reset}` : ''}`);
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), checks: {}, ok: false };

  const apiUrl     = process.env.ZEPHYR_API_URL || 'https://api.zephyrscale.smartbear.com/v2';
  const hasToken   = Boolean(process.env.ZEPHYR_API_TOKEN);
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!JSON_OUT) {
    console.log(`\n${C.bold}${C.cyan}Zephyr Essential — Connectivity Diagnostic${C.reset}`);
    console.log(`  ${C.dim}API URL   : ${apiUrl}${C.reset}`);
    console.log(`  ${C.dim}Project   : ${projectKey || '(unset)'}${C.reset}\n`);
  }

  // 1. Env presence
  report.checks.env = { apiUrl, hasToken, projectKey: projectKey || null };
  if (!projectKey) {
    line(false, 'JIRA_PROJECT_KEY is required for Zephyr (project-scoped)');
    finish(report, false);
    return;
  }
  line(true, 'JIRA_PROJECT_KEY present', projectKey);
  if (!hasToken) {
    line(false, 'ZEPHYR_API_TOKEN not set', 'Zephyr test management is disabled');
    finish(report, false);
    return;
  }
  line(true, 'ZEPHYR_API_TOKEN present');

  let client;
  try {
    client = new ZephyrClient();
  } catch (e) {
    line(false, 'ZephyrClient init failed', e.message);
    report.checks.init = { ok: false, error: e.message };
    finish(report, false);
    return;
  }

  // 2. Connectivity probe
  const conn = await client.checkConnectivity();
  report.checks.connectivity = conn;
  line(conn.connected, 'Connectivity probe (GET /testcases)',
    conn.connected ? `status ${conn.status}` : `status ${conn.status} — ${conn.error}`);
  if (!conn.connected) {
    finish(report, false);
    return;
  }

  // 3. Folder resolution
  try {
    const folderId = await client.ensureFolder();
    report.checks.folder = { name: client.folderName, id: folderId };
    line(folderId != null, `Folder "${client.folderName}"`, folderId != null ? `id ${folderId}` : 'not resolved (proceeding without folder)');
  } catch (e) {
    report.checks.folder = { ok: false, error: e.message };
    line(null, 'Folder resolution', e.message);
  }

  // 4. Optional: sample test cases
  try {
    const page = await client.http.get('/testcases', { projectKey, maxResults: 3 });
    const count = (page.values || []).length;
    report.checks.sampleTestCases = { returned: count };
    line(true, 'Sample test cases fetched', `${count} shown`);
  } catch (e) {
    report.checks.sampleTestCases = { ok: false, error: e.message };
    line(null, 'Sample test-case fetch', e.message);
  }

  finish(report, true);
}

function finish(report, ok) {
  report.ok = ok;
  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n  ${ok ? C.green + 'Zephyr connectivity OK' : C.red + 'Zephyr connectivity FAILED'}${C.reset}\n`);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n  ${C.red}diag-zephyr error: ${err.message}${C.reset}\n`);
  process.exit(1);
});
