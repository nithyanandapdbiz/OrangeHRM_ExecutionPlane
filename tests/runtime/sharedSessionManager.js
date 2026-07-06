'use strict';
/**
 * sharedSessionManager.js — WI-040A
 *
 * Manages a single browser / context / page instance that is shared across all
 * scenarios in a test run (SESSION_MODE=shared).  The BeforeAll hook calls
 * launchBrowser() once; every scenario attaches to the same page via openBrowser()
 * in world.js; AfterAll calls close() to tear down cleanly.
 *
 * Lifecycle:
 *   BeforeAll  →  launchBrowser()    (creates browser + context + page once)
 *   Scenario N →  getBrowser/Context/getPage()  (each scenario reuses them)
 *   AfterAll   →  close()            (closes page → context → browser)
 */

require('dotenv').config();

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

let _browser = null;
let _context = null;
let _page    = null;

const _stats = {
  sessionMode:       'shared',
  browserInstances:  0,
  contextInstances:  0,
  pageInstances:     0,
  scenariosExecuted: 0,
  reauthCount:       0,
  sessionCreatedAt:  null,
};

/**
 * Launch the shared browser, context, and page.
 * Idempotent — returns existing instances if already initialised.
 *
 * @param {{ headless?: boolean, authFile?: string, baseURL?: string, viewport?: object }} opts
 */
// Remember the options the shared context was launched with so reloadStorageState()
// can rebuild an identical context (only the storage-state file differs).
let _launchOpts = {};

function buildContextOpts(authFile) {
  const ctxOpts = {
    baseURL:           _launchOpts.baseURL || process.env.TEST_BASE_URL || process.env.APP_BASE_URL || 'http://localhost',
    viewport:          _launchOpts.viewport || { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  };
  if (authFile && fs.existsSync(authFile)) {
    ctxOpts.storageState = authFile;
  }
  if (process.env.CAPTURE_VIDEO !== 'false') {
    const videoDir = path.join(process.cwd(), '.videos', 'cucumber');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    ctxOpts.recordVideo = { dir: videoDir };
  }
  return ctxOpts;
}

async function launchBrowser({ headless = true, authFile, baseURL, viewport } = {}) {
  if (_browser !== null) return { browser: _browser, context: _context, page: _page };

  _browser = await chromium.launch({
    headless,
    args: headless ? [] : ['--disable-blink-features=AutomationControlled'],
  });
  _stats.browserInstances++;
  console.log('  [SharedSession] Browser created');

  _launchOpts = { headless, baseURL, viewport, authFile };
  _context = await _browser.newContext(buildContextOpts(authFile));
  _stats.contextInstances++;
  console.log('  [SharedSession] Context created');

  _page = await _context.newPage();
  _stats.pageInstances++;
  _stats.sessionCreatedAt = new Date().toISOString();
  console.log('  [SharedSession] Page created');

  return { browser: _browser, context: _context, page: _page };
}

/**
 * Rebuild the shared context/page from a freshly written storage-state file.
 * Used by the mid-run re-auth recovery (shared.steps.js): without this the shared
 * context keeps the expired cookies and every scenario keeps redirecting to login.
 * The browser instance is preserved; only context + page are recreated.
 *
 * @param {string} authFile  path to the fresh .auth/storage-state.json
 * @returns {Promise<{context, page}>}
 */
async function reloadStorageState(authFile) {
  if (_browser === null) {
    throw new Error('reloadStorageState() called before launchBrowser()');
  }
  const file = authFile || _launchOpts.authFile;
  try { if (_page && !_page.isClosed()) await _page.close(); } catch { /* ignore */ }
  try { if (_context) await _context.close(); } catch { /* ignore */ }

  _context = await _browser.newContext(buildContextOpts(file));
  _stats.contextInstances++;
  _page = await _context.newPage();
  _stats.pageInstances++;
  _stats.reauthCount++;
  console.log('  [SharedSession] Context reloaded with fresh storage state');
  return { context: _context, page: _page };
}

/**
 * Returns true when the shared session is fully initialised and the page is open.
 */
function isInitialized() {
  if (!_browser || !_context || !_page) return false;
  try { return !_page.isClosed(); } catch { return false; }
}

function getBrowser()  { return _browser; }
function getContext()  { return _context; }
function getPage()     { return _page; }

function incrementScenarios() { _stats.scenariosExecuted++; }
function incrementReauths()   { _stats.reauthCount++; }

/** Returns a shallow copy of runtime stats. */
function getStats() { return { ..._stats }; }

/**
 * Close the shared session in order: page → context → browser.
 * Called once in AfterAll.
 */
async function close() {
  try { if (_page && !_page.isClosed()) await _page.close(); } catch {}
  console.log('  [SharedSession] Page closed');
  try { if (_context) await _context.close(); } catch {}
  console.log('  [SharedSession] Context closed');
  try { if (_browser) await _browser.close(); } catch {}
  console.log('  [SharedSession] Browser closed');
  _browser = null;
  _context = null;
  _page    = null;
}

/** Reset internal state (test helper — not for production use). */
function reset() {
  _browser = null;
  _context = null;
  _page    = null;
}

module.exports = {
  launchBrowser,
  reloadStorageState,
  isInitialized,
  getBrowser,
  getContext,
  getPage,
  incrementScenarios,
  incrementReauths,
  getStats,
  close,
  reset,
};
