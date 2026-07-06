#!/usr/bin/env node
'use strict';
/**
 * validate-step-registry.js — Step Registry Validation  (WI-038C)
 *
 * Checks:
 *   STEP_REGISTRY.NO_DUPLICATE_PATTERNS  — same step regex/string defined in 2+ files
 *   STEP_REGISTRY.NO_HOOKS_IN_STEP_FILES — Before/BeforeAll/After/AfterAll outside hooks.js
 *   STEP_REGISTRY.NO_APP_VOCABULARY     — no OrangeHRM vocabulary in features or step-defs
 *
 * Exit codes:
 *   0 — all validations pass
 *   4 — duplicate step patterns detected
 *   5 — hooks found in step definition files
 *   6 — OrangeHRM vocabulary detected
 *
 * Usage:
 *   node scripts/validate-step-registry.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const STEP_DEFS_DIR = path.join(ROOT, 'tests', 'step-definitions');
const SUPPORT_DIR   = path.join(ROOT, 'tests', 'support');
const FEATURES_DIR  = path.join(ROOT, 'tests', 'features');

// ─── File collection ──────────────────────────────────────────────────────────

function collectFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full, ext));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

// ─── Check 1: No duplicate step patterns ─────────────────────────────────────

function extractStepPatterns(source) {
  const patterns = [];
  const re = /\b(?:Given|When|Then)\s*\(\s*(\/[^/\n]+\/[gimsuy]*|'[^'\n]*'|"[^"\n]*")/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    patterns.push(m[1]);
  }
  return patterns;
}

function checkNoDuplicatePatterns() {
  const stepFiles = [
    ...collectFiles(STEP_DEFS_DIR, '.js'),
    ...collectFiles(SUPPORT_DIR, '.js'),
  ];

  const patternMap = new Map();

  for (const file of stepFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of extractStepPatterns(source)) {
      const existing = patternMap.get(pattern) || [];
      existing.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      patternMap.set(pattern, existing);
    }
  }

  const duplicates = [];
  for (const [pattern, files] of patternMap.entries()) {
    if (files.length > 1) duplicates.push({ pattern, files });
  }

  return { pass: duplicates.length === 0, duplicates, scanned: stepFiles.length };
}

// ─── Check 2: No hooks in step-definition files ───────────────────────────────

const HOOK_RE = /\b(Before|BeforeAll|After|AfterAll)\s*\(/;

function checkNoHooksInStepFiles() {
  const stepFiles = collectFiles(STEP_DEFS_DIR, '.js');
  const violations = [];

  for (const file of stepFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (HOOK_RE.test(line) && !line.trim().startsWith('//')) {
        violations.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line: i + 1,
          text: line.trim(),
        });
      }
    });
  }

  return { pass: violations.length === 0, violations };
}

// ─── Check 3: App-agnostic — no OrangeHRM vocabulary ─────────────────────────

const ORANGEHRM_TERMS = [
  'OrangeHRM',
  'orangehrm',
  'Employee ID',
  'Employee Profile',
  'Employee List',
  'Employee Detail',
  'admin123',
  'autotest01',
  'Leave Balance',
  'Leave Type',
  'Leave Approval',
  'Annual Leave',
  'Sick Leave',
];

function checkNoAppVocabulary() {
  const featureFiles = collectFiles(FEATURES_DIR, '.feature');
  const stepFiles    = collectFiles(STEP_DEFS_DIR, '.js');
  const violations   = [];
  const seen         = new Set();

  for (const file of [...featureFiles, ...stepFiles]) {
    const source = fs.readFileSync(file, 'utf8');
    for (const term of ORANGEHRM_TERMS) {
      const key = `${file}::${term}`;
      if (source.includes(term) && !seen.has(key)) {
        seen.add(key);
        violations.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), term });
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function validateStepRegistry() {
  const results = [];

  const dup = checkNoDuplicatePatterns();
  results.push({
    rule:   'STEP_REGISTRY.NO_DUPLICATE_PATTERNS',
    pass:   dup.pass,
    detail: dup.pass
      ? `No duplicate step patterns across ${dup.scanned} step definition file(s)`
      : `${dup.duplicates.length} duplicate pattern(s) found:\n` +
        dup.duplicates.map(d =>
          `    ${d.pattern}\n      → ${d.files.join('\n      → ')}`
        ).join('\n'),
  });

  const hook = checkNoHooksInStepFiles();
  results.push({
    rule:   'STEP_REGISTRY.NO_HOOKS_IN_STEP_FILES',
    pass:   hook.pass,
    detail: hook.pass
      ? 'No lifecycle hooks found in step-definition files'
      : `${hook.violations.length} hook(s) found outside tests/support/hooks.js:\n` +
        hook.violations.map(v => `    ${v.file}:${v.line}  ${v.text}`).join('\n'),
  });

  const vocab = checkNoAppVocabulary();
  results.push({
    rule:   'STEP_REGISTRY.NO_APP_VOCABULARY',
    pass:   vocab.pass,
    detail: vocab.pass
      ? 'No OrangeHRM vocabulary detected in features or step definitions'
      : `${vocab.violations.length} OrangeHRM term(s) detected:\n` +
        vocab.violations.map(v => `    ${v.file}  [${v.term}]`).join('\n'),
  });

  const valid = results.every(r => r.pass);
  return { valid, results };
}

// ─── CLI runner ───────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  Step Registry Validator  (WI-038C)                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const { valid, results } = validateStepRegistry();

  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} [${r.rule}]`);
    console.log(`      ${r.detail}\n`);
  }

  if (!valid) {
    const failed = results.filter(r => !r.pass);
    const isDup  = failed.some(r => r.rule.includes('NO_DUPLICATE_PATTERNS'));
    const isHook = failed.some(r => r.rule.includes('NO_HOOKS_IN_STEP_FILES'));
    const isVocab = failed.some(r => r.rule.includes('NO_APP_VOCABULARY'));

    console.error('  STEP_REGISTRY_VIOLATION: one or more checks failed.\n');
    if (isDup)  console.error('  ► Remove duplicate step definitions — canonical copy belongs in tests/support/shared.steps.js');
    if (isHook) console.error('  ► Move lifecycle hooks to tests/support/hooks.js');
    if (isVocab) console.error('  ► Remove OrangeHRM vocabulary from features and step definitions');

    process.exit(isDup ? 4 : isHook ? 5 : 6);
  }

  console.log('  All step registry checks PASSED.\n');
  process.exit(0);
}

module.exports = { validateStepRegistry };
