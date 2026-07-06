'use strict';
/**
 * login.steps.js
 *
 * Step definitions for the Employee Login feature (OrangeHRM auth route).
 * Drives LoginPage + DashboardPage and asserts on the React SPA redirect,
 * the invalid-credentials banner, and required-field validation.
 */

const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('assert');
const { LoginPage }     = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');
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

// ─── Given ──────────────────────────────────────────────────────────────────

Given(/^the OrangeHRM login page is open$/,
  timed('the OrangeHRM login page is open', async function () {
    this._loginPage = new LoginPage(this.page);
    await this._loginPage.goto();
  })
);

// ─── When ───────────────────────────────────────────────────────────────────

When(/^I log in with the configured administrator credentials$/,
  timed('I log in with the configured administrator credentials', async function () {
    if (!this._loginPage) this._loginPage = new LoginPage(this.page);
    await this._loginPage.login();
  })
);

When(/^I log in with username "([^"]*)" and password "([^"]*)"$/,
  timed('I log in with username and password', async function (username, password) {
    if (!this._loginPage) this._loginPage = new LoginPage(this.page);
    await this._loginPage.login(username, password);
  })
);

When(/^I submit the login form without entering credentials$/,
  timed('I submit the login form without entering credentials', async function () {
    if (!this._loginPage) this._loginPage = new LoginPage(this.page);
    await this._loginPage.locators.loginButton.click();
  })
);

// ─── Then ───────────────────────────────────────────────────────────────────

Then(/^I should land on the Dashboard$/,
  timed('I should land on the Dashboard', async function () {
    const loginPage    = this._loginPage || new LoginPage(this.page);
    const onDashboard  = await loginPage.waitForDashboard();
    assert.ok(onDashboard, `Expected the SPA to route to the Dashboard, but URL is ${this.page.url()}`);
    this._dashboardPage = new DashboardPage(this.page);
    await this._dashboardPage.waitForReady();
  })
);

Then(/^the main menu should be visible$/,
  timed('the main menu should be visible', async function () {
    if (!this._dashboardPage) this._dashboardPage = new DashboardPage(this.page);
    const modules = await this._dashboardPage.menu.listModules();
    assert.ok(modules.length > 0, 'Expected the OrangeHRM side menu to render at least one module');
  })
);

Then(/^I should see an authentication error$/,
  timed('I should see an authentication error', async function () {
    const loginPage = this._loginPage || new LoginPage(this.page);
    const error     = await loginPage.getAuthError();
    assert.ok(error, 'Expected an "Invalid credentials" error banner to be shown');
  })
);

Then(/^I should remain on the login page$/,
  timed('I should remain on the login page', async function () {
    const loginPage = this._loginPage || new LoginPage(this.page);
    assert.ok(loginPage.isOnLoginRoute(), `Expected to stay on the login route, but URL is ${this.page.url()}`);
  })
);

Then(/^I should see required-field validation messages$/,
  timed('I should see required-field validation messages', async function () {
    const loginPage = this._loginPage || new LoginPage(this.page);
    const errors    = await loginPage.getFieldErrors();
    assert.ok(errors.length > 0, 'Expected "Required" validation messages on the empty login fields');
  })
);
