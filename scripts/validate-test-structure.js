#!/usr/bin/env node
'use strict';
/**
 * validate-test-structure.js
 * ---------------------------------------------------------------------------
 * Enforces the two strict repository rules documented in
 * `.github/copilot-instructions.md`:
 *
 *   RULE 1 — Feature files MUST be module-based and story-driven.
 *            tests/features/<module-slug>/<story-slug>.feature
 *            <module-slug> is a kebab-case slug derived from Jira metadata.
 *            Forbidden: _unsorted, misc, story-keyed, or uppercase folders.
 *
 *   RULE 2 — Spec files MUST import from fixtures, not @playwright/test.
 *
 * Exit code 0 = clean, 1 = violations found.
 *
 * Usage:
 *   node scripts/validate-test-structure.js
 *   npm run validate:structure
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FEATURES_ROOT = path.join(ROOT, 'tests', 'features');
const SPEC_ROOTS = ['tests/specs', 'tests/healed', 'tests/generated']
  .map(p => path.join(ROOT, p));

const violations = [];
function violate(rule, message, file) {
  violations.push({ rule, message, file: path.relative(ROOT, file) });
}

// ── walk helpers ──────────────────────────────────────────────────────
function walk(dir, predicate) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

// A valid module-slug or story-slug: lower-kebab-case, no uppercase, no spaces
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// Forbidden folder names that must never appear under tests/features/
const FORBIDDEN_FOLDERS = new Set(['_unsorted', 'misc', 'general-unsorted', 'uncategorised']);

// ── RULE 1: feature-file structure ────────────────────────────────────
function validateFeatureStructure() {
  if (!fs.existsSync(FEATURES_ROOT)) return;

  // 1a. Top-level entries under tests/features/ must be README.md or module-slug folders.
  for (const entry of fs.readdirSync(FEATURES_ROOT, { withFileTypes: true })) {
    const full = path.join(FEATURES_ROOT, entry.name);
    if (entry.isFile()) {
      if (entry.name === 'README.md') continue;
      violate('RULE-1',
        `Stray file directly under tests/features/ (allowed only: README.md, module-slug folders): ${entry.name}`,
        full);
      continue;
    }
    if (entry.isDirectory()) {
      if (FORBIDDEN_FOLDERS.has(entry.name)) {
        violate('RULE-1',
          `Forbidden folder '${entry.name}/' under tests/features/. ` +
          `Use the classifyModule() waterfall in featureFile.writer.js to derive the correct module slug.`,
          full);
        continue;
      }
      if (!SLUG_RE.test(entry.name)) {
        violate('RULE-1',
          `Folder '${entry.name}/' is not a valid lower-kebab-case module slug. ` +
          `Module slugs must be lowercase alphanumeric with hyphens only.`,
          full);
        continue;
      }
      // A module folder with no .feature files is stale debris.
      const children = fs.readdirSync(full).filter(n => n !== '.gitkeep');
      const hasFeature = children.some(n => n.endsWith('.feature'));
      if (!hasFeature) {
        violate('RULE-1',
          `Empty module folder '${entry.name}/' has no .feature files. ` +
          `Module folders are created on demand — remove this empty folder.`,
          full);
      }
    }
  }

  // 1b. Every .feature file must live at tests/features/<module-slug>/<story-slug>.feature
  //     Exactly two levels deep — no nesting.
  const featureFiles = walk(FEATURES_ROOT, p => p.endsWith('.feature'));
  for (const f of featureFiles) {
    const rel = path.relative(FEATURES_ROOT, f).split(path.sep);
    if (rel.length !== 2) {
      violate('RULE-1',
        `Feature file must be exactly tests/features/<module-slug>/<story-slug>.feature (no nesting). ` +
        `Found depth=${rel.length}: ${rel.join('/')}`,
        f);
      continue;
    }
    const [moduleDir, fileName] = rel;
    if (!SLUG_RE.test(moduleDir)) {
      violate('RULE-1',
        `Feature file lives under invalid module slug '${moduleDir}'. ` +
        `Module slugs must be lowercase kebab-case.`, f);
    }
    const baseName = fileName.replace(/\.feature$/, '');
    if (!SLUG_RE.test(baseName)) {
      violate('RULE-1',
        `Feature file name '${fileName}' must be a lowercase kebab-case story slug. ` +
        `e.g. 'employee-login-pim.feature'.`, f);
    }
  }
}

// ── RULE 2: fixture import discipline in specs ────────────────────────
const FIXTURE_IMPORT_RE =
  /require\(\s*['"](?:\.\.\/)+fixtures\/(?:base|pom)\.fixture['"]\s*\)|from\s+['"](?:\.\.\/)+fixtures\/(?:base|pom)\.fixture['"]/;
const PLAYWRIGHT_DIRECT_IMPORT_RE =
  /require\(\s*['"]@playwright\/test['"]\s*\)|from\s+['"]@playwright\/test['"]/;

function validatePomDiscipline() {
  for (const root of SPEC_ROOTS) {
    const specs = walk(root, p => p.endsWith('.spec.js'));
    for (const file of specs) {
      const src = fs.readFileSync(file, 'utf8');
      if (PLAYWRIGHT_DIRECT_IMPORT_RE.test(src)) {
        violate('RULE-2',
          `Spec imports directly from '@playwright/test'. Use '../fixtures/base.fixture' instead.`,
          file);
      }
      if (!FIXTURE_IMPORT_RE.test(src)) {
        violate('RULE-2',
          `Spec does not import { test, expect } from '../fixtures/base.fixture' (or pom.fixture).`,
          file);
      }
    }
  }
}

// ── run ───────────────────────────────────────────────────────────────
validateFeatureStructure();
validatePomDiscipline();

if (violations.length === 0) {
  console.log('✅ validate-test-structure: clean — RULE 1 (slug-based features) and RULE 2 (fixture imports) satisfied.');
  process.exit(0);
}

console.error(`❌ validate-test-structure: ${violations.length} violation(s) found.\n`);
const grouped = violations.reduce((acc, v) => {
  (acc[v.rule] = acc[v.rule] || []).push(v);
  return acc;
}, {});
for (const rule of Object.keys(grouped).sort()) {
  console.error(`── ${rule} ──`);
  for (const v of grouped[rule]) {
    console.error(`  • ${v.file}\n      ${v.message}`);
  }
  console.error('');
}
console.error('See .github/copilot-instructions.md for the binding rules.');
process.exit(1);
