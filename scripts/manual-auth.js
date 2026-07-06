'use strict';
/**
 * manual-auth.js — OrangeHRM login & session helper (visible browser)
 *
 * Establishes an authenticated OrangeHRM session for the tests to reuse. Useful
 * when you want to log in once (and clear any first-run dialogs) and then run the
 * suite against a warm session instead of re-authenticating on every scenario.
 *
 *   node scripts/manual-auth.js
 *
 * Modes (set AUTH_MODE in .env or env var):
 *
 *   AUTH_MODE=storage-state (default):
 *     Opens a visible Chromium, logs into the OrangeHRM React SPA with
 *     APP_USERNAME / APP_PASSWORD, waits for the Dashboard to render, then saves
 *     the session (cookies + localStorage) to .auth/storage-state.json for the
 *     Playwright projects to load via `storageState`.
 *
 *   AUTH_MODE=cdp:
 *     Launches Chrome with --remote-debugging-port so tests can attach to the
 *     already-authenticated browser over CDP. The browser stays OPEN; run tests
 *     in another terminal, then Ctrl+C this script when done.
 *
 * OrangeHRM demo defaults (safe): APP_USERNAME=Admin, APP_PASSWORD=admin123,
 * APP_BASE_URL=https://opensource-demo.orangehrmlive.com
 */

require('dotenv').config();

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL  = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com';
const USERNAME  = process.env.APP_USERNAME || 'Admin';
const PASSWORD  = process.env.APP_PASSWORD || 'admin123';
const AUTH_MODE = process.env.AUTH_MODE || 'storage-state';
const CDP_PORT  = parseInt(process.env.CDP_DEBUG_PORT || '9222', 10);
const LOGIN_PATH = process.env.APP_LOGIN_PATH || '/web/index.php/auth/login';

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('[manual-auth] Missing APP_BASE_URL, APP_USERNAME, or APP_PASSWORD in .env');
  process.exit(1);
}

const AUTH_FILE      = path.resolve(process.env.AUTH_STATE_FILE    || '.auth/storage-state.json');
const CHROME_PROFILE = path.resolve(process.env.AUTH_CHROME_PROFILE || '.auth/chrome-profile');

const loginUrl = () => new URL(LOGIN_PATH, BASE_URL).toString();

// Perform the OrangeHRM login form flow on a page and wait for the Dashboard.
async function login(page) {
  console.log('[manual-auth] Navigating to OrangeHRM login…');
  await page.goto(loginUrl(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

  const userField = page.locator('input[name="username"]').first();
  const userVisible = await userField.isVisible({ timeout: 15000 }).catch(() => false);
  if (userVisible) {
    await userField.fill(USERNAME);
    await page.locator('input[name="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click().catch(() => {});
  } else {
    console.log('[manual-auth] Login form not detected — session may already be active.');
  }

  // Wait for the SPA to settle on the Dashboard (spinner gone, main menu rendered).
  const ready = await waitForDashboard(page, Date.now() + 120000);
  if (!ready) throw new Error(`OrangeHRM dashboard not detected. Final URL: ${page.url()}`);
  // Let the loading spinner clear and the dashboard hydrate.
  await page.locator('.oxd-loading-spinner').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function waitForDashboard(page, deadline) {
  let lastUrl = '';
  while (Date.now() < deadline) {
    const url = page.url();
    if (url !== lastUrl) {
      console.log('[manual-auth] URL:', url.substring(0, 90));
      lastUrl = url;
    }
    if (/\/dashboard/i.test(url)) {
      const menuVisible = await page.locator('.oxd-main-menu-item').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (menuVisible) return true;
    }
    // Topbar renders on every authenticated OrangeHRM page.
    const topbar = await page.locator('.oxd-topbar-header').first().isVisible({ timeout: 1000 }).catch(() => false);
    if (topbar) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

function writeSessionMetadata(extra = {}) {
  const SESSION_MAX_AGE_MS = 55 * 60 * 1000;
  const now = new Date().toISOString();
  fs.writeFileSync(path.resolve('.auth/session-metadata.json'), JSON.stringify({
    authenticatedAt: now,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
    manualAuthAt: now,
    appBaseUrl: BASE_URL,
    userId: USERNAME,
    reauthenticated: true,
    ...extra,
  }, null, 2), 'utf8');
}

(async () => {
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  if (!fs.existsSync(CHROME_PROFILE)) fs.mkdirSync(CHROME_PROFILE, { recursive: true });

  if (AUTH_MODE === 'cdp') {
    // ── CDP mode: launch Chrome with remote debugging port, keep alive ────────
    console.log(`[manual-auth] Mode: cdp (port ${CDP_PORT})`);
    console.log('[manual-auth] Keep this script running while tests execute.\n');

    const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
      headless: false,
      args: [`--remote-debugging-port=${CDP_PORT}`],
      ignoreHTTPSErrors: true,
    });
    const page = context.pages()[0] || await context.newPage();

    await login(page);

    console.log('\n[manual-auth] ✅ OrangeHRM session ready. In another terminal, run:');
    console.log(`  AUTH_MODE=cdp npm run e2e\n`);
    console.log('[manual-auth] Press Ctrl+C here when tests are done.\n');

    const cdpReadyFile = path.resolve('.auth/cdp-ready.json');
    fs.writeFileSync(cdpReadyFile, JSON.stringify({
      port: CDP_PORT,
      url: `http://localhost:${CDP_PORT}`,
      readyAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    console.log(`[manual-auth] CDP info written → ${cdpReadyFile}`);

    writeSessionMetadata({ cdpPort: CDP_PORT });

    await new Promise(resolve => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });

    fs.rmSync(cdpReadyFile, { force: true });
    await context.close();
    console.log('\n[manual-auth] Browser closed.');

  } else {
    // ── storage-state mode ────────────────────────────────────────────────────
    console.log('[manual-auth] Mode: storage-state');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    await login(page);
    await context.storageState({ path: AUTH_FILE });
    writeSessionMetadata();

    console.log(`\n[manual-auth] ✅ Session saved → ${AUTH_FILE}`);
    await browser.close();
  }
})().catch(err => {
  console.error('[manual-auth] Failed:', err.message);
  process.exit(1);
});
