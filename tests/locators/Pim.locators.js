'use strict';
// =============================================================================
// Locators     : PimLocators
// Module       : PIM — Add Employee  (/web/index.php/pim/addEmployee)
// App          : OrangeHRM (React SPA)
// Strategy     : name attributes where present → oxd input-group by label fallback
// =============================================================================

class PimLocators {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;

    // ── Add Employee form fields ──────────────────────────────────────────────
    // OrangeHRM exposes the personal-detail name fields via name attributes.
    this.firstNameInput  = page.locator('input[name="firstName"]');
    this.middleNameInput = page.locator('input[name="middleName"]');
    this.lastNameInput   = page.locator('input[name="lastName"]');

    // Employee Id sits inside an oxd input-group with no name attribute — resolve
    // it by the label text of its containing row.
    this.employeeIdInput = this.inputByLabel('Employee Id');

    // Optional "Create Login Details" toggle + credential fields
    this.createLoginToggle   = page.locator('.oxd-switch-input');
    this.usernameInput       = this.inputByLabel('Username');
    this.passwordInput       = page.locator('input[type="password"]').first();
    this.confirmPasswordInput = page.locator('input[type="password"]').nth(1);

    // ── Actions ───────────────────────────────────────────────────────────────
    this.saveButton = page.locator('button[type="submit"]');

    // ── Employee list / search (PIM > Employee List) ─────────────────────────
    this.searchNameInput = this.inputByLabel('Employee Name');
    this.searchButton    = page.locator('button[type="submit"]');
    this.tableCards      = page.locator('.oxd-table-card');
    this.tableRows       = page.locator('.oxd-table-body .oxd-table-row');
    this.noRecordsFound  = page.locator('.oxd-text', { hasText: 'No Records Found' });

    // ── Personal Details heading (confirms the record saved & navigated) ─────
    this.personalDetailsHeading = page.locator('.orangehrm-main-title, .oxd-text--h6', { hasText: 'Personal Details' });
  }

  /**
   * Resolve the fillable `.oxd-input` inside the oxd input-group whose label
   * text matches `label`. This mirrors how OrangeHRM renders form rows:
   *   .oxd-input-group > label + .oxd-input.
   *
   * @param {string} label
   * @returns {import('@playwright/test').Locator}
   */
  inputByLabel(label) {
    return this._page
      .locator('.oxd-input-group')
      .filter({ has: this._page.locator('label', { hasText: label }) })
      .locator('input')
      .first();
  }
}

module.exports = { PimLocators };
