'use strict';
/**
 * Global Setup — runs ONCE before the entire test suite.  (WI-032A / WI-031D)
 *
 * Responsibilities:
 *   1. Ensure output directories exist and stale artifacts are cleared
 *   2. Authenticate to OrangeHRM via storage state (ensureAuthenticated)
 *   3. Active session validation (validateAuthenticatedSession) — verifies
 *      the saved cookies produce a real OrangeHRM session, not a login redirect
 *   4. Log telemetry for traceability
 *
 * All timeouts are driven by env vars (no hardcoded values).
 */

const {
  ensureAuthenticated,
  validateAuthenticatedSession,
  writeSessionMetadata,
  writeSessionTelemetry,
  AUTH_STATE_FILE,
} = require('./auth/authManager');
const { ensureDirs, cleanDir }    = require('../scripts/ensure-dirs');
const { validateStepRegistry }    = require('../scripts/validate-step-registry');

const RUN_CACHE_TTL_MS = parseInt(process.env.AUTH_RUN_CACHE_TTL_MS || String(50 * 60 * 1000), 10);

module.exports = async function globalSetup(config) {
  ensureDirs();
  cleanDir('allure-results');
  cleanDir('test-results/screenshots');

  // Step registry integrity: duplicate steps, hooks outside hooks.js, app-only enforcement
  const registry = validateStepRegistry();
  if (!registry.valid) {
    const failed = registry.results.filter(r => !r.pass);
    const summary = failed.map(r => `[${r.rule}] ${r.detail}`).join('\n');
    throw new Error(`STEP_REGISTRY_VIOLATION — fix before running tests:\n${summary}`);
  }

  const startTime = Date.now();
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║       GLOBAL SETUP — Starting  (WI-031D)         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  const baseUrl = process.env.TEST_BASE_URL || process.env.APP_BASE_URL || '(not set)';
  console.log(`  Base URL  : ${baseUrl}`);
  console.log(`  Auth Mode : ${process.env.AUTH_MODE || 'storage-state'}`);
  console.log(`  Auth File : ${AUTH_STATE_FILE}`);
  if (config) {
    console.log(`  Workers   : ${config.workers || 'default'}`);
    console.log(`  Retries   : ${config.projects?.[0]?.retries ?? 'default'}`);
  }
  console.log(`  Time      : ${new Date().toISOString()}`);

  // Step 1: Ensure session exists (reauth if missing/expired)
  const tel = await ensureAuthenticated();
  console.log(
    `  [Auth] mode=${tel.authMode} ` +
    `sessionValid=${tel.sessionValid} ` +
    `reused=${tel.reusedSession} ` +
    `reauth=${tel.reauthenticated} ` +
    `durationMs=${tel.durationMs}`
  );

  writeSessionMetadata({
    authenticatedAt: new Date().toISOString(),
    expiresAt:       new Date(Date.now() + RUN_CACHE_TTL_MS).toISOString(),
    userId:          tel.userId || null,
    reauthenticated: tel.reauthenticated,
    setupBy:         'global-setup',
  });
  writeSessionTelemetry({
    trigger:          'global_setup',
    validationResult: tel.reauthenticated ? 'reauthenticated' : 'reused',
    durationMs:       tel.durationMs,
    storageStateLoaded: !tel.reauthenticated,
  });

  // Step 2: Active validation — confirm cookies produce a live OrangeHRM session
  if (process.env.AUTH_MODE !== 'none') {
    const liveCheck = await validateAuthenticatedSession(AUTH_STATE_FILE);
    console.log(
      `  [Auth] activeValidation: valid=${liveCheck.valid} ` +
      `reason="${liveCheck.reason}" ` +
      `durationMs=${liveCheck.durationMs}`
    );
    if (!liveCheck.valid) {
      // Active validation failed even after ensureAuthenticated — re-auth once more
      console.log('  [Auth] Active validation failed — performing emergency re-authentication...');
      const tel2 = await ensureAuthenticated();
      if (!tel2.authenticated) {
        throw new Error(
          'Global setup: OrangeHRM authentication could not be established after two attempts. ' +
          'Check credentials and OrangeHRM app availability.'
        );
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Global setup completed in ${elapsed}s`);
  console.log('─'.repeat(52) + '\n');
};
