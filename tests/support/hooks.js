'use strict';
/**
 * Global Cucumber hooks.
 *
 * SESSION_MODE=shared (default):
 *   BeforeAll  launches one browser/context/page for the entire run.
 *   Each scenario reuses that page via openBrowser() in world.js.
 *   AfterAll   closes the shared session and writes session-usage.json.
 *
 * SESSION_MODE=scenario:
 *   Original per-scenario context creation.
 *
 * Parallel guard:
 *   When CUCUMBER_WORKERS > 1 the runner automatically falls back to
 *   scenario mode because shared state across OS processes is not safe.
 *
 * Security:
 *   - Credentials are never logged or written to files (enforced by authManager.js)
 *   - .auth/ is excluded from git via .gitignore
 */

const { Before, After, BeforeAll, AfterAll, Status } = require('@cucumber/cucumber');
const {
  ensureAuthenticated,
  isSessionValid,
  AUTH_STATE_FILE,
  writeSessionTelemetry,
  writeSessionMetadata,
  writeAuthDebugReport,
} = require('../auth/authManager');
const appReadiness = require('../../src/runtime/appReadiness');
const sharedSessionManager = require('../runtime/sharedSessionManager');
const fs   = require('fs');
const path = require('path');

const HOOK_TIMEOUT     = parseInt(process.env.CUCUMBER_HOOK_TIMEOUT_MS || '120000', 10);
const RUN_CACHE_TTL_MS = parseInt(process.env.AUTH_RUN_CACHE_TTL_MS   || String(25 * 60 * 1000), 10);
const REPORTS_DIR      = path.join(process.cwd(), 'reports');

// OrangeHRM bounces unauthenticated requests to its login route.
const LOGIN_REDIRECT = /\/auth\/login\b/i;

// ── Session mode resolution (parallel guard) ─────────────────────────────────

function resolveSessionMode() {
  const requested = process.env.SESSION_MODE || 'shared';
  const workers   = parseInt(process.env.CUCUMBER_WORKERS || '1', 10);

  if (requested === 'shared' && workers > 1) {
    console.log('  [SharedSession] Parallel execution detected (CUCUMBER_WORKERS=' + workers + ') — falling back to scenario mode');
    return 'scenario';
  }
  return requested;
}

const SESSION_MODE = resolveSessionMode();

// Module-level run state — persists for all scenarios within this Cucumber worker process.
const _runAuth = { validated: false, validatedAt: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeReport(filename, data) {
  try {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

/**
 * OrangeHRM session health check.
 * Verifies the page is still on an app route (not a login redirect).
 * Returns a health report object written to reports/session-health.json.
 */
async function checkSessionHealth(page) {
  const checkedAt  = new Date().toISOString();
  const currentUrl = page.url();
  const loginRedirectDetected = LOGIN_REDIRECT.test(currentUrl);

  if (!loginRedirectDetected) {
    return { checkedAt, healthy: true, currentUrl, loginRedirectDetected: false, recoveryAttempted: false };
  }

  // Attempt recovery: navigate back to the app base URL
  const baseUrl = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '';
  let recoverySucceeded = false;
  if (baseUrl) {
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const urlAfter = page.url();
      recoverySucceeded = !LOGIN_REDIRECT.test(urlAfter);
    } catch { /* non-fatal */ }
  }

  return {
    checkedAt,
    healthy:               recoverySucceeded,
    currentUrl:            page.url(),
    loginRedirectDetected: true,
    recoveryAttempted:     true,
    recoverySucceeded,
  };
}

// ─── BeforeAll: authenticate once + launch shared browser ─────────────────────

BeforeAll({ timeout: HOOK_TIMEOUT }, async function () {
  const authMode = process.env.AUTH_MODE || 'storage-state';

  if (authMode !== 'storage-state') {
    console.log(`  [Hooks] BeforeAll — AUTH_MODE=${authMode}, skipping global auth setup`);

    if (SESSION_MODE === 'shared') {
      await sharedSessionManager.launchBrowser({
        headless: process.env.PW_HEADLESS !== 'false',
        baseURL:  process.env.APP_BASE_URL || process.env.TEST_BASE_URL,
      });
    }
    return;
  }

  const t0 = Date.now();
  console.log('  [Hooks] BeforeAll — running one-time authentication check...');

  // Resilient auth: retry a transient failure, and if it still fails do NOT abort
  // the whole run — launch the browser anyway so the per-scenario recovery
  // (shared.steps sign-in + sharedSessionManager.reloadStorageState) can retry.
  let telemetry = null;
  const maxAuthAttempts = parseInt(process.env.AUTH_BEFOREALL_ATTEMPTS || '2', 10);
  for (let attempt = 1; attempt <= maxAuthAttempts; attempt++) {
    try {
      telemetry = await ensureAuthenticated();
      break;
    } catch (e) {
      console.warn(`  [Hooks] BeforeAll auth attempt ${attempt}/${maxAuthAttempts} failed: ${e.message}`);
      if (attempt < maxAuthAttempts) {
        try { if (fs.existsSync(AUTH_STATE_FILE)) fs.unlinkSync(AUTH_STATE_FILE); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  if (!telemetry) {
    console.warn('  [Hooks] BeforeAll auth unresolved — launching browser anyway; per-scenario recovery will retry.');
    telemetry = { reusedSession: false, reauthenticated: false };
  }

  _runAuth.validated   = true;
  _runAuth.validatedAt = Date.now();

  writeSessionMetadata({
    authenticatedAt: new Date().toISOString(),
    expiresAt:       new Date(Date.now() + RUN_CACHE_TTL_MS).toISOString(),
    userId:          telemetry.userId || null,
    reauthenticated: telemetry.reauthenticated,
  });

  console.log(`  [Hooks] BeforeAll auth complete — ${Date.now() - t0}ms (reused=${telemetry.reusedSession}, reauthenticated=${telemetry.reauthenticated})`);

  // Launch shared browser/context/page ONCE for the entire run
  if (SESSION_MODE === 'shared') {
    const authFile = process.env.AUTH_STATE_FILE || '.auth/storage-state.json';
    await sharedSessionManager.launchBrowser({
      headless: process.env.PW_HEADLESS !== 'false',
      authFile,
      baseURL:  process.env.APP_BASE_URL || process.env.TEST_BASE_URL,
    });
    console.log(`  [Hooks] Shared session initialised (SESSION_MODE=shared)`);
  }
});

// ─── Before: per-scenario guard ───────────────────────────────────────────────

Before({ order: 0, timeout: HOOK_TIMEOUT }, async function () {
  const authMode = process.env.AUTH_MODE || 'storage-state';

  if (authMode === 'storage-state') {
    const cacheAge      = Date.now() - _runAuth.validatedAt;
    const runCacheValid = _runAuth.validated && cacheAge < RUN_CACHE_TTL_MS;

    if (!runCacheValid) {
      const t0           = Date.now();
      const sessionValid = isSessionValid(AUTH_STATE_FILE);

      if (!sessionValid) {
        console.log('  [Hooks] Before — session expired mid-run, re-authenticating...');
        await ensureAuthenticated();
      }

      _runAuth.validated   = true;
      _runAuth.validatedAt = Date.now();

      writeSessionTelemetry({
        trigger:            'before_scenario_recheck',
        storageStateLoaded: fs.existsSync(AUTH_STATE_FILE),
        validationResult:   sessionValid ? 'reused' : 'reauthenticated',
        durationMs:         Date.now() - t0,
      });
    }
  }

  // openBrowser assigns shared refs or creates a new context
  await this.openBrowser();

  // Session health check (shared mode only)
  if (SESSION_MODE === 'shared' && this.page) {
    const health = await checkSessionHealth(this.page);
    writeReport('session-health.json', health);

    if (!health.healthy) {
      console.warn('  [SharedSession] Health check failed — attempting re-auth');
      try {
        await ensureAuthenticated();
        sharedSessionManager.incrementReauths();
      } catch { /* non-fatal — test will fail naturally if app unreachable */ }
    }
  }
});

// ─── Before (@auth): isolate login-form scenarios in a FRESH, logged-out context ──
// Runs AFTER the order-0 shared setup and overrides `this.page` with an
// unauthenticated context. Without this, the shared authenticated session makes
// /auth/login redirect to the dashboard and the login form never renders.
Before({ tags: '@auth', order: 100, timeout: HOOK_TIMEOUT }, async function () {
  await this.openFreshLoginContext();
  console.log('  [Hooks] @auth scenario — fresh unauthenticated context opened');
});

// After(@auth): close the fresh context. Runs AFTER the main After(order 9999),
// so screenshots/autopsy are still captured on the fresh page before teardown.
After({ tags: '@auth', order: 100, timeout: HOOK_TIMEOUT }, async function () {
  await this.closeFreshLoginContext();
});

// ─── After: screenshot + failure diagnostics + video + cleanup ───────────────

After({ order: 9999, timeout: HOOK_TIMEOUT }, async function (scenario) {
  const scenarioName = scenario.pickle?.name || 'unknown';
  const status       = scenario.result?.status;
  const sessionMode  = process.env.SESSION_MODE || 'shared';

  // Capture end-state screenshot for every scenario
  if (this.page) {
    const screenshot = await this.page.screenshot({ fullPage: true }).catch(() => null);
    if (screenshot) this.attach(screenshot, 'image/png');
  }

  if (status === Status.FAILED && this.page) {
    try {
      if (typeof appReadiness.collectAutopsy === 'function') {
        await appReadiness.collectAutopsy(this.page, {
          scenarioName,
          error:           scenario.result.exception || null,
          consoleErrors:   this._consoleErrors   || [],
          networkFailures: this._networkFailures || [],
        });
        console.warn(`  [Hooks] App autopsy written for scenario: ${scenarioName}`);
      }
    } catch { /* non-fatal */ }

    try {
      const currentUrl    = this.page.url();
      const loginDetected = LOGIN_REDIRECT.test(currentUrl);
      if (loginDetected) {
        writeAuthDebugReport({
          currentUrl,
          loginDetection:   true,
          redirectChain:    [currentUrl],
          cookieExpiry:     { storageStateFile: AUTH_STATE_FILE, fileExists: fs.existsSync(AUTH_STATE_FILE) },
          validationReason: 'login_redirect_detected_in_failed_scenario',
          scenario:         scenarioName,
        });
        console.warn('  [Hooks] Auth debug report written — login redirect detected');
      }
    } catch { /* non-fatal */ }
  }

  // ── Deep test intelligence embeddings ────────────────────────────────────
  const consoleLogs = this._consoleLogs || this._consoleErrors || [];
  if (consoleLogs.length) {
    try { this.attach('console:' + JSON.stringify(consoleLogs.slice(-100)), 'text/plain'); } catch {}
  }
  const networkLogs = this._networkFailures || [];
  if (networkLogs.length) {
    try { this.attach('network:' + JSON.stringify(networkLogs.slice(-50)), 'text/plain'); } catch {}
  }
  const apiCalls = this._apiCalls || [];
  if (apiCalls.length) {
    try { this.attach('api:' + JSON.stringify(apiCalls.slice(-30)), 'text/plain'); } catch {}
  }

  // Grab video handle before closeBrowser() finalizes the recording (scenario mode only)
  const videoHandle = (sessionMode === 'scenario' && this.page) ? this.page.video() : null;

  // closeBrowser is a no-op in shared mode; closes context in scenario mode
  await this.closeBrowser();

  // Attach video after context.close() finalizes the webm
  if (videoHandle) {
    try {
      const videoPath = await videoHandle.path();
      if (videoPath && fs.existsSync(videoPath)) {
        const videosDir = path.join(process.cwd(), 'reports', 'videos');
        if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
        const slug = scenarioName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase();
        const destName = `${slug}-${Date.now()}.webm`;
        const destPath = path.join(videosDir, destName);
        fs.copyFileSync(videoPath, destPath);
        this.attach(`video:../reports/videos/${destName}`, 'text/plain');
      }
    } catch { /* non-fatal — video capture may be disabled */ }
  }
});

// ─── AfterAll: shared session teardown + session-usage telemetry ──────────────

AfterAll({ timeout: HOOK_TIMEOUT }, async function () {
  if (SESSION_MODE === 'shared') {
    await sharedSessionManager.close();

    const stats = sharedSessionManager.getStats();
    writeReport('session-usage.json', {
      generatedAt:       new Date().toISOString(),
      sessionMode:       SESSION_MODE,
      browserInstances:  stats.browserInstances,
      contextInstances:  stats.contextInstances,
      pageInstances:     stats.pageInstances,
      scenariosExecuted: stats.scenariosExecuted,
      reauthCount:       stats.reauthCount,
      sessionCreatedAt:  stats.sessionCreatedAt,
    });
    console.log('  [SharedSession] session-usage.json written');
  }
});
