'use strict';
/**
 * pom.fixture.js — OrangeHRM Page Object Model fixture.
 *
 * Extends base.fixture with lazily-constructed page objects so Playwright spec
 * files can inject exactly the pages they use:
 *
 *   const { test, expect } = require('../fixtures/pom.fixture');
 *
 *   test('add employee', async ({ loginPage, dashboardPage, pimPage }) => {
 *     await loginPage.goto();
 *     await loginPage.login();
 *     await dashboardPage.waitForReady();
 *     await pimPage.addEmployee({ firstName: 'Alex', lastName: 'Turner' });
 *   });
 *
 * Each fixture is page-scoped and instantiated on first use.
 */

const { test: base, expect } = require('./base.fixture');
const { LoginPage }     = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');
const { PimPage }       = require('../pages/PimPage');
const { AdminPage }     = require('../pages/AdminPage');
const { LeavePage }     = require('../pages/LeavePage');

const test = base.extend({
  loginPage:     async ({ page }, use) => { await use(new LoginPage(page)); },
  dashboardPage: async ({ page }, use) => { await use(new DashboardPage(page)); },
  pimPage:       async ({ page }, use) => { await use(new PimPage(page)); },
  adminPage:     async ({ page }, use) => { await use(new AdminPage(page)); },
  leavePage:     async ({ page }, use) => { await use(new LeavePage(page)); },
});

module.exports = { test, expect };
