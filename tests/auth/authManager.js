'use strict';
/**
 * Auth Manager — OrangeHRM Login Session (storage-state based)
 *
 * OrangeHRM is a React SPA guarded by a form login. To avoid logging in for
 * every scenario, this manager signs in once, captures the browser storage
 * state (session cookie + any local storage), and reuses it across the run.
 *
 * Session validity is checked at two levels:
 *   Passive (isSessionValid):              storage-state file age + session cookie inspection — fast, no browser
 *   Active  (validateAuthenticatedSession): real browser navigation to the app — authoritative
 *
 * All timeouts are configurable via env vars — no hardcoded values remain.
 *
 * Security:
 *   - Credentials (APP_USERNAME / APP_PASSWORD) read from env only; never logged or written to files
 *   - Storage state excluded from git via .gitignore (.auth/)
 *
 * Exit path on irrecoverable auth failure:
 *   Throws AuthenticationRecoveryError — callers should treat as fatal.
 */

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

// ─── Telemetry & diagnostics helpers ─────────────────────────────────────────

const SESSION_METADATA_FILE = process.env.AUTH_SESSION_METADATA_FILE || '.auth/session-metadata.json';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '').replace(/\/+$/, '');
}

function appLoginUrl() {
  const base = appBaseUrl();
  return base ? `${base}/web/index.php/auth/login` : '';
}

function appDashboardUrl() {
  const base = appBaseUrl();
  return base ? `${base}/web/index.php/dashboard/index` : '';
}

function writeSessionTelemetry(entry) {
  const logsDir = path.join(process.cwd(), 'logs');
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(path.join(logsDir, 'auth-session-validation.jsonl'), line, 'utf8');
  } catch { /* non-fatal */ }
}

function readSessionMetadata() {
  try {
    if (!fs.existsSync(SESSION_METADATA_FILE)) return null;
    return JSON.parse(fs.readFileSync(SESSION_METADATA_FILE, 'utf8'));
  } catch { return null; }
}

function writeSessionMetadata(data) {
  const dir = path.dirname(path.resolve(SESSION_METADATA_FILE));
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_METADATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

function writeAuthDebugReport(data) {
  const reportsDir = path.join(process.cwd(), 'reports');
  try {
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportsDir, 'auth-debug-report.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

// ─── AuthenticationRecoveryError ─────────────────────────────────────────────

/**
 * Thrown when session re-authentication fails irrecoverably.
 * exitCode = 4 (distinct from contamination=2 and compliance=3).
 */
class AuthenticationRecoveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name     = 'AuthenticationRecoveryError';
    this.exitCode = 4;
    this.details  = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

const AUTH_STATE_FILE = process.env.AUTH_STATE_FILE || '.auth/storage-state.json';

// OrangeHRM server sessions are relatively short-lived; 30 minutes is a safe
// default window for reuse. Override AUTH_SESSION_MAX_AGE_MS to adjust.
const SESSION_MAX_AGE_MS = parseInt(process.env.AUTH_SESSION_MAX_AGE_MS || String(30 * 60 * 1000), 10);

// Navigation / interaction timeouts — all configurable, no hardcoded values
const T = {
  goto:     () => parseInt(process.env.AUTH_GOTO_TIMEOUT_MS     || '30000', 10),
  element:  () => parseInt(process.env.AUTH_ELEMENT_TIMEOUT_MS  || '20000', 10),
  pwdWait:  () => parseInt(process.env.AUTH_PWD_WAIT_MS         || '15000', 10),
  redirect: () => parseInt(process.env.AUTH_REDIRECT_TIMEOUT_MS || '45000', 10),
};

// ─── Passive validation (fast — no browser) ───────────────────────────────────

/**
 * Returns true when the storage state represents a plausibly-valid OrangeHRM session.
 *
 * Checks (in order):
 *   1. File exists
 *   2. File age < SESSION_MAX_AGE_MS
 *   3. Parses as JSON with a non-empty cookies array
 *   4. At least one cookie for the app host has not expired
 *
 * This is the fast pre-check used in hooks.js (no browser launch).
 */
function isSessionValid(authFile) {
  if (!fs.existsSync(authFile)) return false;
  try {
    const ageMs = Date.now() - fs.statSync(authFile).mtimeMs;
    if (ageMs > SESSION_MAX_AGE_MS) return false;

    const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (!Array.isArray(state.cookies) || state.cookies.length === 0) return false;

    const nowSec = Date.now() / 1000;

    // Prefer cookies whose domain matches the app host; if the host is unknown,
    // accept any live session cookie in the state.
    let appHost = '';
    try { appHost = new URL(appBaseUrl()).hostname; } catch { /* base url not set */ }

    const activeCookies = state.cookies.filter(c => {
      const domain = String(c.domain || '');
      const domainMatches = appHost ? domain.includes(appHost.replace(/^www\./, '')) : true;
      if (!domainMatches) return false;
      if (c.expires === undefined || c.expires === -1) return true; // session cookie
      return c.expires > nowSec;
    });

    return activeCookies.length > 0;
  } catch {
    return false;
  }
}

// ─── Active validation (authoritative — launches a browser) ──────────────────

/**
 * Validates the session by navigating to the app in a temporary context.
 * This is the authoritative check — it detects expired sessions even when the
 * storage-state file appears valid by timestamp/cookie criteria.
 *
 * Returns { valid, reason, redirectUrl, durationMs }
 *
 * NOTE: This launches a browser (5–15s). Call from global-setup or diagnostics,
 *       not from per-scenario Before hooks.
 */
async function validateAuthenticatedSession(authFile) {
  const t0      = Date.now();
  const target  = appDashboardUrl() || appBaseUrl();

  if (!fs.existsSync(authFile)) {
    return { valid: false, reason: 'storage-state file not found', redirectUrl: null, durationMs: 0 };
  }
  if (!target) {
    return { valid: false, reason: 'APP_BASE_URL not configured', redirectUrl: null, durationMs: 0 };
  }

  console.log('  [AuthManager] validateAuthenticatedSession — launching verification browser...');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authFile, ignoreHTTPSErrors: true });
    const page    = await context.newPage();

    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: T.goto() });
    const finalUrl = page.url();
    await context.close();

    const isLoginRedirect = /\/auth\/login\b/i.test(finalUrl);
    const durationMs = Date.now() - t0;

    if (isLoginRedirect) {
      console.log(`  [AuthManager] Active validation: redirected to login (${durationMs}ms)`);
      return { valid: false, reason: `Redirected to login: ${finalUrl}`, redirectUrl: finalUrl, durationMs };
    }

    console.log(`  [AuthManager] Active validation: OrangeHRM session confirmed (${durationMs}ms)`);
    return { valid: true, reason: 'Session active on OrangeHRM', redirectUrl: null, durationMs };
  } finally {
    await browser.close();
  }
}

// ─── OrangeHRM login flow ─────────────────────────────────────────────────────

/**
 * Perform the OrangeHRM form login and capture the storage state.
 * Credentials are read from APP_USERNAME / APP_PASSWORD (safe demo defaults).
 * Credential values are never printed to logs.
 */
async function authenticateOrangeHRM(authFile) {
  const username = process.env.APP_USERNAME || 'Admin';
  const password = process.env.APP_PASSWORD || 'admin123';
  const loginUrl = appLoginUrl();

  if (!loginUrl) {
    throw new Error('APP_BASE_URL must be set for OrangeHRM authentication.');
  }

  const authDir = path.resolve(authFile, '..');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const authHeadless = process.env.PW_AUTH_HEADLESS !== 'false';
  const browser = await chromium.launch({ headless: authHeadless });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();

  try {
    console.log('  [AuthManager] Navigating to OrangeHRM login...');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: T.goto() });

    const usernameField = page.locator('input[name="username"]').first();
    await usernameField.waitFor({ state: 'visible', timeout: T.element() });
    await usernameField.fill(username);

    const passwordField = page.locator('input[name="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: T.pwdWait() });
    await passwordField.fill(password);

    await page.locator('button[type="submit"]').first().click();

    // Wait for the SPA to route to the Dashboard, confirming a valid session.
    await page.waitForURL(/\/dashboard\b/i, { timeout: T.redirect() });
    await page.waitForSelector('.oxd-main-menu, .oxd-topbar-header', { timeout: T.element() }).catch(() => {});

    console.log('  [AuthManager] OrangeHRM authentication successful');
    await context.storageState({ path: authFile });
    console.log(`  [AuthManager] Storage state saved -> ${authFile}`);
  } finally {
    await browser.close();
  }
}

// ─── ensureAuthenticated ──────────────────────────────────────────────────────

/**
 * Lifecycle entry point called from global-setup and hooks.
 *
 * Strategy:
 *   AUTH_MODE != 'storage-state'   → no-op (tests sign in via the UI login step)
 *   isSessionValid() false         → full OrangeHRM login (self-heal)
 *   isSessionValid() true          → reuse without re-auth
 *   AUTH_ACTIVE_VALIDATION=true    → also run validateAuthenticatedSession()
 *
 * Returns telemetry: { authMode, sessionValid, authenticated, reusedSession,
 *                      reauthenticated, activeValidation, durationMs }
 */
async function ensureAuthenticated() {
  const t0       = Date.now();
  const authMode = process.env.AUTH_MODE || 'storage-state';
  const authFile = AUTH_STATE_FILE;

  const telemetry = {
    authMode,
    sessionValid:     false,
    authenticated:    false,
    reusedSession:    false,
    reauthenticated:  false,
    activeValidation: false,
    userId:           null,
    durationMs:       0,
  };

  if (authMode !== 'storage-state') {
    console.log(`  [AuthManager] AUTH_MODE=${authMode} — UI login handled per-scenario, skipping storage-state auth`);
    telemetry.durationMs = Date.now() - t0;
    writeSessionTelemetry({ authMode, validationResult: 'skipped', durationMs: telemetry.durationMs });
    return telemetry;
  }

  // Inspect storage state file for telemetry before the passive check
  let storageStateAge = null;
  let cookieCount = 0;
  try {
    if (fs.existsSync(authFile)) {
      storageStateAge = Date.now() - fs.statSync(authFile).mtimeMs;
      const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      cookieCount = (state.cookies || []).length;
    }
  } catch { /* non-fatal */ }

  const passiveValid = isSessionValid(authFile);
  telemetry.sessionValid = passiveValid;

  if (!passiveValid) {
    const reason = fs.existsSync(authFile) ? 'expired/invalid' : 'missing';
    console.log(`  [AuthManager] Session ${reason} — authenticating... (self-healing)`);
    try {
      if (fs.existsSync(authFile)) fs.unlinkSync(authFile);
      await authenticateOrangeHRM(authFile);
    } catch (authErr) {
      throw new AuthenticationRecoveryError(
        `Authentication failed after session ${reason}: ${authErr.message}`,
        { reason, originalError: authErr.message }
      );
    }
    if (process.env.AUTH_ACTIVE_VALIDATION === 'true') {
      const freshCheck = await validateAuthenticatedSession(authFile);
      if (!freshCheck.valid) {
        throw new AuthenticationRecoveryError(
          `Fresh session validation failed: ${freshCheck.reason}`,
          { reason: freshCheck.reason, redirectUrl: freshCheck.redirectUrl }
        );
      }
    }
    telemetry.sessionValid    = true;
    telemetry.authenticated   = true;
    telemetry.reauthenticated = true;
    telemetry.durationMs      = Date.now() - t0;
    writeSessionTelemetry({
      storageStateLoaded: true, storageStateAge, cookieCount,
      validationResult: 'reauthenticated', durationMs: telemetry.durationMs,
    });
    writeSessionMetadata({
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
      userId: null,
      reauthenticated: true,
    });
    return telemetry;
  }

  // Optional active validation (configurable — off by default for performance)
  if (process.env.AUTH_ACTIVE_VALIDATION === 'true') {
    const liveCheck = await validateAuthenticatedSession(authFile);
    telemetry.activeValidation = true;
    if (!liveCheck.valid) {
      console.log(`  [AuthManager] Active check failed (${liveCheck.reason}) — re-authenticating...`);
      try { if (fs.existsSync(authFile)) fs.unlinkSync(authFile); } catch { /* ignore */ }
      try {
        await authenticateOrangeHRM(authFile);
      } catch (authErr) {
        throw new AuthenticationRecoveryError(
          `Re-authentication failed after active check rejected session: ${authErr.message}`,
          { reason: liveCheck.reason, originalError: authErr.message }
        );
      }
      const reValidate = await validateAuthenticatedSession(authFile);
      if (!reValidate.valid) {
        throw new AuthenticationRecoveryError(
          `Re-authenticated session still invalid: ${reValidate.reason}`,
          { reason: reValidate.reason }
        );
      }
      telemetry.sessionValid    = true;
      telemetry.reauthenticated = true;
    } else {
      console.log('  [AuthManager] Active check passed — session live on OrangeHRM');
      telemetry.reusedSession = true;
    }
    telemetry.authenticated = true;
  } else {
    console.log(`  [AuthManager] Reusing existing session (${authFile})`);
    telemetry.authenticated = true;
    telemetry.reusedSession = true;
    writeSessionTelemetry({
      storageStateLoaded: fs.existsSync(authFile), storageStateAge, cookieCount,
      validationResult: 'reused', durationMs: Date.now() - t0,
    });
    writeSessionMetadata({
      authenticatedAt: new Date(Date.now() - (storageStateAge || 0)).toISOString(),
      expiresAt: new Date(Date.now() + (SESSION_MAX_AGE_MS - (storageStateAge || 0))).toISOString(),
      userId: null,
      reauthenticated: false,
    });
  }

  telemetry.durationMs = Date.now() - t0;
  return telemetry;
}

module.exports = {
  AuthenticationRecoveryError,
  ensureAuthenticated,
  isSessionValid,
  validateAuthenticatedSession,
  writeSessionTelemetry,
  readSessionMetadata,
  writeSessionMetadata,
  writeAuthDebugReport,
  AUTH_STATE_FILE,
  SESSION_METADATA_FILE,
};
