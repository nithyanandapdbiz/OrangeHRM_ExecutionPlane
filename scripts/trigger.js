#!/usr/bin/env node
'use strict';
/**
 * OrangeHRM Execution Plane — CLI trigger
 *
 * Usage:
 *   node scripts/trigger.js [ISSUE_KEY]
 *   npm run pipeline             # uses ISSUE_KEY from .env
 *   npm run pipeline -- OHRM-1   # explicit issue key
 *   npm run e2e                  # alias
 *
 * Requires the EP server to be running: npm start
 */
require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');

const issueKey = process.argv[2] || process.env.ISSUE_KEY;
const port     = parseInt(process.env.PORT || '3000', 10);

// ── Live trace: follow BOTH plane logs while the pipeline runs ──────────────────
// The pipeline runs server-side; without this the trigger terminal sits blank.
// We tail the Execution-Plane log AND the Intelligence-Plane log so the long
// /api/pipeline step (6 AI agents, ~5-7 min) streams its per-stage progress
// instead of a silent gap. Disable with TRIGGER_TAIL=false.
const TAIL = process.env.TRIGGER_TAIL !== 'false';
const _sources = [
  { file: path.join(__dirname, '..', 'logs', 'execution-plane.log'), prefix: '  │ ' },
  { file: process.env.INTELLIGENCE_LOG_FILE
        || path.join(__dirname, '..', '..', 'DBiz_IntelligencePlane', 'logs', 'app.log'),
    prefix: '  │⟦IP⟧ ' },
  // Raw test-execution stream (cucumber steps, k6/ZAP output, failure stack traces).
  { file: path.join(__dirname, '..', 'logs', 'child-output.log'), prefix: '  ┊ ' },
];
for (const s of _sources) { s.pos = (TAIL && fs.existsSync(s.file)) ? fs.statSync(s.file).size : 0; }
let _tailTimer = null;

function flushTrace() {
  if (!TAIL) return;
  for (const s of _sources) {
    try {
      if (!fs.existsSync(s.file)) continue;
      const n = fs.statSync(s.file).size;
      if (n <= s.pos) { if (n < s.pos) s.pos = n; continue; }
      const fd = fs.openSync(s.file, 'r');
      const b  = Buffer.alloc(n - s.pos);
      fs.readSync(fd, b, 0, n - s.pos, s.pos);
      fs.closeSync(fd);
      s.pos = n;
      for (const line of b.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const o = JSON.parse(line); console.log(s.prefix + (o.message ?? line)); }
        catch { console.log(s.prefix + line); }
      }
    } catch { /* ignore transient fs races */ }
  }
}
function stopTrace() { if (_tailTimer) { clearInterval(_tailTimer); _tailTimer = null; } flushTrace(); }

if (!issueKey) {
  console.error('');
  console.error('  Usage:  node scripts/trigger.js <ISSUE_KEY>');
  console.error('          npm run pipeline -- OHRM-1');
  console.error('          or set ISSUE_KEY in .env');
  console.error('');
  process.exit(1);
}

const body = JSON.stringify({ issueKey });

console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  OrangeHRM Execution Plane — Pipeline Trigger');
console.log('══════════════════════════════════════════════════════');
console.log(`  Issue Key : ${issueKey}`);
console.log(`  EP Server : http://localhost:${port}`);
console.log('  Calling   : POST /run');
console.log('══════════════════════════════════════════════════════');
console.log('');

const start = Date.now();

if (TAIL) {
  console.log('  ── live trace (server) ───────────────────────────────');
  _tailTimer = setInterval(flushTrace, 500);
}

const req = http.request(
  {
    hostname: 'localhost',
    port,
    path:    '/run',
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      // Authenticate automatically when the server requires it (API_SECRET set).
      ...(process.env.API_SECRET ? { 'X-API-Key': process.env.API_SECRET } : {}),
    },
  },
  (res) => {
    let raw = '';
    res.on('data', chunk => { raw += chunk; });
    res.on('end', () => {
      stopTrace();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      try {
        const result = JSON.parse(raw);
        if (TAIL) console.log('  ──────────────────────────────────────────────────────');
        else console.log(JSON.stringify(result, null, 2));
        console.log('');
        console.log(`══════════════════════════════════════════════════════`);
        if (result.success === true) {
          const pw     = result.playwright || {};
          const jira   = result.jira || {};
          const zephyr = result.zephyr || {};
          console.log(`  ✅  Pipeline COMPLETED in ${elapsed}s`);
          console.log(`  Story  : ${result.storyTitle || result.issueKey}`);
          console.log(`  AI     : ${result.intelligence?.testCasesGenerated ?? '?'} test cases generated`);
          const ag = result.intelligence?.agents;
          if (ag) {
            const d = ag.riskPrioritizer?.distribution || {};
            console.log(`  Agents : planner(${ag.planner?.testTypes} types) → qa(${ag.qa?.generated}) → reviewer(${ag.reviewer?.kept} kept, −${ag.reviewer?.removedDuplicates} dup) → risk(H${d.High||0}/N${d.Normal||0}/L${d.Low||0}) | compliance(${ag.compliance?.gate}) security(${ag.security?.threats})`);
          }
          const nfp = result.intelligence?.nonFunctionalPlans;
          if (nfp && (nfp.performance || nfp.pentest)) {
            console.log(`  Agents+: performance(perfRequired=${nfp.performance?.perfRequired ?? '?'}) | pentest(tools=${(nfp.pentest?.toolsRequired || []).join(',') || 'none'}, risk=${nfp.pentest?.riskLevel ?? '?'})`);
          }
          console.log(`  Zephyr : ${zephyr.testCasesCreated ?? '?'} test cases created  |  Cycle ${zephyr.testCycleKey ?? '?'}`);
          console.log(`  Tests  : ${pw.passed ?? 0}/${pw.total ?? 0} passed${pw.bddMode ? '  (BDD — run via Cucumber)' : ''}`);
          if (jira.bugsCreated) console.log(`  Bugs   : ${jira.bugsCreated} created in Jira`);
          const perf = result.performance || {};
          if (perf.ran) console.log(`  Perf   : ${perf.passed}/${perf.scriptsRun} passed  (k6 ${perf.testType} → ${perf.target})`);
          else if (perf.skipped) console.log(`  Perf   : skipped (${perf.skipped})`);
          else if (perf.error) console.log(`  Perf   : error (${perf.error})`);
          else console.log(`  Perf   : not run`);
          const sec = result.securityScan || {};
          if (sec.ran) console.log(`  Security : ${sec.totalFindings} findings  (C${sec.critical}/H${sec.high}/M${sec.medium})  verdict ${sec.verdict}  → ${sec.target}`);
          else if (sec.skipped) console.log(`  Security : skipped (${sec.skipped})`);
          else if (sec.error) console.log(`  Security : error (${sec.error})`);
          else console.log(`  Security : not run`);
          const gate = result.intelligence?.complianceGate;
          if (gate) console.log(`  Gate   : ${gate.verdict}  — ${gate.reason}`);
          console.log(`  PII→IP : ${result.sovereign?.piiSentToDBiz === false ? 'ZERO ✅' : 'check logs'}`);
          const rep = result.reports;
          if (rep) {
            console.log(`  Reports:`);
            console.log(`    Functional  : ${rep.functional?.generated ? rep.functional.path : '(none)'}`);
            console.log(`    Performance : ${rep.performance?.generated ? rep.performance.path : '(none)'}`);
            console.log(`    Security    : ${rep.security?.generated ? rep.security.path : '(none)'}`);
          }
        } else {
          console.log(`  ❌  Pipeline status: ${result.status || result.error || res.statusCode}`);
          if (result.error)  console.log(`  Error : ${result.error}`);
          if (result.detail) console.log(`  Detail: ${result.detail}`);
        }
        console.log(`══════════════════════════════════════════════════════`);
        console.log('');
        process.exit(result.success === true ? 0 : 1);
      } catch {
        console.log(raw);
        process.exit(res.statusCode < 400 ? 0 : 1);
      }
    });
  }
);

req.on('error', (e) => {
  stopTrace();
  if (e.code === 'ECONNREFUSED') {
    console.error('  ❌  EP server is not running on port ' + port);
    console.error('');
    console.error('  Start it first in a separate terminal:');
    console.error('    cd c:\\POC\\OrangeHRM_ExecutionPlane');
    console.error('    npm start');
    console.error('');
    console.error('  Also ensure the Intelligence Plane is running:');
    console.error('    cd c:\\POC\\DBiz_IntelligencePlane');
    console.error('    npm start');
    console.error('');
  } else {
    console.error('  ❌  Request error:', e.message);
  }
  process.exit(1);
});

req.setTimeout(1800000, () => {
  stopTrace();
  console.error('  ❌  Request timed out after 30 minutes');
  req.destroy();
  process.exit(1);
});

req.write(body);
req.end();
