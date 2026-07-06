'use strict';
/**
 * base.fixture.js — Composed Playwright fixture with full hook lifecycle.
 *
 * Provides:
 *   • ScreenshotHelper (sh)
 *   • uniqueSuffix — timestamp-based suffix for test data isolation
 *
 * Hooks provided:
 *   • beforeEach — Clear cookies for session isolation
 *   • afterEach  — On failure: capture failure screenshot, collect console errors,
 *                  dismiss open dialogs; always: log test result with duration
 *   • beforeAll  — Log suite start
 *   • afterAll   — Log suite summary
 *
 * Usage in spec files:
 *   const { test, expect } = require('../fixtures/base.fixture');
 *
 *   test('my test', async ({ page, sh, uniqueSuffix }, testInfo) => {
 *     await sh.step('Navigate', async () => { ... });
 *   });
 *
 * Story-specific page objects are injected in the individual spec files or via
 * the POM fixture (pom.fixture.js) — not in this shared base fixture.
 */

const { test: base, expect } = require('@playwright/test');
const fs                     = require('fs');
const { ScreenshotHelper }   = require('../helpers/screenshot.helper');

// ── Suite-level counters (shared across workers) ──────────────────────────
let _suiteStartTime = 0;
let _suitePassed    = 0;
let _suiteFailed    = 0;

const test = base.extend({

  uniqueSuffix: async ({}, use) => {
    await use(String(Date.now()).slice(-5));
  },

  // ── ScreenshotHelper ─────────────────────────────────────────────────
  sh: async ({ page }, use, testInfo) => {
    await use(new ScreenshotHelper(page, testInfo));
  },

  // ── Video capture for failed tests ───────────────────────────────────
  page: async ({ page }, use, testInfo) => {
    const videoObj = page.video ? page.video() : null;

    await use(page);

    if (testInfo.status !== 'passed' && testInfo.status !== 'skipped' && videoObj) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
        const videoPath = await videoObj.path();
        if (videoPath && fs.existsSync(videoPath)) {
          const buf = fs.readFileSync(videoPath);
          await testInfo.attach('video', {
            body:        buf,
            contentType: 'video/webm',
          });
          console.log(`  [Hook] Video attached (${(buf.length / 1024).toFixed(0)} KB) for "${testInfo.title}"`);
        }
      } catch (err) {
        console.warn(`  [Hook] Video capture failed for "${testInfo.title}": ${err.message}`);
      }
    }
  },

  // ── Console error collector ───────────────────────────────────────────
  _consoleErrors: async ({ page }, use, testInfo) => {
    const errors = [];
    const handler = (msg) => {
      if (msg.type() === 'error') {
        errors.push({ text: msg.text(), url: msg.location()?.url || '' });
      }
    };
    page.on('console', handler);

    await use(errors);

    if (errors.length > 0) {
      const summary = errors.map((e, i) => `${i + 1}. ${e.text} (${e.url})`).join('\n');
      await testInfo.attach('Console Errors', { body: summary, contentType: 'text/plain' });
      if (testInfo.status !== 'passed') {
        console.log(`  [Hook] ${errors.length} console error(s) captured during "${testInfo.title}"`);
      }
    }
  },

  // ── beforeEach / afterEach (auto-use fixtures) ────────────────────────
  _beforeEach: [async ({ page }, use) => {
    await page.context().clearCookies();
    await use();
  }, { auto: true }],

  _afterEach: [async ({ page, _consoleErrors }, use, testInfo) => {
    await use();

    const status   = testInfo.status;
    const duration = (testInfo.duration / 1000).toFixed(1);
    const icon     = status === 'passed' ? 'PASS' : status === 'skipped' ? 'SKIP' : 'FAIL';

    if (status === 'passed') _suitePassed++;
    else if (status !== 'skipped') _suiteFailed++;

    if (status !== 'passed' && status !== 'skipped') {
      try {
        page.once('dialog', async (dialog) => { await dialog.dismiss(); });
        const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
        if (buffer) {
          await testInfo.attach('failure-screenshot', {
            body: buffer,
            contentType: 'image/png',
          });
        }
      } catch {
        // Page may already be closed — silently skip
      }
    }

    console.log(`  [${icon}] [${duration}s] ${testInfo.title}`);
  }, { auto: true }],

  // ── beforeAll / afterAll (worker-scoped fixtures) ─────────────────────
  _beforeAll: [async ({}, use) => {
    _suiteStartTime = Date.now();
    _suitePassed    = 0;
    _suiteFailed    = 0;
    console.log('\n  +---------------------------------------------');
    console.log('  | Test Suite Starting');
    console.log('  | Time: ' + new Date().toISOString());
    console.log('  +---------------------------------------------');

    await use();

    const elapsed = ((Date.now() - _suiteStartTime) / 1000).toFixed(1);
    console.log('\n  +---------------------------------------------');
    console.log('  | Test Suite Complete');
    console.log(`  | Passed: ${_suitePassed}  Failed: ${_suiteFailed}  Duration: ${elapsed}s`);
    console.log('  +---------------------------------------------\n');
  }, { auto: true, scope: 'worker' }],
});

module.exports = { test, expect };
