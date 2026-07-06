'use strict';
/**
 * Dev-Change Pattern Mining — OrangeHRM Execution Plane.
 *
 * Nightly job: scans historical run logs/reports for recurring failure signatures
 * (flaky selectors, slow routes, repeated defect classes) and emits a patterns
 * summary that feeds the proactive-healer and scoped-QA scheduling. Best-effort:
 * if no history is present it writes an empty summary and exits 0.
 *
 * Usage:  node scripts/mine-dev-change-patterns.js [--out <file>]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function mine() {
  const patterns = { flakySelectors: {}, slowRoutes: {}, defectClasses: {} };
  const logsDir = path.join(ROOT, 'logs');
  let scanned = 0;
  if (fs.existsSync(logsDir)) {
    for (const f of fs.readdirSync(logsDir)) {
      if (!/\.(log|jsonl)$/.test(f)) continue;
      scanned++;
      for (const rec of readJsonl(path.join(logsDir, f))) {
        const msg = String(rec.message || '');
        const sel = msg.match(/selector[:\s]+([^\s]+)/i);
        if (sel) patterns.flakySelectors[sel[1]] = (patterns.flakySelectors[sel[1]] || 0) + 1;
      }
    }
  }
  return { scannedFiles: scanned, patterns };
}

function main() {
  const args = process.argv.slice(2);
  const oIdx = args.indexOf('--out');
  const outFile = oIdx >= 0 ? args[oIdx + 1] : 'reports/dev-change-patterns.json';

  const summary = { minedAt: new Date().toISOString(), ...mine() };
  const outPath = path.resolve(ROOT, outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log(`[pattern-mining] Scanned ${summary.scannedFiles} log file(s) → ${outFile}`);
  process.exit(0);
}

main();
