'use strict';
/**
 * SideMenuComponent.js
 *
 * OrangeHRM left-hand navigation (the `.oxd-sidepanel` main menu).
 * Every top-level module (Admin, PIM, Leave, Time, Recruitment, My Info,
 * Performance, Dashboard, Directory, Maintenance, Claim, Buzz) renders as an
 * `.oxd-main-menu-item`. This component encapsulates React SPA navigation via
 * client-side routing — clicking a menu item swaps the route without a full
 * page reload.
 *
 * Methods:
 *   open(moduleName)        → click a top-level menu item
 *   isActive(moduleName)    → boolean — is the module the current active route
 *   search(term)            → filter the menu via the search box
 *   listModules()           → string[] of visible module names
 */

const { logPageAction } = require('../../src/utils/perfLogger');

const NAV_TIMEOUT = parseInt(process.env.MENU_NAV_TIMEOUT_MS || '15000', 10);

class SideMenuComponent {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;
    this.menuItems  = page.locator('.oxd-main-menu-item');
    this.searchBox  = page.locator('.oxd-main-menu-search input, input[placeholder="Search"]');
  }

  /**
   * Navigate to a module by its visible menu label (e.g. "PIM", "Admin").
   * @param {string} moduleName
   */
  async open(moduleName) {
    const t0 = Date.now();
    try {
      const item = this._page.locator('.oxd-main-menu-item', { hasText: moduleName }).first();
      await item.waitFor({ state: 'visible', timeout: NAV_TIMEOUT });
      await item.click();
      // Client-side route change — wait for the topbar to reflect the new module
      await this._page.locator('.oxd-topbar-header-breadcrumb, .oxd-topbar-header')
                       .first()
                       .waitFor({ state: 'visible', timeout: NAV_TIMEOUT })
                       .catch(() => {});
      logPageAction({ component: 'SideMenuComponent', method: 'open', durationMs: Date.now() - t0, status: 'passed', meta: { moduleName } });
    } catch (err) {
      logPageAction({ component: 'SideMenuComponent', method: 'open', durationMs: Date.now() - t0, status: 'failed', meta: { moduleName, error: err.message } });
      throw err;
    }
  }

  /**
   * @param {string} moduleName
   * @returns {Promise<boolean>}
   */
  async isActive(moduleName) {
    const active = this._page.locator('.oxd-main-menu-item--active', { hasText: moduleName });
    return active.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Filter the side menu using its search box.
   * @param {string} term
   */
  async search(term) {
    await this.searchBox.fill(term);
    await this._page.waitForTimeout(300);
  }

  /** @returns {Promise<string[]>} visible module labels */
  async listModules() {
    const texts = await this.menuItems.allTextContents().catch(() => []);
    return texts.map(t => t.trim()).filter(Boolean);
  }
}

module.exports = { SideMenuComponent };
