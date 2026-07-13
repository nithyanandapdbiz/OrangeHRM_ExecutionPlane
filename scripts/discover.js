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
const BOOL_FLAGS = new Set(['resume', 'delta', 'ci', 'help', 'headless', 'no-download', 'json']);
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
  return cfg;
}

function buildRunBody(cfg) {
  return {
    baseUrl: cfg.baseUrl, maxDepth: cfg.maxDepth, maxPages: cfg.maxPages,
    strategy: cfg.strategy, username: cfg.username, password: cfg.password,
    headless: cfg.headless, domain: cfg.domain,
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
async function pollRun(cfg, runId) {
  const t0 = Date.now();
  let lastStage = '';
  for (;;) {
    const r = await http('get', `${cfg.epUrl}/discovery/runs/${runId}`, { retries: cfg.retries });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const s = r.data;
    const pct = STAGE_PCT[s.stage] ?? s.progress ?? 0;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    // Show the Intelligence-Plane sub-stage when available (contract-extract →
    // app-model → generate-artefacts → report → intelligence) so synthesis is visible.
    const label = s.substage ? `${s.stage} · ${s.substage}` : s.stage;
    const key = `${s.stage}|${s.substage || ''}`;
    if (!cfg.ci && key !== lastStage) {
      out(`  ${C.cyan('▸')} ${C.bold(String(label).padEnd(30))} ${C.dim(`${pct}%`)}  ${C.dim(`${elapsed}s`)}`);
      lastStage = key;
    }
    if (['completed', 'failed', 'cancelled'].includes(s.status)) return { ...s, elapsedS: Number(elapsed) };
    await new Promise((r2) => setTimeout(r2, 3000));
  }
}

// ── Pretty summary ───────────────────────────────────────────────────────────
function printSummary(runId, status, artifacts, savedDir) {
  const m = (artifacts && artifacts.metadata) || {};
  const intel = (artifacts && artifacts.intelligence) || {};
  out('');
  out(C.green(C.bold('  ✔ Discovery Completed')));
  out('  ' + C.dim('─'.repeat(46)));
  const row = (k, v) => out(`  ${String(k).padEnd(22)} ${C.bold(v)}`);
  row('Run Id', runId);
  row('IP Run Id', status.ipRunId || '-');
  row('Duration', `${status.elapsedS ?? '?'}s`);
  row('Pages', m.routes ?? '?');
  row('Components', m.components ?? '?');
  row('Forms', m.forms ?? '?');
  row('Endpoints', (status.crawlStats && status.crawlStats.endpoints) ?? '?');
  row('POMs', m.pageObjects ?? '?');
  row('Contracts', m.contracts ?? '?');
  row('Contract Tests', m.contractTests ?? '?');
  row('Workflows', m.workflows ?? '?');
  row('Knowledge Graph', `${m.knowledgeGraphNodes ?? '?'} nodes / ${m.knowledgeGraphEdges ?? '?'} edges`);
  row('Business Rules', m.businessRules ?? '?');
  row('Coverage', `${m.coverage ?? '?'}%`);
  const sev = m.riskSeverity || (intel.risk && intel.risk.severity) || '?';
  const sevC = sev === 'high' ? C.red : sev === 'medium' ? C.yellow : C.green;
  row('Risk', sevC(`${sev}${intel.risk ? ` (${intel.risk.overall})` : ''}`));
  row('Recommendations', m.recommendations ?? '?');

  // ── Reports & artefacts — listed explicitly so generation is visible ──
  const reports = intel.reports || {};
  const kinds = ['executive', 'architect', 'qa', 'developer'].filter((k) => reports[k]);
  if (kinds.length || artifacts) {
    out('  ' + C.dim('─'.repeat(46)));
    out('  ' + C.bold('Reports generated'));
    for (const k of kinds) out(`    ${C.green('✔')} ${k} report`);
    if (typeof artifacts.report === 'string' && artifacts.report) {
      out(`    ${C.green('✔')} discovery report.html   ${C.dim(`(${(artifacts.report.length / 1024).toFixed(0)} KB)`)}`);
    }
    out('  ' + C.bold('Artefacts generated'));
    const a = (present, label) => out(`    ${present ? C.green('✔') : C.dim('·')} ${label}`);
    a(artifacts.applicationModel, 'application model');
    a(artifacts.navGraph, 'navigation graph');
    a(artifacts.knowledgeGraph, `knowledge graph (${m.knowledgeGraphNodes ?? '?'} nodes / ${m.knowledgeGraphEdges ?? '?'} edges)`);
    a((artifacts.workflows || []).length, `${(artifacts.workflows || []).length} workflows`);
    a((intel.businessRules || []).length, `${(intel.businessRules || []).length} business rules`);
    a(intel.coverage, 'coverage intelligence (+ heatmap)');
    a(intel.risk, 'risk model');
    a((intel.recommendations || []).length, `${(intel.recommendations || []).length} test recommendations`);
    a((artifacts.pageObjects || []).length, `${(artifacts.pageObjects || []).length} page objects (Playwright POMs)`);
    a((artifacts.contracts || []).length, `${(artifacts.contracts || []).length} API contracts`);
    a((artifacts.contractTests || []).length, `${(artifacts.contractTests || []).length} contract tests`);
    a(intel.aiReadiness, `AI-readiness contract (${intel.aiReadiness ? Object.keys(intel.aiReadiness.consumers || {}).length : 0} consumers)`);
  }
  if (savedDir) { out('  ' + C.dim('─'.repeat(46))); out(`  ${C.dim('Artifacts →')} ${savedDir}`); }
  out('');
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
  let artifacts = null, saved = null;
  if (status.status === 'completed' && cfg.download) {
    const a = await http('get', `${cfg.epUrl}/discovery/runs/${runId}/artifacts`, { retries: cfg.retries });
    if (a.status === 200) { artifacts = a.data.artifacts; saved = writeArtifacts(runId, artifacts); }
  }
  pushHistory({ runId, ipRunId: status.ipRunId, at: new Date().toISOString(), baseUrl: cfg.baseUrl, status: status.status });
  log('info', 'discovery finished', { runId, status: status.status, ipRunId: status.ipRunId });

  if (cfg.ci) {
    out(JSON.stringify({ runId, ipRunId: status.ipRunId, status: status.status, metadata: artifacts && artifacts.metadata, artifactsDir: saved && saved.dir }));
  } else if (status.status === 'completed') {
    printSummary(runId, status, artifacts, saved && `${saved.dir} (${saved.count} files)`);
  } else {
    out(C.red(`  x Discovery ${status.status}${status.error ? ` — ${status.error}` : ''}`));
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

module.exports = { parseArgs, resolveConfig, buildRunBody, splitArtifacts, isSafeArtifactPath, loadRc, main, http, __setHttpClient };
