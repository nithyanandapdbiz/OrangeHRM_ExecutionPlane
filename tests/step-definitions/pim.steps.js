'use strict';
/**
 * pim.steps.js
 *
 * Step definitions for the PIM Add-Employee feature. Drives PimPage to create
 * employees and asserts on the oxd success toast / Employee List grid.
 */

const { When, Then } = require('@cucumber/cucumber');
const assert = require('assert');
const { PimPage }       = require('../pages/PimPage');
const { logStepTiming } = require('../../src/utils/perfLogger');

function timed(step, fn) {
  const wrapper = async function (...args) {
    const t0 = Date.now();
    try {
      const r = await fn.apply(this, args);
      logStepTiming({ step, durationMs: Date.now() - t0, status: 'passed' });
      return r;
    } catch (err) {
      logStepTiming({ step, durationMs: Date.now() - t0, status: 'failed', error: err.message });
      throw err;
    }
  };
  Object.defineProperty(wrapper, 'length', { value: fn.length });
  return wrapper;
}

// ─── When ───────────────────────────────────────────────────────────────────

When(/^I add an employee with first name "([^"]*)" and last name "([^"]*)"$/,
  timed('I add an employee with first and last name', async function (firstName, lastName) {
    const suffix = String(Date.now()).slice(-4);
    this._pimPage      = new PimPage(this.page);
    this._employeeName = `${firstName} ${lastName}${suffix}`;
    this._saveResult   = await this._pimPage.addEmployee({ firstName, lastName: `${lastName}${suffix}` });
  })
);

When(/^I add an employee with first name "([^"]*)" and no last name$/,
  timed('I add an employee with no last name', async function (firstName) {
    this._pimPage = new PimPage(this.page);
    await this._pimPage.gotoAddEmployee();
    await this._pimPage.fillEmployee({ firstName });
    // Attempt to save with the required Last Name left blank.
    await this._pimPage.locators.saveButton.first().click();
    // Success is a toast + SPA route change; neither should occur here.
    const toast  = await this._pimPage.toast.waitForToast({ timeout: 5000 });
    const routed = await this.page.waitForURL(/\/pim\/viewPersonalDetails|\/pim\/viewEmployee/i, { timeout: 5000 })
      .then(() => true).catch(() => false);
    this._saveResult = { saved: toast.type === 'success' || routed, toast };
  })
);

When(/^I search the Employee List for "([^"]*)"$/,
  timed('I search the Employee List', async function (name) {
    if (!this._pimPage) this._pimPage = new PimPage(this.page);
    await this._pimPage.gotoEmployeeList();
    await this._pimPage.searchByName(name);
    this._searchTerm = name;
  })
);

// ─── Then ───────────────────────────────────────────────────────────────────

Then(/^the employee should be saved successfully$/,
  timed('the employee should be saved successfully', async function () {
    assert.ok(this._saveResult && this._saveResult.saved,
      `Expected the employee to be saved (toast=${this._saveResult?.toast?.type}), but no success signal was observed`);
  })
);

Then(/^the employee should not be saved$/,
  timed('the employee should not be saved', async function () {
    assert.ok(this._saveResult && this._saveResult.saved === false,
      'Expected the employee NOT to be saved when the required last name is missing');
  })
);

Then(/^the employee "([^"]*)" should appear in the results$/,
  timed('the employee should appear in the results', async function (name) {
    if (!this._pimPage) this._pimPage = new PimPage(this.page);
    const found = await this._pimPage.isEmployeeListed(name);
    assert.ok(found, `Expected an employee matching "${name}" in the Employee List results`);
  })
);
