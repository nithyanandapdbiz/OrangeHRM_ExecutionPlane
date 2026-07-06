'use strict';
/**
 * locatorIntelligence.js — WI-036 Phase 4/5
 *
 * Manages the locator intelligence cache at .cache/locator-intelligence.json.
 * Each entry records the locator that resolved successfully for a module+field
 * pair, along with success metrics and promotion status.
 *
 * Cache schema per entry:
 *   {
 *     resolvedLocator: string,   — selector / label / role name that worked
 *     strategy:        string,   — name of the winning strategy
 *     selectorType:    string,   — 'css' | 'label' | 'role' | 'text'
 *     successCount:    number,
 *     promoted:        boolean,  — true once successCount >= LOCATOR_PROMOTION_THRESHOLD
 *     firstSeen:       ISO date,
 *     lastUsed:        ISO date,
 *   }
 *
 * Auto-promotion:
 *   When successCount reaches LOCATOR_PROMOTION_THRESHOLD (default 10) the entry
 *   is marked promoted=true and the resolver will try it as the first candidate
 *   on future runs.
 *
 * Public API:
 *   buildKey(entity, logicalName)               → string
 *   getCachedLocator(key, cacheFile?)           → entry | null
 *   recordSuccess(key, locator, strategy, ...)  → entry
 *   isPromoted(key, cacheFile?)                 → boolean
 *   getAll(cacheFile?)                          → { [key]: entry }
 *   clearCache(cacheFile?)                      → void
 */

const fs   = require('fs');
const path = require('path');

const DEFAULT_CACHE_FILE = path.resolve(__dirname, '..', '..', '.cache', 'locator-intelligence.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _promotionThreshold() {
  const v = parseInt(process.env.LOCATOR_PROMOTION_THRESHOLD || '10', 10);
  return isNaN(v) || v < 1 ? 10 : v;
}

function _load(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function _save(data, file) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* cache write failure is non-critical */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the canonical cache key for a module+field pair.
 * Keys are always lowercase: 'pim.firstname', 'admin.username', etc.
 *
 * @param {string} entity      — e.g. 'PIM' or 'pim'
 * @param {string} logicalName — e.g. 'firstName'
 * @returns {string}
 */
function buildKey(entity, logicalName) {
  return `${entity}.${logicalName}`.toLowerCase();
}

/**
 * Get a cached locator entry, or null if the key is not in the cache.
 *
 * @param {string} key         — e.g. 'pim.firstname'
 * @param {string} [cacheFile] — override path (for testing)
 * @returns {object|null}
 */
function getCachedLocator(key, cacheFile) {
  const data = _load(cacheFile || DEFAULT_CACHE_FILE);
  return data[key] || null;
}

/**
 * Record a successful locator resolution.
 * Increments successCount and auto-promotes when the threshold is reached.
 *
 * @param {string} key
 * @param {string} resolvedLocator — the selector / label / role that worked
 * @param {string} strategy        — winning strategy key
 * @param {string} [cacheFile]
 * @param {string} [selectorType]  — 'css' | 'label' | 'role' | 'text'
 * @returns {object} updated cache entry
 */
function recordSuccess(key, resolvedLocator, strategy, cacheFile, selectorType) {
  const file     = cacheFile || DEFAULT_CACHE_FILE;
  const data     = _load(file);
  const existing = data[key];
  const now      = new Date().toISOString();

  const entry = {
    resolvedLocator,
    strategy,
    selectorType:  selectorType || existing?.selectorType || 'css',
    successCount:  (existing?.successCount || 0) + 1,
    promoted:      existing?.promoted || false,
    firstSeen:     existing?.firstSeen || now,
    lastUsed:      now,
  };

  if (!entry.promoted && entry.successCount >= _promotionThreshold()) {
    entry.promoted = true;
  }

  data[key] = entry;
  _save(data, file);
  return entry;
}

/**
 * Return true if the given key has been promoted
 * (successCount reached the promotion threshold).
 *
 * @param {string} key
 * @param {string} [cacheFile]
 * @returns {boolean}
 */
function isPromoted(key, cacheFile) {
  const entry = getCachedLocator(key, cacheFile);
  return !!(entry && entry.promoted);
}

/**
 * Return the entire intelligence cache as a plain object.
 *
 * @param {string} [cacheFile]
 * @returns {{ [key: string]: object }}
 */
function getAll(cacheFile) {
  return _load(cacheFile || DEFAULT_CACHE_FILE);
}

/**
 * Reset the intelligence cache to an empty object.
 *
 * @param {string} [cacheFile]
 */
function clearCache(cacheFile) {
  _save({}, cacheFile || DEFAULT_CACHE_FILE);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  DEFAULT_CACHE_FILE,
  buildKey,
  getCachedLocator,
  recordSuccess,
  isPromoted,
  getAll,
  clearCache,
};
