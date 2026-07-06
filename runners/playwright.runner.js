'use strict';
/**
 * Playwright Runner — OrangeHRM Execution Plane
 *
 * Executes Playwright tests from the OrangeHRM_AgenticQAPlatform directory,
 * driving the OrangeHRM React web application. ALL execution happens inside the
 * OrangeHRM tenant:
 *   - App credentials injected from env (never sent to DBiz)
 *   - Screenshots saved to local storage (never sent to DBiz)
 *   - Test results parsed locally and returned as structured JSON
 *
 * run(opts?)     → { total, passed, failed, duration, results[], reportPath }
 * checkInstalled() → { installed, version, error? }
 */
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const path   = require('path');
const fs     = require('fs');
const logger = require('../lib/logger');
const config = require('../config/customer.json');

const execFileAsync = promisify(execFile);

// Stream child (cucumber) output live to the server console AND to the child-output
// log so the trace (trigger.js) shows BDD step detail + failure stack traces.
// Set STREAM_CHILD_OUTPUT=false to silence it.
const STREAM_CHILD = process.env.STREAM_CHILD_OUTPUT !== 'false';
const childLog     = require('../lib/childLog');

const PLATFORM_DIR = () => {
  const p = path.resolve(process.env.PLATFORM_DIR || '.');
  // Windows: normalise to the real on-disk casing. A cwd whose drive-letter or
  // path casing differs from the real path makes Node cache @cucumber/cucumber
  // under two keys, triggering a "support code depends on a different instance
  // of Cucumber" load error. realpathSync.native() returns canonical casing.
  try { return fs.realpathSync.native(p); } catch { return p; }
};
const REPORT_DIR   = () => {
  const d = path.join(PLATFORM_DIR(), config.playwright?.reportDir || 'logs/playwright');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
};

// ── CLI invocation (no shell) ─────────────────────────────────────────────────
// Resolve a package's CLI entry so we can run it via `node <bin>` directly. This
// avoids spawning through a shell, which clears the DEP0190 deprecation, the
// command-injection class, and the Windows requirement that `.cmd` shims (npx)
// be launched with shell:true (CVE-2024-27980). If resolution fails we fall back
// to the previous npx-with-shell behaviour so this is strictly no worse.
function cliInvoker(pkg, binName, fromDir) {
  try {
    const pj  = require.resolve(`${pkg}/package.json`, { paths: [fromDir] });
    const bin = require(pj).bin;
    const rel = typeof bin === 'string' ? bin : (bin[binName] || Object.values(bin)[0]);
    const abs = path.join(path.dirname(pj), rel);
    if (fs.existsSync(abs)) return { file: process.execPath, prefix: [abs], shell: false };
  } catch { /* fall through to npx */ }
  return { file: 'npx', prefix: [binName], shell: true };
}

// ── Check Playwright is installed ─────────────────────────────────────────────

async function checkInstalled() {
  try {
    const inv = cliInvoker('playwright', 'playwright', PLATFORM_DIR());
    const { stdout } = await execFileAsync(inv.file, [...inv.prefix, '--version'], {
      cwd: PLATFORM_DIR(), timeout: 10000, shell: inv.shell,
    });
    return { installed: true, version: stdout.trim() };
  } catch (e) {
    return { installed: false, error: e.message };
  }
}

// ── Parse Playwright JSON report ──────────────────────────────────────────────

function parseReport(reportPath) {
  if (!fs.existsSync(reportPath)) return null;
  try {
    const raw     = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const results = [];
    const walk    = (suites) => {
      for (const suite of (suites || [])) {
        for (const spec of (suite.specs || [])) {
          const passed = spec.tests?.every(t => t.results?.every(r => r.status === 'passed'));
          results.push({
            title:      spec.title,
            file:       suite.file || '',
            passed:     !!passed,
            durationMs: spec.tests?.[0]?.results?.[0]?.duration || 0,
            error:      passed ? '' : (spec.tests?.[0]?.results?.[0]?.error?.message || 'Test failed'),
          });
        }
        walk(suite.suites);
      }
    };
    walk(raw.suites);
    return results;
  } catch (e) {
    logger.warn(`[Playwright] Could not parse report: ${e.message}`);
    return null;
  }
}

// ── Main run function ─────────────────────────────────────────────────────────

async function run(opts = {}) {
  const platformDir = PLATFORM_DIR();
  const reportDir   = REPORT_DIR();
  const reportFile  = path.join(reportDir, `run-${Date.now()}.json`);
  const timeout     = opts.timeout || config.playwright?.timeout || 300_000;

  logger.info(`[Playwright] Starting test run`);
  logger.info(`[Playwright] Platform dir : ${platformDir}`);
  logger.info(`[Playwright] Target URL   : ${process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '(not set)'}`);
  logger.info(`[Playwright] Credentials  : loaded from env (NEVER sent to DBiz)`);
  logger.info(`[Playwright] Report       : ${reportFile}`);

  if (!fs.existsSync(platformDir)) {
    logger.error(`[Playwright] Platform directory not found: ${platformDir}`);
    return buildFallback(`Platform directory not found: ${platformDir}`, reportFile);
  }

  // BDD architecture: playwright.config.js points testDir to __playwright_disabled__
  // so `npx playwright test` finds no specs. In that case the real Playwright
  // execution is driven through Cucumber (.feature files), so run the BDD suite
  // headed rather than skipping it.
  const pwConfig = path.join(platformDir, 'playwright.config.js');
  if (fs.existsSync(pwConfig)) {
    const cfgText = fs.readFileSync(pwConfig, 'utf8');
    if (cfgText.includes('__playwright_disabled__')) {
      logger.info('[Playwright] BDD mode detected — executing Cucumber suite (Playwright under the hood)');
      return runBdd({ platformDir, timeout: opts.timeout });
    }
  }

  const args = [
    'test',
    '--reporter=json',
    `--output=${reportDir}`,
  ];
  if (opts.grep)    args.push(`--grep=${opts.grep}`);
  if (opts.project) args.push(`--project=${opts.project}`);

  const appUrl = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '';
  const env = {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    APP_BASE_URL:  appUrl,
    TEST_BASE_URL: appUrl, // alias for the child suite
    APP_USERNAME:  process.env.APP_USERNAME || '',
    APP_PASSWORD:  process.env.APP_PASSWORD || '',
    CI: 'true',
  };

  const start = Date.now();
  let exitCode = 0;

  try {
    const inv = cliInvoker('playwright', 'playwright', platformDir);
    await execFileAsync(inv.file, [...inv.prefix, ...args], { cwd: platformDir, timeout, shell: inv.shell, env });
    logger.info('[Playwright] ✅ All tests passed');
  } catch (e) {
    exitCode = e.code ?? 1;
    logger.info(`[Playwright] ⚠  Exit code ${exitCode} — parsing results`);
  }

  const duration = Date.now() - start;
  const results  = parseReport(reportFile);

  if (results && results.length > 0) {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    logger.info(`[Playwright] Results: ${passed} passed, ${failed} failed, ${results.length} total (${(duration/1000).toFixed(1)}s)`);
    logger.info('[Playwright] Screenshots and artefacts saved to local Customer storage — never sent to DBiz');
    return { total: results.length, passed, failed, duration, results, reportPath: reportFile };
  }

  // No JSON report — return structured failure with context
  logger.warn('[Playwright] No JSON report found — returning structured failure');
  return buildFallback(`Playwright exited ${exitCode} with no parseable report`, reportFile, duration);
}

// ── BDD (Cucumber) execution ──────────────────────────────────────────────────
// The QA platform is BDD-only: .feature files drive Playwright via the Cucumber
// World. `npx cucumber-js` (default profile) runs the feature suite, honours
// PW_HEADLESS for headed/headless, and excludes @failure-sim scenarios.

const BDD_TIMEOUT_MS = parseInt(process.env.PLAYWRIGHT_BDD_TIMEOUT_MS || '900000', 10); // 15 min

async function runBdd({ platformDir, timeout } = {}) {
  const headless   = process.env.PW_HEADLESS === 'true';
  const reportPath = path.join(platformDir, 'reports', 'cucumber-report.json');
  const runTimeout = timeout || BDD_TIMEOUT_MS;

  // Remove any stale report so we never parse a previous run's results.
  try { if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath); } catch { /* non-fatal */ }

  logger.info(`[Playwright] BDD mode   : ${headless ? 'headless' : 'HEADED'} (PW_HEADLESS=${process.env.PW_HEADLESS || 'unset'})`);
  logger.info(`[Playwright] Cucumber   : cucumber-js (node, no shell)  (cwd=${platformDir})`);
  logger.info(`[Playwright] BDD report : ${reportPath}`);

  const appUrl = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '';
  const env = {
    ...process.env,
    PW_HEADLESS:   process.env.PW_HEADLESS || 'false', // headed by default for QA
    APP_BASE_URL:  appUrl,
    TEST_BASE_URL: appUrl, // alias for the child suite
    APP_USERNAME:  process.env.APP_USERNAME || '',
    APP_PASSWORD:  process.env.APP_PASSWORD || '',
  };

  const start = Date.now();
  let exitCode = 0;
  try {
    await new Promise((resolve, reject) => {
      const inv = cliInvoker('@cucumber/cucumber', 'cucumber-js', platformDir);
      const child = spawn(inv.file, [...inv.prefix], { cwd: platformDir, shell: inv.shell, env });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* ignore */ } }, runTimeout);
      const tee = (c) => { if (STREAM_CHILD) { process.stdout.write(c); childLog.write(c); } }; // live BDD trace → console + child log
      child.stdout.on('data', tee);
      child.stderr.on('data', tee);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut || signal === 'SIGTERM') { const e = new Error('timeout'); e.killed = true; return reject(e); }
        if (code === 0) return resolve();
        const e = new Error(`Cucumber exited ${code}`); e.code = code; return reject(e);
      });
    });
    logger.info('[Playwright] ✅ Cucumber suite passed');
  } catch (e) {
    exitCode = e.code ?? 1;
    if (e.killed || e.signal === 'SIGTERM') {
      logger.warn(`[Playwright] ⚠  Cucumber timed out after ${runTimeout}ms`);
    } else {
      logger.info(`[Playwright] ⚠  Cucumber exit code ${exitCode} — parsing results`);
    }
  }

  const duration = Date.now() - start;
  let results = parseCucumberReport(reportPath);
  // The JSON report can lag the child's exit on slow disks (partial/empty read).
  // Retry once after a short delay before treating it as "no report".
  if (!results || results.length === 0) {
    await new Promise(r => setTimeout(r, 2500));
    results = parseCucumberReport(reportPath);
  }

  if (results && results.length > 0) {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    logger.info(`[Playwright] BDD results: ${passed} passed, ${failed} failed, ${results.length} scenarios (${(duration/1000).toFixed(1)}s)`);
    logger.info('[Playwright] Screenshots and artefacts saved locally — never sent to DBiz');
    return { total: results.length, passed, failed, duration, results, reportPath, bddMode: true };
  }

  logger.warn('[Playwright] No Cucumber report found — returning structured failure');
  return buildFallback(`Cucumber exited ${exitCode} with no parseable report`, reportPath, duration);
}

// Parse the cucumber-js JSON report into the runner's result shape.
// A scenario passes only when every step result.status === 'passed'.
function parseCucumberReport(reportPath) {
  if (!fs.existsSync(reportPath)) return null;
  try {
    const features = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const results  = [];
    for (const feature of (features || [])) {
      for (const el of (feature.elements || [])) {
        if (el.type && el.type !== 'scenario') continue; // skip backgrounds
        const steps    = el.steps || [];
        const statuses = steps.map(s => s.result?.status || 'unknown');
        const passed   = statuses.length > 0 && statuses.every(s => s === 'passed');
        const durMs    = steps.reduce((sum, s) => sum + ((s.result?.duration || 0) / 1e6), 0);
        const failing  = steps.find(s => s.result?.status && s.result.status !== 'passed' && s.result.status !== 'skipped');
        results.push({
          title:      el.name || '(unnamed scenario)',
          file:       feature.uri || '',
          passed,
          durationMs: Math.round(durMs),
          error:      passed ? '' : (failing?.result?.error_message
                        || `Step status: ${statuses.join(', ') || 'none'}`),
        });
      }
    }
    return results;
  } catch (e) {
    logger.warn(`[Playwright] Could not parse Cucumber report: ${e.message}`);
    return null;
  }
}

function buildFallback(reason, reportPath, duration = 0) {
  return {
    total: 0, passed: 0, failed: 0, duration,
    results: [{ title: 'Playwright execution', passed: false, durationMs: duration, error: reason }],
    reportPath,
    fallback: true,
  };
}

module.exports = { run, checkInstalled, parseReport, parseCucumberReport, cliInvoker };
