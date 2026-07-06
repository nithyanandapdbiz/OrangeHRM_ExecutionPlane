'use strict';
// =============================================================================
// Locators     : AdminLocators
// Module       : Admin — Add User  (/web/index.php/admin/saveSystemUser)
// App          : OrangeHRM (React SPA)
// Strategy     : oxd component classes + input-group-by-label resolution
// =============================================================================

class AdminLocators {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;

    // ── Add User form — dropdowns are oxd-select components ───────────────────
    this.userRoleDropdown = this.selectByLabel('User Role');
    this.statusDropdown   = this.selectByLabel('Status');

    // Employee Name is an autocomplete text field
    this.employeeNameInput = page.locator('input[placeholder="Type for hints..."]');
    this.autocompleteOption = page.locator('.oxd-autocomplete-option');

    // Credential fields
    this.usernameInput        = this.inputByLabel('Username');
    this.passwordInput        = page.locator('input[type="password"]').first();
    this.confirmPasswordInput = page.locator('input[type="password"]').nth(1);

    // ── Actions ───────────────────────────────────────────────────────────────
    this.saveButton   = page.locator('button[type="submit"]');
    this.cancelButton = page.locator('button.oxd-button--ghost', { hasText: 'Cancel' });

    // ── User Management list + search ────────────────────────────────────────
    this.searchUsernameInput = this.inputByLabel('Username');
    this.tableCards          = page.locator('.oxd-table-card');
    this.tableRows           = page.locator('.oxd-table-body .oxd-table-row');
    this.noRecordsFound      = page.locator('.oxd-text', { hasText: 'No Records Found' });

    // ── Dropdown option list (shared by oxd-select components) ───────────────
    this.dropdownOptions = page.locator('.oxd-select-dropdown .oxd-select-option');
  }

  /**
   * Resolve the `.oxd-input` inside the oxd input-group matching `label`.
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

  /**
   * Resolve the `.oxd-select-text` (dropdown trigger) inside the input-group
   * matching `label`.
   * @param {string} label
   * @returns {import('@playwright/test').Locator}
   */
  selectByLabel(label) {
    return this._page
      .locator('.oxd-input-group')
      .filter({ has: this._page.locator('label', { hasText: label }) })
      .locator('.oxd-select-text')
      .first();
  }
}

module.exports = { AdminLocators };
