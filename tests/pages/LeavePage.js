'use strict';
/**
 * LeavePage.js
 *
 * Page object for the OrangeHRM Leave module — Apply Leave and Leave List.
 * Routes:
 *   Apply Leave /web/index.php/leave/applyLeave
 *   Leave List  /web/index.php/leave/viewLeaveList
 *
 * The Apply Leave form is a React view: a Leave Type oxd-select, From/To date
 * pickers, an optional comment, and Apply. Submitting flashes an oxd success
 * toast (or a red toast when no balance is available).
 *
 * Uses:
 *   - DataTableComponent — Leave List grid
 *   - ToastComponent     — apply confirmation toast
 */

const { DataTableComponent } = require('../components/DataTableComponent');
const { ToastComponent }     = require('../components/ToastComponent');
const { logPageAction }      = require('../../src/utils/perfLogger');

const APPLY_LEAVE_PATH = '/web/index.php/leave/applyLeave';
const LEAVE_LIST_PATH  = '/web/index.php/leave/viewLeaveList';
const NAV_TIMEOUT   = parseInt(process.env.LEAVE_NAV_TIMEOUT_MS   || '30000', 10);
const FIELD_TIMEOUT = parseInt(process.env.LEAVE_FIELD_TIMEOUT_MS || '15000', 10);

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com').replace(/\/+$/, '');
}

class LeavePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;
    this.table = new DataTableComponent(page);
    this.toast = new ToastComponent(page);

    this.leaveTypeDropdown = page.locator('.oxd-input-group')
      .filter({ has: page.locator('label', { hasText: 'Leave Type' }) })
      .locator('.oxd-select-text').first();
    this.fromDateInput = page.locator('.oxd-input-group')
      .filter({ has: page.locator('label', { hasText: 'From Date' }) })
      .locator('input').first();
    this.toDateInput = page.locator('.oxd-input-group')
      .filter({ has: page.locator('label', { hasText: 'To Date' }) })
      .locator('input').first();
    this.commentBox  = page.locator('textarea');
    this.applyButton = page.locator('button[type="submit"]');
    this.balanceText = page.locator('.orangehrm-leave-balance-text, .oxd-text--span');
  }

  /** Navigate to the Apply Leave form and wait for it to hydrate. */
  async gotoApplyLeave() {
    await this._page.goto(`${baseUrl()}${APPLY_LEAVE_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await this.leaveTypeDropdown.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT }).catch(() => {});
  }

  /** Navigate to the Leave List view. */
  async gotoLeaveList() {
    await this._page.goto(`${baseUrl()}${LEAVE_LIST_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }

  /**
   * Apply for leave.
   * @param {{ leaveType, fromDate, toDate, comment? }} leave
   * @returns {Promise<{ applied: boolean, toast: object }>}
   */
  async applyLeave({ leaveType, fromDate, toDate, comment } = {}) {
    const t0 = Date.now();
    try {
      await this.gotoApplyLeave();

      if (leaveType) {
        await this.leaveTypeDropdown.click();
        const option = this._page.locator('.oxd-select-dropdown .oxd-select-option', { hasText: leaveType }).first();
        await option.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
        await option.click();
      }
      if (fromDate) { await this.fromDateInput.fill(String(fromDate)); }
      if (toDate)   { await this.toDateInput.fill(String(toDate)); }
      if (comment)  { await this.commentBox.first().fill(String(comment)).catch(() => {}); }

      await this.applyButton.first().click();
      const toast   = await this.toast.waitForToast({ timeout: NAV_TIMEOUT });
      const applied = toast.type === 'success';

      logPageAction({ component: 'LeavePage', method: 'applyLeave', durationMs: Date.now() - t0, status: applied ? 'passed' : 'failed', meta: { toastType: toast.type } });
      return { applied, toast };
    } catch (err) {
      logPageAction({ component: 'LeavePage', method: 'applyLeave', durationMs: Date.now() - t0, status: 'failed', meta: { error: err.message } });
      throw err;
    }
  }

  /** @returns {Promise<number>} rows in the Leave List grid */
  async leaveRecordCount() {
    await this.table.waitForRows(1);
    return this.table.rowCount();
  }
}

module.exports = { LeavePage };
