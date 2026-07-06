'use strict';
/**
 * healerPatchValidator.js  —  WI-042B Phases 2–6
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates every healer patch before it is written to disk.
 *
 * Public API:
 *   validatePatch(targetFile, originalContent, patchContent, meta)
 *     → { valid: boolean, violations: string[], quarantinePath: string|null }
 *
 *   applyPatch(targetFile, originalContent, patchContent, meta)
 *     → boolean  (false = rejected)
 *
 *   loadPatchHistory()  → array
 *   recordPatchHistory(entry)  → void
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const crypto        = require('crypto');

const ROOT            = path.resolve(__dirname, '..', '..');
const QUARANTINE_DIR  = path.join(ROOT, '.healer', 'quarantine');
const REPORTS_DIR     = path.join(ROOT, 'reports');
const PATCH_HISTORY   = path.join(REPORTS_DIR, 'healer-patch-history.json');

// ─── Phase 3 — Forbidden patterns ─────────────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  {
    pattern:     /waitForLoadState\s*\(\s*['"`]networkidle['"`]/,
    description: "networkidle usage — the OrangeHRM React SPA never fully idles; causes indefinite hang",
    severity:    'error',
  },
  {
    pattern:     /await\s+page\.waitForLoadState/,
    description: "bare 'await page.waitForLoadState' injected by healer — scope not verified",
    severity:    'error',
  },
  {
    pattern:     /^import\s+/m,
    description: "ESM import statement in CommonJS file",
    severity:    'error',
  },
  {
    pattern:     /^export\s+(default|const|function|class)\s/m,
    description: "ESM export statement in CommonJS file",
    severity:    'error',
  },
  {
    pattern:     /require\s*\(\s*['"`]fs\/promises['"`]\s*\)/,
    description: "fs/promises import — not supported in older Node targets used by this project",
    severity:    'warning',
  },
];

// ─── Top-level await detection ────────────────────────────────────────────────
// Walk through the patch lines; any 'await' that is not inside a function body
// (detected by checking brace depth) is top-level.
function hasTopLevelAwait(patchContent) {
  const lines = patchContent.split('\n');
  let depth   = 0;
  for (const line of lines) {
    const stripped = line.replace(/\/\/.*$/, '').replace(/`[^`]*`/g, '""'); // strip comments/template literals
    for (const ch of stripped) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    // If we're outside all braces (depth 0) and the line has await, it's top-level
    if (depth === 0 && /\bawait\b/.test(stripped)) {
      return true;
    }
  }
  return false;
}

// ─── Duplicate step definition detection ─────────────────────────────────────
function findDuplicateSteps(originalContent, patchContent) {
  const stepPattern = /(?:Given|When|Then|And|But)\s*\(\s*(?:\/([^/]+)\/[gimsuy]*|'([^']+)'|"([^"]+)")/g;

  function extractSteps(text) {
    const found = new Set();
    let m;
    while ((m = stepPattern.exec(text)) !== null) {
      found.add(m[1] || m[2] || m[3]);
    }
    stepPattern.lastIndex = 0;
    return found;
  }

  const origSteps  = extractSteps(originalContent);
  const patchSteps = extractSteps(patchContent);
  const dupes      = [...patchSteps].filter(s => origSteps.has(s));
  return dupes;
}

// ─── Duplicate hook detection ─────────────────────────────────────────────────
function findDuplicateHooks(originalContent, patchContent) {
  const hookPattern = /\b(Before|After|BeforeAll|AfterAll)\s*\(/g;

  function countHooks(text) {
    const found = {};
    let m;
    while ((m = hookPattern.exec(text)) !== null) {
      found[m[1]] = (found[m[1]] || 0) + 1;
    }
    hookPattern.lastIndex = 0;
    return found;
  }

  const origHooks  = countHooks(originalContent);
  const patchHooks = countHooks(patchContent);
  const dupes      = [];
  for (const [hook, count] of Object.entries(patchHooks)) {
    if (origHooks[hook] && count > 0) {
      dupes.push(hook);
    }
  }
  return dupes;
}

// ─── Phase 4 — JavaScript syntax gate ────────────────────────────────────────
function checkSyntax(combinedContent) {
  const tmpFile = path.join(QUARANTINE_DIR, `_syntax-check-${Date.now()}.js`);
  ensureDir(QUARANTINE_DIR);
  try {
    fs.writeFileSync(tmpFile, combinedContent, 'utf8');
    execSync(`node --check "${tmpFile}"`, { stdio: 'pipe', timeout: 10000 });
    return { ok: true, error: null };
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || '').split('\n')[0];
    return { ok: false, error: msg };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ─── Phase 5 — Quarantine ─────────────────────────────────────────────────────
function quarantinePatch(targetFile, patchContent, reason) {
  ensureDir(QUARANTINE_DIR);
  const base      = path.basename(targetFile);
  const ts        = new Date().toISOString().replace(/[:.]/g, '-');
  const qFile     = path.join(QUARANTINE_DIR, `${base}.${ts}.patch`);
  const manifest  = {
    timestamp:  new Date().toISOString(),
    targetFile,
    reason,
    patchContent,
    status:     'quarantined',
  };
  fs.writeFileSync(qFile, JSON.stringify(manifest, null, 2), 'utf8');
  return qFile;
}

// ─── Phase 6 — Patch history ──────────────────────────────────────────────────
function loadPatchHistory() {
  try {
    return JSON.parse(fs.readFileSync(PATCH_HISTORY, 'utf8'));
  } catch {
    return [];
  }
}

function recordPatchHistory(entry) {
  ensureDir(REPORTS_DIR);
  const history = loadPatchHistory();
  history.push({
    timestamp:  entry.timestamp || new Date().toISOString(),
    healer:     entry.healer     || 'unknown',
    file:       entry.file,
    reason:     entry.reason     || '',
    approved:   entry.approved   === true,
    violations: entry.violations || [],
    quarantinePath: entry.quarantinePath || null,
    patchHash:  entry.patchHash  || null,
  });
  fs.writeFileSync(PATCH_HISTORY, JSON.stringify(history, null, 2), 'utf8');
}

// ─── Core validation ──────────────────────────────────────────────────────────
/**
 * Validate a patch before it is written.
 *
 * @param {string} targetFile        — absolute path to the file being patched
 * @param {string} originalContent   — current file content (before patch)
 * @param {string} patchContent      — the code to be appended/inserted
 * @param {object} [meta]            — { healer, reason }
 * @returns {{ valid: boolean, violations: string[], quarantinePath: string|null }}
 */
function validatePatch(targetFile, originalContent, patchContent, meta = {}) {
  const violations = [];

  // Check 1: top-level await
  if (hasTopLevelAwait(patchContent)) {
    violations.push('TOP_LEVEL_AWAIT: patch contains await outside any function body');
  }

  // Check 2: forbidden patterns
  for (const fp of FORBIDDEN_PATTERNS) {
    if (fp.pattern.test(patchContent)) {
      const severity = fp.severity === 'error' ? 'FORBIDDEN' : 'WARNING';
      violations.push(`${severity}: ${fp.description}`);
    }
  }

  // Check 3: syntax gate (combined file)
  const combined     = originalContent + '\n' + patchContent;
  const syntaxResult = checkSyntax(combined);
  if (!syntaxResult.ok) {
    violations.push(`SYNTAX_ERROR: ${syntaxResult.error}`);
  }

  // Check 4: duplicate step definitions
  const dupSteps = findDuplicateSteps(originalContent, patchContent);
  if (dupSteps.length > 0) {
    violations.push(`DUPLICATE_STEPS: ${dupSteps.join(', ')}`);
  }

  // Check 5: duplicate hooks
  const dupHooks = findDuplicateHooks(originalContent, patchContent);
  if (dupHooks.length > 0) {
    violations.push(`DUPLICATE_HOOKS: ${dupHooks.join(', ')}`);
  }

  const hasErrors  = violations.some(v => v.startsWith('FORBIDDEN') || v.startsWith('TOP_LEVEL') || v.startsWith('SYNTAX'));
  const valid      = !hasErrors;
  const patchHash  = crypto.createHash('sha1').update(patchContent).digest('hex').slice(0, 12);

  // Phase 5: quarantine rejected patches
  let quarantinePath = null;
  if (!valid) {
    quarantinePath = quarantinePatch(
      targetFile,
      patchContent,
      violations.join('; ')
    );
    writeForbiddenPatternsReport(targetFile, violations, patchHash);
    writeSyntaxAuditReport(targetFile, violations, syntaxResult, valid);
  }

  // Phase 6: record history
  recordPatchHistory({
    timestamp:  new Date().toISOString(),
    healer:     meta.healer  || 'unknown',
    file:       path.relative(ROOT, targetFile),
    reason:     meta.reason  || '',
    approved:   valid,
    violations,
    quarantinePath: quarantinePath ? path.relative(ROOT, quarantinePath) : null,
    patchHash,
  });

  return { valid, violations, quarantinePath };
}

// ─── applyPatch ───────────────────────────────────────────────────────────────
/**
 * Validate and, if valid, apply a patch by appending to a file.
 * Restores original on syntax failure.
 *
 * @returns {boolean} true if patch was applied
 */
function applyPatch(targetFile, originalContent, patchContent, meta = {}) {
  const result = validatePatch(targetFile, originalContent, patchContent, meta);

  if (!result.valid) {
    const summary = result.violations.join('; ');
    console.warn(`[HealerPatchValidator] REJECTED — ${path.basename(targetFile)}: ${summary}`);
    if (result.quarantinePath) {
      console.warn(`[HealerPatchValidator] Quarantined at: ${result.quarantinePath}`);
    }
    writeSyntaxAuditReport(targetFile, result.violations, null, false);
    return false;
  }

  try {
    fs.appendFileSync(targetFile, '\n' + patchContent, 'utf8');
    console.log(`[HealerPatchValidator] Applied — ${path.basename(targetFile)}`);
    writeSyntaxAuditReport(targetFile, [], null, true);
    return true;
  } catch (err) {
    // Restore original on write failure
    try { fs.writeFileSync(targetFile, originalContent, 'utf8'); } catch { /* best-effort */ }
    console.error(`[HealerPatchValidator] Write failed, restored original: ${err.message}`);
    return false;
  }
}

// ─── Report writers ───────────────────────────────────────────────────────────
function writeForbiddenPatternsReport(targetFile, violations, patchHash) {
  ensureDir(REPORTS_DIR);
  const report = {
    generatedAt:    new Date().toISOString(),
    file:           path.relative(ROOT, targetFile),
    patchHash,
    forbiddenMatches: violations.filter(v => v.startsWith('FORBIDDEN')),
    topLevelAwait:    violations.some(v => v.startsWith('TOP_LEVEL')),
    banned: [
      "waitForLoadState('networkidle')",
      'waitForLoadState("networkidle")',
      'await page.waitForLoadState',
    ],
    action: 'patch rejected and quarantined',
  };
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'healer-forbidden-patterns.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
}

function writeSyntaxAuditReport(targetFile, violations, syntaxResult, passed) {
  ensureDir(REPORTS_DIR);
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, 'healer-syntax-audit.json'), 'utf8')); }
    catch { return []; }
  })();

  existing.push({
    timestamp:   new Date().toISOString(),
    file:        path.relative(ROOT, targetFile),
    status:      passed ? 'approved' : 'rejected',
    reason:      passed ? null : (violations.find(v => v.startsWith('SYNTAX')) || 'validation failure'),
    syntaxError: syntaxResult?.error || null,
    violations,
  });

  fs.writeFileSync(
    path.join(REPORTS_DIR, 'healer-syntax-audit.json'),
    JSON.stringify(existing, null, 2),
    'utf8'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  validatePatch,
  applyPatch,
  loadPatchHistory,
  recordPatchHistory,
  FORBIDDEN_PATTERNS,
};
