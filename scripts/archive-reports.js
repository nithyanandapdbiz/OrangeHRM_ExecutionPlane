'use strict';
/**
 * archive-reports.js
 * ─────────────────────────────────────────────────────────────────────
 * Archive the latest run's reports into a date-time-stamped folder so
 * every execution becomes a permanent, browseable historical record.
 *
 * Layout produced
 * ─────────────────────────────────────────────────────────────────────
 *   runs/
 *     functional/
 *       2026-04-28_14-32-07__OHRM-1__a1b2c3d/
 *         allure-report/         ← Allure single-file HTML
 *         playwright-report/     ← Native Playwright HTML report
 *         custom-report/         ← In-house functional report
 *         test-results.json
 *         test-results-healed.json
 *         manifest.json
 *       latest -> 2026-04-28_14-32-07__OHRM-1__a1b2c3d   (junction/copy)
 *     performance/
 *       2026-04-28_15-04-11__OHRM-1__a1b2c3d/
 *         perf-report/           ← from custom-report/perf
 *         summary.json
 *         results/               ← raw k6 JSON outputs
 *         manifest.json
 *     security/
 *       <stamp>/security-report/, findings.json, manifest.json
 *     pentest/
 *       <stamp>/pentest-report/, findings.json, manifest.json
 *
 * Usage
 *   node scripts/archive-reports.js --category functional
 *   node scripts/archive-reports.js --category performance --story OHRM-1
 *   node scripts/archive-reports.js --category security --label "smoke"
 *   node scripts/archive-reports.js --category pentest
 *   node scripts/archive-reports.js --category all
 *   node scripts/archive-reports.js --list                 (list runs)
 *   node scripts/archive-reports.js --keep 20 --category functional
 *                                                           (prune oldest)
 *
 * Behaviour
 *   • Best-effort: missing source folders are skipped silently (logged).
 *   • Never deletes the live report folders — only copies.
 *   • Writes manifest.json with timestamp, git sha/branch, story key,
 *     summary stats parsed from each report category, exit code passed
 *     in via --exit-code (optional).
 *   • Maintains a `latest` shortcut (NTFS junction on Windows, symlink
 *     elsewhere; falls back to a tiny pointer text file if both fail).
 * ─────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const ROOT  = path.resolve(__dirname, '..');
const ARCHIVE_ROOT = path.join(ROOT, 'runs');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan:  '\x1b[36m', white: '\x1b[97m'
};

// ─── CLI parsing ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { category: null, story: null, label: null, keep: null, exitCode: null, list: false, runId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list')                       args.list = true;
    else if (a === '--category')              args.category = argv[++i];
    else if (a.startsWith('--category='))     args.category = a.split('=')[1];
    else if (a === '--story')                 args.story = argv[++i];
    else if (a.startsWith('--story='))        args.story = a.split('=')[1];
    else if (a === '--label')                 args.label = argv[++i];
    else if (a.startsWith('--label='))        args.label = a.split('=')[1];
    else if (a === '--keep')                  args.keep = Number(argv[++i]);
    else if (a.startsWith('--keep='))         args.keep = Number(a.split('=')[1]);
    else if (a === '--run-id')                args.runId = argv[++i];
    else if (a.startsWith('--run-id='))       args.runId = a.split('=')[1];
    else if (a === '--exit-code')             args.exitCode = Number(argv[++i]);
    else if (a.startsWith('--exit-code='))    args.exitCode = Number(a.split('=')[1]);
  }
  return args;
}

// ─── helpers ─────────────────────────────────────────────────────────
function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function gitInfo() {
  const out = (cmd) => {
    try { return cp.execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
  };
  return {
    sha:    out('git rev-parse --short HEAD'),
    branch: out('git rev-parse --abbrev-ref HEAD'),
    dirty:  (out('git status --porcelain') || '').length > 0
  };
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

// Recursive copy. Skips node_modules and any nested runs/ to avoid loops.
function copyDir(src, dst) {
  if (!exists(src)) return false;
  const stat = fs.statSync(src);
  if (!stat.isDirectory()) {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
    return true;
  }
  ensureDir(dst);
  for (const name of fs.readdirSync(src)) {
    if (name === 'node_modules' || name === 'runs') continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}

function copyFile(src, dst) {
  if (!exists(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function dirSize(p) {
  if (!exists(p)) return 0;
  let total = 0;
  const stat = fs.statSync(p);
  if (stat.isFile()) return stat.size;
  for (const name of fs.readdirSync(p)) {
    total += dirSize(path.join(p, name));
  }
  return total;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// "latest" pointer — try NTFS junction, then symlink, then pointer file.
function updateLatestPointer(categoryDir, runDirName) {
  const latest = path.join(categoryDir, 'latest');
  // Best-effort cleanup
  try {
    if (fs.lstatSync(latest).isSymbolicLink() || fs.lstatSync(latest).isDirectory()) {
      fs.rmSync(latest, { recursive: true, force: true });
    } else {
      fs.unlinkSync(latest);
    }
  } catch { /* not present */ }

  // Try junction (Windows-friendly, no admin needed) → symlink → fallback file
  try {
    fs.symlinkSync(runDirName, latest, 'junction');
    return 'junction';
  } catch {/* fall through */}
  try {
    fs.symlinkSync(runDirName, latest, 'dir');
    return 'symlink';
  } catch {/* fall through */}
  try {
    fs.writeFileSync(latest + '.txt', runDirName + '\n', 'utf8');
    return 'pointer-file';
  } catch {/* give up */}
  return 'none';
}

// ─── Per-category source manifests ───────────────────────────────────
const SOURCES = {
  functional: [
    { src: 'allure-report',         dest: 'allure-report',     kind: 'dir'  },
    { src: 'playwright-report',     dest: 'playwright-report', kind: 'dir'  },
    { src: 'custom-report',         dest: 'custom-report',     kind: 'dir',
      // strip nested perf/security/pentest, those have their own categories
      excludeChildren: ['perf', 'security', 'pentest', 'discovery'] },
    { src: 'test-results.json',     dest: 'test-results.json',        kind: 'file' },
    { src: 'test-results-healed.json', dest: 'test-results-healed.json', kind: 'file' },
    { src: 'logs',                  dest: 'logs',              kind: 'dir',
      excludeChildren: ['perf', 'security', 'pentest', 'discovery'] }
  ],
  performance: [
    { src: 'custom-report/perf',    dest: 'perf-report',       kind: 'dir' },
    { src: 'perf',                  dest: 'perf-raw',          kind: 'dir' },
    { src: 'logs',                  dest: 'logs',              kind: 'dir',
      excludeChildren: ['discovery'] }
  ],
  security: [
    { src: 'custom-report/security', dest: 'security-report',  kind: 'dir' },
    { src: 'security',               dest: 'security-raw',     kind: 'dir' },
    { src: 'logs',                   dest: 'logs',             kind: 'dir',
      excludeChildren: ['discovery'] }
  ],
  pentest: [
    { src: 'custom-report/pentest', dest: 'pentest-report',    kind: 'dir' },
    { src: 'logs',                  dest: 'logs',              kind: 'dir',
      excludeChildren: ['discovery'] }
  ],
  logs: [
    { src: 'logs',                  dest: 'logs',              kind: 'dir' }
  ]
};

const CATEGORY_COLOURS = {
  functional:  C.cyan,
  performance: C.yellow,
  security:    C.green,
  pentest:     C.red,
  logs:        C.white
};

// ─── Stats parsers (best-effort, never throws) ───────────────────────
function summariseFunctional() {
  const summary = { tests: null, passed: null, failed: null, skipped: null };
  const file = path.join(ROOT, 'test-results-healed.json');
  const fallback = path.join(ROOT, 'test-results.json');
  const target = exists(file) ? file : (exists(fallback) ? fallback : null);
  if (!target) return summary;
  try {
    const json = JSON.parse(fs.readFileSync(target, 'utf8'));
    let pass = 0, fail = 0, skip = 0;
    const walk = (suite) => {
      for (const s of suite.suites || []) walk(s);
      for (const sp of suite.specs || []) {
        for (const t of sp.tests || []) {
          for (const r of t.results || []) {
            if (r.status === 'passed') pass++;
            else if (r.status === 'failed' || r.status === 'timedOut') fail++;
            else if (r.status === 'skipped') skip++;
          }
        }
      }
    };
    if (Array.isArray(json.suites)) json.suites.forEach(walk);
    summary.passed = pass;
    summary.failed = fail;
    summary.skipped = skip;
    summary.tests = pass + fail + skip;
  } catch { /* shape mismatch — leave nulls */ }
  return summary;
}

function summarisePerformance() {
  const summary = { thresholds: null, vusMax: null };
  const dir = path.join(ROOT, 'perf');
  if (!exists(dir)) return summary;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    summary.runs = files.length;
  } catch { /* ignore */ }
  return summary;
}

function summariseSecurity() {
  const summary = { findings: null, critical: null, high: null };
  const dir = path.join(ROOT, 'security');
  if (!exists(dir)) return summary;
  try {
    const findingsFile = path.join(dir, 'findings.json');
    if (exists(findingsFile)) {
      const json = JSON.parse(fs.readFileSync(findingsFile, 'utf8'));
      const findings = Array.isArray(json) ? json : (json.findings || []);
      summary.findings = findings.length;
      summary.critical = findings.filter(f => /critical/i.test(f.severity || '')).length;
      summary.high     = findings.filter(f => /high/i.test(f.severity || '')).length;
    }
  } catch { /* ignore */ }
  return summary;
}

function summarisePentest() {
  const summary = { tools: null };
  const dir = path.join(ROOT, 'custom-report', 'pentest');
  if (!exists(dir)) return summary;
  try { summary.tools = fs.readdirSync(dir).filter(n => n.endsWith('.json')).length; }
  catch { /* ignore */ }
  return summary;
}

function summariseLogs() {
  const summary = { files: null, errors: null, warnings: null };
  const dir = path.join(ROOT, 'logs');
  if (!exists(dir)) return summary;
  try {
    const files = fs.readdirSync(dir).filter(n => n.endsWith('.log') || n.endsWith('.json'));
    summary.files = files.length;
    let errors = 0, warnings = 0;
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      try {
        const txt = fs.readFileSync(path.join(dir, f), 'utf8');
        errors   += (txt.match(/\bERROR\b/g) || []).length;
        warnings += (txt.match(/\bWARN(?:ING)?\b/g) || []).length;
      } catch { /* ignore single file */ }
    }
    summary.errors   = errors;
    summary.warnings = warnings;
  } catch { /* ignore */ }
  return summary;
}

const SUMMARISERS = {
  functional:  summariseFunctional,
  performance: summarisePerformance,
  security:    summariseSecurity,
  pentest:     summarisePentest,
  logs:        summariseLogs
};

// ─── Core archiver ───────────────────────────────────────────────────
function computeRunId(opts) {
  // Priority: explicit --run-id > RUN_ID env var > freshly computed.
  if (opts.runId) return opts.runId;
  if (process.env.RUN_ID && process.env.RUN_ID.trim()) return process.env.RUN_ID.trim();
  const stamp = timestamp();
  const story = opts.story || process.env.ISSUE_KEY || 'no-story';
  const git   = gitInfo();
  const sha   = git.sha || 'nogit';
  const labelPart = opts.label ? `__${opts.label.replace(/[^a-z0-9_-]+/gi, '-')}` : '';
  return `${stamp}__${story}__${sha}${labelPart}`;
}

function archiveCategory(category, opts) {
  const colour = CATEGORY_COLOURS[category] || C.white;
  const runId  = computeRunId(opts);
  const git    = gitInfo();
  const story  = opts.story || process.env.ISSUE_KEY || 'no-story';

  const runRoot     = path.join(ARCHIVE_ROOT, runId);
  const runDir      = path.join(runRoot, category);

  console.log(`\n${colour}${C.bold}▶ Archiving ${category}${C.reset} → runs/${runId}/${category}`);

  ensureDir(runDir);

  const items = SOURCES[category];
  const copied = [];
  const skipped = [];

  for (const item of items) {
    const absSrc = path.join(ROOT, item.src);
    const absDst = path.join(runDir, item.dest);
    if (!exists(absSrc)) {
      skipped.push(item.src);
      console.log(`  ${C.dim}↷ skip ${item.src} (not present)${C.reset}`);
      continue;
    }
    try {
      if (item.kind === 'file') {
        copyFile(absSrc, absDst);
      } else {
        copyDir(absSrc, absDst);
        if (item.excludeChildren && Array.isArray(item.excludeChildren)) {
          for (const child of item.excludeChildren) {
            const p = path.join(absDst, child);
            if (exists(p)) fs.rmSync(p, { recursive: true, force: true });
          }
        }
      }
      copied.push({ src: item.src, dest: item.dest, bytes: dirSize(absDst) });
      console.log(`  ${C.green}✓${C.reset} ${item.src} → ${item.dest}  ${C.dim}(${fmtBytes(dirSize(absDst))})${C.reset}`);
    } catch (e) {
      skipped.push(`${item.src} (error: ${e.message})`);
      console.log(`  ${C.red}✗${C.reset} ${item.src} — ${e.message}`);
    }
  }

  const summary = (SUMMARISERS[category] || (() => ({})))();

  const manifest = {
    category,
    timestamp:    new Date().toISOString(),
    runId,
    story,
    label:        opts.label || null,
    git,
    summary,
    exitCode:     opts.exitCode,
    copied:       copied.map(c => ({ from: c.src, to: c.dest, bytes: c.bytes })),
    skipped,
    totalBytes:   dirSize(runDir),
    node:         { version: process.version, platform: process.platform }
  };

  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // Update / merge top-level run-manifest.json so it summarises every
  // category archived in this run.
  upsertRunManifest(runRoot, runId, story, git, category, manifest);

  // Update the global `latest` pointer at runs/latest -> <runId>.
  const pointerKind = updateLatestPointer(ARCHIVE_ROOT, runId);
  console.log(`  ${C.dim}latest pointer: ${pointerKind}${C.reset}`);
  console.log(`  ${C.bold}Total:${C.reset} ${fmtBytes(manifest.totalBytes)}  ${C.dim}(${copied.length} item(s) copied, ${skipped.length} skipped)${C.reset}`);

  if (opts.keep && Number.isInteger(opts.keep) && opts.keep > 0) {
    pruneOldRuns(ARCHIVE_ROOT, opts.keep);
  }

  return { category, runDir, runId, manifest };
}

function upsertRunManifest(runRoot, runId, story, git, category, catManifest) {
  const file = path.join(runRoot, 'run-manifest.json');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { doc = { runId, story, git, createdAt: new Date().toISOString(), categories: {} }; }
  doc.updatedAt = new Date().toISOString();
  doc.categories = doc.categories || {};
  doc.categories[category] = {
    timestamp:  catManifest.timestamp,
    summary:    catManifest.summary,
    totalBytes: catManifest.totalBytes,
    copiedCount:  catManifest.copied.length,
    skippedCount: catManifest.skipped.length
  };
  doc.totalBytes = Object.values(doc.categories).reduce((s, c) => s + (c.totalBytes || 0), 0);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
}

function pruneOldRuns(archiveRoot, keep) {
  if (!exists(archiveRoot)) return;
  const entries = fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'latest')
    .map(d => ({ name: d.name, mtime: fs.statSync(path.join(archiveRoot, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toRemove = entries.slice(keep);
  if (toRemove.length === 0) return;
  console.log(`  ${C.yellow}↻ pruning ${toRemove.length} old run(s) — keeping latest ${keep}${C.reset}`);
  for (const e of toRemove) {
    try {
      fs.rmSync(path.join(archiveRoot, e.name), { recursive: true, force: true });
      console.log(`     ${C.dim}- ${e.name}${C.reset}`);
    } catch (err) {
      console.log(`     ${C.red}!${C.reset} could not remove ${e.name}: ${err.message}`);
    }
  }
}

function listRuns() {
  if (!exists(ARCHIVE_ROOT)) {
    console.log(`${C.yellow}No runs archived yet (runs/ does not exist).${C.reset}`);
    return;
  }
  const runs = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'latest')
    .map(d => d.name)
    .sort()
    .reverse();

  console.log(`\n${C.bold}Run archive${C.reset}  ${C.dim}(${runs.length} run(s) under runs/)${C.reset}`);
  for (const r of runs.slice(0, 20)) {
    const runRoot = path.join(ARCHIVE_ROOT, r);
    const line = `  ${C.bold}${r}${C.reset}`;
    let detail = '';
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(runRoot, 'run-manifest.json'), 'utf8'));
      const cats = Object.keys(doc.categories || {});
      const f    = doc.categories && doc.categories.functional && doc.categories.functional.summary;
      if (f && f.tests !== null && f.tests !== undefined) {
        detail += `  ${C.dim}tests=${f.tests}, pass=${f.passed}, fail=${f.failed}${C.reset}`;
      }
      detail += `  ${C.dim}[${cats.join(', ')}]  ${fmtBytes(doc.totalBytes || 0)}${C.reset}`;
    } catch {
      // legacy per-category run folder (no run-manifest.json) — ignore
    }
    console.log(line + detail);
  }
  if (runs.length > 20) console.log(`  ${C.dim}... and ${runs.length - 20} older${C.reset}`);
}

// ─── Main ────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    listRuns();
    return;
  }

  if (!args.category) {
    console.error(`${C.red}error:${C.reset} --category required (functional | performance | security | pentest | logs | all)`);
    process.exit(2);
  }

  ensureDir(ARCHIVE_ROOT);

  const targets = args.category === 'all'
    ? Object.keys(SOURCES)
    : [args.category];

  for (const cat of targets) {
    if (!SOURCES[cat]) {
      console.error(`${C.red}error:${C.reset} unknown category "${cat}"`);
      process.exit(2);
    }
    archiveCategory(cat, args);
  }
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    console.error(`${C.red}archive-reports failed:${C.reset} ${e.message}`);
    process.exit(1);
  }
}

module.exports = { archiveCategory, listRuns, SOURCES };
