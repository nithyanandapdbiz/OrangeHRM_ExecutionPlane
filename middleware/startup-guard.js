'use strict';
/**
 * Execution Plane startup guard.
 *
 * Enforces Sovereign Split rules at boot:
 *   ❌ NO AI provider/model/prompt config or credential — provider-AGNOSTIC ban
 *      (pattern-based via lib/config-allowlist; catches unknown future providers
 *      with no code change — see FF-22/23/24).
 *   ✅ CLIENT_ID + CLIENT_SECRET required (OAuth2 client-credentials)
 *   ✅ JIRA_API_TOKEN required
 *   ✅ JIRA_BASE_URL required
 *   ✅ INTELLIGENCE_API_URL required
 *   ⚠  APP_BASE_URL / app credentials warned if missing (Playwright will fail)
 *
 * Exits the process on any hard failure.
 */
const path = require('path');
const fs   = require('fs');
const logger = require('../lib/logger');
const allowlist = require('../lib/config-allowlist');

function validate() {
  const checks = [];
  let hardFail = false;

  function pass(name, msg)  { checks.push({ name, status: 'pass', message: msg }); }
  function warn(name, msg)  { checks.push({ name, status: 'warn', message: msg }); }
  function fail(name, msg)  { checks.push({ name, status: 'fail', message: msg }); hardFail = true; }

  // ── Sovereign Split: NO AI provider/model/credential config may be set here ──
  // Provider-AGNOSTIC: a denylist of provider names is trivially bypassed and must
  // be edited for every new provider. Instead we detect AI config by PATTERN
  // (model/tokens/temperature/prompt/…) and reject any credential-shaped variable
  // not on the Execution Plane allowlist — so a provider that does not exist yet
  // is still caught with no change here. See lib/config-allowlist.js.
  const forbidden = allowlist.scanForbidden(process.env);
  if (forbidden.length) {
    fail('sovereign-split:ai-config',
      'Forbidden AI/provider configuration SET in the Execution Plane: ' +
      forbidden.map(f => `${f.name} [${f.reason}]`).join('; ') +
      '. The EP is provider-agnostic — all AI config, models, prompts and credentials live only in the DBiz Intelligence Plane.');
  } else {
    pass('sovereign-split:ai-config', 'No AI provider/model/credential config present — provider-agnostic boundary intact');
  }

  // ── Required: JWT for Intelligence API ───────────────────────────────────
  // Auth: canonical OAuth2 client-credentials (the static CUSTOMER_JWT is deprecated).
  const hasOAuth = (process.env.CLIENT_ID || '').trim() && (process.env.CLIENT_SECRET || process.env.CLIENT_SECRET_REF || '').trim();
  if (hasOAuth) {
    pass('env:CLIENT_ID/CLIENT_SECRET', 'Present — OAuth2 client-credentials');
  } else {
    fail('env:auth', 'Missing — set CLIENT_ID + CLIENT_SECRET (OAuth2 client-credentials from DBiz)');
  }

  // ── Required: Jira credentials ────────────────────────────────────────────
  const jiraToken = (process.env.JIRA_API_TOKEN || '').trim();
  const jiraUrl   = (process.env.JIRA_BASE_URL || '').trim();
  const jiraProj  = (process.env.JIRA_PROJECT_KEY || '').trim();
  const jiraEmail = (process.env.JIRA_EMAIL || '').trim();

  if (!jiraToken || jiraToken.startsWith('your-')) {
    fail('env:JIRA_API_TOKEN', 'Missing — generate at Atlassian → Account → Security → API tokens');
  } else {
    pass('env:JIRA_API_TOKEN', 'Present');
  }

  if (!jiraUrl || jiraUrl.startsWith('https://your-org.atlassian')) {
    fail('env:JIRA_BASE_URL', 'Missing or still set to placeholder');
  } else {
    pass('env:JIRA_BASE_URL', jiraUrl);
  }

  if (!jiraEmail || jiraEmail.startsWith('your-')) {
    warn('env:JIRA_EMAIL', 'Not set — Jira Basic auth (email:token) will fail');
  } else {
    pass('env:JIRA_EMAIL', jiraEmail);
  }

  if (!jiraProj) {
    warn('env:JIRA_PROJECT_KEY', 'Not set — Jira/Zephyr operations will fail');
  } else {
    pass('env:JIRA_PROJECT_KEY', `"${jiraProj}"`);
  }

  // ── Optional: Zephyr Essential test-management token ──────────────────────
  if (!process.env.ZEPHYR_API_TOKEN) warn('env:ZEPHYR_API_TOKEN', 'Not set — Zephyr test-management sync will be skipped');
  else                                pass('env:ZEPHYR_API_TOKEN', 'Present');

  // ── Required: Intelligence API URL ───────────────────────────────────────
  const intelUrl = (process.env.INTELLIGENCE_API_URL || '').trim();
  if (!intelUrl) {
    fail('env:INTELLIGENCE_API_URL', 'Missing — set to DBiz Intelligence API URL');
  } else {
    pass('env:INTELLIGENCE_API_URL', intelUrl);
  }

  // ── Warnings: Playwright prerequisites (OrangeHRM React app under test) ────
  const appUrl = process.env.APP_BASE_URL || process.env.TEST_BASE_URL;
  if (!appUrl)                     warn('env:APP_BASE_URL',   'Not set — Playwright tests will fail');
  else                              pass('env:APP_BASE_URL',   appUrl);

  if (!process.env.APP_USERNAME)   warn('env:APP_USERNAME',   'Not set — app login tests will fail');
  else                              pass('env:APP_USERNAME',   'Present');

  if (!process.env.APP_PASSWORD)   warn('env:APP_PASSWORD',   'Not set — app login tests will fail');
  else                              pass('env:APP_PASSWORD',   'Present');

  // ── Platform dir ──────────────────────────────────────────────────────────
  const platformDir = path.resolve(process.env.PLATFORM_DIR || '../AgenticQAPlatform');
  if (!fs.existsSync(platformDir)) {
    warn('env:PLATFORM_DIR', `Directory not found: ${platformDir} — Playwright execution will fail`);
  } else {
    pass('env:PLATFORM_DIR', platformDir);
  }

  // ── Print report ──────────────────────────────────────────────────────────
  logger.info('═'.repeat(60));
  logger.info('  OrangeHRM Execution Plane — Startup Validation');
  checks.forEach(c => {
    const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️ ' : '❌';
    logger.info(`  ${icon}  ${c.name}: ${c.message}`);
  });

  if (hardFail) {
    const failed = checks.filter(c => c.status === 'fail').map(c => c.name).join(', ');
    logger.error(`  BOOT ABORTED — fix: ${failed}`);
    process.exit(1);
  }

  return checks;
}

module.exports = { validate };
