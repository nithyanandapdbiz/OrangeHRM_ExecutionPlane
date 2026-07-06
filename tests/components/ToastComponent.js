'use strict';
/**
 * ToastComponent.js
 *
 * OrangeHRM toast notifications (`.oxd-toast`). After a successful save the app
 * flashes a green "Success" / "Successfully Saved" toast; validation and server
 * errors flash a red toast. These auto-dismiss, so waits are kept short and are
 * treated as best-effort signals rather than hard gates.
 *
 * Methods:
 *   waitForToast(opts?)        → { visible, type, title, message }
 *   waitForSuccess()           → resolves true when a success toast appears
 *   getMessage()               → latest toast body text
 *   dismiss()                  → close any open toast
 */

const TOAST_TIMEOUT = parseInt(process.env.TOAST_TIMEOUT_MS || '10000', 10);

class ToastComponent {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this._page = page;
    this.toast        = page.locator('.oxd-toast');
    this.successToast = page.locator('.oxd-toast--success');
    this.errorToast   = page.locator('.oxd-toast--error, .oxd-toast--warn');
    this.toastTitle   = page.locator('.oxd-toast-content-text .oxd-text--toast-title');
    this.toastMessage = page.locator('.oxd-toast-content-text .oxd-text--toast-message');
    this.closeButton  = page.locator('.oxd-toast .oxd-toast-content--info + .oxd-toast-close, .oxd-toast .oxd-icon.bi-x');
  }

  /**
   * Wait for any toast to appear and classify it.
   * @param {{ timeout?: number }} [opts]
   * @returns {Promise<{ visible: boolean, type: string, title: string|null, message: string|null }>}
   */
  async waitForToast(opts = {}) {
    const timeout = opts.timeout || TOAST_TIMEOUT;
    const visible = await this.toast.first().waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);

    if (!visible) return { visible: false, type: 'none', title: null, message: null };

    const isSuccess = await this.successToast.first().isVisible({ timeout: 500 }).catch(() => false);
    const isError   = await this.errorToast.first().isVisible({ timeout: 500 }).catch(() => false);
    const title     = await this.toastTitle.first().textContent({ timeout: 1000 }).catch(() => null);
    const message   = await this.toastMessage.first().textContent({ timeout: 1000 }).catch(() => null);

    return {
      visible: true,
      type:    isSuccess ? 'success' : isError ? 'error' : 'info',
      title:   title?.trim() || null,
      message: message?.trim() || null,
    };
  }

  /**
   * @param {{ timeout?: number }} [opts]
   * @returns {Promise<boolean>}
   */
  async waitForSuccess(opts = {}) {
    const timeout = opts.timeout || TOAST_TIMEOUT;
    return this.successToast.first().waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);
  }

  /** @returns {Promise<string|null>} */
  async getMessage() {
    return this.toastMessage.first().textContent({ timeout: 2000 }).catch(() => null);
  }

  /** Best-effort dismiss of any open toast. */
  async dismiss() {
    const open = await this.toast.first().isVisible({ timeout: 500 }).catch(() => false);
    if (open) {
      await this.closeButton.first().click({ timeout: 1000 }).catch(() => {});
    }
  }
}

module.exports = { ToastComponent };
