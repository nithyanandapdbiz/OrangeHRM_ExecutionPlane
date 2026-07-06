'use strict';
/**
 * run-tag.js  —  Tag-Based BDD Test Execution  (WI-031C)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs Cucumber scenarios that match a given Cucumber tag expression or alias.
 * Maps built-in aliases to Cucumber @tag expressions on the generated feature
 * files.
 *
 *  Built-in tag aliases:
 *   ┌───────────────┬──────────────────────────────────────────────────────┐
 *   │ smoke         │ @smoke tagged scenarios                              │
 *   │ regression    │ full suite (no tag filter)                          │
 *   │ bva           │ @bva boundary value analysis scenarios              │
 *   │ ep            │ @ep equivalence partitioning scenarios              │
 *   │ negative      │ @negative invalid-input scenarios                   │
 *   │ boundary      │ @boundary or @edge-case scenarios                   │
 *   │ security      │ @security or @rbac scenarios                        │
 *   │ rbac          │ @rbac role-based access control scenarios           │
 *   │ unicode       │ @unicode special-character scenarios                │
 *   │ ui            │ @ui UI feedback scenarios                           │
 *   │ cancel        │ @cancel discard-action scenarios                    │
 *   │ persistence   │ @persistence data-persistence scenarios             │
 *   │ duplicate     │ @duplicate dedup scenarios                          │
 *   │ max           │ @max maximum-record scenarios                       │
 *   │ <Zephyr-key>     │ e.g. OHRM-T3447 → @OHRM-T3447               │
 *   │ <@expression> │ passed directly to --tags (Cucumber expression)    │
 *   └───────────────┴──────────────────────────────────────────────────────┘
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   node scripts/run-tag.js --tag smoke
 *   node scripts/run-tag.js --tag bva
 *   node scripts/run-tag.js --tag OHRM-T3447
 *   node scripts/run-tag.js --tag "@smoke and @bva"
 *   node scripts/run-tag.js --tag regression --skip-heal
 *   node scripts/run-tag.js --tag smoke --headless
 *   node scripts/run-tag.js --tag smoke --list-only
 *
 * ─── Options ─────────────────────────────────────────────────────────────────
 *   --tag <value>    Tag alias or Cucumber tag expression  [REQUIRED]
 *   --headless       Run browser in headless CI mode
 *   --skip-heal      Skip the self-healing stage
 *   --skip-bugs      Skip Jira bug creation
 *   --skip-report    Skip HTML + Allure report generation
 *   --skip-git       Skip git auto-commit + push
 *   --list-only      Print Cucumber tag expression and exit without running
 *
 * All configuration is read from .env  (ISSUE_KEY, PROJECT_KEY, JIRA_BASE_URL, JIRA_API_TOKEN)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');

const ROOT = path.resolve(__dirname, '..');

const args  = process.argv.slice(2);
const flags = new Set(args.map(a => a.toLowerCase()));

// ─── Parse --tag ──────────────────────────────────────────────────────────────
const tagIdx = args.findIndex(a => a.toLowerCase() === '--tag');
const rawTag = tagIdx !== -1 ? args[tagIdx + 1] : null;

const useHeadless = flags.has('--headless') || process.env.PW_HEADLESS === 'true';
const skipHeal    = flags.has('--skip-heal');
const skipBugs    = flags.has('--skip-bugs');
const skipReport  = flags.has('--skip-report');
const skipGit     = flags.has('--skip-git');
const listOnly    = flags.has('--list-only');

// ─── Tag alias → Cucumber tag expression ─────────────────────────────────────
// Values are passed directly to --tags "..." so use Cucumber boolean syntax.
const TAG_MAP = {
  smoke:       '@smoke',
  regression:  null,                        // null = no filter, run everything
  bva:         '@bva',
  ep:          '@ep',
  negative:    '@negative',
  boundary:    '@boundary or @edge-case',
  security:    '@security or @rbac',
  rbac:        '@rbac',
  unicode:     '@unicode',
  ui:          '@ui',
  cancel:      '@cancel',
  persistence: '@persistence',
  duplicate:   '@duplicate',
  max:         '@max',
};

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m', bold:   '\x1b[1m', dim:    '\x1b[2m',
  green:  '\x1b[32m', yellow: '\x1b[33m', red:  '\x1b[31m',
  cyan:   '\x1b[36m', orange: '\x1b[33m', white: '\x1b[97m',
};
const R = C.reset;

function now() { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }

function banner(tag, cucumberExpr) {
  const W = 64;
  const B = '═'.repeat(W);
  const pad = s => s + ' '.repeat(Math.max(0, W - s.length - 1));
  const row = s => `${C.bold}${C.orange}║  ${R}${pad(s)}${C.bold}${C.orange}║${R}`;
  console.log(`\n${C.bold}${C.orange}╔${B}╗${R}`);
  console.log(row('Agentic QA Platform  —  BDD Tag-Based Execution'));
  console.log(row(''));
  console.log(row(`  Tag      : ${tag}`));
  console.log(row(`  Cucumber : ${(cucumberExpr || '(no filter — full suite)').slice(0, 54)}`));
  console.log(row(`  Mode     : ${useHeadless ? 'Headless (CI)' : 'Headed — visible browser'}`));
  console.log(row(`  Time     : ${now()}`));
  if (listOnly) console.log(row('  *** LIST-ONLY mode — will NOT be executed ***'));
  console.log(`${C.bold}${C.orange}╚${B}╝${R}\n`);
}

function stageHeader(num, total, label, skipped = false) {
  const tag = skipped ? `${C.yellow}SKIP${R}` : `${C.cyan}RUN${R}`;
  console.log(`\n${C.bold}${C.white}┌─ [${num}/${total}] ${label}${R}  ${tag}`);
  console.log(`${C.dim}│  ${now()}${R}`);
  console.log(`${C.bold}${C.white}└${'─'.repeat(62)}${R}\n`);
}

function stageDone(num, label, ok, ms) {
  const icon = ok ? `${C.green}✓${R}` : `${C.red}✗${R}`;
  const col  = ok ? C.green : C.red;
  console.log(`\n${icon} ${C.bold}${col}[${num}] ${label}${R}  (${(ms / 1000).toFixed(1)}s)\n`);
}

function runScript(relPath, extraEnv = {}) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    console.error(`${C.red}  Script not found: ${relPath}${R}`);
    return { ok: false, exitCode: 1 };
  }
  const r = spawnSync('node', [abs], {
    cwd:   ROOT,
    stdio: 'inherit',
    env:   { ...process.env, ...extraEnv },
  });
  const exitCode = r.status ?? (r.error ? 1 : 0);
  return { ok: exitCode === 0, exitCode };
}

// ─── Resolve tag → Cucumber tag expression ────────────────────────────────────
function resolveTag(tag) {
  if (!tag) return null;
  const lower = tag.toLowerCase();

  // Known alias → Cucumber tag expression
  if (Object.prototype.hasOwnProperty.call(TAG_MAP, lower)) {
    return TAG_MAP[lower]; // may be null (regression = no filter)
  }

  // Zephyr test case key (e.g. OHRM-T3447) → @OHRM-T3447
  if (/^[a-z_]+-t\d+$/i.test(tag)) {
    return `@${tag}`;
  }

  // Already a @expression — pass through
  if (tag.startsWith('@')) return tag;

  // Treat as a literal tag name
  return `@${tag}`;
}

// ─── Run Cucumber with tag filter (BDD-only, WI-031C) ────────────────────────
function runCucumber(cucumberTag) {
  // cucumberTag: e.g. "@smoke", "@regression", "@OHRM-T3447"
  const tag = cucumberTag.startsWith('@') ? cucumberTag : `@${cucumberTag}`;
  const cmd = `npx cucumber-js --tags "${tag}"`;
  const extraEnv = {
    ...process.env,
    PW_HEADLESS: useHeadless ? 'true' : 'false',
  };
  console.log(`  ${C.dim}Running: ${cmd}${R}\n`);
  const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r   = spawnSync(NPX, ['cucumber-js', '--tags', tag], {
    cwd: ROOT, stdio: 'inherit', shell: false, env: extraEnv
  });
  return r.status ?? (r.error ? 1 : 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!rawTag) {
    console.error(`${C.red}
  Error: --tag is required.

  Examples:
    node scripts/run-tag.js --tag smoke
    node scripts/run-tag.js --tag bva
    node scripts/run-tag.js --tag OHRM-T36
    node scripts/run-tag.js --tag "boundary|duplicate"

  Available tag aliases:
    smoke, regression, bva, ep, negative, boundary,
    security, rbac, unicode, ui, cancel, persistence,
    duplicate, max, <OHRM-Txx key>, <any regex>
${R}`);
    process.exit(1);
  }

  const cucumberExpr = resolveTag(rawTag);

  banner(rawTag, cucumberExpr);

  if (listOnly) {
    console.log(`  Cucumber tag expression: ${cucumberExpr || '(none — full suite)'}`);
    console.log(`${C.green}  Pass without --list-only to run.${R}\n`);
    process.exit(0);
  }

  const TOTAL   = 7;
  const summary = [];
  const t0      = Date.now();

  // ── Stage 1: Execute BDD scenarios by tag ────────────────────────────────────
  stageHeader(1, TOTAL, `Run BDD [tag: ${rawTag}]  [${useHeadless ? 'HEADLESS' : 'HEADED'}]`);
  const ts1    = Date.now();
  const bddExit = runCucumber(cucumberExpr);
  const ms1    = Date.now() - ts1;
  stageDone(1, `Execute BDD [tag: ${rawTag}]`, bddExit === 0, ms1);
  summary.push({ num: 1, label: `Execute BDD [tag: ${rawTag}]`, status: bddExit === 0 ? 'PASS' : 'WARN', ms: ms1 });

  // ── Stage 2: Self-healing ─────────────────────────────────────────────────────
  stageHeader(2, TOTAL, 'Self-Healing Agent → repair + re-run failures', skipHeal);
  if (skipHeal) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-heal${R}\n`);
    summary.push({ num: 2, label: 'Self-Healing', status: 'SKIP', ms: 0 });
  } else {
    const ts2 = Date.now();
    const { ok } = runScript('scripts/healer.js', { PW_HEADLESS: useHeadless ? 'true' : 'false' });
    const ms2 = Date.now() - ts2;
    stageDone(2, 'Self-Healing', ok || true, ms2);
    summary.push({ num: 2, label: 'Self-Healing', status: ok ? 'PASS' : 'WARN', ms: ms2 });
  }

  // ── Stage 3: Jira bug creation ─────────────────────────────────────────────────
  stageHeader(3, TOTAL, 'Auto-create Jira bugs for remaining failures', skipBugs);
  if (skipBugs) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-bugs${R}\n`);
    summary.push({ num: 3, label: 'Jira bug creation', status: 'SKIP', ms: 0 });
  } else {
    const ts3 = Date.now();
    const { ok } = runScript('scripts/create-jira-bugs.js');
    const ms3 = Date.now() - ts3;
    stageDone(3, 'Jira bug creation', ok || true, ms3);
    summary.push({ num: 3, label: 'Jira bug creation', status: ok ? 'PASS' : 'WARN', ms: ms3 });
  }

  // ── Stage 4: HTML report ──────────────────────────────────────────────────────
  stageHeader(4, TOTAL, 'Generate HTML report', skipReport);
  if (skipReport) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-report${R}\n`);
    summary.push({ num: 4, label: 'HTML report', status: 'SKIP', ms: 0 });
  } else {
    const ts4 = Date.now();
    const { ok } = runScript('scripts/generate-report.js');
    const ms4 = Date.now() - ts4;
    stageDone(4, 'HTML report', ok, ms4);
    summary.push({ num: 4, label: 'HTML report', status: ok ? 'PASS' : 'FAIL', ms: ms4 });
  }

  // ── Stage 4b: Governance gate ─────────────────────────────────────────────────
  stageHeader('4b', TOTAL, 'Governance Gate — coding standards + enforcement', skipReport);
  if (skipReport) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-report${R}\n`);
    summary.push({ num: '4b', label: 'Governance Gate', status: 'SKIP', ms: 0 });
  } else {
    const tsGov = Date.now();
    const { ok: okGov } = runScript('scripts/governance-gate.js');
    const msGov = Date.now() - tsGov;
    stageDone('4b', 'Governance Gate', okGov || true, msGov);
    summary.push({ num: '4b', label: 'Governance Gate', status: okGov ? 'PASS' : 'WARN', ms: msGov });
  }

  // ── Stage 5: Allure report ────────────────────────────────────────────────────
  stageHeader(5, TOTAL, 'Generate Allure report', skipReport);
  if (skipReport) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-report${R}\n`);
    summary.push({ num: 5, label: 'Allure report', status: 'SKIP', ms: 0 });
  } else {
    const ts5 = Date.now();
    const { ok } = runScript('scripts/generate-allure-report.js');
    const ms5 = Date.now() - ts5;
    stageDone(5, 'Allure report', ok || true, ms5);
    summary.push({ num: 5, label: 'Allure report', status: ok ? 'PASS' : 'WARN', ms: ms5 });
  }

  // ── Stage 6: Git sync ─────────────────────────────────────────────────────────
  stageHeader(6, TOTAL, 'Git Agent — auto-commit + push', skipGit);
  if (skipGit) {
    console.log(`  ${C.yellow}↷  Skipped — --skip-git${R}\n`);
    summary.push({ num: 6, label: 'Git sync', status: 'SKIP', ms: 0 });
  } else {
    const ts6 = Date.now();
    const { ok } = runScript('scripts/git-sync.js');
    const ms6 = Date.now() - ts6;
    stageDone(6, 'Git sync', ok || true, ms6);
    summary.push({ num: 6, label: 'Git sync', status: ok ? 'PASS' : 'WARN', ms: ms6 });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────
  const total = (Date.now() - t0) / 1000;
  console.log(`\n${C.bold}${C.white}${'─'.repeat(64)}${R}`);
  console.log(`${C.bold}  Tag-Based Run Summary  [tag: ${rawTag}]  ${C.dim}(${total.toFixed(1)}s)${R}\n`);
  for (const s of summary) {
    const col = s.status === 'PASS' ? C.green : s.status === 'SKIP' ? C.yellow : s.status === 'WARN' ? C.yellow : C.red;
    const dur = s.ms ? `  ${C.dim}${(s.ms / 1000).toFixed(1)}s${R}` : '';
    console.log(`  ${col}${s.status.padEnd(5)}${R}  Stage ${s.num}  ${s.label}${dur}`);
  }
  console.log(`\n${C.bold}${C.white}${'─'.repeat(64)}${R}\n`);

  const failed = summary.filter(s => s.status === 'FAIL').length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
