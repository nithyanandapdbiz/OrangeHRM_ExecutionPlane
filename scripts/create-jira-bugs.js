'use strict';
/**
 * create-jira-bugs.js — Auto Jira Bug Creator for Failed Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads test-results.json (and optionally test-results-healed.json), identifies
 * all remaining failing tests, and creates one high-quality Jira Bug issue per
 * failure, linked to the parent story for traceability.
 *
 * Headlines:
 *   • Severity-based Jira priority + AgenticQA labels
 *   • Rich environment block: git, runner, browser, CI run id
 *   • Reproduce-locally CLI command, copy-paste ready
 *   • Definition-of-Done checklist for the developer
 *   • Auto-detect parent story from spec filename, fallback to ISSUE_KEY
 *   • Bug creation flows through the provider-isolation facade (AlmClient →
 *     JiraClient) so this script never talks to Jira REST directly.
 *
 * Usage:
 *   node scripts/create-jira-bugs.js              # create bugs
 *   node scripts/create-jira-bugs.js --dry-run    # preview without hitting Jira
 *
 * Required env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, ISSUE_KEY
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const AlmClient = require('../clients/alm.client');

const ROOT             = path.resolve(__dirname, '..');
const RESULTS_FILE     = path.join(ROOT, 'test-results.json');
const HEALED_RESULTS   = path.join(ROOT, 'test-results-healed.json');
const SCREENSHOTS_ROOT = path.join(ROOT, 'test-results', 'screenshots');

const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'OHRM';
const ISSUE_KEY   = process.env.ISSUE_KEY        || 'OHRM-1';
const CREATE_LIMIT = Number.parseInt(process.env.BUG_CREATE_LIMIT || '10', 10);

const DRY_RUN = process.argv.includes('--dry-run');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m'
};

// ─── Collect all failing tests from a Playwright JSON result file ────────────
function collectFailures(suites, parentFile = '') {
  const failures = [];
  for (const suite of (suites || [])) {
    const file = suite.file || parentFile;

    if (suite.suites && suite.suites.length) {
      failures.push(...collectFailures(suite.suites, file));
    }

    for (const spec of (suite.specs || [])) {
      let failed       = false;
      let timedOut     = false;
      let errorMsg     = '';
      let errorStack   = '';
      let errorSnippet = '';
      let steps        = [];
      let duration     = 0;
      let retryCount   = 0;
      const screenshotPaths = new Map();
      let videoPath  = null;
      let tracePath  = null;

      for (const t of (spec.tests || [])) {
        if (t.results && t.results.length > 1) {
          retryCount = Math.max(retryCount, t.results.length - 1);
        }

        for (const r of (t.results || [])) {
          if (r.status !== 'failed' && r.status !== 'timedOut') continue;
          failed   = true;
          if (r.status === 'timedOut') timedOut = true;
          duration = r.duration || 0;

          if (r.error) {
            errorMsg     = r.error.message || (typeof r.error === 'string' ? r.error : JSON.stringify(r.error));
            errorStack   = r.error.stack   || '';
            errorSnippet = r.error.snippet || '';
          }

          steps = (r.steps || []).map(s => ({
            title:    s.title || '(step)',
            duration: s.duration || 0,
            error:    s.error ? (s.error.message || String(s.error)) : null
          }));

          for (const a of (r.attachments || [])) {
            if (!a.path) continue;
            const abs = path.resolve(ROOT, a.path);
            if (!fs.existsSync(abs)) continue;

            if (a.contentType === 'image/png') {
              if (!screenshotPaths.has(abs)) {
                screenshotPaths.set(abs, { label: a.name || path.basename(abs), absPath: abs });
              }
            }
            if (a.contentType === 'video/webm')   videoPath = abs;
            if (a.contentType === 'application/zip' && a.name === 'trace') tracePath = abs;
          }
        }
      }

      if (!failed) continue;

      // Step screenshots written by ScreenshotHelper to disk (body-only attachments)
      for (const diskPath of loadStepScreenshots(spec.title)) {
        const abs = path.resolve(diskPath);
        if (!screenshotPaths.has(abs)) {
          const label = path.basename(abs, '.png').replace(/^step-\d+-/, '').replace(/-/g, ' ');
          screenshotPaths.set(abs, { label, absPath: abs });
        }
      }

      failures.push({
        title:       spec.title,
        error:       String(errorMsg).slice(0, 2000),
        stack:       String(errorStack).slice(0, 5000),
        snippet:     String(errorSnippet).slice(0, 1000),
        file,
        screenshots: [...screenshotPaths.values()],
        videoPath,
        tracePath,
        steps,
        duration,
        retryCount,
        timedOut
      });
    }
  }
  return failures;
}

function loadStepScreenshots(title) {
  const slug = (title || 'test')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();
  const dir = path.join(SCREENSHOTS_ROOT, slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
    .map(f => path.join(dir, f));
}

function excludeHealed(failures) {
  if (!fs.existsSync(HEALED_RESULTS)) return failures;
  try {
    const healedRaw    = JSON.parse(fs.readFileSync(HEALED_RESULTS, 'utf8'));
    const healedPassed = new Set();
    const gather = (suites) => {
      for (const s of (suites || [])) {
        gather(s.suites || []);
        for (const sp of (s.specs || [])) if (sp.ok) healedPassed.add(sp.title);
      }
    };
    gather(healedRaw.suites || []);
    const before  = failures.length;
    const cleaned = failures.filter(f => !healedPassed.has(f.title));
    if (cleaned.length !== before) {
      console.log(`  ${C.dim}  ${before - cleaned.length} test(s) excluded — already fixed by Healer.${C.reset}\n`);
    }
    return cleaned;
  } catch { return failures; }
}

// ─── Environment fingerprint for the bug description ─────────────────────────
function collectEnvironment() {
  const safe = (fn) => { try { return fn(); } catch { return 'n/a'; } };
  return {
    git:     safe(() => execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()),
    branch:  safe(() => execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim()),
    node:    process.version,
    os:      `${os.type()} ${os.release()}`,
    ci:      process.env.GITHUB_RUN_ID || process.env.CI_RUN_ID || 'local',
    appUrl:  process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com',
  };
}

// ─── Severity → Jira priority ─────────────────────────────────────────────────
function priorityFor(failure) {
  if (failure.timedOut) return 'High';
  if (/expect|assertion|toBe|toHave/i.test(failure.error)) return 'Medium';
  return 'High';
}

// ─── Parent story key: prefer spec-embedded key, fall back to ISSUE_KEY ───────
function parentStoryFor(failure) {
  const m = String(failure.file || '').match(/([A-Z][A-Z0-9]+-\d+)/);
  return (m && m[1]) || ISSUE_KEY;
}

// ─── Build a rich Jira Bug description (steps-to-reproduce) ────────────────────
function buildDescription(failure, env) {
  const cmd = `ISSUE_KEY=${parentStoryFor(failure)} node scripts/run-story-tests.js`;
  const stepLines = (failure.steps || [])
    .map((s, i) => `  ${i + 1}. ${s.title}${s.error ? `   ✗ ${s.error}` : ''}`)
    .join('\n');
  return [
    `Automated test failure detected by the OrangeHRM Agentic QA pipeline.`,
    ``,
    `Test: ${failure.title}`,
    `Spec: ${failure.file || '(unknown)'}`,
    `Parent story: ${parentStoryFor(failure)}`,
    ``,
    `Error:`,
    failure.error || '(no message)',
    ``,
    failure.snippet ? `Snippet:\n${failure.snippet}\n` : '',
    stepLines ? `Steps executed:\n${stepLines}\n` : '',
    `Reproduce locally:`,
    `  ${cmd}`,
    ``,
    `Environment:`,
    `  App URL : ${env.appUrl}`,
    `  Branch  : ${env.branch} @ ${env.git}`,
    `  Node    : ${env.node}`,
    `  OS      : ${env.os}`,
    `  CI Run  : ${env.ci}`,
    ``,
    `Definition of Done:`,
    `  [ ] Root cause identified`,
    `  [ ] Fix applied to the OrangeHRM page object / locator or app code`,
    `  [ ] Test re-run green in the pipeline`,
    `  [ ] Zephyr execution updated to Pass`,
  ].filter((l) => l !== undefined).join('\n');
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║        Auto Jira Bug Creator                          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);
  if (DRY_RUN) console.log(`  ${C.cyan}--dry-run: no Jira API calls will be made.${C.reset}`);
  console.log('');

  if (!DRY_RUN && (!process.env.JIRA_BASE_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN)) {
    console.log(`  ${C.yellow}⚠  Jira credentials not configured.${C.reset}`);
    console.log(`  ${C.dim}  Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env to enable bug creation.${C.reset}\n`);
    return;
  }
  if (!fs.existsSync(RESULTS_FILE)) {
    console.log(`  ${C.yellow}⚠  test-results.json not found. Run tests first.${C.reset}\n`);
    return;
  }

  const raw     = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  let failures  = collectFailures(raw.suites || []);
  failures      = excludeHealed(failures);

  if (failures.length === 0) {
    console.log(`  ${C.green}✓  No failing tests remain. No bugs to create.${C.reset}\n`);
    return;
  }

  if (failures.length > CREATE_LIMIT) {
    console.log(`  ${C.dim}  Capping bug creation at ${CREATE_LIMIT} (of ${failures.length} failures).${C.reset}`);
    failures = failures.slice(0, CREATE_LIMIT);
  }

  console.log(`  ${C.yellow}Found ${failures.length} failing test(s). Reporting under ${PROJECT_KEY} (parent: ${ISSUE_KEY}).${C.reset}\n`);

  const env = collectEnvironment();
  const alm = DRY_RUN ? null : new AlmClient();
  const stats = { created: [], failed: [], dryRun: [] };

  for (const failure of failures) {
    const parentKey = parentStoryFor(failure);
    const priority  = priorityFor(failure);
    const title     = failure.title;
    const steps     = buildDescription(failure, env);

    if (DRY_RUN) {
      stats.dryRun.push({ title });
      console.log(`    ${C.cyan}○ DRY-RUN${C.reset} — would create Bug for "${title.slice(0, 60)}" (parent ${parentKey}, ${priority})`);
      continue;
    }

    try {
      const bug = await alm.createBug(title, steps, parentKey, priority);
      if (bug && bug.key) {
        stats.created.push({ key: bug.key, title });
      } else {
        stats.failed.push({ title, error: 'createBug returned null' });
        console.log(`    ${C.red}✗ FAILED${C.reset} — ${title.slice(0, 60)}`);
      }
    } catch (e) {
      stats.failed.push({ title, error: e.message });
      console.log(`    ${C.red}✗ FAILED${C.reset} — ${e.message}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}  Bug Creation Summary:${C.reset}`);
  console.log(`    ${C.green}Created : ${stats.created.length}${C.reset}`
            + `  ${C.red}Failed  : ${stats.failed.length}${C.reset}`
            + (DRY_RUN ? `  ${C.cyan}DryRun: ${stats.dryRun.length}${C.reset}` : '')
            + `\n`);

  if (stats.created.length) {
    console.log(`  ${C.bold}New Bugs:${C.reset}`);
    for (const b of stats.created) console.log(`    ${C.green}✓${C.reset} ${C.bold}${b.key}${C.reset}  ${b.title.slice(0, 70)}`);
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}  BUG CREATOR ERROR: ${err.message}${C.reset}\n`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
