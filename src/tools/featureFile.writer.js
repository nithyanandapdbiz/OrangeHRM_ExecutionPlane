'use strict';
/**
 * Feature File Writer
 * ------------------------------------------------------------------
 * Sync the Cucumber/Gherkin scenarios for a single story into the
 * correct module-based feature file under tests/features/<module>/.
 *
 *   tests/features/<module>/<story-slug>.feature
 *
 * Story block isolation:
 *   - Every story owns a delimited block:
 *         # ─── BEGIN STORY <KEY> ───
 *         …scenarios…
 *         # ─── END STORY <KEY> ───
 *   - On every run we *replace* that block, leaving other stories intact.
 *   - Each scenario is tagged @<storyKey>, @<module>, @<OHRM-T###>, plus
 *     the test case's own tags.
 *
 * Module classification (confidence waterfall — no fixed taxonomy):
 *   1. opts.module         explicit caller override
 *   2. Jira Components     story.fields.components[0].name
 *   3. Jira Labels         story.fields.labels
 *   4. Story title slug    always available; last resort
 *
 * Feature file naming: <story-title-slug>.feature  (never <module>.feature)
 * Background app name: read from APP_NAME env var (default: "the application")
 */

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const { assertDomainPure } = require('../core/domainPurgeValidator');
const { classifyStep, STEP_TYPES } = require('../core/executabilityClassifier');

const ROOT          = path.resolve(__dirname, '..', '..');
const FEATURES_ROOT = path.join(ROOT, 'tests', 'features');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ─── Slug helpers ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'to','the','a','an','of','for','and','or','in','at','by','with','on','from','is','are','be'
]);

/**
 * Short folder-safe slug from a module/area name.
 * Strips stop words and takes up to 3 content words joined by hyphens.
 * "PIM Employee Management" → "pim-employee-management"
 */
function slugModule(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .slice(0, 3)
    .join('-')
    || 'general';
}

/**
 * File-safe slug from a story title (max 60 chars).
 * "Employee Login and PIM Add-Employee" → "employee-login-and-pim-add-employee"
 */
function slugFile(text) {
  return (text || 'story')
    .toLowerCase()
    .replace(/[-_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    || 'story';
}

// ─── Module classifier ────────────────────────────────────────────────────────
/**
 * Derives a module folder name from Jira issue metadata using a confidence
 * waterfall. Returns a folder-safe slug. Never throws — uses 'general' as last resort.
 *
 * @param {object} story   Jira issue (normalised story)
 * @param {string} override  caller-supplied override (highest confidence)
 * @returns {string} folder-safe module slug
 */
function classifyModule(story, override) {
  // 1. Explicit override — 100% authoritative
  if (override) return slugModule(String(override));

  const fields = (story && story.fields) || {};

  // 2. Jira Components — component/team tag on the issue
  //    e.g. component "PIM" → "pim"
  const components = Array.isArray(fields.components)
    ? fields.components.map(c => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
    : [];
  if (components.length > 0) {
    const m = slugModule(String(components[0]));
    if (m && m !== 'general') return m;
  }

  // 3. Jira Labels — developer-curated metadata (array of strings)
  const labelsRaw = fields.labels || fields.tags || '';
  const labels = (typeof labelsRaw === 'string'
    ? labelsRaw.split(/[;,]/)
    : Array.isArray(labelsRaw) ? labelsRaw : [])
    .map(t => String(t).trim())
    .filter(Boolean);
  if (labels.length > 0) {
    const m = slugModule(labels[0]);
    if (m && m !== 'general') return m;
  }

  // 4. Story title — always available; produces a meaningful slug
  const summary = String(fields.summary || '').trim();
  if (summary) return slugModule(summary);

  logger.warn(`[feature-writer] No module signal for story ${story?.key || 'UNKNOWN'} — using "general"`);
  return 'general';
}

// ─── Feature file header ──────────────────────────────────────────────────────

function featureHeader(moduleName) {
  const appName    = process.env.APP_NAME || process.env.APPLICATION_NAME || 'the application';
  const displayName = moduleName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return [
    `# =============================================================================`,
    `# Module : ${moduleName}`,
    `# Note   : This file is managed by run-story.js. Story blocks delimited by`,
    `#          "BEGIN STORY <KEY>" / "END STORY <KEY>" are auto-regenerated;`,
    `#          edits inside those blocks will be overwritten on the next run.`,
    `# =============================================================================`,
    ``,
    `Feature: ${displayName}`,
    ``,
    `  Background:`,
    `    Given I am an authenticated OrangeHRM user`,
    ``
  ].join('\n');
}

// ─── GWT step classifier ──────────────────────────────────────────────────────

function classify(stepText) {
  const givenSig = /pre-condition|application is accessible|user is authenticated|before.*test|start.*clean|clear.*session/i;
  const thenSig  = /verify|assert|confirm|check|ensure|should|must|expect|no.*record|is displayed|is visible|redirects|remains|not.*contain|not.*match/i;
  const whenSig  = /enter|fill|click|submit|navigate to|attempt|perform|open|log in|clear|set|select|search/i;
  if (givenSig.test(stepText)) return 'Given';
  if (thenSig.test(stepText))  return 'Then';
  if (whenSig.test(stepText))  return 'When';
  return null;
}

// ─── Scenario renderer ────────────────────────────────────────────────────────

function renderScenario(tc, storyKey, module) {
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  if (steps.length === 0) {
    throw new Error(
      `[feature-writer] Test case '${tc.key || tc.title}' has no steps. ` +
      `A scenario without steps is not allowed in feature files.`
    );
  }

  // Gherkin tags must not contain whitespace — sanitize key by replacing spaces with underscores
  const safeTag = (raw) => String(raw).replace(/^@/, '').replace(/\s+/g, '_');

  // Ensure @ui/@api/@database/@manual is present.
  // tc.tags is populated by qa.agent.js classification; fall back to classifying the first
  // non-precondition step when the tag is absent (e.g. test cases loaded from handoff file).
  const existingTags = (tc.tags || []).map(t => String(t).replace(/^@/, '').toLowerCase());
  const classificationTypes = Object.values(STEP_TYPES).map(t => t.toLowerCase());
  const hasClassTag = existingTags.some(t => classificationTypes.includes(t));
  if (!hasClassTag) {
    const sampleStep = steps.find(s => {
      const t = typeof s === 'string' ? s : (s?.description || s?.text || '');
      return t && !/^\[Pre-?condition\]/i.test(t);
    });
    if (sampleStep) {
      const stepText = typeof sampleStep === 'string' ? sampleStep : (sampleStep?.description || sampleStep?.text || '');
      const { type } = classifyStep(stepText);
      existingTags.push(type.toLowerCase());
    }
  }

  const tags = new Set([
    `@${safeTag(tc.key)}`,
    `@${storyKey.toLowerCase()}`,
    `@${module}`,
    ...existingTags.map(t => `@${t.replace(/^@/, '')}`)
  ]);

  const lines = [];
  lines.push('  ' + Array.from(tags).join(' '));
  lines.push(`  Scenario: ${tc.title}`);

  const gwt  = Array.isArray(tc.gwt) && tc.gwt.length === steps.length ? tc.gwt : null;
  let last   = null;
  for (let i = 0; i < steps.length; i++) {
    const raw  = steps[i];
    const text = typeof raw === 'string' ? raw : (raw?.description || raw?.text || '');
    if (!text || !text.trim()) continue;
    const cleaned = text.replace(/^\s*(Given|When|Then|And|But)\s+/i, '').trim();

    // Non-UI step annotation — add inline Gherkin comment before the step line
    const execability = gwt?.[i]?.executability || classifyStep(cleaned);
    if (execability.type !== STEP_TYPES.UI) {
      lines.push(`    # [NON-UI: ${execability.type}] Not browser-automatable — verify via ${execability.type.toLowerCase()} layer`);
    }

    let kw = gwt ? gwt[i].keyword : classify(cleaned);
    if (!kw) kw = last ? 'And' : 'Given';
    if (last && kw === last) kw = 'And'; else last = kw;
    lines.push(`    ${kw} ${cleaned}`);
  }
  if (lines.length <= 2) {
    throw new Error(
      `[feature-writer] Test case '${tc.key || tc.title}' rendered with no usable steps after cleaning.`
    );
  }
  return lines.join('\n');
}

// ─── Story block management ───────────────────────────────────────────────────

const BEGIN = key => `# ─── BEGIN STORY ${key} ───`;
const END   = key => `# ─── END STORY ${key} ───`;

function replaceStoryBlock(existing, storyKey, body) {
  const begin    = BEGIN(storyKey);
  const end      = END(storyKey);
  const newBlock = `${begin}\n${body}\n${end}`;
  if (existing.includes(begin) && existing.includes(end)) {
    const re = new RegExp(`${begin}[\\s\\S]*?${end}`);
    return existing.replace(re, newBlock);
  }
  return existing.replace(/\s*$/, '\n\n') + newBlock + '\n';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sync a story's scenarios to disk.
 *
 * @param {object}  story        Jira issue (normalised story)
 * @param {Array}   testCases    [{ key, title, steps[], gwt[], tags[], priority }]
 * @param {object}  [opts]
 * @param {string}  [opts.module]   override inferred module
 * @param {boolean} [opts.dryRun]   compute without writing
 * @returns {{ filePath, module, storySlug, written, scenarios }}
 */
function syncStoryFeature(story, testCases, opts = {}) {
  const storyKey  = story?.key || story?.fields?.issuekey || 'STORY';
  const module    = classifyModule(story, opts.module);
  const storySlug = slugFile(story?.fields?.summary || storyKey);
  const moduleDir = path.join(FEATURES_ROOT, module);
  const filePath  = path.join(moduleDir, `${storySlug}.feature`);

  ensureDir(moduleDir);

  // Gate 2: hard-fail on stale-domain contamination before writing feature file
  assertDomainPure(testCases || [], 'Gate 2 — feature file');

  const tcs = (testCases || []).filter(tc => {
    if (!tc || !tc.key || !tc.title) return false;
    const hasSteps = Array.isArray(tc.steps) &&
                     tc.steps.some(s => {
                       const t = typeof s === 'string' ? s : (s?.description || s?.text || '');
                       return t && t.trim().length > 0;
                     });
    if (!hasSteps) {
      logger.warn(
        `[feature-writer] ${storyKey}: dropping '${tc.key} — ${tc.title}' — no steps. ` +
        `Fix the upstream generator (qa.agent.js / aiEnrich).`
      );
      return false;
    }
    return true;
  });

  if (tcs.length === 0) {
    logger.warn(`[feature-writer] ${storyKey}: no test cases with steps — nothing to sync`);
    return { filePath, module, storySlug, written: false, scenarios: 0 };
  }

  const summary     = (story?.fields?.summary || '').trim();
  const blockHeader = `  # ─── ${storyKey}${summary ? ' — ' + summary : ''} ─────────────────────────────`;
  const scenarios   = tcs.map(tc => renderScenario(tc, storyKey, module)).join('\n\n');
  const body        = `${blockHeader}\n${scenarios}`;

  let existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const hasScenario   = /^\s*Scenario:/m.test(existing);
  const hasStoryBlock = /# ─{3} BEGIN STORY /.test(existing);
  if (!existing.trim() || !/^\s*Feature:/m.test(existing) || (!hasScenario && !hasStoryBlock)) {
    existing = featureHeader(module);
  }
  const next = replaceStoryBlock(existing, storyKey, body);

  if (!opts.dryRun) {
    fs.writeFileSync(filePath, next, 'utf8');
    logger.info(
      `[feature-writer] ${storyKey}: synced ${tcs.length} scenario(s) → ${path.relative(ROOT, filePath)}`
    );
  }

  return { filePath, module, storySlug, written: !opts.dryRun, scenarios: tcs.length };
}

module.exports = { syncStoryFeature, classifyModule, slugModule, slugFile };
