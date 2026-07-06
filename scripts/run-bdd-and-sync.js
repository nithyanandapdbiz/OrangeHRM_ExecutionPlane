'use strict';
/**
 * run-bdd-and-sync.js  —  BDD Run + Zephyr Essential Test Cycle Sync
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Domain-purity gate over the feature files (Gate 4)
 * 2. Pre-execution feasibility gate (Gate 5)
 * 3. Run the Cucumber BDD suite against the OrangeHRM React app
 * 4. Parse cucumber-report.json → normalize to test-results.json
 * 5. Fetch the Jira story, create a Zephyr test cycle, sync executions, complete
 *    it — all through the provider-isolated ALM facade (clients/alm.client.js).
 *
 * Zephyr Essential model: test cycle + executions (Pass/Fail), keyed by the
 * scenario's @<PROJECT>-T<id> tag, via the provider-isolated ALM facade.
 *
 * Environment:
 *   SKIP_BDD_RUN=true     — skip execution, reuse existing cucumber-report.json
 *   PW_HEADLESS=false     — launch browser in headed/visible mode
 *   CUCUMBER_WORKERS=N    — parallel workers (default: 1)
 *   ISSUE_KEY             — Jira parent issue key for traceability
 * Required env: JIRA_BASE_URL, JIRA_PROJECT_KEY, JIRA_EMAIL, JIRA_API_TOKEN
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const { scanForContamination, writeContaminationReport } = require('../src/core/domainPurgeValidator');
const executabilityEngine = require('../src/runtime/executabilityEngine');

// Legacy pre-platform terms that must never appear in OrangeHRM feature files —
// sourced from the single governance denylist (scripts/legacy-terms.js).
const { TERMS: LEGACY_TERMS } = require('./legacy-terms');
const AlmClient    = require('../clients/alm.client');

const JIRA_BASE_URL    = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_API_TOKEN   = process.env.JIRA_API_TOKEN;
const ISSUE_KEY        = process.env.ISSUE_KEY || '';

const ROOT              = path.resolve(__dirname, '..');
const REPORTS_DIR       = path.join(ROOT, 'reports');
const CUCUMBER_REPORT   = path.join(REPORTS_DIR, 'cucumber-report.json');
const RESULTS_FILE      = path.join(ROOT, 'test-results.json');
const STATE_FILE        = path.join(ROOT, '.zephyr-testcycle.json');

function writeReport(filename, data) {
  try {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

// ─── Cucumber parsing helpers ─────────────────────────────────────────────────
function tagToTestKey(tag) {
  const raw = (tag || '').replace(/^@/, '').trim();
  const m = raw.match(/^(.+?)-T(\d+)$/i);
  return m ? `${m[1].replace(/_/g, ' ')}-T${m[2]}`.toUpperCase() : null;
}

function extractTestKey(tags) {
  for (const t of (tags || [])) {
    const key = tagToTestKey(typeof t === 'string' ? t : (t.name || ''));
    if (key) return key;
  }
  return null;
}

function scenarioStatus(steps) {
  const statuses = (steps || []).map(s => (s.result || {}).status || 'undefined');
  if (statuses.some(s => s === 'failed')) return 'Fail';
  if (statuses.length && statuses.every(s => s === 'passed')) return 'Pass';
  if (statuses.some(s => s === 'pending' || s === 'ambiguous')) return 'Blocked';
  return 'Not Executed';
}

function stepErrorMessage(steps) {
  const failing = (steps || []).find(s => (s.result || {}).status === 'failed');
  return failing?.result?.error_message || '';
}

function stepDurationMs(steps) {
  return (steps || []).reduce((sum, s) => sum + ((s.result?.duration || 0) / 1e6), 0);
}

function parseCucumberReport(reportPath) {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const scenarios = [];
  for (const feature of (Array.isArray(raw) ? raw : [])) {
    const file = feature.uri || feature.id || '';
    for (const element of (feature.elements || [])) {
      if (element.keyword === 'Background') continue;
      scenarios.push({
        testKey:    extractTestKey(element.tags),
        title:      element.name || '',
        status:     scenarioStatus(element.steps),
        error:      stepErrorMessage(element.steps),
        durationMs: stepDurationMs(element.steps),
        file
      });
    }
  }
  const priority = { Fail: 4, Blocked: 3, 'Not Executed': 2, Pass: 1 };
  const byKey = new Map();
  for (const s of scenarios) {
    if (!s.testKey) continue;
    const prev = byKey.get(s.testKey);
    if (!prev || (priority[s.status] || 0) > (priority[prev.status] || 0)) {
      byKey.set(s.testKey, { status: s.status, error: s.error, title: s.title });
    }
  }
  return { scenarios, byKey };
}

// ─── Normalized test-results.json (Playwright-shaped) writer ─────────────────
function writeNormalizedResults(scenarios, startTime, durationMs) {
  const PW_STATUS = { Pass: 'passed', Fail: 'failed', Blocked: 'timedOut', 'Not Executed': 'skipped' };
  const byFile = new Map();
  for (const s of scenarios) {
    const key = s.file || 'unknown.feature';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(s);
  }
  const suites = [];
  for (const [file, items] of byFile) {
    suites.push({
      title: path.basename(file, '.feature'), file, suites: [],
      specs: items.map(s => ({
        title: s.title, ok: s.status === 'Pass',
        tags: s.testKey ? [`@${s.testKey.replace(/ /g, '_')}`] : [],
        tests: [{
          title: s.title, status: s.status === 'Pass' ? 'expected' : 'unexpected',
          results: [{ status: PW_STATUS[s.status] || 'skipped', duration: Math.round(s.durationMs),
            ...(s.error ? { error: { message: s.error } } : {}) }]
        }]
      }))
    });
  }
  const passed      = scenarios.filter(s => s.status === 'Pass').length;
  const failed      = scenarios.filter(s => s.status === 'Fail').length;
  const blocked     = scenarios.filter(s => s.status === 'Blocked').length;
  const notExecuted = scenarios.filter(s => s.status === 'Not Executed').length;
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    stats: { startTime: startTime.toISOString(), duration: Math.round(durationMs),
      expected: passed, skipped: notExecuted + blocked, unexpected: failed, flaky: 0 },
    suites
  }, null, 2), 'utf8');
  return { passed, failed, blocked, notExecuted };
}

const statusIcon = (s) => s === 'Pass' ? '✓' : s === 'Fail' ? '✗' : s === 'Blocked' ? '⊘' : '○';

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   BDD Run + Zephyr Essential Test Cycle Sync        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (!JIRA_API_TOKEN) { console.error('  ERROR: JIRA_API_TOKEN not set in .env'); process.exit(1); }
  if (!JIRA_BASE_URL)  { console.error('  ERROR: JIRA_BASE_URL not set in .env');  process.exit(1); }
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // ── Gate 4: Domain purity check over the feature files ───────────────────
  {
    const featuresDir = path.join(ROOT, 'tests', 'features');
    const featureFiles = [];
    (function collect(dir) {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collect(full);
        else if (e.name.endsWith('.feature')) {
          try { featureFiles.push({ filePath: full, content: fs.readFileSync(full, 'utf8') }); } catch { /* skip */ }
        }
      }
    }(featuresDir));
    if (featureFiles.length > 0) {
      // Map each feature file to a scannable test-case-shaped object.
      const items = featureFiles.map(f => ({ title: path.basename(f.filePath), description: f.content }));
      const result = scanForContamination(items, LEGACY_TERMS);
      writeContaminationReport({ gate: 'Gate 4 — BDD execution', domain: 'OrangeHRM', ...result });
      if (!result.clean) {
        console.error(`\n  FATAL: DomainContaminationError [Gate 4] — legacy terms: ${result.terms.join(', ')} in ${result.contaminatedTestCases.join(', ')}`);
        process.exit(2);
      }
    }
  }

  // ── Gate 5: Pre-execution feasibility check ──────────────────────────────
  if (process.env.SKIP_FEASIBILITY_CHECK !== 'true') {
    console.log('  Gate 5 — Pre-Execution Feasibility Check');
    try {
      let metadata = null;
      const cacheFile = path.join(ROOT, '.cache', 'app-metadata.json');
      if (fs.existsSync(cacheFile)) {
        try { metadata = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).metadata || null; } catch { /* skip */ }
      }
      const featuresDir = path.join(ROOT, 'tests', 'features');
      const featureFiles = [];
      (function collect(dir) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) collect(full);
          else if (e.name.endsWith('.feature')) featureFiles.push(full);
        }
      }(featuresDir));
      let totalScenarios = 0, lowestScore = 100;
      for (const featureFile of featureFiles) {
        const r = executabilityEngine.analyzeStory(featureFile, metadata, { storyId: ISSUE_KEY || null });
        totalScenarios += r.scenarioCount;
        if (r.score < lowestScore) lowestScore = r.score;
      }
      const readiness = executabilityEngine.scoreToReadiness(lowestScore);
      console.log(`  Feature files: ${featureFiles.length}  Scenarios: ${totalScenarios}  Readiness: ${readiness} (score ${lowestScore})`);
      if (readiness === 'BLOCKED') {
        console.error(`\n  FATAL [Gate 5]: feasibility BLOCKED. See reports/executability-readiness.json.\n`);
        process.exit(5);
      }
      console.log(`  Gate 5 PASSED${readiness === 'READY_WITH_WARNINGS' ? ' with warnings' : ''}.\n`);
    } catch (gateErr) {
      console.warn(`  Gate 5 skipped (engine error): ${gateErr.message}\n`);
    }
  }

  // ── Step 1: Run Cucumber ─────────────────────────────────────────────────
  console.log('  Step 1 — Run BDD Scenarios (Cucumber)');
  const startTime = new Date();
  if (process.env.SKIP_BDD_RUN === 'true') {
    console.log('  [SKIP_BDD_RUN=true] Using existing cucumber-report.json\n');
  } else {
    if (fs.existsSync(CUCUMBER_REPORT)) fs.unlinkSync(CUCUMBER_REPORT);
    const headless = process.env.PW_HEADLESS !== 'false';
    const workers  = parseInt(process.env.CUCUMBER_WORKERS || '1', 10);
    console.log(`  Running: npx cucumber-js  (headless=${headless}, workers=${workers})\n`);
    try {
      execSync('npx cucumber-js', {
        cwd: ROOT, stdio: 'inherit', shell: true,
        env: { ...process.env, PW_HEADLESS: String(headless), CUCUMBER_PARALLEL: String(workers) }
      });
    } catch { /* non-zero exit expected on scenario failures — results parsed below */ }
  }
  const durationMs = Date.now() - startTime.getTime();

  // ── Step 2: Parse Cucumber results ───────────────────────────────────────
  if (!fs.existsSync(CUCUMBER_REPORT)) {
    console.error(`\n  ERROR: ${CUCUMBER_REPORT} not found. Ensure cucumber.js emits json:reports/cucumber-report.json\n`);
    process.exit(1);
  }
  const { scenarios, byKey } = parseCucumberReport(CUCUMBER_REPORT);
  console.log(`\n  Step 2 — Parsed ${scenarios.length} scenario(s), ${byKey.size} with a test key`);

  // ── Step 3: Normalize → test-results.json ────────────────────────────────
  const counts = writeNormalizedResults(scenarios, startTime, durationMs);
  console.log(`  Step 3 — test-results.json  Pass:${counts.passed} Fail:${counts.failed} Blocked:${counts.blocked} NotExec:${counts.notExecuted}`);
  for (const s of scenarios) console.log(`    ${statusIcon(s.status)} ${s.status.padEnd(12)} ${s.title.slice(0, 70)}`);

  // ── Step 4: Fetch Jira story + Zephyr cycle sync (via ALM facade) ─────────
  const alm = new AlmClient();
  let story = null;
  try { story = await alm.fetchWorkItem(ISSUE_KEY); } catch (e) { console.warn(`  ⚠ Could not fetch Jira story ${ISSUE_KEY}: ${e.message}`); }
  if (story) console.log(`\n  Step 4 — Story ${story.key} — ${story.title}`);

  const results = scenarios.map(s => ({
    title:       s.title,
    passed:      s.status === 'Pass',
    error:       s.error || '',
    durationMs:  Math.round(s.durationMs),
    testCaseKey: s.testKey || null,
  }));

  let cycle = { id: null, key: null };
  let sync  = { ok: false, synced: 0, passed: counts.passed, failed: counts.failed };
  try {
    cycle = await alm.createTestRun(story?.title || ISSUE_KEY || 'BDD Run', [...byKey.keys()]);
    if (cycle.key) {
      sync = await alm.updateTestResults(cycle.key, results);
      await alm.completeTestRun(cycle.key);
    } else {
      console.warn('  ⚠ Zephyr disabled or no cycle created — result sync skipped');
    }
  } catch (e) {
    console.warn(`  ⚠ Zephyr sync error: ${e.message}`);
  }

  // ── Step 5: Persist cycle state (consumed by create-bdd-bugs.js) ─────────
  const executions = {};
  for (const s of scenarios) if (s.testKey) executions[s.testKey] = { status: s.status };
  const state = {
    generatedAt: new Date().toISOString(),
    storyKey:    story?.key || ISSUE_KEY || null,
    cycleKey:    cycle.key,
    testCycleKey: cycle.key,
    executions,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  writeReport('zephyr-sync-summary.json', {
    generatedAt: new Date().toISOString(),
    story: story?.key || ISSUE_KEY || null,
    cycleKey: cycle.key,
    synced: sync.synced, passed: sync.passed, failed: sync.failed, ok: sync.ok,
    scenarios: scenarios.length,
  });

  console.log(`\n  Step 5 — Zephyr cycle ${cycle.key || '(none)'} — ${sync.synced} execution(s) synced (${sync.passed} Pass / ${sync.failed} Fail)`);
  console.log(`\n  ✓ Done. test-results.json + .zephyr-testcycle.json written.\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n  BDD RUN+SYNC ERROR: ${err.message}\n`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, parseCucumberReport, writeNormalizedResults };
