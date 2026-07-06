'use strict';
const { createExecution, linkExecutionToIssue } = require('../tools/zephyrTestRun.client');
const logger = require('../utils/logger');

const ENV_NAME = process.env.ZEPHYR_ENV_NAME || 'Chromium - Playwright (headless)';

/**
 * Maps Playwright results to Zephyr test cycle executions with full Details,
 * Traceability, and History fields.
 *
 * @param {string|number} runId      — Zephyr test cycle key returned by setupCycle() / createTestRun()
 * @param {Array<{id, key}>} testCaseRefs — Objects returned by executor.agent
 * @param {Array} results            — Playwright parsed results (title, passed, duration, error)
 * @param {object} [story]           — Jira story for traceability linking
 */
async function mapResults(runId, testCaseRefs, results, story) {
  const cycleKey = runId; // alias for backwards-compat log messages
  for (const r of results) {
    // Match on test case key substring in result title; fall back to first entry
    const ref =
      testCaseRefs.find(t => r.title.toLowerCase().includes(t.key.toLowerCase())) ||
      testCaseRefs[0];
    if (!ref) continue;

    const statusName = r.passed ? "Pass" : "Fail";
    const now = new Date().toISOString();

    // Build rich execution comment for History
    const commentParts = [
      `**Status:** ${statusName}`,
      `**Test Case:** ${ref.key}`,
      `**Cycle:** ${cycleKey}`,
      `**Duration:** ${r.duration ? (r.duration / 1000).toFixed(1) + 's' : 'N/A'}`,
      `**Environment:** ${ENV_NAME}`,
      `**Executed:** ${now}`
    ];
    if (r.retries > 0) {
      commentParts.push(`**Retries:** ${r.retries}`);
    }
    if (r.error) {
      commentParts.push(`**Error:** ${r.error.slice(0, 300)}`);
    }

    // Create execution with full Details
    const exec = await createExecution(runId, ref.key, statusName, {
      environmentName: ENV_NAME,
      executionTime:   r.duration || 0,
      comment:         commentParts.join('\n'),
      actualEndDate:   now
    });

    // Traceability — link execution to the originating Jira issue
    if (story && (story.key || story.id)) {
      try {
        await linkExecutionToIssue(runId, story.key || story.id);
      } catch (err) {
        logger.warn(`Failed to link execution ${exec.id} to ${story.key}: ${err.message}`);
      }
    }
  }
}
module.exports = { mapResults, validateMapping, resolveSpecsForCycle };

/**
 * validateMapping — quick sanity check that a story has usable Zephyr
 * test cases before the executor attempts to create executions.
 *
 * Looks up test cases via the Zephyr test case handoff file produced by
 * run-story.js. Returns structured outcome so callers can halt the pipeline
 * early when the mapping is clearly broken.
 *
 * @param {string} storyKey   - e.g. "OHRM-1"
 * @returns {Promise<{valid:boolean, testCaseCount:number, missingKeys:string[], reason?:string}>}
 */
async function validateMapping(storyKey) {
  if (!storyKey || typeof storyKey !== 'string') {
    return { valid: false, testCaseCount: 0, missingKeys: [], reason: 'storyKey is required' };
  }

  // We read the handoff file produced by scripts/run-story.js which
  // enumerates exactly the keys created/linked for this story in this run.
  const fs   = require('fs');
  const path = require('path');
  const handoff = path.resolve(process.cwd(), '.story-testcases.json');

  if (!fs.existsSync(handoff)) {
    return {
      valid:         false,
      testCaseCount: 0,
      missingKeys:   [],
      reason:        'No .story-testcases.json handoff file — run scripts/run-story.js first.'
    };
  }

  let payload;
  try { payload = JSON.parse(fs.readFileSync(handoff, 'utf8')); }
  catch (e) { return { valid: false, testCaseCount: 0, missingKeys: [], reason: `handoff parse error: ${e.message}` }; }

  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  if (keys.length === 0) {
    return {
      valid:         false,
      testCaseCount: 0,
      missingKeys:   [],
      reason:        `handoff file has no test case keys for story ${storyKey}`
    };
  }

  // Verify each key has a corresponding spec file (tests/specs/<KEY>_*.spec.js)
  const specsDir = path.resolve(process.cwd(), 'tests', 'specs');
  const specFiles = fs.existsSync(specsDir) ? fs.readdirSync(specsDir) : [];
  const missingKeys = keys.filter(k =>
    !specFiles.some(f => f.toUpperCase().startsWith(String(k).toUpperCase() + '_'))
  );

  return {
    valid:         missingKeys.length === 0,
    testCaseCount: keys.length,
    missingKeys,
    reason:        missingKeys.length === 0
      ? undefined
      : `${missingKeys.length} test case(s) have no spec file in tests/specs/`
  };
}

/**
 * Phase 3.4 — Resolve every Zephyr test case key in a dev-change cycle to its spec file.
 *
 * Reads `.dev-change-cycle.json` (written by the dev-change orchestrator) and
 * matches each `testCaseKeys[]` entry to a file in `tests/specs/` of the form
 * `<KEY>_*.spec.[jt]sx?`. Returns deduplicated absolute spec paths grouped by
 * executionGroup.
 *
 * @param {string} [cycleFilePath]   - override path to the cycle file
 * @returns {Promise<{
 *   valid: boolean,
 *   cycleKey: ?string,
 *   groups: Array<{ name:string, specPaths:string[], missingKeys:string[] }>,
 *   allSpecPaths: string[],
 *   missingKeys: string[],
 *   reason?: string
 * }>}
 */
async function resolveSpecsForCycle(cycleFilePath) {
  const fs = require('fs');
  const path = require('path');
  const cyclePath = cycleFilePath || path.resolve(process.cwd(), '.dev-change-cycle.json');

  if (!fs.existsSync(cyclePath)) {
    return { valid: false, cycleKey: null, groups: [], allSpecPaths: [], missingKeys: [], reason: `cycle file not found: ${cyclePath}` };
  }

  let cycleDoc;
  try { cycleDoc = JSON.parse(fs.readFileSync(cyclePath, 'utf8')); }
  catch (e) { return { valid: false, cycleKey: null, groups: [], allSpecPaths: [], missingKeys: [], reason: `cycle file parse error: ${e.message}` }; }

  const cycle = cycleDoc && cycleDoc.cycle;
  const groupsIn = (cycle && Array.isArray(cycle.executionGroups)) ? cycle.executionGroups : [];
  const cycleKey = cycleDoc.mainCycleKey || null;

  const specsDir = path.resolve(process.cwd(), 'tests', 'specs');
  const specFiles = fs.existsSync(specsDir) ? fs.readdirSync(specsDir) : [];

  const groups = [];
  const allSpecs = new Set();
  const allMissing = new Set();

  for (const g of groupsIn) {
    if (!g || typeof g !== 'object') continue;
    const keys = Array.isArray(g.testCaseKeys) ? g.testCaseKeys : [];
    const specPaths = [];
    const missingKeys = [];
    for (const key of keys) {
      const upper = String(key || '').toUpperCase();
      const match = specFiles.find((f) => f.toUpperCase().startsWith(upper + '_'));
      if (match) {
        const abs = path.join(specsDir, match);
        specPaths.push(abs);
        allSpecs.add(abs);
      } else {
        missingKeys.push(key);
        allMissing.add(key);
      }
    }
    groups.push({
      name: typeof g.name === 'string' ? g.name : 'group',
      specPaths,
      missingKeys
    });
  }

  return {
    valid: allMissing.size === 0 && allSpecs.size > 0,
    cycleKey,
    groups,
    allSpecPaths: Array.from(allSpecs),
    missingKeys: Array.from(allMissing),
    reason: allSpecs.size === 0
      ? 'no spec files matched any test case key in the cycle'
      : (allMissing.size > 0 ? `${allMissing.size} key(s) had no matching spec file` : undefined)
  };
}
