'use strict';
/**
 * locatorResolver.js — WI-036  Intelligent Locator Resolution Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves an OrangeHRM field locator via an ordered 9-strategy chain.  On first
 * success the winning selector is stored in the locator intelligence cache.
 * Once a locator has been verified LOCATOR_PROMOTION_THRESHOLD times it is
 * promoted and tried first on all future runs.
 *
 * Strategy chain (in order):
 *   1.  logical-name       [name=], [id*=], input[name=]
 *   2.  display-name       getByLabel(displayName from metadata)
 *   3.  alias              getByLabel(alias) for each APP_FIELD_ALIASES entry
 *   4.  role               getByRole(textbox|combobox|…, { name })
 *   5.  aria-label         [aria-label=…]
 *   6.  placeholder        [placeholder*=…]
 *   7.  label-association  label:has-text(…) + input/textarea
 *   8.  visible-text       :text-is("…")
 *   9.  ai-assisted        last-resort (marker; actual AI call is opt-in)
 *
 * Authentication guard (Phase 11):
 *   If page.url() matches an IdP domain the resolver immediately throws
 *   AuthenticationRecoveryError (exitCode=4) instead of attempting healing.
 *
 * Telemetry:
 *   Every resolution attempt is appended to logs/locator-healing.jsonl.
 *
 * Failure diagnostics:
 *   Failed resolutions are written to reports/locator-resolution-report.json.
 *
 * Public API:
 *   resolveLocator(options)                    → Promise<ResolveResult>
 *   resolveField(page, module, field, meta?)   → Promise<ResolveResult>
 *   resolveEntityField(options)                → alias for resolveLocator
 *   buildStrategyCandidates(entity, field, meta) → Candidate[]
 *   isAuthPage(url)                            → boolean
 *   writeTelemetry(entry)                      → void
 *   writeResolutionReport(report)              → void
 *   AuthenticationRecoveryError
 */

const fs          = require('fs');
const path        = require('path');
const intelligence = require('./locatorIntelligence');

const ROOT             = path.resolve(__dirname, '..', '..');
const TELEMETRY_FILE   = path.join(ROOT, 'logs',    'locator-healing.jsonl');
const RESOLUTION_REPORT = path.join(ROOT, 'reports', 'locator-resolution-report.json');

// ─── OrangeHRM field alias table ──────────────────────────────────────────────
// Display-name variations tried in strategy 3 (alias). Keys are lowercased module.field.
const APP_FIELD_ALIASES = {
  'pim.firstname':             ['First Name', 'First'],
  'pim.middlename':            ['Middle Name'],
  'pim.lastname':              ['Last Name', 'Last'],
  'pim.employeeid':            ['Employee Id', 'Employee ID', 'Id'],
  'admin.username':            ['Username', 'User Name'],
  'admin.password':            ['Password'],
  'admin.userrole':            ['User Role', 'Role'],
  'admin.status':              ['Status'],
  'admin.employeename':        ['Employee Name', 'Name'],
  'leave.leavetype':           ['Leave Type', 'Type'],
  'leave.fromdate':            ['From Date', 'Start Date'],
  'leave.todate':              ['To Date', 'End Date'],
  'recruitment.vacancy':       ['Vacancy', 'Job Vacancy'],
  'recruitment.candidatename': ['Candidate Name', 'Name'],
  'myinfo.employeename':       ['Employee Full Name', 'Name'],
  'time.date':                 ['Date'],
};

// OrangeHRM ARIA roles tried in strategy 4.
const APP_ROLES = ['textbox', 'combobox', 'listbox', 'button', 'checkbox', 'radio', 'option'];

// Login / IdP routes that indicate an unauthenticated session.
const AUTH_DOMAINS = [
  '/web/index.php/auth/login',
  '/auth/login',
  '/auth/validate',
  '/oauth2/authorize',
  '/saml2/idp',
];

// ─── AuthenticationRecoveryError ─────────────────────────────────────────────

class AuthenticationRecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name     = 'AuthenticationRecoveryError';
    this.exitCode = 4;
    this.code     = 'AUTH_PAGE_DETECTED';
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Return true when the URL matches a known IdP / auth domain.
 *
 * @param {string|null} url
 * @returns {boolean}
 */
function isAuthPage(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return AUTH_DOMAINS.some(d => lower.includes(d));
}

/**
 * Build the ordered list of selector candidates for a given module+field pair.
 * This is a pure function — it does NOT interact with a browser page.
 *
 * Each candidate has:
 *   { strategy: string, selectorType: 'css'|'label'|'role'|'text'|'ai', selector: string|{role,name}|null }
 *
 * @param {string}  entity      — e.g. 'pim'
 * @param {string}  logicalName — e.g. 'firstName'
 * @param {object}  [metadata]  — app metadata map { [moduleName]: { fields: [{logicalName, displayName}] } }
 * @returns {object[]} ordered candidate list
 */
function buildStrategyCandidates(entity, logicalName, metadata) {
  const candidates = [];
  const key        = `${entity}.${logicalName}`.toLowerCase();

  // ── Resolve display name from metadata ──────────────────────────────────────
  const entityMeta = metadata?.[entity.toLowerCase()] || metadata?.[entity] || null;
  const fieldMeta  = entityMeta?.fields?.find(f =>
    (f.logicalName || '').toLowerCase() === logicalName.toLowerCase()
  ) || null;
  const displayName = fieldMeta?.displayName || null;
  const controlName = fieldMeta?.controlName || null;

  // ── Strategy 1: Metadata Logical Name ───────────────────────────────────────
  candidates.push({ strategy: 'logical-name', selectorType: 'css', selector: `[name="${logicalName}"]` });
  candidates.push({ strategy: 'logical-name', selectorType: 'css', selector: `input[name="${logicalName}"]` });
  candidates.push({ strategy: 'logical-name', selectorType: 'css', selector: `[id*="${logicalName}"]` });
  if (controlName) {
    candidates.push({ strategy: 'logical-name', selectorType: 'css', selector: `[name="${controlName}"]` });
  }

  // ── Strategy 2: Display Name ─────────────────────────────────────────────────
  if (displayName) {
    candidates.push({ strategy: 'display-name', selectorType: 'label', selector: displayName });
  }

  // ── Strategy 3: App Metadata Aliases ─────────────────────────────────────────
  const aliases = APP_FIELD_ALIASES[key] || [];
  for (const alias of aliases) {
    if (alias === displayName) continue;
    candidates.push({ strategy: 'alias', selectorType: 'label', selector: alias });
  }

  // ── Strategy 4: Role-based ───────────────────────────────────────────────────
  const labelForRole = displayName || aliases[0] || logicalName;
  for (const role of APP_ROLES) {
    candidates.push({ strategy: 'role', selectorType: 'role', selector: { role, name: labelForRole } });
  }
  // Also try with first alias as the name
  if (aliases.length > 0 && aliases[0] !== labelForRole) {
    candidates.push({ strategy: 'role', selectorType: 'role', selector: { role: 'textbox', name: aliases[0] } });
  }

  // ── Strategy 5: Aria Label ───────────────────────────────────────────────────
  if (displayName) {
    candidates.push({ strategy: 'aria-label', selectorType: 'css', selector: `[aria-label="${displayName}"]` });
    candidates.push({ strategy: 'aria-label', selectorType: 'css', selector: `[aria-label*="${displayName}"]` });
  }
  for (const alias of aliases.slice(0, 2)) {
    candidates.push({ strategy: 'aria-label', selectorType: 'css', selector: `[aria-label="${alias}"]` });
  }

  // ── Strategy 6: Placeholder ──────────────────────────────────────────────────
  const labelForPlaceholder = displayName || aliases[0] || logicalName;
  candidates.push({ strategy: 'placeholder', selectorType: 'css', selector: `[placeholder="${labelForPlaceholder}"]` });
  candidates.push({ strategy: 'placeholder', selectorType: 'css', selector: `[placeholder*="${labelForPlaceholder}"]` });

  // ── Strategy 7: Label Association ────────────────────────────────────────────
  const labelForAssoc = displayName || aliases[0];
  if (labelForAssoc) {
    candidates.push({ strategy: 'label-association', selectorType: 'css', selector: `label:has-text("${labelForAssoc}") + input` });
    candidates.push({ strategy: 'label-association', selectorType: 'css', selector: `label:has-text("${labelForAssoc}") ~ input` });
    candidates.push({ strategy: 'label-association', selectorType: 'css', selector: `label:has-text("${labelForAssoc}") + textarea` });
  }

  // ── Strategy 8: Visible Text ─────────────────────────────────────────────────
  if (displayName) {
    candidates.push({ strategy: 'visible-text', selectorType: 'css', selector: `:text-is("${displayName}")` });
  }
  for (const alias of aliases.slice(0, 3)) {
    candidates.push({ strategy: 'visible-text', selectorType: 'css', selector: `:text-is("${alias}")` });
  }

  // ── Strategy 9: AI-Assisted (marker) ─────────────────────────────────────────
  candidates.push({ strategy: 'ai-assisted', selectorType: 'ai', selector: null });

  return candidates;
}

// ─── Browser interaction ──────────────────────────────────────────────────────

/**
 * Try a single candidate against the live page.
 * Returns the resolved locator handle when count > 0, null otherwise.
 * Never throws.
 */
async function tryCandidate(page, candidate) {
  try {
    const { selectorType, selector } = candidate;
    let loc;

    if (selectorType === 'ai' || selector === null) return null;

    if (selectorType === 'label') {
      loc = page.getByLabel(selector, { exact: false });
    } else if (selectorType === 'role') {
      loc = page.getByRole(selector.role, { name: selector.name, exact: false });
    } else {
      loc = page.locator(selector);
    }

    const count = await loc.count();
    return count > 0 ? loc : null;
  } catch {
    return null;
  }
}

// ─── Telemetry & diagnostics ──────────────────────────────────────────────────

/**
 * Append one JSON line to logs/locator-healing.jsonl.
 *
 * @param {object} entry — { timestamp, entity, field, originalLocator, resolvedLocator, strategy, durationMs, success, promoted }
 */
function writeTelemetry(entry) {
  try {
    const dir = path.dirname(TELEMETRY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* telemetry write failure is non-critical */ }
}

/**
 * Write/append one entry to reports/locator-resolution-report.json.
 * Keeps the latest 100 entries (older entries are dropped).
 *
 * Schema per entry:
 * { field, attempts: string[], winningStrategy: string|null, success: boolean, generatedAt: ISO }
 *
 * @param {object} report
 */
function writeResolutionReport(report) {
  try {
    const dir = path.dirname(RESOLUTION_REPORT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let existing = [];
    if (fs.existsSync(RESOLUTION_REPORT)) {
      try {
        const raw = fs.readFileSync(RESOLUTION_REPORT, 'utf8');
        existing  = JSON.parse(raw);
        if (!Array.isArray(existing)) existing = [];
      } catch {
        existing = [];
      }
    }

    existing.push(report);
    if (existing.length > 100) existing = existing.slice(-100);

    fs.writeFileSync(RESOLUTION_REPORT, JSON.stringify(existing, null, 2), 'utf8');
  } catch { /* report write failure is non-critical */ }
}

// ─── Main resolution function ─────────────────────────────────────────────────

/**
 * Resolve the best locator for an OrangeHRM field.
 *
 * Resolution order:
 *   0. Promoted cache entry (tried first if promoted)
 *   1–8. Strategy chain via buildStrategyCandidates()
 *   Cache-only (non-promoted): also tried first; stale entries fall through
 *
 * @param {object} options
 * @param {string}  options.entity       — OrangeHRM module name (e.g. 'pim')
 * @param {string}  options.logicalName  — field logical name (e.g. 'firstName')
 * @param {object}  options.page         — Playwright page object
 * @param {object}  [options.metadata]   — metadata map from metadataCache
 * @param {string}  [options.cacheFile]  — override intelligence cache path
 *
 * @returns {Promise<{ success: boolean, strategy: string, locator: object|null, durationMs: number }>}
 * @throws  {AuthenticationRecoveryError} when page URL is an IdP login page
 */
async function resolveLocator(options) {
  const { entity, logicalName, page, metadata, cacheFile } = options;
  const t0  = Date.now();
  const key = intelligence.buildKey(entity, logicalName);

  // Phase 11: Authentication guard ─────────────────────────────────────────────
  let currentUrl = '';
  try { currentUrl = page.url(); } catch { /* guard against non-standard page objects */ }
  if (isAuthPage(currentUrl)) {
    throw new AuthenticationRecoveryError(
      `Authentication page detected (${currentUrl}) — locator healing cannot proceed. Re-authentication required.`
    );
  }

  const attemptsLog = [];

  // Phase 4/5: Intelligence cache check ────────────────────────────────────────
  const cached = intelligence.getCachedLocator(key, cacheFile);
  if (cached) {
    const cacheCandidate = {
      strategy:     cached.strategy || 'cache-hit',
      selectorType: cached.selectorType || 'css',
      selector:     cached.resolvedLocator,
    };
    attemptsLog.push('cache-hit');
    const loc = await tryCandidate(page, cacheCandidate);
    if (loc) {
      const durationMs = Date.now() - t0;
      const updated    = intelligence.recordSuccess(key, cached.resolvedLocator, cached.strategy || 'cache-hit', cacheFile);
      writeTelemetry({
        timestamp: new Date().toISOString(), entity, field: logicalName,
        originalLocator: logicalName, resolvedLocator: cached.resolvedLocator,
        strategy: 'cache-hit', durationMs, success: true, promoted: updated.promoted,
      });
      return { success: true, strategy: 'cache-hit', locator: loc, durationMs };
    }
    // Cache entry is stale — fall through to strategy chain
  }

  // Phases 1–9: Strategy chain ─────────────────────────────────────────────────
  const candidates     = buildStrategyCandidates(entity, logicalName, metadata);
  let winningStrategy  = null;
  let resolvedLocator  = null;
  let resolvedSelector = null;
  let resolvedType     = 'css';

  for (const candidate of candidates) {
    if (candidate.selectorType === 'ai') continue; // Phase 9: AI-assist is separate opt-in

    const selectorStr = typeof candidate.selector === 'object'
      ? `role:${candidate.selector.role}[${candidate.selector.name}]`
      : candidate.selector;

    // Deduplicate attempts log (same strategy may have many selectors)
    if (attemptsLog[attemptsLog.length - 1] !== candidate.strategy) {
      attemptsLog.push(candidate.strategy);
    }

    const loc = await tryCandidate(page, candidate);
    if (loc) {
      winningStrategy  = candidate.strategy;
      resolvedLocator  = loc;
      resolvedSelector = selectorStr;
      resolvedType     = candidate.selectorType;
      break;
    }
  }

  const durationMs = Date.now() - t0;

  if (resolvedLocator) {
    const updated = intelligence.recordSuccess(key, resolvedSelector, winningStrategy, cacheFile, resolvedType);
    writeTelemetry({
      timestamp: new Date().toISOString(), entity, field: logicalName,
      originalLocator: logicalName, resolvedLocator: resolvedSelector,
      strategy: winningStrategy, durationMs, success: true, promoted: updated.promoted,
    });
    writeResolutionReport({
      field: `${entity}.${logicalName}`,
      attempts: attemptsLog,
      winningStrategy,
      success: true,
      generatedAt: new Date().toISOString(),
    });
    return { success: true, strategy: winningStrategy, locator: resolvedLocator, durationMs };
  }

  // All strategies exhausted
  writeTelemetry({
    timestamp: new Date().toISOString(), entity, field: logicalName,
    originalLocator: logicalName, resolvedLocator: null,
    strategy: 'none', durationMs, success: false, promoted: false,
  });
  writeResolutionReport({
    field: `${entity}.${logicalName}`,
    attempts: attemptsLog,
    winningStrategy: null,
    success: false,
    generatedAt: new Date().toISOString(),
  });

  return { success: false, strategy: 'none', locator: null, durationMs };
}

/**
 * Convenience form: resolveField(page, entity, logicalName, metadata?)
 */
async function resolveField(page, entity, logicalName, metadata) {
  return resolveLocator({ entity, logicalName, page, metadata });
}

/**
 * Alias for resolveLocator — accepts full options object.
 */
async function resolveEntityField(options) {
  return resolveLocator(options);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  resolveLocator,
  resolveField,
  resolveEntityField,
  buildStrategyCandidates,
  isAuthPage,
  writeTelemetry,
  writeResolutionReport,
  AuthenticationRecoveryError,
  APP_FIELD_ALIASES,
  APP_ROLES,
  TELEMETRY_FILE,
  RESOLUTION_REPORT,
};
