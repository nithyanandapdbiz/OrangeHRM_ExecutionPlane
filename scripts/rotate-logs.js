#!/usr/bin/env node
'use strict';
/**
 * rotate-logs — maintenance CLI for JSONL telemetry log rotation and cleanup.
 *
 * Manages the four append-only JSONL telemetry logs produced by the platform.
 * Safe to run from cron, CI, or manually.
 *
 * Usage:
 *   node scripts/rotate-logs.js [options]
 *
 * Options:
 *   --force          Rotate even if threshold not yet met
 *   --dry-run        Show what would happen without making any changes
 *   --compress       Force gzip compression (overrides LOG_ROTATION_COMPRESS)
 *   --no-compress    Skip gzip compression
 *   --file <path>    Rotate a specific file only (absolute or relative to project root)
 *   --help           Print this help
 *
 * Active configuration (read from env vars):
 *   LOG_ROTATION_MODE     size | daily | weekly   (default: size)
 *   MAX_LOG_SIZE_MB       rotation trigger size    (default: 100)
 *   ROTATION_KEEP_FILES   max archives to keep     (default: 10)
 *   ROTATION_KEEP_DAYS    max archive age in days  (default: 30)
 *   LOG_ROTATION_COMPRESS gzip archives            (default: true)
 *
 * Note: token-report.js and all other consumers continue to read/write the
 * original log paths after rotation — the live file is re-created on the
 * next write. Historical data lives in sibling archive/ directories.
 */
/* eslint-disable no-console */

const path        = require('path');
const logRotation = require('../src/utils/logRotation');

const ROOT = path.resolve(__dirname, '..');

// ── Managed JSONL log files ───────────────────────────────────────────────────
// Winston text logs (app.log, error.log) are excluded — they use Winston's own
// maxsize/maxFiles rotation, already configured in src/utils/logger.js.
const MANAGED_LOGS = [
  path.join(ROOT, 'logs', 'token-telemetry.jsonl'),
  path.join(ROOT, 'logs', 'agent-decisions.jsonl'),
  path.join(ROOT, 'logs', 'dev-change', 'token-cost.jsonl'),
  path.join(ROOT, 'logs', 'dev-change', 'outcomes.jsonl'),
];

// ── CLI argument parsing ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    'Usage: node scripts/rotate-logs.js [options]',
    '',
    'Options:',
    '  --force           Rotate even if the configured threshold is not met',
    '  --dry-run         Show what would happen without making changes',
    '  --compress        Force gzip compression (overrides LOG_ROTATION_COMPRESS)',
    '  --no-compress     Skip gzip compression',
    '  --file <path>     Rotate a specific file only',
    '  --help            Show this help',
    '',
    'Environment:',
    `  LOG_ROTATION_MODE      ${logRotation.rotationMode()}  (size|daily|weekly)`,
    `  MAX_LOG_SIZE_MB        ${(logRotation.maxSizeBytes() / 1024 / 1024).toFixed(0)} MB`,
    `  ROTATION_KEEP_FILES    ${logRotation.keepFiles()}`,
    `  ROTATION_KEEP_DAYS     ${logRotation.keepDays()}`,
    `  LOG_ROTATION_COMPRESS  ${logRotation.shouldCompress()}`,
    ''
  ].join('\n'));
  process.exit(0);
}

const forceRotate = args.includes('--force');
const dryRun      = args.includes('--dry-run');
const compressArg = args.includes('--compress')    ? true
                  : args.includes('--no-compress') ? false
                  : undefined;

const fileArgIdx  = args.indexOf('--file');
const singleFile  = fileArgIdx >= 0 && args[fileArgIdx + 1]
  ? path.resolve(ROOT, args[fileArgIdx + 1])
  : null;

const targetLogs = singleFile ? [singleFile] : MANAGED_LOGS;

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(s, w) { return String(s).padEnd(w); }
function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024)        return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const fs = require('fs');

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     Log Rotation — Maintenance CLI    ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  Mode:     ${logRotation.rotationMode().toUpperCase()}`);
  console.log(`  Max size: ${fmtBytes(logRotation.maxSizeBytes())}`);
  console.log(`  Keep:     ${logRotation.keepFiles()} files / ${logRotation.keepDays()} days`);
  console.log(`  Compress: ${logRotation.shouldCompress()}`);
  if (dryRun) console.log('  *** DRY-RUN — no changes will be made ***');
  console.log('');

  let totalRotated  = 0;
  let totalSkipped  = 0;
  let totalDeleted  = 0;
  let totalNotFound = 0;

  for (const logFile of targetLogs) {
    const rel = path.relative(ROOT, logFile);

    if (!fs.existsSync(logFile)) {
      console.log(`  ${pad(rel, 45)} (not found — skip)`);
      totalNotFound++;
      continue;
    }

    const stat    = fs.statSync(logFile);
    const sizeStr = fmtBytes(stat.size);
    const opts    = { dryRun, ...(compressArg !== undefined ? { compress: compressArg } : {}) };

    let result;
    if (forceRotate && !dryRun) {
      result = await logRotation.rotate(logFile, opts);
    } else {
      result = await logRotation.checkAndRotate(logFile, opts);
    }

    if (result.dryRun) {
      console.log(`  ${pad(rel, 45)} [DRY-RUN] would archive → ${path.relative(ROOT, result.archive)}`);
      totalRotated++;
    } else if (result.rotated) {
      const archRel = result.archive ? path.relative(ROOT, result.archive) : '(unknown)';
      const delStr  = result.deleted.length > 0 ? `  (purged ${result.deleted.length} old archives)` : '';
      console.log(`  ${pad(rel, 45)} ✓  → ${archRel}${delStr}`);
      totalRotated++;
      totalDeleted += result.deleted.length;
    } else if (result.error) {
      console.log(`  ${pad(rel, 45)} ✗  ERROR: ${result.error}`);
    } else {
      const reason = result.reason === 'below-threshold'
        ? `below threshold (${sizeStr})`
        : result.reason || 'skipped';
      console.log(`  ${pad(rel, 45)} —  ${reason}`);
      totalSkipped++;
    }
  }

  console.log('');
  console.log(`  Rotated: ${totalRotated}   Skipped: ${totalSkipped}   ` +
              `Not found: ${totalNotFound}   Archives purged: ${totalDeleted}`);
  console.log('');
})().catch(err => {
  console.error(`\n[rotate-logs] Fatal: ${err.message}`);
  process.exit(1);
});
