'use strict';
// =============================================================================
// Locators     : LoginLocators
// Page         : OrangeHRM Login  (/web/index.php/auth/login)
// App          : OrangeHRM (React SPA)
// Strategy     : name attributes for auth fields → oxd component classes fallback
// =============================================================================

class LoginLocators {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;

    // ── Credential fields — OrangeHRM auth form uses stable name attributes ──
    // Precise selectors only: ambiguous `.oxd-input` fallbacks match dashboard
    // inputs after an (unexpected) auth redirect and mask "login form not shown".
    this.usernameInput = page.locator('input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');

    // ── Submit ───────────────────────────────────────────────────────────────
    this.loginButton = page.locator('button[type="submit"]');

    // ── Branding / shell ──────────────────────────────────────────────────────
    this.loginBranding = page.locator('.orangehrm-login-branding img, .orangehrm-login-logo');
    this.loginTitle    = page.locator('.orangehrm-login-title');

    // ── Feedback ──────────────────────────────────────────────────────────────
    // Invalid-credentials banner
    this.authErrorAlert       = page.locator('.oxd-alert-content-text');
    // Per-field "Required" validation messages
    this.fieldErrorMessage    = page.locator('.oxd-input-field-error-message');
  }
}

module.exports = { LoginLocators };
