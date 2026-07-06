'use strict';
/**
 * domainPurgeValidator.js — guards generated artefacts against stale-domain
 * contamination when the platform is re-pointed at a new target application.
 *
 * When a tenant migrates its target app, generated test cases must not carry
 * over vocabulary from the previous domain. This validator scans candidate
 * test cases for a configurable set of banned terms and reports contamination
 * so the pipeline can halt (exit code 2) before writing feature files.
 *
 * Banned terms are supplied purely by configuration (no hard-coded vocabulary),
 * so the validator stays domain-agnostic:
 *   - DOMAIN_BANNED_TERMS  — comma-separated list of terms to reject (case-insensitive)
 * When no terms are configured the validator is a no-op (everything passes).
 *
 * Public API:
 *   assertDomainPure(testCases, label, opts?)  — throw on contamination
 *   scanForContamination(testCases, terms?)    — { clean, terms, contaminatedTestCases }
 *   readContaminationReport()                  — last written report or null
 *   writeContaminationReport(report)           — persist report for pipeline steps
 */

const fs   = require('fs');
const path = require('path');

const REPORTS_DIR   = path.join(process.cwd(), 'reports');
const REPORT_FILE   = path.join(REPORTS_DIR, 'domain-contamination.json');

/** Distinct error class the pipeline runner recognises (exitCode 2). */
class DomainContaminationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name         = 'DomainContaminationError';
    this.code         = 'DOMAIN_CONTAMINATION';
    this.exitCode     = 2;
    this.recoveryHint = details.recoveryHint ||
      'Regenerate the test cases for the current target application, or clear DOMAIN_BANNED_TERMS.';
    this.details      = { domainContamination: true, ...details };
  }
}

function configuredBannedTerms() {
  return String(process.env.DOMAIN_BANNED_TERMS || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

function testCaseText(tc) {
  if (!tc) return '';
  const parts = [tc.title, tc.name, tc.description, tc.objective];
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  for (const s of steps) {
    parts.push(typeof s === 'string' ? s : (s?.description || s?.text || s?.action || ''));
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * @param {Array} testCases
 * @param {string[]} [terms] - override banned terms (defaults to configured)
 * @returns {{ clean: boolean, terms: string[], contaminatedTestCases: string[] }}
 */
function scanForContamination(testCases, terms) {
  const banned = (terms && terms.length ? terms : configuredBannedTerms()).map(t => t.toLowerCase());
  if (banned.length === 0) {
    return { clean: true, terms: [], contaminatedTestCases: [] };
  }
  const hits = new Set();
  const contaminated = [];
  for (const tc of (testCases || [])) {
    const text = testCaseText(tc);
    const found = banned.filter(term => text.includes(term));
    if (found.length) {
      found.forEach(f => hits.add(f));
      contaminated.push(tc.key || tc.title || '(unnamed test case)');
    }
  }
  return { clean: contaminated.length === 0, terms: [...hits], contaminatedTestCases: contaminated };
}

function writeContaminationReport(report) {
  try {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

function readContaminationReport() {
  try {
    if (!fs.existsSync(REPORT_FILE)) return null;
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Hard-fail if any test case contains a banned-domain term.
 * @param {Array}  testCases
 * @param {string} label   - stage label for the error message
 * @param {object} [opts]  - { terms?: string[] }
 */
function assertDomainPure(testCases, label = 'domain purity gate', opts = {}) {
  const result = scanForContamination(testCases, opts.terms);
  if (result.clean) return result;
  writeContaminationReport(result);
  throw new DomainContaminationError(
    `ABORT: stale-domain contamination detected at ${label}. Terms: ${result.terms.join(', ')}`,
    { recoveryHint: opts.recoveryHint, contaminationReport: result }
  );
}

module.exports = {
  assertDomainPure,
  scanForContamination,
  readContaminationReport,
  writeContaminationReport,
  DomainContaminationError,
};
