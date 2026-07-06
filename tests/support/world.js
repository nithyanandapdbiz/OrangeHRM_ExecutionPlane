'use strict';
require('dotenv').config();
/**
 * Playwright World for @cucumber/cucumber
 *
 * Provides `this.page` (and `this.browser`, `this.context`) to every step
 * definition and Before/After hook. The browser is launched and closed by the
 * global hooks in hooks.js — this file only defines the shape.
 *
 * newContext() loads the OrangeHRM storage state (when present) so scenarios
 * start with an authenticated SPA session and skip the per-scenario login.
 *
 * SESSION_MODE=shared: openBrowser() reuses the single browser/context/page
 * managed by sharedSessionManager.js; closeBrowser() is a no-op.
 */
const { setWorldConstructor, World, setDefaultTimeout } = require('@cucumber/cucumber');
const { chromium }                                      = require('@playwright/test');
const sharedSessionManager                              = require('../runtime/sharedSessionManager');
const fs                                                = require('fs');
const path                                              = require('path');

// OrangeHRM REST calls (used only for lightweight telemetry, never assertions)
const API_PATTERN = /\/api\/v\d|\/web\/index\.php\/api\//i;

const _defaultTimeoutMs = parseInt(process.env.CUCUMBER_DEFAULT_TIMEOUT_MS || process.env.CUCUMBER_STEP_TIMEOUT_MS || '120000', 10);
const _hookTimeoutMs    = parseInt(process.env.CUCUMBER_HOOK_TIMEOUT_MS    || '120000', 10);
setDefaultTimeout(_defaultTimeoutMs);
console.log('[Cucumber]');
console.log(`Default timeout = ${_defaultTimeoutMs}ms`);
console.log(`Hook timeout    = ${_hookTimeoutMs}ms`);

class PlaywrightWorld extends World {
  constructor(options) {
    super(options);
    this.browser           = null;
    this.context           = null;
    this.page              = null;
    this._consoleErrors    = [];
    this._networkFailures  = [];
    this._consoleLogs      = [];   // all console types (info/warn/error/log) for intelligence report
    this._apiCalls         = [];   // OrangeHRM API request/response pairs for intelligence report
    // Named listener references — required so shared-mode can remove them between scenarios
    this._consoleListener  = null;
    this._networkListener  = null;
    this._apiListener      = null;
  }

  async openBrowser() {
    const sessionMode = process.env.SESSION_MODE || 'shared';
    const headless    = process.env.PW_HEADLESS !== 'false';
    const authMode    = process.env.AUTH_MODE || 'storage-state';
    const authFile    = process.env.AUTH_STATE_FILE || '.auth/storage-state.json';
    const baseURL     = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'http://localhost';

    // ── Shared mode — reuse global browser / context / page ─────────────────
    if (sessionMode === 'shared' && sharedSessionManager.isInitialized()) {
      // Remove any per-scenario listeners from the previous scenario to avoid accumulation
      if (this._consoleListener && this.page) {
        try { this.page.off('console', this._consoleListener); } catch {}
      }
      if (this._networkListener && this.page) {
        try { this.page.off('requestfailed', this._networkListener); } catch {}
      }
      if (this._apiListener && this.page) {
        try { this.page.off('response', this._apiListener); } catch {}
      }

      this.browser = sharedSessionManager.getBrowser();
      this.context = sharedSessionManager.getContext();
      this.page    = sharedSessionManager.getPage();

      // Reset per-scenario collections
      this._consoleErrors   = [];
      this._networkFailures = [];
      this._consoleLogs     = [];
      this._apiCalls        = [];

      // Set up fresh named listeners for this scenario
      this._consoleListener = msg => {
        const entry = { time: new Date().toISOString(), type: msg.type(), text: msg.text() };
        this._consoleLogs.push(entry);
        if (msg.type() === 'error') this._consoleErrors.push(entry);
      };
      this._apiListener = res => {
        try {
          const url = res.url();
          if (!API_PATTERN.test(url)) return;
          this._apiCalls.push({
            time: new Date().toISOString(), method: res.request().method(),
            url: url.slice(0, 300), status: res.status(), ok: res.ok()
          });
        } catch {}
      };
      this.page.on('response', this._apiListener);
      this._networkListener = req => {
        this._networkFailures.push({ url: req.url(), failure: req.failure()?.errorText || 'unknown' });
      };
      this.page.on('console',      this._consoleListener);
      this.page.on('requestfailed', this._networkListener);

      sharedSessionManager.incrementScenarios();
      console.log('  [SharedSession] Reusing global page');
      return;
    }

    this._consoleErrors   = [];
    this._networkFailures = [];
    this._consoleLogs     = [];
    this._apiCalls        = [];

    const contextOpts = {
      baseURL,
      viewport: { width: 1280, height: 720 },
    };

    if (authMode === 'storage-state' && fs.existsSync(authFile)) {
      contextOpts.storageState = authFile;
    }
    if (process.env.CAPTURE_VIDEO !== 'false') {
      const videoDir = path.join(process.cwd(), '.videos', 'cucumber');
      if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
      contextOpts.recordVideo = { dir: videoDir };
    }

    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext(contextOpts);
    this.page    = await this.context.newPage();

    this.page.on('console', msg => {
      const e = { time: new Date().toISOString(), type: msg.type(), text: msg.text() };
      this._consoleLogs.push(e);
      if (msg.type() === 'error') this._consoleErrors.push(e);
    });
    this.page.on('requestfailed', req => {
      this._networkFailures.push({ url: req.url(), failure: req.failure()?.errorText || 'unknown' });
    });
    this.page.on('response', res => {
      try {
        if (!API_PATTERN.test(res.url())) return;
        this._apiCalls.push({ time: new Date().toISOString(), method: res.request().method(), url: res.url().slice(0, 300), status: res.status(), ok: res.ok() });
      } catch {}
    });
  }

  /**
   * Open a dedicated UNAUTHENTICATED context for login-form scenarios (@auth).
   * The shared session is authenticated, so /auth/login would redirect to the
   * dashboard and the real login form would never render. A fresh context (no
   * storageState) restores it. Reuses the shared browser process but an isolated
   * context so the shared session is never disturbed.
   */
  async openFreshLoginContext() {
    const baseURL  = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'http://localhost';
    const headless = process.env.PW_HEADLESS !== 'false';
    const shared   = (process.env.SESSION_MODE || 'shared') === 'shared' && sharedSessionManager.isInitialized();

    this._freshBrowser     = shared ? sharedSessionManager.getBrowser() : await chromium.launch({ headless });
    this._freshOwnsBrowser = !shared;
    this._freshContext     = await this._freshBrowser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    this._freshPage        = await this._freshContext.newPage();

    // Point the world at the fresh, logged-out page for this scenario.
    this.browser = this._freshBrowser;
    this.context = this._freshContext;
    this.page    = this._freshPage;

    // Fresh diagnostics collections + listeners (for autopsy on failure).
    this._consoleErrors = []; this._networkFailures = []; this._consoleLogs = []; this._apiCalls = [];
    this.page.on('console', msg => {
      const e = { time: new Date().toISOString(), type: msg.type(), text: msg.text() };
      this._consoleLogs.push(e); if (msg.type() === 'error') this._consoleErrors.push(e);
    });
    this.page.on('requestfailed', req => {
      this._networkFailures.push({ url: req.url(), failure: req.failure()?.errorText || 'unknown' });
    });
  }

  /** Close the fresh login context (and its browser if we launched one). */
  async closeFreshLoginContext() {
    try { if (this._freshContext) await this._freshContext.close(); } catch { /* non-fatal */ }
    try { if (this._freshOwnsBrowser && this._freshBrowser) await this._freshBrowser.close(); } catch { /* non-fatal */ }
    this._freshContext = this._freshPage = this._freshBrowser = null;
    this._freshOwnsBrowser = false;
  }

  async closeBrowser() {
    const sessionMode = process.env.SESSION_MODE || 'shared';

    // ── Shared mode — AfterAll owns the lifecycle, not individual scenarios ──
    if (sessionMode === 'shared' && sharedSessionManager.isInitialized()) {
      if (this._consoleListener && this.page) {
        try { this.page.off('console', this._consoleListener); } catch {}
      }
      if (this._networkListener && this.page) {
        try { this.page.off('requestfailed', this._networkListener); } catch {}
      }
      if (this._apiListener && this.page) {
        try { this.page.off('response', this._apiListener); } catch {}
      }
      this._consoleListener = null;
      this._networkListener = null;
      this._apiListener     = null;
      // Null refs without closing — AfterAll closes the shared session
      this.page = this.context = this.browser = null;
      return;
    }

    if (this.context) await this.context.close().catch(() => {});
    if (this.browser && this.browser !== this.context) await this.browser.close().catch(() => {});
    this.page = this.context = this.browser = null;
  }
}

setWorldConstructor(PlaywrightWorld);
