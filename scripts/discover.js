#!/usr/bin/env node
'use strict';
/**
 * discover.js — Enterprise Discovery CLI.
 *
 * A THIN developer-experience wrapper around the existing Discovery REST APIs. It
 * orchestrates the Execution Plane (crawl + status + artifacts) and the Intelligence
 * Plane (delta + graph query) — it contains NO discovery logic of its own.
 *
 * Config precedence:  CLI args  >  env vars  >  .discoveryrc.json  >  defaults.
 *
 * Usage:
 *   npm run discover
 *   npm run discover -- --url=https://app --username=Admin --password=admin123 --depth=5 --pages=200 --strategy=bfs
 *   npm run discover -- --resume
 *   npm run discover -- --delta
 *   npm run discover -- --query pagesWithComponent --type datepicker
 *   npm run discover -- --report executive
 *   npm run discover -- --ci
 *   npm run discover -- --help
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'discovery');
const STATE_DIR = path.join(ROOT, 'logs', 'discovery');
const HISTORY_FILE = path.join(STATE_DIR, 'cli-history.json');
const LOG_FILE = path.join(ROOT, 'logs', 'discovery-cli.log');
const RC_FILE = path.join(ROOT, '.discoveryrc.json');

// ── ANSI colours (auto-disabled for --ci / NO_COLOR / non-TTY) ───────────────
function makeColors(enabled) {
  const wrap = (code) => (s) => (enabled ? `[${code}m${s}[0m` : String(s));
  return { green: wrap(32), red: wrap(31), yellow: wrap(33), cyan: wrap(36), bold: wrap(1), dim: wrap(2), magenta: wrap(35) };
}

// ── Structured file logger ───────────────────────────────────────────────────
function log(level, msg, extra) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(extra || {}) });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging is best-effort */ }
}

// ── Arg parsing (supports --k v, --k=v, boolean flags) ───────────────────────
const BOOL_FLAGS = new Set(['resume', 'delta', 'ci', 'help', 'headless', 'no-download', 'json', 'zephyr']);
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    a = a.slice(2);
    if (a.includes('=')) { const [k, ...v] = a.split('='); out[k] = v.join('='); continue; }
    if (BOOL_FLAGS.has(a)) { out[a] = true; continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a] = next; i++; } else { out[a] = true; }
  }
  return out;
}

// ── Config resolution: args > env > rc > defaults ────────────────────────────
function loadRc() {
  try { return JSON.parse(fs.readFileSync(RC_FILE, 'utf8')); } catch { return {}; }
}
function resolveConfig(args, env = process.env, rc = loadRc()) {
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : parseInt(v, 10));
  const first = (...xs) => xs.find((x) => x !== undefined && x !== '');
  const cfg = {
    epUrl: first(args['ep-url'], env.DISCOVERY_EP_URL, rc.epUrl, 'http://localhost:3002'),
    ipUrl: first(args['ip-url'], env.INTELLIGENCE_API_URL, rc.ipUrl, 'http://localhost:3001'),
    baseUrl: first(args.url, env.DISCOVERY_URL, rc.baseUrl),
    username: first(args.username, env.DISCOVERY_USERNAME, rc.username),
    password: first(args.password, env.DISCOVERY_PASSWORD, rc.password),
    maxDepth: first(num(args.depth), num(env.DISCOVERY_DEPTH), rc.maxDepth, 3),
    maxPages: first(num(args.pages), num(env.DISCOVERY_PAGES), rc.maxPages, 60),
    strategy: first(args.strategy, env.DISCOVERY_STRATEGY, rc.strategy, 'bfs'),
    headless: String(first(args.headless, rc.headless, true)) !== 'false',
    domain: first(args.domain, env.DISCOVERY_DOMAIN, rc.domain, 'hr'),
    clientId: first(env.CLIENT_ID, rc.clientId),
    clientSecret: first(env.CLIENT_SECRET, rc.clientSecret),
    retries: first(num(args.retries), num(env.DISCOVERY_RETRIES), rc.retries, 2),
    ci: Boolean(args.ci),
    download: args['no-download'] ? false : true,
  };
  // ── Zephyr Essential native-workflow governance (opt-in) ──────────────────
  // Enable with --zephyr, ZEPHYR_GOVERNANCE=true, or "zephyr":{"enabled":true} in
  // .discoveryrc.json. Values are forwarded to the EP, which owns the Jira/Zephyr
  // credentials and does the authoritative defaulting (see zephyrGovernance.js).
  const rz = rc.zephyr || {};
  const bool = (v) => (v === undefined || v === '' ? undefined : (v === true || String(v).toLowerCase() === 'true'));
  cfg.zephyr = {
    enabled: Boolean(args.zephyr) || bool(first(env.ZEPHYR_GOVERNANCE, rz.enabled)) || false,
    project: first(args['zephyr-project'], env.ZEPHYR_PROJECT, rz.project),
    release: first(args['zephyr-release'], env.ZEPHYR_RELEASE, rz.release),
    cycle: first(args['zephyr-cycle'], env.ZEPHYR_CYCLE, rz.cycle),
    folder: first(args['zephyr-folder'], env.ZEPHYR_FOLDER, rz.folder),
    story: first(args['zephyr-story'], env.ZEPHYR_STORY, env.ISSUE_KEY, rz.story),
    environment: first(args.env, env.DISCOVERY_ENV, rz.environment),
    build: first(args.build, env.DISCOVERY_BUILD, rz.build),
    browser: cfg.headless ? 'chromium (headless)' : 'chromium (headed)',
    autoCreateCycle: bool(first(args['auto-create-cycle'], env.AUTO_CREATE_CYCLE, rz.autoCreateCycle)),
    autoCreateExecution: bool(first(env.AUTO_CREATE_EXECUTION, rz.autoCreateExecution)),
    autoUploadArtifacts: bool(first(env.AUTO_UPLOAD_ARTIFACTS, rz.autoUploadArtifacts)),
    autoSyncStatus: bool(first(env.AUTO_SYNC_STATUS, rz.autoSyncStatus)),
  };
  return cfg;
}

function buildRunBody(cfg) {
  return {
    baseUrl: cfg.baseUrl, maxDepth: cfg.maxDepth, maxPages: cfg.maxPages,
    strategy: cfg.strategy, username: cfg.username, password: cfg.password,
    headless: cfg.headless, domain: cfg.domain,
    ...(cfg.zephyr && cfg.zephyr.enabled ? { zephyr: cfg.zephyr } : {}),
  };
}

// ── HTTP with retry (client is injectable for tests) ─────────────────────────
let httpClient = axios;
function __setHttpClient(fn) { httpClient = fn || axios; }
async function http(method, url, { body, token, retries = 0 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = `Bearer ${token}`; headers['X-Customer-ID'] = 'orangehrm'; }
  let attempt = 0;
  for (;;) {
    try {
      const resp = await httpClient({ method, url, data: body, headers, timeout: 60000, validateStatus: () => true });
      if (resp.status >= 500 && attempt < retries) throw new Error(`HTTP ${resp.status}`);
      return { status: resp.status, data: resp.data };
    } catch (err) {
      if (attempt >= retries) { log('error', `${method} ${url} failed`, { error: err.message }); throw err; }
      attempt++;
      log('warn', `retry ${attempt}/${retries} ${method} ${url}`, { reason: err.message });
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// ── History / resume state ───────────────────────────────────────────────────
function readHistory() { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; } }
function pushHistory(entry) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const h = readHistory(); h.push(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-50), null, 2));
  } catch { /* best-effort */ }
}

// ── Artifact splitter (maps the artifacts object → files) ────────────────────
function splitArtifacts(artifacts = {}) {
  const files = [];
  const json = (name, obj) => { if (obj !== undefined) files.push({ path: name, content: JSON.stringify(obj, null, 2) }); };
  const intel = artifacts.intelligence || {};
  json('metadata.json', artifacts.metadata);
  json('application-model.json', artifacts.applicationModel);
  json('navigation-graph.json', artifacts.navGraph);
  json('knowledge-graph.json', artifacts.knowledgeGraph);
  json('workflows.json', artifacts.workflows);
  json('contracts.json', artifacts.contracts);
  json('business-rules.json', intel.businessRules);
  json('coverage.json', intel.coverage);
  json('risk.json', intel.risk);
  json('recommendations.json', intel.recommendations);
  json('reports.json', intel.reports);
  // Also write each report as its own file under reports/ for a browsable tree.
  for (const k of ['executive', 'architect', 'qa', 'developer']) {
    if (intel.reports && intel.reports[k]) json(path.join('reports', `${k}.json`), intel.reports[k]);
  }
  json('ai-readiness.json', intel.aiReadiness);
  for (const p of (artifacts.pageObjects || [])) if (p && p.name) files.push({ path: path.join('page-objects', p.name), content: p.content || '' });
  for (const t of (artifacts.contractTests || [])) if (t && t.name) files.push({ path: path.join('contract-tests', t.name), content: t.content || '' });
  if (typeof artifacts.report === 'string' && artifacts.report) files.push({ path: 'report.html', content: artifacts.report });
  return files;
}
// F4: reject unsafe artefact filenames — traversal, absolute paths, drive letters,
// control characters — and guarantee the resolved path stays inside the run directory.
function isSafeArtifactPath(rel, baseDir) {
  if (typeof rel !== 'string' || rel === '') return false;
  if ([...rel].some((ch) => ch.charCodeAt(0) < 32)) return false; // control characters
  if (path.isAbsolute(rel)) return false;                 // absolute path
  if (/^[a-zA-Z]:/.test(rel)) return false;               // Windows drive letter
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return false; // traversal/empty
  const base = path.resolve(baseDir);
  const full = path.resolve(baseDir, rel);
  return full === base || full.startsWith(base + path.sep); // never escape the run dir
}

function writeArtifacts(runId, artifacts) {
  const dir = path.join(ARTIFACT_DIR, runId);
  const files = splitArtifacts(artifacts);
  let count = 0, rejected = 0;
  for (const f of files) {
    if (!isSafeArtifactPath(f.path, dir)) {
      rejected++;
      log('warn', 'rejected unsafe artifact filename', { name: String(f.path).slice(0, 120) });
      continue;
    }
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
    count++;
  }
  if (rejected) log('warn', `discovery-cli rejected ${rejected} unsafe artifact filename(s)`, { runId });
  return { dir, count, rejected };
}

// ── Colours + printing (bound at runtime from cfg.ci) ────────────────────────
let C = makeColors(false);
const out = (s = '') => process.stdout.write(s + '\n');

// ── Health checks ────────────────────────────────────────────────────────────
async function healthChecks(cfg) {
  const checks = [];
  if (!cfg.baseUrl) checks.push({ name: 'config', ok: false, detail: 'baseUrl not set (use --url, DISCOVERY_URL, or .discoveryrc.json)' });
  else checks.push({ name: 'config', ok: true, detail: cfg.baseUrl });

  try {
    const ep = await http('get', `${cfg.epUrl}/health`);
    const ok = ep.status === 200;
    checks.push({ name: 'execution-plane', ok, detail: ok ? `${cfg.epUrl} (${ep.data.customer}/${ep.data.domain})` : `HTTP ${ep.status}` });
    const intel = ep.data && ep.data.intelligenceApi;
    checks.push({ name: 'intelligence-plane', ok: Boolean(intel && intel.reachable), detail: intel ? `${intel.url} reachable=${intel.reachable} agents=${intel.agents}` : 'unknown' });
    checks.push({ name: 'tenant', ok: Boolean(ep.data.customer), detail: `${ep.data.customer || '?'} / ${ep.data.domain || '?'}` });
  } catch (e) {
    checks.push({ name: 'execution-plane', ok: false, detail: `${cfg.epUrl} unreachable: ${e.message}` });
  }

  if (cfg.clientId && cfg.clientSecret) {
    try { const t = await oauthToken(cfg); checks.push({ name: 'oauth2', ok: Boolean(t), detail: t ? 'token obtained' : 'no token' }); }
    catch (e) { checks.push({ name: 'oauth2', ok: false, detail: e.message }); }
  } else {
    checks.push({ name: 'oauth2', ok: false, detail: 'CLIENT_ID/CLIENT_SECRET not set (delta/query need them)' });
  }
  return { ok: checks.every((c) => c.ok || c.name === 'oauth2'), checks };
}

async function oauthToken(cfg) {
  const r = await http('post', `${cfg.ipUrl}/oauth/token`, { body: { grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }, retries: cfg.retries });
  return r.data && r.data.access_token;
}

// ── Poll a run to terminal with progress ─────────────────────────────────────
const STAGE_PCT = { queued: 0, crawling: 25, scrubbing: 45, synthesising: 65, downloading: 88, completed: 100, failed: 100, cancelled: 100 };

// Canonical pipeline order for the live stage checklist (EP stages + IP sub-stages).
const PIPELINE = [
  ['crawling', 'Crawling (browser)'],
  ['scrubbing', 'PII Scrubbing'],
  ['contract-extract', 'Contract Extraction'],
  ['app-model-synthesise', 'Application Model'],
  ['generate-artefacts', 'Artefact Generation'],
  ['report', 'Report Generation'],
  ['model', 'Workflows + Knowledge Graph'],
  ['intelligence', 'Intelligence (rules/coverage/risk)'],
  ['downloading', 'Packaging + Download'],
  ['completed', 'Completed'],
];
function currentKey(stage, substage) {
  if (stage === 'synthesising') return (PIPELINE.find(([k]) => k === substage) || ['contract-extract'])[0];
  return stage;
}
function buildChecklist(stage, substage, terminal) {
  const idx = PIPELINE.findIndex(([k]) => k === currentKey(stage, substage));
  return PIPELINE.map(([, label], i) => {
    if (terminal === 'completed') return { label, state: 'done' };
    if (terminal === 'failed' || terminal === 'cancelled') return { label, state: i < idx ? 'done' : i === idx ? 'fail' : 'pending' };
    if (idx < 0) return { label, state: 'pending' };
    return { label, state: i < idx ? 'done' : i === idx ? 'active' : 'pending' };
  });
}
function moduleFromUrl(u) {
  try { const p = new URL(u).pathname.split('/').filter(Boolean); const i = p.indexOf('index.php'); return i >= 0 && p[i + 1] ? p[i + 1] : (p[0] || '-'); } catch { return '-'; }
}
function humanBytes(n) { if (n == null) return '?'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
function bar(pct, w = 16) { const f = Math.max(0, Math.min(w, Math.round((pct / 100) * w))); return '█'.repeat(f) + '░'.repeat(w - f); }
const ESC = String.fromCharCode(27);
const ansiUp = (n) => (n > 0 ? ESC + '[' + n + 'A' : '');
const CLEAR_DOWN = ESC + '[0J';
const HR = () => C.dim('═'.repeat(54));

// In-place TTY dashboard. Returns the number of lines drawn (for the next redraw).
function renderDashboard(s, elapsed, prevLines) {
  const pct = STAGE_PCT[s.stage] ?? s.progress ?? 0;
  const L = [HR(),
    `  ${C.bold('Discovery Run')}  ${C.cyan(s.runId)}`,
    `  ${C.dim('Stage')} ${C.bold((s.substage ? `${s.stage} · ${s.substage}` : s.stage).padEnd(28))} ${C.dim('elapsed')} ${elapsed}s   ${C.cyan(bar(pct))} ${pct}%`,
    HR()];
  for (const it of buildChecklist(s.stage, s.substage, null)) {
    const mark = it.state === 'done' ? C.green('✔') : it.state === 'active' ? C.cyan('▶') : it.state === 'fail' ? C.red('✘') : C.dim('○');
    L.push(`    ${mark} ${it.state === 'active' ? C.bold(it.label) : it.state === 'pending' ? C.dim(it.label) : it.label}`);
  }
  if (s.stage === 'crawling' && s.currentUrl) {
    L.push(HR(), `  ${C.dim('current')} ${C.bold(moduleFromUrl(s.currentUrl))}  ${C.dim('· pages')} ${C.bold(s.pagesCrawled || 0)}`, `  ${C.dim(String(s.currentUrl).slice(0, 62))}`);
  }
  L.push(HR());
  process.stdout.write(ansiUp(prevLines) + CLEAR_DOWN + L.join('\n') + '\n');
  return L.length;
}

async function pollRun(cfg, runId) {
  const t0 = Date.now();
  const tty = !cfg.ci && process.stdout.isTTY;
  let lastKey = '', drawn = 0;
  const timeline = [];
  for (;;) {
    const r = await http('get', `${cfg.epUrl}/discovery/runs/${runId}`, { retries: cfg.retries });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const s = r.data;
    const elapsed = Number(((Date.now() - t0) / 1000).toFixed(0));
    const key = `${s.stage}|${s.substage || ''}`;
    const isNew = key !== lastKey;
    if (isNew) { timeline.push({ t: elapsed, label: s.substage ? `${s.stage} · ${s.substage}` : s.stage }); log('info', 'stage', { runId, stage: s.stage, substage: s.substage || null, currentUrl: s.currentUrl || null, elapsed }); }
    if (tty) drawn = renderDashboard(s, elapsed, drawn);
    else if (!cfg.ci && isNew) out(`  ${C.cyan('▸')} ${C.bold(String(s.substage ? `${s.stage} · ${s.substage}` : s.stage).padEnd(30))} ${C.dim(`${elapsed}s`)}`);
    if (isNew) lastKey = key;
    if (['completed', 'failed', 'cancelled'].includes(s.status)) return { ...s, elapsedS: elapsed, timeline };
    await new Promise((r2) => setTimeout(r2, tty ? 1000 : 3000));
  }
}

// ── Pretty summary ───────────────────────────────────────────────────────────
// Recursive artefact tree with file sizes (for the final dashboard).
function artifactTree(dir, prefix = '  ') {
  const lines = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return lines; }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
  entries.forEach((e, i) => {
    const last = i === entries.length - 1;
    const branch = last ? '└── ' : '├── ';
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      let n = 0; try { n = fs.readdirSync(full).length; } catch { /* */ }
      lines.push(`${prefix}${branch}${C.cyan(e.name + '/')}  ${C.dim(`(${n} files)`)}`);
      lines.push(...artifactTree(full, prefix + (last ? '    ' : '│   ')));
    } else {
      let sz = 0; try { sz = fs.statSync(full).size; } catch { /* */ }
      lines.push(`${prefix}${branch}${e.name}  ${C.dim(humanBytes(sz))}`);
    }
  });
  return lines;
}

// ── Governance audit package (Phases 2/3/5/7) ────────────────────────────────
// Written alongside the downloaded artefacts so a compliance auditor can replay
// the whole run WITHOUT accessing live Jira/Zephyr. Only produced when governance
// is enabled — otherwise behaviour is byte-identical to today (backward compat).
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function readPkgVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

// Phase 3 — evidence manifest: every written artefact with size + SHA-256 + time.
function buildEvidenceManifest(dir) {
  const items = [];
  const walk = (d, rel) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, r); continue; }
      try {
        const buf = fs.readFileSync(full);
        const st = fs.statSync(full);
        items.push({ filename: r, size: st.size, sha256: sha256(buf), generatedAt: st.mtime.toISOString(), status: 'present', location: r });
      } catch { /* skip unreadable */ }
    }
  };
  walk(dir, '');
  return items;
}

// Phase 2 — governance.json (permanent audit record).
function buildGovernance(runId, status, artifacts, evidence) {
  const z = status.zephyr || {};
  return {
    schema: 'discovery-governance/v1',
    runId,
    ipRunId: status.ipRunId || (z.correlationIds && z.correlationIds.ipRunId) || null,
    tenant: z.tenant || null,
    jira: z.story || null,
    zephyr: { cycle: z.cycleKey || null, execution: z.executionKey || null, status: z.zephyrStatus || null },
    governanceResult: z.governanceResult || null,
    timeline: z.timeline || [],
    comments: z.commentLog || [],
    evidence,
    metrics: z.metrics || {},
    compliance: z.compliance || null,
    metrics_summary: { evidenceFiles: evidence.length, comments: z.comments || 0, timelineEvents: (z.timeline || []).length },
    metadata: (artifacts && artifacts.metadata) || null,
    generatedAt: new Date().toISOString(),
  };
}

// Phase 7 — audit-report.json (immutable, self-contained audit).
function buildAuditReport(runId, status, artifacts, evidence, governance) {
  const z = status.zephyr || {};
  const hashes = {}; for (const e of evidence) hashes[e.filename] = e.sha256;
  const terminal = new Set(['PASS', 'FAIL', 'PARTIAL', 'BLOCKED']);
  return {
    schema: 'discovery-audit-report/v1',
    executionMetadata: {
      runId, ipRunId: governance.ipRunId, baseUrl: status.baseUrl || null, status: status.status,
      startedAt: status.startedAt || null, completedAt: status.completedAt || null, durationS: status.elapsedS ?? null,
    },
    governanceTimeline: z.timeline || [],
    statusHistory: (z.timeline || []).filter((e) => e.stage || terminal.has(e.event)).map((e) => ({ ts: e.ts, event: e.event, result: e.result })),
    evidenceInventory: evidence,
    comments: z.commentLog || [],
    metrics: z.metrics || {},
    failures: (z.metrics && z.metrics.failures) || 0,
    retries: (z.metrics && z.metrics.retryCount) || 0,
    configuration: { retryPolicy: z.retryPolicy || null, project: z.project || null, release: z.release || null },
    environment: z.environment || null,
    tenant: z.tenant || null,
    versions: { executionPlane: readPkgVersion(), discoveryApi: '1.0.0', checkpointSchema: 1, auditSchema: 'v1' },
    hashes,
    packageHash: sha256(JSON.stringify(governance)),
    correlationIds: z.correlationIds || { discoveryRunId: runId, ipRunId: governance.ipRunId },
    compliance: z.compliance || null,
    generatedAt: new Date().toISOString(),
  };
}

function writeGovernancePackage(runId, status, artifacts, dir) {
  try {
    const evidence = buildEvidenceManifest(dir); // scan BEFORE writing the package files
    const governance = buildGovernance(runId, status, artifacts, evidence);
    const audit = buildAuditReport(runId, status, artifacts, evidence, governance);
    fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    fs.writeFileSync(path.join(dir, 'governance.json'), JSON.stringify(governance, null, 2));
    fs.writeFileSync(path.join(dir, 'audit-report.json'), JSON.stringify(audit, null, 2));
    log('info', 'governance package written', { runId, evidenceFiles: evidence.length, governanceResult: governance.governanceResult });
    return { evidence, governance, audit };
  } catch (e) { log('warn', 'governance package write failed', { runId, error: e.message }); return null; }
}

// Grouped enterprise final dashboard (Application / Knowledge / Automation /
// Intelligence / Performance / Reports / Governance / Timeline / Artefacts).
function finalDashboard(runId, status, artifacts, savedDir, timeline, gov) {
  const m = (artifacts && artifacts.metadata) || {};
  const intel = (artifacts && artifacts.intelligence) || {};
  const kgStats = (artifacts && artifacts.knowledgeGraph && artifacts.knowledgeGraph.stats) || {};
  const grp = (t) => out('  ' + C.bold(t));
  const kv = (k, v) => out(`    ${C.dim(String(k).padEnd(18))} ${v}`);
  out(''); out(HR()); out('  ' + C.green(C.bold('DISCOVERY SUMMARY')) + '   ' + C.dim(runId)); out(HR());

  grp('Application');
  kv('Pages', m.routes ?? '?'); kv('Components', m.components ?? '?'); kv('Forms', m.forms ?? '?');
  kv('Endpoints', (status.crawlStats && status.crawlStats.endpoints) ?? m.contracts ?? '?');
  kv('Modules', (kgStats.byType && kgStats.byType.Module) ?? '?');

  grp('Knowledge');
  kv('Graph nodes', m.knowledgeGraphNodes ?? '?'); kv('Graph edges', m.knowledgeGraphEdges ?? '?');
  kv('Workflows', m.workflows ?? '?'); kv('Business rules', m.businessRules ?? '?');

  grp('Automation');
  kv('Page objects', m.pageObjects ?? '?'); kv('API contracts', m.contracts ?? '?'); kv('Contract tests', m.contractTests ?? '?');

  grp('Intelligence');
  const sev = m.riskSeverity || (intel.risk && intel.risk.severity) || '?';
  const sevC = sev === 'high' ? C.red : sev === 'medium' ? C.yellow : C.green;
  kv('Coverage', `${m.coverage ?? '?'}%`); kv('Risk', sevC(`${sev}${intel.risk ? ` (${intel.risk.overall})` : ''}`));
  kv('Recommendations', m.recommendations ?? '?'); kv('AI consumers', intel.aiReadiness ? Object.keys(intel.aiReadiness.consumers || {}).length : '?');

  grp('Performance');
  const crawlMs = status.crawlStats && status.crawlStats.durationMs;
  kv('Total', `${status.elapsedS ?? '?'}s`);
  kv('Crawl (browser)', crawlMs != null ? `${(crawlMs / 1000).toFixed(1)}s` : '?');
  kv('Synthesis + dl', (crawlMs != null && status.elapsedS != null) ? `~${Math.max(0, status.elapsedS - crawlMs / 1000).toFixed(1)}s` : '?');

  if (status.zephyr && status.zephyr.enabled) {
    const z = status.zephyr;
    const gr = z.governanceResult || '?';
    const grC = gr === 'PASS' ? C.green : gr === 'PARTIAL' ? C.yellow : C.red;
    const ev = gov && gov.evidence ? gov.evidence.length : (z.evidence && z.evidence.count) || 0;
    const tl = (z.timeline && z.timeline.length) || 0;
    const durMs = z.metrics && z.metrics.governanceDurationMs;
    out(HR()); grp('Governance');
    kv('Jira', z.story ? C.green(`Linked (${z.story})`) : C.dim('not linked'));
    kv('Zephyr Cycle', z.cycleKey ? C.green(`Created (${z.cycleKey})`) : C.dim('(none)'));
    kv('Execution', z.executionKey ? `${z.zephyrStatus === 'Pass' ? C.green(z.zephyrStatus) : C.yellow(z.zephyrStatus)} (${z.executionKey})` : C.dim('(none)'));
    kv('Evidence', z.evidence && z.evidence.uploaded ? C.green(`Uploaded (${ev} files)`) : C.dim(`${ev} files`));
    kv('Comments', z.comments ? C.green(`Updated (${z.comments})`) : C.dim('0'));
    kv('Timeline', tl ? C.green(`Stored (${tl} events)`) : C.dim('0'));
    kv('Compliance', z.compliance ? grC(z.compliance.result) : C.dim('?'));
    kv('Governance', grC(gr));
    kv('Duration', durMs != null ? `${(durMs / 1000).toFixed(1)}s` : '?');
    if (gov) kv('Audit package', C.dim('governance.json · evidence.json · audit-report.json'));
    if (z.compliance && z.compliance.missing.length) kv('Missing', C.yellow(z.compliance.missing.join(', ')));
  }

  out(HR()); grp('Reports');
  const reports = intel.reports || {};
  for (const k of ['executive', 'architect', 'qa', 'developer']) {
    const ok = !!reports[k];
    const sz = ok ? humanBytes(Buffer.byteLength(JSON.stringify(reports[k]))) : '-';
    out(`    ${ok ? C.green('✔') : C.dim('·')} ${String(`${k} report`).padEnd(20)} ${C.dim(String(sz).padStart(8))}  ${C.dim(`reports/${k}.json`)}`);
  }
  if (typeof artifacts.report === 'string' && artifacts.report) {
    out(`    ${C.green('✔')} ${'discovery HTML'.padEnd(20)} ${C.dim(humanBytes(artifacts.report.length).padStart(8))}  ${C.dim('report.html')}`);
  }

  if (timeline && timeline.length) { out(HR()); grp('Timeline'); for (const e of timeline) out(`    ${C.dim(`${String(e.t).padStart(4)}s`)}  ${e.label}`); }

  if (savedDir) { out(HR()); grp(`Artifacts  ${C.dim(savedDir)}`); for (const l of artifactTree(savedDir)) out(l); }

  out(HR()); out('  ' + C.green(C.bold('STATUS: SUCCESS'))); out(HR()); out('');
}

// ── Commands ─────────────────────────────────────────────────────────────────
async function cmdDiscover(cfg, { runId } = {}) {
  if (!runId) {
    if (!cfg.baseUrl) throw new Error('baseUrl is required (--url, DISCOVERY_URL, or .discoveryrc.json)');
    const r = await http('post', `${cfg.epUrl}/discovery/run`, { body: buildRunBody(cfg), retries: cfg.retries });
    if (r.status !== 202) throw new Error(`run rejected: HTTP ${r.status} ${JSON.stringify(r.data)}`);
    runId = r.data.runId;
    log('info', 'discovery started', { runId, baseUrl: cfg.baseUrl });
    if (!cfg.ci) out(`  ${C.cyan('●')} Run accepted ${C.bold(runId)} — polling…`);
  } else if (!cfg.ci) { out(`  ${C.cyan('●')} Resuming ${C.bold(runId)} — polling…`); }

  const status = await pollRun(cfg, runId);
  let artifacts = null, saved = null, govPkg = null;
  if (status.status === 'completed' && cfg.download) {
    const a = await http('get', `${cfg.epUrl}/discovery/runs/${runId}/artifacts`, { retries: cfg.retries });
    if (a.status === 200) { artifacts = a.data.artifacts; saved = writeArtifacts(runId, artifacts); }
  }
  // Governance audit package (only when governance is enabled — else no-op).
  if (status.zephyr && status.zephyr.enabled && saved && saved.dir) {
    govPkg = writeGovernancePackage(runId, status, artifacts, saved.dir);
  }
  pushHistory({ runId, ipRunId: status.ipRunId, at: new Date().toISOString(), baseUrl: cfg.baseUrl, status: status.status });
  log('info', 'discovery finished', { runId, status: status.status, ipRunId: status.ipRunId });

  if (cfg.ci) {
    out(JSON.stringify({
      runId, ipRunId: status.ipRunId, status: status.status,
      metadata: artifacts && artifacts.metadata, artifactsDir: saved && saved.dir,
      zephyr: status.zephyr || null,
      governance: govPkg ? { result: govPkg.governance.governanceResult, evidenceFiles: govPkg.evidence.length, files: ['governance.json', 'evidence.json', 'audit-report.json'] } : null,
    }));
  } else if (status.status === 'completed') {
    finalDashboard(runId, status, artifacts, saved && saved.dir, status.timeline, govPkg);
  } else {
    out(C.red(`  x Discovery ${status.status}${status.error ? ` — ${status.error}` : ''}`));
    if (status.zephyr && status.zephyr.enabled) {
      const z = status.zephyr;
      out(`    ${C.dim('Zephyr')} ${C.yellow(z.zephyrStatus || '?')}  ${C.dim('cycle')} ${z.cycleKey || '(none)'}  ${C.dim('exec')} ${z.executionKey || '(none)'}${z.story ? `  ${C.dim('jira')} ${z.story}` : ''}`);
    }
  }
  return status.status === 'completed' ? 0 : 1;
}

async function cmdResume(cfg) {
  const h = readHistory();
  const last = [...h].reverse().find((x) => x.runId);
  if (!last) { out(C.yellow('  No previous run to resume.')); return 1; }
  // If already terminal, re-download; else keep polling.
  return cmdDiscover(cfg, { runId: last.runId });
}

async function cmdDelta(cfg) {
  const h = readHistory().filter((x) => x.ipRunId);
  if (h.length < 2) { out(C.yellow('  Need at least two completed runs for a delta.')); return 1; }
  const [prev, latest] = [h[h.length - 2], h[h.length - 1]];
  const token = await oauthToken(cfg);
  const r = await http('post', `${cfg.ipUrl}/api/discovery/delta`, { token, body: { fromRunId: prev.ipRunId, toRunId: latest.ipRunId }, retries: cfg.retries });
  if (r.status !== 200) throw new Error(`delta failed: HTTP ${r.status} ${JSON.stringify(r.data)}`);
  const d = r.data.delta, ci = r.data.changeImpact;
  if (cfg.ci) { out(JSON.stringify({ from: prev.ipRunId, to: latest.ipRunId, delta: d.summary, graph: d.graph.stats, changeImpact: ci })); return 0; }
  out('');
  out(C.bold(`  Δ Discovery Delta  ${C.dim(`${prev.runId} → ${latest.runId}`)}`));
  out('  ' + C.dim('─'.repeat(46)));
  const s = d.summary;
  out(`  Pages added/removed/changed   ${C.green(s.pagesAdded)} / ${C.red(s.pagesRemoved)} / ${C.yellow(s.pagesChanged)}`);
  out(`  APIs changed                  ${C.bold(s.apisChanged)}`);
  out(`  Components changed            ${C.bold(s.componentsChanged)}`);
  out(`  Selectors changed             ${C.bold(s.selectorsChanged)}`);
  out(`  Workflows changed             ${C.bold(s.workflowsChanged)}`);
  out(`  Graph nodes +/−/~             ${C.green(d.graph.stats.nodesAdded)} / ${C.red(d.graph.stats.nodesRemoved)} / ${C.yellow(d.graph.stats.nodesChanged)}`);
  out(`  Change impact                 ${ci.hasImpact ? C.yellow(`${ci.impactedPages.length} pages, ${ci.affectedTests.length} tests`) : C.green('none')}`);
  out('');
  return 0;
}

async function cmdQuery(cfg, args) {
  const h = readHistory().filter((x) => x.ipRunId);
  const latest = h[h.length - 1];
  if (!latest) { out(C.yellow('  No completed run to query.')); return 1; }
  const where = {};
  if (args.type) where.type = args.type;
  if (args.module) where.module = args.module;
  if (args.field) where.field = args.field;
  const token = await oauthToken(cfg);
  const r = await http('post', `${cfg.ipUrl}/api/discovery/${latest.ipRunId}/query`, { token, body: { find: args.query, where }, retries: cfg.retries });
  if (r.status !== 200) throw new Error(`query failed: HTTP ${r.status}`);
  const q = r.data.query;
  if (cfg.ci) { out(JSON.stringify(q)); return q.error ? 1 : 0; }
  if (q.error) { out(C.red(`  ${q.error}. Available: ${q.available.join(', ')}`)); return 1; }
  out('');
  out(C.bold(`  ⌕ ${args.query}(${JSON.stringify(where)}) → ${q.count} result(s)`));
  for (const n of q.results.slice(0, 25)) out(`    • ${C.cyan(n.type || '')} ${n.label || n.id}`);
  out('');
  return 0;
}

async function cmdReport(cfg, kind) {
  const h = readHistory();
  const latest = [...h].reverse().find((x) => x.runId);
  if (!latest) { out(C.yellow('  No run to report on.')); return 1; }
  const file = path.join(ARTIFACT_DIR, latest.runId, 'reports.json');
  let reports;
  try { reports = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { out(C.yellow(`  reports.json not found for ${latest.runId} — run discovery first.`)); return 1; }
  const report = reports[kind];
  if (!report) { out(C.red(`  Unknown report "${kind}". Available: ${Object.keys(reports).join(', ')}`)); return 1; }
  if (cfg.ci) { out(JSON.stringify(report)); return 0; }
  out('');
  out(C.bold(`  ▤ ${kind.toUpperCase()} REPORT  ${C.dim(latest.runId)}`));
  out('  ' + C.dim('─'.repeat(46)));
  out(JSON.stringify(report, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
  out('');
  return 0;
}

function printHelp() {
  out(`Enterprise Discovery CLI

  npm run discover [-- <options>]

  Discovery:
    --url <baseUrl>          Target application (or DISCOVERY_URL / .discoveryrc.json)
    --username, --password   Credentials for authenticated crawl
    --depth <n>              Max crawl depth (default 3)
    --pages <n>              Max pages (default 60)
    --strategy <bfs|dfs>     Traversal strategy (default bfs)
    --domain <d>             Tenant domain (default hr)
    --no-download            Do not write artifacts to disk

  Lifecycle:
    --resume                 Resume / re-check the last run
    --delta                  Compare the two most recent runs
    --query <name>           Knowledge-graph query (--type / --module / --field)
    --report <executive|architect|qa|developer>

  Modes:
    --ci                     Machine-readable JSON, no colour, exit codes
    --retries <n>            Transient-failure retries (default 2)
    --help

  Config precedence: CLI args > env vars > .discoveryrc.json > defaults
  Artifacts: artifacts/discovery/<runId>/   Log: logs/discovery-cli.log`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cfg = resolveConfig(args);
  C = makeColors(!cfg.ci && !process.env.NO_COLOR && process.stdout.isTTY);

  if (args.help) { printHelp(); return 0; }

  // Health checks (skip the hard gate for pure read commands, but still report).
  const health = await healthChecks(cfg);
  if (!cfg.ci) {
    out(C.bold('  Discovery pre-flight'));
    for (const c of health.checks) out(`    ${c.ok ? C.green('✔') : C.red('x')} ${c.name.padEnd(20)} ${C.dim(c.detail)}`);
    out('');
  }
  const needsEP = !(args.delta || args.query || args.report);
  const epOk = health.checks.find((c) => c.name === 'execution-plane')?.ok;
  if (needsEP && !epOk) { out(C.red('  Execution Plane is not reachable — start it with `PORT=3002 node server.js`.')); return 2; }

  try {
    if (args.delta) return await cmdDelta(cfg);
    if (args.query) return await cmdQuery(cfg, args);
    if (args.report) return await cmdReport(cfg, String(args.report));
    if (args.resume) return await cmdResume(cfg);
    return await cmdDiscover(cfg);
  } catch (e) {
    log('error', 'cli command failed', { error: e.message });
    if (cfg.ci) out(JSON.stringify({ error: e.message }));
    else out(C.red(`  ✘ ${e.message}`));
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { parseArgs, resolveConfig, buildRunBody, splitArtifacts, isSafeArtifactPath, buildChecklist, currentKey, moduleFromUrl, humanBytes, artifactTree, PIPELINE, loadRc, main, http, __setHttpClient, buildEvidenceManifest, buildGovernance, buildAuditReport, writeGovernancePackage, sha256 };
