'use strict';
/**
 * logRotation — production-grade log lifecycle management for JSONL telemetry files.
 *
 * Handles: rotation, gzip compression, archive management, and retention enforcement
 * for the four append-only JSONL logs produced by the platform:
 *
 *   logs/token-telemetry.jsonl
 *   logs/agent-decisions.jsonl
 *   logs/dev-change/token-cost.jsonl
 *   logs/dev-change/outcomes.jsonl
 *
 * Winston text logs (app.log, error.log) are excluded — they use Winston's
 * own maxsize/maxFiles rotation which is already configured in logger.js.
 *
 * Configuration via env vars (all read at call time, not module load):
 *   LOG_ROTATION_MODE      size | daily | weekly     (default: size)
 *   MAX_LOG_SIZE_MB        number                    (default: 100)
 *   ROTATION_KEEP_FILES    number, 0=disabled        (default: 10)
 *   ROTATION_KEEP_DAYS     number, 0=disabled        (default: 30)
 *   LOG_ROTATION_COMPRESS  true | false              (default: true)
 *
 * Archive layout:
 *   logs/archive/token-telemetry.jsonl.2026-06-07T14-30-00Z.gz
 *   logs/dev-change/archive/token-cost.jsonl.2026-06-07T14-30-00Z.gz
 *
 * After rotation the original path does not exist; the next append-write
 * (via fs.appendFile) re-creates it automatically — all consumers remain
 * backward-compatible.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Config readers (read env at call time) ────────────────────────────────────

function rotationMode()   { return (process.env.LOG_ROTATION_MODE || 'size').toLowerCase(); }
function maxSizeBytes()   {
  const mb = parseFloat(process.env.MAX_LOG_SIZE_MB || '100') || 100;
  return mb * 1024 * 1024;
}
function keepFiles()      { return Math.max(0, parseInt(process.env.ROTATION_KEEP_FILES || '10', 10) || 0); }
function keepDays()       { return Math.max(0, parseInt(process.env.ROTATION_KEEP_DAYS  || '30', 10) || 0); }
function shouldCompress() {
  return !/^(0|false|no|off)$/i.test(process.env.LOG_ROTATION_COMPRESS || 'true');
}

// ── In-process rotation lock (prevents concurrent rotation of same file) ──────
const _rotatingNow = new Set();

// ── Archive path helpers ──────────────────────────────────────────────────────

/**
 * Compute the archive directory: sibling `archive/` subdirectory.
 * @param {string} logFile  — absolute path to the log file
 * @returns {string}
 */
function getArchiveDir(logFile) {
  return path.join(path.dirname(logFile), 'archive');
}

/**
 * Format a Date as a filesystem-safe ISO string (colons → hyphens, ms stripped).
 * Example: "2026-06-07T14-30-00Z"
 */
function _fmtTimestamp(date) {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

/**
 * Return the full archive file path for a given log file and rotation timestamp.
 *
 * compress=true  → archive/token-telemetry.jsonl.2026-06-07T14-30-00Z.gz
 * compress=false → archive/token-telemetry.jsonl.2026-06-07T14-30-00Z
 *
 * @param {string}  logFile
 * @param {string}  archiveDir
 * @param {Date}    date
 * @param {boolean} compress
 * @returns {string}
 */
function getArchivePath(logFile, archiveDir, date, compress) {
  const base = path.basename(logFile);
  const ts   = _fmtTimestamp(date || new Date());
  const name = compress ? `${base}.${ts}.gz` : `${base}.${ts}`;
  return path.join(archiveDir, name);
}

/**
 * List existing archives for a given base log name, sorted oldest-first.
 *
 * @param {string} archiveDir
 * @param {string} baseName   — e.g. "token-telemetry.jsonl"
 * @returns {Array<{ file: string, mtime: Date }>}
 */
function listArchives(archiveDir, baseName) {
  if (!fs.existsSync(archiveDir)) return [];
  try {
    return fs.readdirSync(archiveDir)
      .filter(f => f.startsWith(baseName + '.'))
      .map(f => {
        const full = path.join(archiveDir, f);
        try {
          return { file: full, mtime: fs.statSync(full).mtime };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime);
  } catch (_) {
    return [];
  }
}

// ── Rotation trigger check ────────────────────────────────────────────────────

/**
 * Determine whether `logFile` needs rotation based on the configured mode.
 *
 * Returns false when the file does not exist (nothing to rotate).
 *
 * @param {string} logFile
 * @returns {boolean}
 */
function needsRotation(logFile) {
  let stat;
  try { stat = fs.statSync(logFile); } catch (_) { return false; }
  if (stat.size === 0) return false;

  const mode = rotationMode();

  if (mode === 'size') {
    return stat.size >= maxSizeBytes();
  }
  if (mode === 'daily') {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    return stat.mtime < midnight;
  }
  if (mode === 'weekly') {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return stat.mtime < oneWeekAgo;
  }
  return false;
}

// ── Compression ───────────────────────────────────────────────────────────────

/**
 * Pipe `srcPath` through gzip into `destPath`, then delete `srcPath`.
 * If compression fails, `srcPath` is preserved (data is never lost).
 *
 * @param {string} srcPath   — uncompressed source (will be deleted on success)
 * @param {string} destPath  — gzip destination path (*.gz)
 * @returns {Promise<void>}
 */
function _compressFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const src  = fs.createReadStream(srcPath);
    const gz   = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
    const dest = fs.createWriteStream(destPath);

    dest.on('finish', () => {
      try { fs.unlinkSync(srcPath); } catch (_) { /* keep if unlink fails — data preserved */ }
      resolve();
    });
    dest.on('error', reject);
    src.on('error',  reject);
    src.pipe(gz).pipe(dest);
  });
}

// ── Retention enforcement ─────────────────────────────────────────────────────

/**
 * Delete archives that exceed the configured retention limits.
 *
 * Applies two independent limits (whichever is more restrictive wins):
 *   ROTATION_KEEP_DAYS  — deletes archives older than N days (0 = skip)
 *   ROTATION_KEEP_FILES — keeps only the N most-recent archives  (0 = skip)
 *
 * @param {string} archiveDir
 * @param {string} baseName   — base log filename (e.g. "token-telemetry.jsonl")
 * @returns {Promise<{ deleted: string[] }>}
 */
async function applyRetention(archiveDir, baseName) {
  const archives = listArchives(archiveDir, baseName);
  if (archives.length === 0) return { deleted: [] };

  const toDelete = new Set();
  const kd = keepDays();
  const kf = keepFiles();

  if (kd > 0) {
    const cutoff = new Date(Date.now() - kd * 24 * 60 * 60 * 1000);
    for (const a of archives) {
      if (a.mtime < cutoff) toDelete.add(a.file);
    }
  }

  if (kf > 0) {
    // archives is oldest-first; the live ones (not yet marked for deletion) at the
    // front are the candidates to purge when we have more than kf total
    const live   = archives.filter(a => !toDelete.has(a.file));
    const excess = live.length > kf ? live.slice(0, live.length - kf) : [];
    for (const a of excess) toDelete.add(a.file);
  }

  const deleted = [];
  for (const file of toDelete) {
    try { fs.unlinkSync(file); deleted.push(file); } catch (_) { /* already gone */ }
  }
  return { deleted };
}

// ── Core rotation ─────────────────────────────────────────────────────────────

/**
 * Force-rotate `logFile` regardless of whether the rotation threshold is met.
 * Renames the live file to a timestamped archive, optionally gzips it, then
 * applies the configured retention policy.
 *
 * The live path is vacated — the next write (fs.appendFile) re-creates it.
 *
 * @param {string} logFile
 * @param {object} [opts]
 * @param {boolean} [opts.compress]    — override LOG_ROTATION_COMPRESS
 * @param {string}  [opts.archiveDir]  — override computed archive directory
 * @param {boolean} [opts.dryRun]      — describe what would happen; no changes made
 * @returns {Promise<{ rotated: boolean, archive: string|null, deleted: string[], dryRun?: boolean, error?: string }>}
 */
async function rotate(logFile, opts = {}) {
  if (!fs.existsSync(logFile)) return { rotated: false, archive: null, deleted: [] };

  const compress   = opts.compress   !== undefined ? Boolean(opts.compress) : shouldCompress();
  const archiveDir = opts.archiveDir || getArchiveDir(logFile);
  const now        = new Date();
  const archivePath = getArchivePath(logFile, archiveDir, now, compress);

  if (opts.dryRun) {
    return { rotated: false, archive: archivePath, deleted: [], dryRun: true };
  }

  try {
    fs.mkdirSync(archiveDir, { recursive: true });

    if (compress) {
      // Two-step: rename to an intermediate uncompressed path, then gzip to final .gz
      const tmpPath = getArchivePath(logFile, archiveDir, now, false);
      fs.renameSync(logFile, tmpPath);
      try {
        await _compressFile(tmpPath, archivePath);
      } catch (compressErr) {
        // gzip failed — keep the uncompressed archive rather than losing data
        _logger().warn(`[logRotation] gzip failed for ${path.basename(logFile)}: ${compressErr.message}`);
        const { deleted } = await applyRetention(archiveDir, path.basename(logFile));
        return { rotated: true, archive: tmpPath, deleted, compressionFailed: true };
      }
    } else {
      fs.renameSync(logFile, archivePath);
    }

    const { deleted } = await applyRetention(archiveDir, path.basename(logFile));
    return { rotated: true, archive: archivePath, deleted };
  } catch (err) {
    _logger().warn(`[logRotation] rotate failed for ${path.basename(logFile)}: ${err.message}`);
    return { rotated: false, archive: null, deleted: [], error: err.message };
  }
}

// Lazy logger to avoid circular deps at module load time
function _logger() {
  try { return require('./logger'); } catch (_) { return { warn: () => {} }; }
}

// ── Primary entry point ───────────────────────────────────────────────────────

/**
 * Check whether `logFile` needs rotation and, if so, rotate it.
 * This is the standard entry point for startup checks and scheduled runs.
 *
 * Acquires an in-process lock so concurrent calls for the same file are safe.
 *
 * @param {string} logFile
 * @param {object} [opts]  — forwarded to rotate()
 * @returns {Promise<{ rotated: boolean, reason?: string, archive?: string|null, deleted?: string[] }>}
 */
async function checkAndRotate(logFile, opts = {}) {
  if (_rotatingNow.has(logFile)) {
    return { rotated: false, reason: 'already-rotating' };
  }
  if (!needsRotation(logFile)) {
    return { rotated: false, reason: 'below-threshold' };
  }

  _rotatingNow.add(logFile);
  try {
    return await rotate(logFile, opts);
  } finally {
    _rotatingNow.delete(logFile);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  checkAndRotate,
  rotate,
  applyRetention,
  needsRotation,
  listArchives,
  getArchiveDir,
  getArchivePath,
  // Config readers — exposed for testing and for scripts/rotate-logs.js
  rotationMode,
  maxSizeBytes,
  keepFiles,
  keepDays,
  shouldCompress
};
