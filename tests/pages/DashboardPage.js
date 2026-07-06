'use strict';
/**
 * DashboardPage.js
 *
 * Page object for the OrangeHRM Dashboard route (/web/index.php/dashboard/index).
 * The Dashboard is the post-login landing view: a responsive grid of widgets
 * (Time at Work, My Actions, Quick Launch, Employees on Leave Today, …) with the
 * side menu and the topbar user dropdown.
 *
 * Uses:
 *   - SideMenuComponent — left-hand module navigation
 */

const { SideMenuComponent } = require('../components/SideMenuComponent');
const { logPageAction }     = require('../../src/utils/perfLogger');

const READY_TIMEOUT = parseInt(process.env.DASHBOARD_READY_TIMEOUT_MS || '20000', 10);

class DashboardPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page   = page;
    this.menu    = new SideMenuComponent(page);

    this.header          = page.locator('.oxd-topbar-header-breadcrumb-module, .oxd-topbar-header');
    this.userDropdown    = page.locator('.oxd-userdropdown-tab');
    this.userName        = page.locator('.oxd-userdropdown-name');
    this.widgets         = page.locator('.oxd-grid-item, .orangehrm-dashboard-widget');
    this.quickLaunch     = page.locator('.orangehrm-quick-launch');
    this.loadingSpinner  = page.locator('.oxd-loading-spinner');
  }

  /** Wait until the dashboard shell + at least one widget is hydrated. */
  async waitForReady() {
    const t0 = Date.now();
    await this.loadingSpinner.first().waitFor({ state: 'detached', timeout: READY_TIMEOUT }).catch(() => {});
    await this.header.first().waitFor({ state: 'visible', timeout: READY_TIMEOUT }).catch(() => {});
    await this.widgets.first().waitFor({ state: 'visible', timeout: READY_TIMEOUT }).catch(() => {});
    logPageAction({ component: 'DashboardPage', method: 'waitForReady', durationMs: Date.now() - t0, status: 'passed' });
  }

  /** @returns {Promise<boolean>} */
  async isLoaded() {
    return /\/dashboard\b/i.test(this._page.url()) &&
      await this.header.first().isVisible({ timeout: READY_TIMEOUT }).catch(() => false);
  }

  /**
   * Navigate to a module via the side menu.
   * @param {string} moduleName e.g. "PIM", "Admin", "Leave"
   */
  async openModule(moduleName) {
    await this.menu.open(moduleName);
  }

  /** @returns {Promise<string|null>} the signed-in user's display name */
  async getUserName() {
    return this.userName.first().textContent({ timeout: 5000 }).then(t => t?.trim() || null).catch(() => null);
  }

  /** Open the topbar user dropdown and click Logout. */
  async logout() {
    await this.userDropdown.click();
    await this._page.locator('.oxd-dropdown-menu a', { hasText: 'Logout' }).click();
    await this._page.waitForURL(/\/auth\/login\b/i, { timeout: READY_TIMEOUT }).catch(() => {});
  }
}

module.exports = { DashboardPage };
