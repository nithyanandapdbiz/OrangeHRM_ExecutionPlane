'use strict';
/**
 * PimPage.js
 *
 * Page object for the OrangeHRM PIM module — Add Employee and Employee List.
 * Routes:
 *   Add Employee  /web/index.php/pim/addEmployee
 *   Employee List /web/index.php/pim/viewEmployeeList
 *
 * PIM is a React SPA view: the Add Employee form hydrates client-side, and on
 * save the router advances to the new employee's Personal Details tab and the
 * app flashes an oxd success toast.
 *
 * Uses:
 *   - PimLocators        — Add Employee / list selectors
 *   - DataTableComponent — Employee List grid
 *   - ToastComponent     — save confirmation toast
 */

const { PimLocators }        = require('../locators/Pim.locators');
const { DataTableComponent } = require('../components/DataTableComponent');
const { ToastComponent }     = require('../components/ToastComponent');
const { logPageAction }      = require('../../src/utils/perfLogger');

const ADD_EMPLOYEE_PATH   = '/web/index.php/pim/addEmployee';
const EMPLOYEE_LIST_PATH  = '/web/index.php/pim/viewEmployeeList';
const NAV_TIMEOUT   = parseInt(process.env.PIM_NAV_TIMEOUT_MS   || '30000', 10);
const FIELD_TIMEOUT = parseInt(process.env.PIM_FIELD_TIMEOUT_MS || '15000', 10);

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com').replace(/\/+$/, '');
}

class PimPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page    = page;
    this.locators = new PimLocators(page);
    this.table    = new DataTableComponent(page);
    this.toast    = new ToastComponent(page);
  }

  /** Navigate to the Add Employee form and wait for it to hydrate. */
  async gotoAddEmployee() {
    await this._page.goto(`${baseUrl()}${ADD_EMPLOYEE_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await this.locators.firstNameInput.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
  }

  /** Navigate to the Employee List view. */
  async gotoEmployeeList() {
    await this._page.goto(`${baseUrl()}${EMPLOYEE_LIST_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await this.locators.searchNameInput.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT }).catch(() => {});
  }

  /**
   * Fill the Add Employee form. Only provided fields are filled.
   * @param {{ firstName?, middleName?, lastName?, employeeId? }} fields
   */
  async fillEmployee({ firstName, middleName, lastName, employeeId } = {}) {
    const t0 = Date.now();
    try {
      if (firstName  !== undefined) await this.locators.firstNameInput.fill(String(firstName));
      if (middleName !== undefined) await this.locators.middleNameInput.fill(String(middleName));
      if (lastName   !== undefined) await this.locators.lastNameInput.fill(String(lastName));
      if (employeeId !== undefined) {
        await this.locators.employeeIdInput.fill('');
        await this.locators.employeeIdInput.fill(String(employeeId));
      }
      logPageAction({ component: 'PimPage', method: 'fillEmployee', durationMs: Date.now() - t0, status: 'passed' });
    } catch (err) {
      logPageAction({ component: 'PimPage', method: 'fillEmployee', durationMs: Date.now() - t0, status: 'failed', meta: { error: err.message } });
      throw err;
    }
  }

  /**
   * Convenience: navigate, fill and save a new employee.
   * @param {{ firstName, lastName, middleName?, employeeId? }} employee
   * @returns {Promise<{ saved: boolean, toast: object }>}
   */
  async addEmployee(employee) {
    await this.gotoAddEmployee();
    await this.fillEmployee(employee);
    return this.save();
  }

  /**
   * Submit the Add Employee form and wait for the success signal.
   * Success = an oxd success toast OR the SPA routing to Personal Details.
   * @returns {Promise<{ saved: boolean, toast: object }>}
   */
  async save() {
    const t0 = Date.now();
    try {
      await this.locators.saveButton.first().click();

      const toast   = await this.toast.waitForToast({ timeout: NAV_TIMEOUT });
      const routed  = await this._page.waitForURL(/\/pim\/viewPersonalDetails|\/pim\/viewEmployee/i, { timeout: NAV_TIMEOUT })
        .then(() => true).catch(() => false);

      const saved = toast.type === 'success' || routed;
      logPageAction({ component: 'PimPage', method: 'save', durationMs: Date.now() - t0, status: saved ? 'passed' : 'failed', meta: { toastType: toast.type, routed } });
      return { saved, toast };
    } catch (err) {
      logPageAction({ component: 'PimPage', method: 'save', durationMs: Date.now() - t0, status: 'failed', meta: { error: err.message } });
      throw err;
    }
  }

  /**
   * Search the Employee List by (partial) name.
   * @param {string} name
   */
  async searchByName(name) {
    await this.locators.searchNameInput.fill(name);
    await this.locators.searchButton.first().click();
    await this.table.waitForRows(1);
  }

  /**
   * @param {string} text employee name / id fragment
   * @returns {Promise<boolean>} whether a matching row is present
   */
  async isEmployeeListed(text) {
    return this.table.hasRowContaining(text);
  }
}

module.exports = { PimPage };
