'use strict';
/**
 * appReadiness.js — OrangeHRM React SPA readiness engine.
 *
 * Replaces generic Playwright waits with React/OrangeHRM-aware readiness checks:
 * client-side route settle, the `.oxd-loading-spinner` overlay gone, and the
 * `.oxd-*` shell/form hydrated. Every public function writes a diagnostic JSON
 * report for downstream failure analysis.
 *
 * Public API:
 *   appFormReady(page, options?)              → writes app-readiness-analysis.json
 *   waitForRouteSettled(page, options?)       → writes route-analysis.json
 *   validateLocators(page, locators, options?) → writes locator-validation.json + locator-root-cause.json
 *   collectAutopsy(page, context)             → writes app-autopsy.json + app-autopsy-summary.json
 */

const fs   = require('fs');
const path = require('path');

const REPORTS_DIR   = path.join(process.cwd(), 'reports');
const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts', 'app-autopsy');

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* non-fatal */ }
}

function writeReport(filename, data) {
  ensureDir(REPORTS_DIR);
  try { fs.writeFileSync(path.join(REPORTS_DIR, filename), JSON.stringify(data, null, 2), 'utf8'); } catch { /* non-fatal */ }
}

// ─── appFormReady ─────────────────────────────────────────────────────────────

/**
 * Wait until the OrangeHRM React page is hydrated and ready for interaction.
 * Writes reports/app-readiness-analysis.json with per-check results.
 *
 * Checks:
 *   1. document.readyState === 'complete'
 *   2. React SPA loading spinner (.oxd-loading-spinner) gone
 *   3. Top bar / main menu attached to DOM
 *   4. At least one .oxd-* control visible (form hydrated)
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 */
async function appFormReady(page, options = {}) {
  const timeout    = options.timeout || parseInt(process.env.APP_FORM_READY_TIMEOUT_MS || '30000', 10);
  const shortGuard = Math.min(timeout, 15000);

  const checks = {
    readyState:      false,
    spinnersGone:    false,
    chromeLoaded:    false,
    controlsVisible: false,
    oxdCount:        0,
  };

  // 1. DOM complete
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout }
  ).then(() => { checks.readyState = true; }).catch(() => {});

  // 2. React loading spinner gone (.oxd-loading-spinner)
  await page.waitForFunction(
    () => {
      const spinners = document.querySelectorAll('.oxd-loading-spinner, [class*="loading-spinner"], .oxd-form-loader');
      return spinners.length === 0 || [...spinners].every(s => {
        const cs = window.getComputedStyle(s);
        return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
      });
    },
    { timeout: shortGuard }
  ).then(() => { checks.spinnersGone = true; }).catch(() => {});

  // 3. App chrome (top bar or main menu) attached
  await page.waitForSelector(
    '.oxd-topbar-header, .oxd-main-menu, .orangehrm-login-branding',
    { state: 'attached', timeout: shortGuard }
  ).then(() => { checks.chromeLoaded = true; }).catch(() => {});

  // 4. At least one .oxd-* control visible (form hydrated)
  await page.waitForSelector(
    '.oxd-input, .oxd-button, .oxd-main-menu-item',
    { state: 'visible', timeout: Math.min(timeout, 10000) }
  ).then(() => { checks.controlsVisible = true; }).catch(() => {});

  checks.oxdCount = await page.locator('[class*="oxd-"]').count().catch(() => 0);

  writeReport('app-readiness-analysis.json', {
    generatedAt: new Date().toISOString(),
    pageUrl:     page.url(),
    ...checks,
  });
}

// ─── waitForRouteSettled ──────────────────────────────────────────────────────

/**
 * Wait until client-side routing has settled on a stable OrangeHRM route.
 * A React SPA does not reload the document between routes, so this observes the
 * URL settling plus the loading spinner clearing.
 * Writes reports/route-analysis.json with result.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number, expectedPath?: string }} [options]
 * @returns {Promise<{ settled: boolean, route: string|null }>}
 */
async function waitForRouteSettled(page, options = {}) {
  const timeout      = options.timeout || parseInt(process.env.APP_ROUTE_TIMEOUT_MS || '20000', 10);
  const expectedPath = options.expectedPath || null;

  let settled = false;
  try {
    if (expectedPath) {
      await page.waitForURL(u => String(u).includes(expectedPath), { timeout });
    }
    // Spinner must be gone for the route to be considered settled.
    await page.waitForSelector('.oxd-loading-spinner', { state: 'hidden', timeout: Math.min(timeout, 10000) })
      .catch(() => {});
    // A settled OrangeHRM route always renders the top bar or login branding.
    await page.waitForSelector('.oxd-topbar-header, .orangehrm-login-branding', { state: 'visible', timeout: Math.min(timeout, 10000) });
    settled = true;
  } catch { /* best-effort */ }

  let route = null;
  try { route = new URL(page.url()).pathname; } catch { route = page.url(); }

  writeReport('route-analysis.json', {
    generatedAt:  new Date().toISOString(),
    pageUrl:      page.url(),
    route,
    expectedPath,
    routeSettled: settled,
    failureType:  settled ? null : 'ROUTE_NOT_SETTLED',
  });

  return { settled, route };
}

// ─── validateLocators ────────────────────────────────────────────────────────

/**
 * Validate that every named locator is visible before an interaction begins.
 * Captures found + visible + enabled state.
 * Writes reports/locator-validation.json AND reports/locator-root-cause.json.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, import('@playwright/test').Locator | string>} locators
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ allFound: boolean, locators: Record<string, object> }>}
 */
async function validateLocators(page, locators, options = {}) {
  const timeout = options.timeout || parseInt(process.env.LOCATOR_VALIDATE_TIMEOUT_MS || '5000', 10);
  const results = {};

  for (const [name, def] of Object.entries(locators)) {
    try {
      const loc      = typeof def === 'string' ? page.locator(def) : def;
      const locFirst = loc.first();
      const found    = await locFirst.isVisible({ timeout }).catch(() => false);
      const enabled  = found ? await locFirst.isEnabled({ timeout: 2000 }).catch(() => null) : false;
      const selector = typeof def === 'string' ? def : '[Locator object]';
      const strategy = typeof def === 'string'
        ? (def.startsWith('[name')     ? 'name-attr'
          : def.startsWith('[data-')   ? 'data-attr'
          : def.startsWith('.oxd-')    ? 'oxd-class'
          : def.startsWith('button')   ? 'role-button'
          : 'css')
        : 'locator-object';

      const entry = { found, visible: found, enabled, strategy, selector };
      if (!found) {
        entry.failureType = 'LOCATOR_NOT_FOUND';
        entry.pageUrl     = page.url();
      }
      results[name] = entry;
    } catch (err) {
      results[name] = {
        found:       false,
        visible:     false,
        enabled:     false,
        strategy:    'error',
        error:       err.message,
        failureType: 'LOCATOR_ERROR',
        pageUrl:     page.url(),
      };
    }
  }

  const allFound = Object.values(results).every(r => r.found);
  const report   = { generatedAt: new Date().toISOString(), allFound, locators: results };

  writeReport('locator-validation.json',  report);
  writeReport('locator-root-cause.json',  report);

  return report;
}

// ─── collectAutopsy ──────────────────────────────────────────────────────────

/**
 * Collect full diagnostic data after an app action failure.
 * Writes reports/app-autopsy.json, reports/app-autopsy-summary.json,
 * and saves screenshot + DOM to artifacts/app-autopsy/.
 *
 * @param {import('@playwright/test').Page | null} page
 * @param {{ scenarioName?, error?, consoleErrors?, networkFailures? }} context
 * @returns {Promise<object>}
 */
async function collectAutopsy(page, context = {}) {
  const { scenarioName, error, consoleErrors = [], networkFailures = [] } = context;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  ensureDir(REPORTS_DIR);
  ensureDir(ARTIFACTS_DIR);

  const autopsy = {
    generatedAt:     new Date().toISOString(),
    scenarioName:    scenarioName || 'unknown',
    error:           error ? { message: error.message, stack: error.stack?.split('\n').slice(0, 8).join('\n') } : null,
    url:             null,
    pageTitle:       null,
    screenshotFile:  null,
    domSnapshotFile: null,
    consoleErrors:   consoleErrors.slice(-20),
    networkFailures: networkFailures.slice(-20),
  };

  if (page) {
    try { autopsy.url = page.url(); } catch { /* non-fatal */ }
    try { autopsy.pageTitle = await page.title().catch(() => null); } catch { /* non-fatal */ }

    try {
      const screenshotPath = path.join(ARTIFACTS_DIR, `autopsy-${timestamp}.png`);
      await page.screenshot({ fullPage: true, path: screenshotPath });
      autopsy.screenshotFile = screenshotPath;
    } catch { /* non-fatal */ }

    try {
      const domPath = path.join(ARTIFACTS_DIR, `autopsy-dom-${timestamp}.html`);
      fs.writeFileSync(domPath, await page.content(), 'utf8');
      autopsy.domSnapshotFile = domPath;
    } catch { /* non-fatal */ }
  }

  writeReport('app-autopsy.json', autopsy);

  writeReport('app-autopsy-summary.json', {
    generatedAt:          autopsy.generatedAt,
    scenarioName:         autopsy.scenarioName,
    url:                  autopsy.url,
    pageTitle:            autopsy.pageTitle,
    errorMessage:         autopsy.error?.message || null,
    screenshotAvailable:  !!autopsy.screenshotFile,
    domSnapshotAvailable: !!autopsy.domSnapshotFile,
    consoleErrorCount:    autopsy.consoleErrors.length,
    networkFailureCount:  autopsy.networkFailures.length,
    topConsoleError:      autopsy.consoleErrors[0]?.text || null,
    topNetworkFailure:    autopsy.networkFailures[0]?.url || null,
    artifacts: {
      screenshot:  autopsy.screenshotFile,
      domSnapshot: autopsy.domSnapshotFile,
      directory:   ARTIFACTS_DIR,
    },
  });

  return autopsy;
}

module.exports = { appFormReady, waitForRouteSettled, validateLocators, collectAutopsy };
