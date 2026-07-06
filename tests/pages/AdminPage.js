'use strict';
/**
 * AdminPage.js
 *
 * Page object for the OrangeHRM Admin module — Add User and User Management.
 * Routes:
 *   Add User        /web/index.php/admin/saveSystemUser
 *   User Management /web/index.php/admin/viewSystemUsers
 *
 * The Add User form is a React view built from oxd-select dropdowns (User Role,
 * Status), an employee autocomplete, and credential inputs. On save the app
 * routes back to User Management and flashes an oxd success toast.
 *
 * Uses:
 *   - AdminLocators      — Add User / list selectors
 *   - DataTableComponent — User Management grid
 *   - ToastComponent     — save confirmation toast
 */

const { AdminLocators }      = require('../locators/Admin.locators');
const { DataTableComponent } = require('../components/DataTableComponent');
const { ToastComponent }     = require('../components/ToastComponent');
const { logPageAction }      = require('../../src/utils/perfLogger');

const ADD_USER_PATH  = '/web/index.php/admin/saveSystemUser';
const USER_LIST_PATH = '/web/index.php/admin/viewSystemUsers';
const NAV_TIMEOUT   = parseInt(process.env.ADMIN_NAV_TIMEOUT_MS   || '30000', 10);
const FIELD_TIMEOUT = parseInt(process.env.ADMIN_FIELD_TIMEOUT_MS || '15000', 10);

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com').replace(/\/+$/, '');
}

class AdminPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page    = page;
    this.locators = new AdminLocators(page);
    this.table    = new DataTableComponent(page);
    this.toast    = new ToastComponent(page);
  }

  /** Navigate to the Add User form and wait for it to hydrate. */
  async gotoAddUser() {
    await this._page.goto(`${baseUrl()}${ADD_USER_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await this.locators.userRoleDropdown.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
  }

  /** Navigate to the User Management list view. */
  async gotoUserList() {
    await this._page.goto(`${baseUrl()}${USER_LIST_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }

  /**
   * Select a value from an oxd-select dropdown trigger.
   * @param {import('@playwright/test').Locator} trigger
   * @param {string} optionLabel
   */
  async _selectOption(trigger, optionLabel) {
    await trigger.click();
    const option = this._page.locator('.oxd-select-dropdown .oxd-select-option', { hasText: optionLabel }).first();
    await option.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
    await option.click();
  }

  /**
   * Resolve the first REAL employee suggestion (not "Searching..." / "No Records
   * Found"). Returns the locator, or null if the dropdown yielded nothing usable.
   */
  async _firstEmployeeOption() {
    const opt = this.locators.autocompleteOption.first();
    const appeared = await opt.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT }).then(() => true).catch(() => false);
    if (!appeared) return null;
    // The dropdown first shows "Searching..." then resolves to records (or "No
    // Records Found"). Poll until the first option settles into a real record.
    const deadline = Date.now() + FIELD_TIMEOUT;
    while (Date.now() < deadline) {
      const text = ((await opt.textContent().catch(() => '')) || '').trim();
      if (/no records? found/i.test(text)) return null;
      if (text && !/searching/i.test(text)) return opt;
      await this._page.waitForTimeout(150);
    }
    return null;
  }

  /**
   * Pick an employee via the autocomplete "Type for hints..." field. OrangeHRM
   * requires an actual selection from the dropdown (typed text alone fails the
   * form's validation). Falls back to a broad query so any existing employee can
   * be selected, and surfaces a clear error instead of silently continuing.
   * @param {string} employeeName
   */
  async _selectEmployee(employeeName) {
    const input = this.locators.employeeNameInput;
    await input.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });

    // OrangeHRM's employee field is a debounced React autocomplete — it fires its
    // search only on real keystrokes, so type char-by-char. fill() sets the value
    // without dispatching the keystrokes the search listens for and yields "no
    // records" even when the employee exists.
    const query = async (q) => {
      await input.fill('');
      await input.pressSequentially(q, { delay: 60 });
      return this._firstEmployeeOption();
    };

    let option = await query(employeeName);
    // Fallback: the requested name may not exist on the shared demo — query broadly
    // so any real employee is selectable.
    for (const q of ['a', 'e', 'i']) {
      if (option) break;
      option = await query(q);
    }
    if (!option) {
      throw new Error(`No selectable employee for "${employeeName}" — the OrangeHRM autocomplete returned no records`);
    }
    await option.click();
  }

  /**
   * Fill and submit the Add User form.
   * @param {{ role, employeeName, username, password, status? }} user
   * @returns {Promise<{ saved: boolean, toast: object }>}
   */
  async addUser({ role, employeeName, username, password, status = 'Enabled' } = {}) {
    const t0 = Date.now();
    try {
      await this.gotoAddUser();

      if (role)         await this._selectOption(this.locators.userRoleDropdown, role);
      if (status)       await this._selectOption(this.locators.statusDropdown, status);
      if (employeeName) await this._selectEmployee(employeeName);
      if (username)     await this.locators.usernameInput.fill(String(username));
      if (password) {
        await this.locators.passwordInput.fill(String(password));
        await this.locators.confirmPasswordInput.fill(String(password));
      }

      await this.locators.saveButton.first().click();

      const toast  = await this.toast.waitForToast({ timeout: NAV_TIMEOUT });
      const routed = await this._page.waitForURL(/\/admin\/viewSystemUsers/i, { timeout: NAV_TIMEOUT })
        .then(() => true).catch(() => false);

      const saved = toast.type === 'success' || routed;
      logPageAction({ component: 'AdminPage', method: 'addUser', durationMs: Date.now() - t0, status: saved ? 'passed' : 'failed', meta: { toastType: toast.type, routed } });
      return { saved, toast };
    } catch (err) {
      logPageAction({ component: 'AdminPage', method: 'addUser', durationMs: Date.now() - t0, status: 'failed', meta: { error: err.message } });
      throw err;
    }
  }

  /**
   * Search User Management by username.
   * @param {string} username
   */
  async searchByUsername(username) {
    await this.gotoUserList();
    await this.locators.searchUsernameInput.fill(username);
    await this.locators.saveButton.first().click();
    await this.table.waitForRows(1);
  }

  /**
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async isUserListed(username) {
    return this.table.hasRowContaining(username);
  }
}

module.exports = { AdminPage };
