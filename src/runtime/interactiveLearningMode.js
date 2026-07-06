'use strict';
/**
 * interactiveLearningMode.js  —  WI-042B Phases 7–10
 * ─────────────────────────────────────────────────────────────────────────────
 * Supported HEAL_MODE values:
 *   off          — no healing, no interactivity
 *   auto         — healer runs automatically (default)
 *   interactive  — pauses on locator failure and captures human corrections
 *
 * Public API:
 *   getHealMode()                      → 'off'|'auto'|'interactive'
 *   isInteractive()                    → boolean
 *   onLocatorFailure(ctx)              → void   (Phase 8 — pause & report)
 *   loadLocatorIntelligence()          → object
 *   saveLocatorIntelligence(data)      → void
 *   learnSelector(entity, action, sel) → void   (Phase 9)
 *   getLearnedSelector(entity, action) → string|null
 *   recordSelectorSuccess(entity, action) → void  (Phase 10 — promotion)
 */

const fs   = require('fs');
const path = require('path');

const ROOT             = path.resolve(__dirname, '..', '..');
const CACHE_DIR        = path.join(ROOT, '.cache');
const REPORTS_DIR      = path.join(ROOT, 'reports');
const INTELLIGENCE_FILE = path.join(CACHE_DIR, 'locator-intelligence.json');
const PROMOTION_HISTORY = path.join(REPORTS_DIR, 'locator-promotion-history.json');
const SESSION_REPORT    = path.join(REPORTS_DIR, 'interactive-healing-session.json');

const PROMOTION_THRESHOLD = 10;

const EMPTY_CACHE = () => ({ version: 1, selectors: [] });

// ─── Phase 5+6 — Cache schema validation + self-healing ───────────────────────

/**
 * Validate and if necessary repair the locator intelligence cache.
 * Writes locator-cache-validation.json and locator-cache-recovery.json.
 *
 * Missing file  → create fresh default cache
 * Corrupt JSON  → rename to .corrupt.json, create fresh cache
 * Missing field → patch in-place
 *
 * @returns {{ version: number, selectors: Array }}  — always a valid object
 */
function loadLocatorCache() {
  const reportsDir = REPORTS_DIR;

  // Case 1: file does not exist
  if (!fs.existsSync(INTELLIGENCE_FILE)) {
    const fresh = EMPTY_CACHE();
    _saveCacheFile(fresh);
    _writeCacheValidation({ status: 'created', reason: 'file not found', recovered: true });
    return fresh;
  }

  // Case 2: file exists — try to parse
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(INTELLIGENCE_FILE, 'utf8'));
  } catch (err) {
    // Corrupt JSON — rename and create fresh
    const corruptDest = INTELLIGENCE_FILE.replace('.json', '.corrupt.json');
    try { fs.renameSync(INTELLIGENCE_FILE, corruptDest); } catch { /* best-effort */ }
    const fresh = EMPTY_CACHE();
    _saveCacheFile(fresh);
    _writeCacheValidation({ status: 'recovered', reason: `corrupt JSON: ${err.message}`, corruptFile: corruptDest, recovered: true });
    _writeCacheRecovery({ action: 'renamed-corrupt', corruptFile: corruptDest, newFile: INTELLIGENCE_FILE });
    return fresh;
  }

  // Case 3: parsed but missing/invalid selectors field
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.selectors)) {
    parsed = { ...EMPTY_CACHE(), ...(parsed && typeof parsed === 'object' ? parsed : {}), selectors: [] };
    _saveCacheFile(parsed);
    _writeCacheValidation({ status: 'repaired', reason: 'selectors field missing or not an array', recovered: true });
  } else {
    _writeCacheValidation({ status: 'ok', reason: 'schema valid', recovered: false });
  }

  return parsed;
}

function _saveCacheFile(data) {
  try {
    ensureDir(CACHE_DIR);
    fs.writeFileSync(INTELLIGENCE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

function _writeCacheValidation(details) {
  try {
    ensureDir(REPORTS_DIR);
    fs.writeFileSync(
      path.join(REPORTS_DIR, 'locator-cache-validation.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...details }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

function _writeCacheRecovery(details) {
  try {
    ensureDir(REPORTS_DIR);
    fs.writeFileSync(
      path.join(REPORTS_DIR, 'locator-cache-recovery.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...details }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

// ─── Phase 7 — Mode support ───────────────────────────────────────────────────
function getHealMode() {
  const raw = (process.env.HEAL_MODE || 'auto').toLowerCase().trim();
  if (['off', 'auto', 'interactive'].includes(raw)) return raw;
  console.warn(`[InteractiveLearning] Unknown HEAL_MODE="${raw}" — falling back to "auto"`);
  return 'auto';
}

function isInteractive() { return getHealMode() === 'interactive'; }

// ─── Phase 9 — Locator intelligence store ────────────────────────────────────

/**
 * Load the locator intelligence cache with full schema validation.
 * Never returns an object without a valid `selectors` array.
 */
function loadLocatorIntelligence() {
  return loadLocatorCache();
}

function saveLocatorIntelligence(data) {
  // Defensive: always write a valid schema even if caller passes bad data
  const safe = {
    version:   data?.version   ?? 1,
    selectors: Array.isArray(data?.selectors) ? data.selectors : [],
  };
  ensureDir(CACHE_DIR);
  fs.writeFileSync(INTELLIGENCE_FILE, JSON.stringify(safe, null, 2), 'utf8');
}

/**
 * Persist a human-learned selector.
 *
 * @param {string} entity   — e.g. "PIM"
 * @param {string} action   — e.g. "SaveEmployee"
 * @param {string} selector — e.g. "button[type='submit']"
 * @param {object} [attrs]  — captured attributes (name, aria-label, role, title, text)
 */
function learnSelector(entity, action, selector, attrs = {}) {
  const data      = loadLocatorIntelligence();
  const selectors = Array.isArray(data.selectors) ? data.selectors : [];
  const existing  = selectors.find(s => s.entity === entity && s.action === action);

  if (existing) {
    existing.selector             = selector;
    existing.attrs                = attrs;
    existing.learnedBy            = 'human';
    existing.confidence           = 1.0;
    existing.status               = 'learned';
    existing.consecutiveSuccesses = 0;
    existing.updatedAt            = new Date().toISOString();
  } else {
    selectors.push({
      entity,
      action,
      selector,
      attrs,
      learnedBy:            'human',
      confidence:           1.0,
      status:               'learned',
      consecutiveSuccesses: 0,
      learnedAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
    });
    data.selectors = selectors;
  }
  saveLocatorIntelligence(data);
  console.log(`[InteractiveLearning] Learned selector: ${entity}.${action} → ${selector}`);
}

/**
 * Return the best known selector for entity+action.
 * Human-learned selectors outrank AI-generated selectors.
 * Returns null if nothing is known.
 */
function getLearnedSelector(entity, action) {
  const data      = loadLocatorIntelligence();
  const selectors = Array.isArray(data?.selectors) ? data.selectors : [];
  const match     = selectors.find(s =>
    s.entity === entity && s.action === action &&
    (s.status === 'learned' || s.status === 'promoted')
  );
  return match?.selector ?? null;
}

// ─── Phase 10 — Promotion ─────────────────────────────────────────────────────
/**
 * Record a successful use of the learned selector.
 * After PROMOTION_THRESHOLD consecutive successes, promote the selector.
 */
function recordSelectorSuccess(entity, action) {
  const data      = loadLocatorIntelligence();
  const selectors = Array.isArray(data?.selectors) ? data.selectors : [];
  const entry     = selectors.find(s => s.entity === entity && s.action === action);
  if (!entry) return;

  entry.consecutiveSuccesses = (entry.consecutiveSuccesses || 0) + 1;
  entry.updatedAt = new Date().toISOString();

  if (entry.consecutiveSuccesses >= PROMOTION_THRESHOLD && entry.status !== 'promoted') {
    entry.status     = 'promoted';
    entry.promotedAt = new Date().toISOString();
    console.log(`[InteractiveLearning] PROMOTED: ${entity}.${action} → ${entry.selector} (${PROMOTION_THRESHOLD} consecutive successes)`);
    _recordPromotion(entity, action, entry.selector, entry.consecutiveSuccesses);
  }

  data.selectors = selectors;
  saveLocatorIntelligence(data);
}

function _recordPromotion(entity, action, selector, streak) {
  ensureDir(REPORTS_DIR);
  const history = (() => {
    try { return JSON.parse(fs.readFileSync(PROMOTION_HISTORY, 'utf8')); }
    catch { return []; }
  })();
  history.push({
    timestamp: new Date().toISOString(),
    entity,
    action,
    selector,
    consecutiveSuccesses: streak,
    status: 'promoted',
  });
  fs.writeFileSync(PROMOTION_HISTORY, JSON.stringify(history, null, 2), 'utf8');
}

// ─── Phase 8 — Interactive failure pause ─────────────────────────────────────
/**
 * Called when a locator resolution fails in interactive mode.
 * Records context to reports/interactive-healing-session.json.
 * In a real terminal context this would pause for stdin; in CI it logs and continues.
 *
 * @param {object} ctx
 *   ctx.entity          — e.g. "PIM"
 *   ctx.action          — e.g. "SaveEmployee"
 *   ctx.expectedLocator — the selector that failed
 *   ctx.url             — current page URL
 *   ctx.candidateElements — array of { selector, text, ariaLabel, role, title }
 */
function onLocatorFailure(ctx) {
  const session = _loadOrCreateSession();

  const entry = {
    timestamp:        new Date().toISOString(),
    entity:           ctx.entity           || 'Unknown',
    action:           ctx.action           || 'Unknown',
    expectedLocator:  ctx.expectedLocator  || '',
    currentUrl:       ctx.url              || '',
    currentEntity:    ctx.currentEntity    || ctx.entity || '',
    candidateElements: ctx.candidateElements || [],
    resolution:       'pending',
  };

  session.failures.push(entry);
  session.totalFailures = session.failures.length;
  session.lastUpdated   = new Date().toISOString();
  _saveSession(session);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   INTERACTIVE HEALING — Locator Failure              ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Entity   : ${entry.entity}`);
  console.log(`  Action   : ${entry.action}`);
  console.log(`  URL      : ${entry.currentUrl}`);
  console.log(`  Failed   : ${entry.expectedLocator}`);

  if (entry.candidateElements.length > 0) {
    console.log('\n  Candidate elements:');
    for (let i = 0; i < Math.min(entry.candidateElements.length, 8); i++) {
      const el = entry.candidateElements[i];
      console.log(`    [${i + 1}] ${el.selector || ''}  text="${el.text || ''}"  aria="${el.ariaLabel || ''}"  title="${el.title || ''}"`);
    }
  }

  console.log('\n  To teach the framework the correct selector, call:');
  console.log(`    learnSelector("${entry.entity}", "${entry.action}", "<selector>")`);
  console.log('\n  See reports/interactive-healing-session.json for full context.');
  console.log('──────────────────────────────────────────────────────\n');
}

function _loadOrCreateSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_REPORT, 'utf8'));
  } catch {
    return {
      startedAt:     new Date().toISOString(),
      lastUpdated:   new Date().toISOString(),
      healMode:      getHealMode(),
      totalFailures: 0,
      failures:      [],
    };
  }
}

function _saveSession(data) {
  ensureDir(REPORTS_DIR);
  fs.writeFileSync(SESSION_REPORT, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  getHealMode,
  isInteractive,
  onLocatorFailure,
  loadLocatorCache,
  loadLocatorIntelligence,
  saveLocatorIntelligence,
  learnSelector,
  getLearnedSelector,
  recordSelectorSuccess,
  PROMOTION_THRESHOLD,
};
