'use strict';
/**
 * Governance Gate — OrangeHRM Execution Plane.
 *
 * Applies the release-decision thresholds from config/platform.config.json to the
 * latest validation/traceability report (if present) and returns a GO / CONDITIONAL
 * GO / NO GO verdict. Exits non-zero on NO GO so CI can block a release.
 *
 * Usage:  node scripts/governance-gate.js [--report <file>] [--warn]
 * If no report is found, the gate passes (nothing to evaluate yet).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function findReport(explicit) {
  if (explicit) return path.resolve(ROOT, explicit);
  const candidates = [
    'reports/alm-validation-report.json',
    'reports/traceability-certification.json',
    'reports/validation-history.json',
  ].map((r) => path.join(ROOT, r));
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function main() {
  const args = process.argv.slice(2);
  const warnOnly = args.includes('--warn');
  const rIdx = args.indexOf('--report');
  const cfg = loadJson(path.join(ROOT, 'config', 'platform.config.json')) || {};
  const thresholds = cfg.governance?.releaseDecision || {};

  const reportPath = findReport(rIdx >= 0 ? args[rIdx + 1] : null);
  if (!reportPath) {
    console.log('✅ Governance gate: no validation report present — nothing to evaluate (PASS)');
    process.exit(0);
  }

  const report = loadJson(reportPath) || {};
  const summary = report.summary || {};
  const orphanRate = summary.orphanRate ?? report.orphanRate ?? 0;
  const certifiedRate = summary.certifiedRate ?? report.certifiedRate ?? 100;

  const reasons = [];
  let verdict = 'GO';
  if (orphanRate >= (thresholds.orphanRateBlockThreshold ?? 20)) {
    verdict = 'NO GO'; reasons.push(`orphan rate ${orphanRate}% >= block ${thresholds.orphanRateBlockThreshold}%`);
  } else if (orphanRate >= (thresholds.orphanRateWarnThreshold ?? 10)) {
    verdict = 'CONDITIONAL GO'; reasons.push(`orphan rate ${orphanRate}% >= warn ${thresholds.orphanRateWarnThreshold}%`);
  }
  if (certifiedRate < (thresholds.traceabilityCertifiedBlockThreshold ?? 30)) {
    verdict = 'NO GO'; reasons.push(`certified rate ${certifiedRate}% < block ${thresholds.traceabilityCertifiedBlockThreshold}%`);
  } else if (certifiedRate < (thresholds.traceabilityCertifiedWarnThreshold ?? 60) && verdict === 'GO') {
    verdict = 'CONDITIONAL GO'; reasons.push(`certified rate ${certifiedRate}% < warn ${thresholds.traceabilityCertifiedWarnThreshold}%`);
  }

  console.log(`Governance gate verdict: ${verdict}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`);
  process.exit(verdict === 'NO GO' && !warnOnly ? 1 : 0);
}

main();
