'use strict';
/**
 * admin.steps.js
 *
 * Step definitions for the Admin Add-User feature. Drives AdminPage to create
 * system users and asserts on the oxd success toast / User Management grid.
 */

const { When, Then } = require('@cucumber/cucumber');
const assert = require('assert');
const { AdminPage }     = require('../pages/AdminPage');
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

When(/^I add a user with role "([^"]*)" for employee "([^"]*)" username "([^"]*)" and password "([^"]*)"$/,
  timed('I add a user', async function (role, employeeName, username, password) {
    // Create a dedicated, brand-new employee for this account. OrangeHRM allows
    // exactly one system user per employee, and the public demo's employees may
    // already be claimed — a freshly created employee is always assignable, so the
    // save reliably succeeds. Falls back to the feature-named employee if creation
    // could not be confirmed.
    const stamp = String(Date.now()).slice(-6);
    const first = 'Usr';
    const last  = `Auto${stamp}`;
    const emp   = await new PimPage(this.page).addEmployee({ firstName: first, lastName: last }).catch(() => null);
    const employeeForUser = emp && emp.saved ? `${first} ${last}` : employeeName;

    // Unique username per run so re-runs never collide with an existing account.
    this._adminPage   = new AdminPage(this.page);
    this._createdUser = `${username}.${stamp}`;
    this._saveResult  = await this._adminPage.addUser({ role, employeeName: employeeForUser, username: this._createdUser, password });
  })
);

When(/^I search User Management for username "([^"]*)"$/,
  timed('I search User Management', async function (username) {
    if (!this._adminPage) this._adminPage = new AdminPage(this.page);
    // Search for the actual (run-unique) username created above, not the feature literal.
    const term = this._createdUser || username;
    await this._adminPage.searchByUsername(term);
    this._searchTerm = term;
  })
);

// ─── Then ───────────────────────────────────────────────────────────────────

Then(/^the user should be saved successfully$/,
  timed('the user should be saved successfully', async function () {
    assert.ok(this._saveResult && this._saveResult.saved,
      `Expected the user to be saved (toast=${this._saveResult?.toast?.type}), but no success signal was observed`);
  })
);

Then(/^the user "([^"]*)" should appear in the results$/,
  timed('the user should appear in the results', async function (username) {
    if (!this._adminPage) this._adminPage = new AdminPage(this.page);
    const term  = this._createdUser || username;
    const found = await this._adminPage.isUserListed(term);
    assert.ok(found, `Expected a user matching "${term}" in the User Management results`);
  })
);
