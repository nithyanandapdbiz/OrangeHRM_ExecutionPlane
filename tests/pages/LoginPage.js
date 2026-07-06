'use strict';
/**
 * LoginPage.js
 *
 * Page object for the OrangeHRM login route (/web/index.php/auth/login).
 * OrangeHRM is a React SPA — after a successful sign-in the client router
 * redirects to the Dashboard without a hard reload.
 *
 * Uses:
 *   - LoginLocators (tests/locators/Login.locators.js) — OrangeHRM auth selectors
 *
 * Credentials come from APP_USERNAME / APP_PASSWORD (defaults Admin / admin123).
 * Values are never printed to logs.
 */

const { LoginLocators }  = require('../locators/Login.locators');
const { logPageAction }  = require('../../src/utils/perfLogger');

const LOGIN_PATH   = '/web/index.php/auth/login';
const NAV_TIMEOUT  = parseInt(process.env.LOGIN_NAV_TIMEOUT_MS  || '30000', 10);
const FIELD_TIMEOUT = parseInt(process.env.LOGIN_FIELD_TIMEOUT_MS || '15000', 10);

class LoginPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page    = page;
    this.locators = new LoginLocators(page);
  }

  /** Base URL of the OrangeHRM app under test. */
  static baseUrl() {
    return (process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com').replace(/\/+$/, '');
  }

  /** Navigate to the login route and wait for the form to hydrate. */
  async goto() {
    const url = `${LoginPage.baseUrl()}${LOGIN_PATH}`;
    await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await this.locators.usernameInput.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
  }

  /**
   * Fill credentials and submit the login form.
   * @param {string} [username] defaults to APP_USERNAME
   * @param {string} [password] defaults to APP_PASSWORD
   */
  async login(username, password) {
    const t0   = Date.now();
    const user = username ?? process.env.APP_USERNAME ?? 'Admin';
    const pass = password ?? process.env.APP_PASSWORD ?? 'admin123';

    try {
      await this.locators.usernameInput.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
      await this.locators.usernameInput.fill(user);
      await this.locators.passwordInput.fill(pass);
      await this.locators.loginButton.click();
      logPageAction({ component: 'LoginPage', method: 'login', durationMs: Date.now() - t0, status: 'passed' });
    } catch (err) {
      logPageAction({ component: 'LoginPage', method: 'login', durationMs: Date.now() - t0, status: 'failed', meta: { error: err.message } });
      throw err;
    }
  }

  /**
   * Wait for the SPA to route to the Dashboard after a successful login.
   * @returns {Promise<boolean>}
   */
  async waitForDashboard() {
    return this._page.waitForURL(/\/dashboard\b/i, { timeout: NAV_TIMEOUT })
      .then(() => true)
      .catch(() => /\/dashboard\b/i.test(this._page.url()));
  }

  /**
   * Return the invalid-credentials banner text, if present.
   * @returns {Promise<string|null>}
   */
  async getAuthError() {
    // The banner renders ~0.5s after submit (async auth round-trip), so WAIT for it.
    // isVisible() ignores its timeout arg and samples the DOM immediately, returning
    // false before the banner has mounted.
    const appeared = await this.locators.authErrorAlert.first()
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!appeared) return null;
    return (await this.locators.authErrorAlert.first().textContent().catch(() => ''))?.trim() || null;
  }

  /**
   * Return per-field "Required" validation messages shown on empty submit.
   * @returns {Promise<string[]>}
   */
  async getFieldErrors() {
    const texts = await this.locators.fieldErrorMessage.allTextContents().catch(() => []);
    return texts.map(t => t.trim()).filter(Boolean);
  }

  /** @returns {boolean} is the browser currently on the login route */
  isOnLoginRoute() {
    return /\/auth\/login\b/i.test(this._page.url());
  }
}

module.exports = { LoginPage };
