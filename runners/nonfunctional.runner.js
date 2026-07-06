'use strict';
/**
 * Non-Functional Runner — OrangeHRM Execution Plane
 *
 * Drives the standalone performance and security pipelines as pipeline steps and
 * returns structured summaries for the /run response.
 *
 *   - Performance: scripts/run-perf.js  → k6 against PERF_BASE_URL (sanctioned target)
 *   - Security:    scripts/run-security.js --no-zap → 18 HTTP checks against SEC_BASE_URL
 *
 * Both child scripts auto-generate their own HTML reports
 * (custom-report/perf/index.html, custom-report/security/index.html).
 *
 * IMPORTANT (sovereign boundary): perf/security run ENTIRELY in the customer tenant
 * and target sanctioned public test sites — never the live OrangeHRM app, never DBiz.
 */
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const logger = require('../lib/logger');

// Stream child (k6/ZAP/run-*) output live to the server console AND the child-output
// log so the trace (trigger.js) shows perf/security detail. STREAM_CHILD_OUTPUT=false silences.
const STREAM_CHILD = process.env.STREAM_CHILD_OUTPUT !== 'false';
const childLog     = require('../lib/childLog');

const ROOT = (() => {
  const p = path.resolve(__dirname, '..');
  try { return fs.realpathSync.native(p); } catch { return p; }
})();

const PERF_TIMEOUT_MS = parseInt(process.env.PERF_EXEC_TIMEOUT_MS || '600000', 10); // 10 min
const SEC_TIMEOUT_MS  = parseInt(process.env.SEC_EXEC_TIMEOUT_MS  || '600000', 10); // 10 min

// Strip ANSI colour codes so banner regexes match. The \x1B (ESC) control char
// is intentional — it is the literal start of an ANSI SGR sequence.
// eslint-disable-next-line no-control-regex
function stripAnsi(s) { return String(s || '').replace(/\x1B\[[0-9;]*m/g, ''); }

function num(text, label) {
  const m = stripAnsi(text).match(new RegExp(label + '\\s*:\\s*(\\d+)'));
  return m ? parseInt(m[1], 10) : null;
}

// Spawn `node <script> <args>` in ROOT with a clean, casing-correct cwd.
// Output is captured (for banner parsing) AND streamed live to the server console.
function runNode(scriptRel, args, extraEnv, timeout, label) {
  return new Promise((resolve) => {
    const script = path.join(ROOT, scriptRel);
    const env = { ...process.env, ...extraEnv };
    const start = Date.now();
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env });

    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* ignore */ } }, timeout);

    const onData = (chunk) => {
      out += chunk.toString();
      if (STREAM_CHILD) { process.stdout.write(chunk); childLog.write(chunk); } // tee → console + child log
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (e) => {
      clearTimeout(timer);
      logger.error(`[${label}] spawn error: ${e.message}`);
      resolve({ out, durationMs: Date.now() - start, exitCode: 1, timedOut });
    });
    // run-security exits 1 on a 'fail' verdict and run-perf exits 1 on fatal only;
    // a non-zero exit is NOT necessarily a runner failure — we parse the banner regardless.
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) logger.warn(`[${label}] timed out after ${timeout}ms`);
      resolve({ out, durationMs: Date.now() - start, exitCode: timedOut ? -1 : (code ?? 0), timedOut });
    });
  });
}

function reportInfo(rel) {
  const abs = path.join(ROOT, rel);
  return { path: rel, absolute: abs, generated: fs.existsSync(abs) };
}

// ── Performance ────────────────────────────────────────────────────────────────
async function runPerformance(opts = {}) {
  if (process.env.RUN_PERF === 'false') {
    return { ran: false, skipped: 'RUN_PERF=false' };
  }
  const baseUrl  = opts.baseUrl  || process.env.PERF_BASE_URL || 'https://test.k6.io';
  const testType = opts.testType || process.env.PERF_TEST_TYPE || 'spike';
  const story    = opts.story    || process.env.ISSUE_KEY;

  logger.info(`[Perf] Running k6 (${testType}) against ${baseUrl}  story=${story}`);
  const { out, durationMs, exitCode, timedOut } = await runNode(
    'scripts/run-perf.js',
    ['--skip-generate', '--skip-sync', '--skip-bugs', '--skip-git',
     `--test-type=${testType}`, story ? `--story=${story}` : ''].filter(Boolean),
    { BASE_URL: baseUrl, ISSUE_KEY: story || process.env.ISSUE_KEY || '' },
    PERF_TIMEOUT_MS,
    'Perf',
  );

  const summary = {
    scriptsRun: num(out, 'Scripts run') ?? 0,
    passed:     num(out, 'Pass') ?? 0,
    warned:     num(out, 'Warn') ?? 0,
    failed:     num(out, 'Fail') ?? 0,
  };
  logger.info(`[Perf] ${summary.passed} pass, ${summary.warned} warn, ${summary.failed} fail (${(durationMs/1000).toFixed(1)}s)`);

  return {
    ran: true, tool: 'k6', target: baseUrl, testType,
    durationMs, timedOut, exitCode, ...summary,
    report: reportInfo(path.join('custom-report', 'perf', 'index.html')),
  };
}

// ── Security ───────────────────────────────────────────────────────────────────
async function runSecurity(opts = {}) {
  if (process.env.RUN_SECURITY === 'false') {
    return { ran: false, skipped: 'RUN_SECURITY=false' };
  }
  const baseUrl = opts.baseUrl || process.env.SEC_BASE_URL || 'http://testphp.vulnweb.com';
  const story   = opts.story   || process.env.ISSUE_KEY;

  // ZAP is opt-in: when ZAP_AUTO_LAUNCH=true we run the full ZAP scan + custom
  // checks; otherwise just the 18 HTTP checks (--no-zap). ZAP failures are
  // non-fatal inside run-security (it falls back to custom checks).
  const zapEnabled = process.env.ZAP_AUTO_LAUNCH === 'true';
  const secArgs = ['--skip-generate', '--skip-sync', '--skip-git'];
  if (!zapEnabled) secArgs.splice(1, 0, '--no-zap');

  logger.info(`[Security] Running ${zapEnabled ? 'ZAP + ' : ''}custom HTTP checks against ${baseUrl}  story=${story}`);
  const { out, durationMs, exitCode, timedOut } = await runNode(
    'scripts/run-security.js',
    secArgs,
    { BASE_URL: baseUrl, ISSUE_KEY: story || process.env.ISSUE_KEY || '' },
    SEC_TIMEOUT_MS,
    'Security',
  );

  const verdictMatch = stripAnsi(out).match(/Verdict\s*:\s*(\w+)/);
  const summary = {
    totalFindings: num(out, 'Total findings') ?? 0,
    critical:      num(out, 'Critical') ?? 0,
    high:          num(out, 'High') ?? 0,
    medium:        num(out, 'Medium') ?? 0,
    verdict:       verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN',
  };
  logger.info(`[Security] ${summary.totalFindings} findings (C=${summary.critical} H=${summary.high} M=${summary.medium}) verdict=${summary.verdict} (${(durationMs/1000).toFixed(1)}s)`);

  return {
    ran: true, tool: zapEnabled ? 'owasp-zap + custom-http-checks' : 'custom-http-checks',
    zap: zapEnabled, target: baseUrl,
    durationMs, timedOut, exitCode, ...summary,
    report: reportInfo(path.join('custom-report', 'security', 'index.html')),
  };
}

// ── Report manifest ─────────────────────────────────────────────────────────────
// Functional (cucumber) HTML is produced during the BDD run via the html formatter.
function collectReports() {
  return {
    functional: reportInfo(path.join('reports', 'cucumber-report.html')),
    performance: reportInfo(path.join('custom-report', 'perf', 'index.html')),
    security:    reportInfo(path.join('custom-report', 'security', 'index.html')),
  };
}

module.exports = { runPerformance, runSecurity, collectReports };
