'use strict';
/**
 * shared.steps.js
 *
 * Cross-feature step definitions for the OrangeHRM suite:
 *   • "I am signed in to OrangeHRM"  — ensures an authenticated Dashboard session,
 *     performing a UI login (APP_USERNAME / APP_PASSWORD) if the SPA has bounced
 *     the browser to the login route (expired/absent session).
 *   • "I navigate to the {module} module" — side-menu client-side routing.
 *   • "the application is accessible at the configured base URL" — smoke nav.
 *
 * Credentials are read from env only and are never printed to logs.
 */

const { Given } = require('@cucumber/cucumber');
const { LoginPage }     = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');

const NAV_TIMEOUT = parseInt(process.env.APP_GOTO_TIMEOUT_MS || '30000', 10);

Given(/^I am signed in to OrangeHRM$/, async function () {
  const loginPage = new LoginPage(this.page);
  const dashboardUrl = `${LoginPage.baseUrl()}/web/index.php/dashboard/index`;

  await this.page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  // If the React router redirected us to the login route, sign in via the UI.
  if (/\/auth\/login\b/i.test(this.page.url())) {
    await loginPage.locators.usernameInput.waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => {});
    await loginPage.login();
    const landed = await loginPage.waitForDashboard();
    if (!landed) {
      throw new Error(
        'OrangeHRM sign-in failed — verify APP_USERNAME / APP_PASSWORD in .env or CI secrets ' +
        'and that APP_BASE_URL is reachable.'
      );
    }
  }

  this._dashboardPage = new DashboardPage(this.page);
  await this._dashboardPage.waitForReady();
});

Given(/^I navigate to the "([^"]*)" module$/, async function (moduleName) {
  if (!this._dashboardPage) this._dashboardPage = new DashboardPage(this.page);
  await this._dashboardPage.openModule(moduleName);
});

Given(/^the application is accessible at the configured base URL$/, async function () {
  const url = LoginPage.baseUrl();
  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
});
