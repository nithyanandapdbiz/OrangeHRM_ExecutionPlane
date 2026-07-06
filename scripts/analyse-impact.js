'use strict';
/**
 * analyse-impact.js  —  Proactive Healer Stage 1
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspect the most recent git diff, map changed application files to the
 * Page Objects (and therefore the Zephyr test cases / Playwright specs) that
 * could be affected, and emit an impact manifest consumed by
 * scripts/proactive-healer.js.
 *
 * Contract:
 *   Input  : git history (HEAD~1..HEAD) or origin/${GITHUB_BASE_REF}...HEAD
 *   Output : ./impact-manifest.json
 *   Exit 0 : always (empty manifest is a valid outcome)
 *   Exit 1 : only on an unhandled exception
 *
 * Usage:
 *   node scripts/analyse-impact.js
 */

require('dotenv').config();
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const logger          = require('../src/utils/logger');
const { loadLocators } = require('../tests/helpers/locatorLoader');

const ROOT       = path.resolve(__dirname, '..');
const PAGES_DIR  = path.join(ROOT, 'tests', 'pages');
const SPECS_DIR  = path.join(ROOT, 'tests', 'specs');
const MANIFEST   = path.join(ROOT, 'impact-manifest.json');

// ─── Source-path → PageObject map ────────────────────────────────────────────
// Populated dynamically from tests/pages/ — no application-specific page names hardcoded.
function buildPageObjectMap() {
  const map = [];
  const pagesDir = path.join(ROOT, 'tests', 'pages');
  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir)) {
      const m = f.match(/^([A-Za-z0-9]+Page)\.(yml|js)$/);
      if (m && f.endsWith('.js')) {
        map.push({
          pattern: new RegExp(`^tests[\\/]pages[\\/]${m[1]}`, 'i'),
          pages:   [m[1]]
        });
      }
    }
  }
  return map;
}
const PAGE_OBJECT_MAP = buildPageObjectMap();

// ─── Atomic JSON writer ──────────────────────────────────────────────────────
/**
 * Atomically serialise `data` as JSON to `filePath`.
 * Writes to `<filePath>.tmp` first and renames on success, preventing
 * corrupt manifest files if the process is interrupted mid-write.
 *
 * @param {string} filePath  Absolute path of the target file.
 * @param {object} data      JSON-serialisable value.
 */
function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─── Git diff → changed files ────────────────────────────────────────────────
/**
 * Resolve the list of changed files since the last commit (or PR base).
 * Honours `GITHUB_BASE_REF` the same way scripts/resolve-affected-pages.js does.
 *
 * @returns {string[]} Array of repository-relative file paths (forward slashes).
 */
function getChangedFiles() {
  try {
    const cmd = process.env.GITHUB_BASE_REF
      ? `git diff --name-only origin/${process.env.GITHUB_BASE_REF}...HEAD`
      : 'git diff --name-only HEAD~1 HEAD';
    const raw = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
    return raw.split('\n').map(f => f.trim()).filter(Boolean).map(f => f.replace(/\\/g, '/'));
  } catch (err) {
    logger.warn(`[analyse-impact] git diff failed: ${err.message}`);
    return [];
  }
}

/**
 * Retain files that live in application directories and exclude spec files.
 * We only care about source changes (src/**) and page-object definitions
 * (tests/pages/**); specs themselves drive no impact analysis.
 *
 * @param {string[]} files  Raw list from `getChangedFiles()`.
 * @returns {string[]}      Filtered list suitable for impact mapping.
 */
function filterApplicationFiles(files) {
  return files.filter(f =>
    (f.startsWith('src/') || f.startsWith('tests/pages/')) && !f.startsWith('tests/specs/')
  );
}

// ─── File → PageObject mapping ───────────────────────────────────────────────
/**
 * Map changed files to affected Page Object names using `PAGE_OBJECT_MAP`.
 *
 * @param {string[]} files  Filtered application files.
 * @returns {string[]}      Deduplicated Page Object names (e.g. ['DashboardPage']).
 */
function mapFilesToPageObjects(files) {
  const set = new Set();
  for (const file of files) {
    for (const { pattern, pages } of PAGE_OBJECT_MAP) {
      if (pattern.test(file)) pages.forEach(p => set.add(p));
    }
  }
  return [...set];
}

// ─── PageObject → locator snapshot ───────────────────────────────────────────
/**
 * Build a snapshot of the current locators for each affected Page Object.
 * Reads `tests/pages/<PageName>.yml` via `loadLocators`.
 *
 * @param {string[]} pageNames  List of Page Object names.
 * @returns {Array<{pageName:string,ymlPath:string,jsPath:string,currentLocators:object}>}
 */
function snapshotPageObjects(pageNames) {
  const out = [];
  for (const pageName of pageNames) {
    const ymlPath = path.join(PAGES_DIR, `${pageName}.yml`);
    const jsPath  = path.join(PAGES_DIR, `${pageName}.js`);
    if (!fs.existsSync(ymlPath)) {
      logger.warn(`[analyse-impact] Missing YAML for ${pageName}: ${ymlPath}`);
      continue;
    }
    let currentLocators = {};
    try {
      currentLocators = loadLocators(ymlPath);
    } catch (err) {
      logger.warn(`[analyse-impact] Failed to parse ${ymlPath}: ${err.message}`);
    }
    out.push({
      pageName,
      ymlPath: path.relative(ROOT, ymlPath).replace(/\\/g, '/'),
      jsPath:  path.relative(ROOT, jsPath).replace(/\\/g, '/'),
      currentLocators,
    });
  }
  return out;
}

// ─── Spec discovery ──────────────────────────────────────────────────────────
/**
 * Discover spec files that reference any of the affected Page Object names.
 * A spec is considered "affected" when the page object identifier
 * (exact-case) appears anywhere in the file body.
 *
 * @param {string[]} pageNames  Affected Page Object names.
 * @returns {{affectedSpecFiles:string[], affectedTestKeys:string[]}}
 */
function findAffectedSpecs(pageNames) {
  const affectedSpecFiles = [];
  const affectedTestKeys  = new Set();
  if (!fs.existsSync(SPECS_DIR) || pageNames.length === 0) {
    return { affectedSpecFiles, affectedTestKeys: [] };
  }
  const files = fs.readdirSync(SPECS_DIR).filter(f => f.endsWith('.spec.js'));
  for (const file of files) {
    const full = path.join(SPECS_DIR, file);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const matched = pageNames.some(p => content.includes(p));
    if (!matched) continue;

    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    affectedSpecFiles.push(rel);

    const keyMatch = file.match(/^(OHRM-T\d+)/i);
    if (keyMatch) affectedTestKeys.add(keyMatch[1].toUpperCase());
  }
  return { affectedSpecFiles, affectedTestKeys: [...affectedTestKeys] };
}

// ─── Main ────────────────────────────────────────────────────────────────────
/**
 * Produce the impact manifest.
 *
 * @returns {Promise<object>} The manifest object that was written to disk.
 *
 * @example
 *   // Given:
 *   //   changed: ['src/auth/login.service.js']
 *   // Produces impact-manifest.json:
 *   // {
 *   //   "timestamp": "2026-04-21T10:30:00.000Z",
 *   //   "changedFiles": ["src/services/dashboard.service.js"],
 *   //   "affectedPages": [
 *   //     { "pageName": "DashboardPage", "ymlPath": "tests/pages/DashboardPage.yml",
 *   //       "jsPath": "tests/pages/DashboardPage.js",
 *   //       "currentLocators": { "titleInput": "input[name=\"title\"]" } }
 *   //   ],
 *   //   "affectedTestKeys": ["OHRM-T138"],
 *   //   "affectedSpecFiles": ["tests/specs/OHRM-T138_verify_dashboard.spec.js"]
 *   // }
 */
async function analyseImpact() {
  const started = Date.now();
  const rawChanged        = getChangedFiles();
  const changedFiles      = filterApplicationFiles(rawChanged);
  const pageNames         = mapFilesToPageObjects(changedFiles);
  const affectedPages     = snapshotPageObjects(pageNames);
  const { affectedSpecFiles, affectedTestKeys } = findAffectedSpecs(pageNames);

  const manifest = {
    timestamp:         new Date().toISOString(),
    changedFiles,
    affectedPages,
    affectedTestKeys,
    affectedSpecFiles,
  };

  writeJsonAtomic(MANIFEST, manifest);

  // Human-readable stdout summary
  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(' Proactive Impact Analysis');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Changed files       : ${changedFiles.length}`);
  console.log(`  Affected pages      : ${affectedPages.length}${affectedPages.length ? '  (' + affectedPages.map(p => p.pageName).join(', ') + ')' : ''}`);
  console.log(`  Affected specs      : ${affectedSpecFiles.length}`);
  console.log(`  Zephyr test cases   : ${affectedTestKeys.length}`);
  console.log(`  Manifest            : ${path.relative(ROOT, MANIFEST).replace(/\\/g, '/')}`);
  console.log(`  Elapsed             : ${((Date.now() - started) / 1000).toFixed(2)}s`);
  console.log('───────────────────────────────────────────────────────────────');
  if (affectedPages.length === 0) {
    console.log('  No UI-layer changes detected — proactive heal not required.');
  }
  console.log('');

  return manifest;
}

if (require.main === module) {
  analyseImpact()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error(`[analyse-impact] FATAL: ${err.stack || err.message}`);
      process.exit(1);
    });
}

module.exports = {
  analyseImpact,
  getChangedFiles,
  filterApplicationFiles,
  mapFilesToPageObjects,
  snapshotPageObjects,
  findAffectedSpecs,
  PAGE_OBJECT_MAP,
};
