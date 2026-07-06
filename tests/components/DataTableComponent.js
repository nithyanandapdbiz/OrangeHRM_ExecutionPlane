'use strict';
/**
 * DataTableComponent.js
 *
 * OrangeHRM data grid (the `.oxd-table` used across Employee List, User
 * Management, Leave List, etc.). Rows render as `.oxd-table-card`. This
 * component provides read/search helpers over that grid.
 *
 * Methods:
 *   rowCount()                 → number of rendered row cards
 *   getCellTexts(rowIndex)     → string[] of cell values in a row
 *   findRow(text)              → Locator of the first row card containing text
 *   hasRowContaining(text)     → boolean
 *   waitForRows(min?)          → wait until at least `min` rows are present
 *   recordCount()             → the "(N) Record(s) Found" header count
 */

const ROW_TIMEOUT = parseInt(process.env.TABLE_ROW_TIMEOUT_MS || '15000', 10);

class DataTableComponent {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;
    this.rows        = page.locator('.oxd-table-card');
    this.bodyRows    = page.locator('.oxd-table-body .oxd-table-row');
    this.headerCells = page.locator('.oxd-table-header .oxd-table-header-cell');
    this.recordsHeader = page.locator('.orangehrm-horizontal-padding .oxd-text--span, .oxd-table-filter-header-title + span');
  }

  /** @returns {Promise<number>} */
  async rowCount() {
    return this.rows.count().catch(() => 0);
  }

  /**
   * @param {number} rowIndex
   * @returns {Promise<string[]>}
   */
  async getCellTexts(rowIndex) {
    const row   = this.rows.nth(rowIndex);
    const cells = row.locator('.oxd-table-cell');
    const texts = await cells.allTextContents().catch(() => []);
    return texts.map(t => t.trim());
  }

  /**
   * @param {string} text
   * @returns {import('@playwright/test').Locator}
   */
  findRow(text) {
    return this._page.locator('.oxd-table-card', { hasText: text }).first();
  }

  /**
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async hasRowContaining(text) {
    // The grid refreshes asynchronously after a search — WAIT for the matching row
    // to appear. isVisible() ignores its timeout and samples the mid-refresh DOM,
    // so a row that renders a moment later is missed.
    return this.findRow(text)
      .waitFor({ state: 'visible', timeout: ROW_TIMEOUT })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Wait until the grid has at least `min` row cards rendered.
   * @param {number} [min=1]
   */
  async waitForRows(min = 1) {
    await this._page.waitForFunction(
      (m) => document.querySelectorAll('.oxd-table-card').length >= m,
      min,
      { timeout: ROW_TIMEOUT }
    ).catch(() => {});
  }

  /**
   * Parse the "(N) Record(s) Found" count shown above the grid.
   * @returns {Promise<number|null>}
   */
  async recordCount() {
    const text = await this.recordsHeader.first().textContent({ timeout: 5000 }).catch(() => null);
    if (!text) return null;
    const m = text.match(/\((\d+)\)/);
    return m ? parseInt(m[1], 10) : null;
  }
}

module.exports = { DataTableComponent };
