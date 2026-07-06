'use strict';
/**
 * test-jira-bug-create.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-test for Jira Bug creation.
 *
 * Flow:
 *   1. Create a temporary Jira Bug issue (via the JiraClient / AlmClient facade)
 *   2. Verify it was created (has a key + id)
 *   3. Add a comment marking it as an automated self-test (safe cleanup signal)
 *   4. Write reports/jira-bug-create-validation.json
 *
 * We intentionally do NOT delete the issue (Jira Cloud REST delete needs elevated
 * project permissions); instead we comment so a human/automation can triage it.
 *
 * Usage:
 *   node scripts/test-jira-bug-create.js
 *   node scripts/test-jira-bug-create.js --dry-run
 *
 * Required env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const AlmClient = require('../clients/alm.client');

const ROOT        = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUT_FILE    = path.join(REPORTS_DIR, 'jira-bug-create-validation.json');
const DEBUG_FILE  = path.join(REPORTS_DIR, 'jira-bug-create-debug.json');

const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'OHRM';
const PARENT_KEY  = process.env.ISSUE_KEY        || 'OHRM-1';
const DRY_RUN     = process.argv.includes('--dry-run');

if (!DRY_RUN && (!process.env.JIRA_BASE_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN)) {
  console.error('  ERROR: JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must be set in .env');
  process.exit(1);
}

function ensureReports() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function appendDebug(entry) {
  try {
    ensureReports();
    const existing = (() => {
      try { return JSON.parse(fs.readFileSync(DEBUG_FILE, 'utf8')); } catch { return []; }
    })();
    existing.push(entry);
    fs.writeFileSync(DEBUG_FILE, JSON.stringify(existing, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Jira Bug Creation Self-Test                        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would create a Bug in project ${PROJECT_KEY} linked to ${PARENT_KEY}`);
    ensureReports();
    fs.writeFileSync(OUT_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode:        'dry-run',
      success:     true,
      bugKey:      null,
      message:     'Dry run — no bug created',
    }, null, 2), 'utf8');
    console.log('  ✓ Dry run complete. See reports/jira-bug-create-validation.json\n');
    return;
  }

  const result = { generatedAt: new Date().toISOString(), success: false, bugKey: null, commented: false, error: null };
  const title  = `[AUTO-TEST] Bug Creation Validation — ${new Date().toISOString()}`;
  const steps  = 'Automated self-test from test-jira-bug-create.js. Safe to close — no reproduction steps required.';

  const alm = new AlmClient();

  // Step 1: Create bug
  let bug;
  try {
    console.log('  Step 1: Create test Bug via Jira...');
    bug = await alm.createBug(title, steps, PARENT_KEY, 'Low');
    if (!bug || !bug.key) throw new Error('createBug returned null (check Jira permissions / project config)');
    console.log(`  ✓ Bug created: ${bug.key} (id=${bug.id})`);
    appendDebug({ timestamp: new Date().toISOString(), operation: 'createBug-self-test', success: true, bug });
    result.success = true;
    result.bugKey  = bug.key;
    result.bugId   = bug.id;
    result.bugUrl  = `${(process.env.JIRA_BASE_URL || '').replace(/\/$/, '')}/browse/${bug.key}`;
    result.title   = title;
  } catch (err) {
    console.error(`  ✗ Bug creation FAILED: ${err.message}`);
    appendDebug({ timestamp: new Date().toISOString(), operation: 'createBug-self-test', success: false, error: err.message });
    result.error = err.message;
    ensureReports();
    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log('\n  See reports/jira-bug-create-debug.json for details.');
    process.exit(1);
  }

  // Step 2: Comment the bug as an automated self-test (cleanup signal)
  console.log('\n  Step 2: Annotate the test Bug...');
  try {
    await alm.jira.addComment(bug.key, 'Automated self-test bug — safe to resolve/close.');
    result.commented = true;
    console.log(`  ✓ Comment added to ${bug.key}.`);
  } catch (err) {
    console.warn(`  ⚠ Could not comment on ${bug.key}: ${err.message}`);
  }

  // Step 3: Write validation report
  ensureReports();
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log('\n  ─────────────────────────────────────────────────────');
  console.log(`  Result   : ${result.success ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
  console.log(`  BugKey   : ${result.bugKey}`);
  console.log(`  Commented: ${result.commented}`);
  console.log(`  Report   : reports/jira-bug-create-validation.json`);
  console.log('  ─────────────────────────────────────────────────────\n');

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error('\n  FATAL:', err.message);
  process.exit(1);
});
