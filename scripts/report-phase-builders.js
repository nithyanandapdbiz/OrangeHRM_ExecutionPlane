'use strict';
/**
 * report-phase-builders.js
 * HTML builders for Phase 2–12 of the Enterprise Test Intelligence Platform.
 * All functions accept pre-computed data objects from scripts/intelligence/*.js
 */

const e  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fd = ms => ms>=60000?`${(ms/60000).toFixed(1)}m`:ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`;
const fts = ms => { const s=Math.floor(ms/1000); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const pct = (n,t) => t?Math.round(n/t*100):0;
const statusCls = st => st==='Pass'||st==='pass'?'pass':st==='Fail'||st==='fail'?'fail':'skip';
const sevColor  = sv => ({Critical:'#f85149',High:'#e3b341',Medium:'#79c0ff',Low:'#3fb950'})[sv]||'#8b949e';
const healthCls = sc => sc>=90?'pass':sc>=70?'warn':'fail';

// ─── Phase 2: Complete Traceability Engine ────────────────────────────────────
function buildTraceabilityEngine(traceability) {
  if (!traceability) return '<div class="empty-state">Traceability data unavailable.</div>';
  const { coverage, matrix, tree, orphans, reqWithNoTC } = traceability;
  const c = coverage;

  const coverageBars = [
    { label: 'Requirement Coverage', value: c.requirementCoverage, detail: `${c.withRequirement}/${c.total} scenarios linked to requirements` },
    { label: 'Test Case Coverage',   value: c.testCoverage,        detail: `${c.withTestCase}/${c.total} scenarios linked to Zephyr test cases` },
    { label: 'Execution Coverage',   value: c.executionCoverage,   detail: `${c.executed}/${c.total} scenarios executed` },
    { label: 'Automation Coverage',  value: c.automationCoverage,  detail: `${c.withTestCase} automated / ${c.total} total` },
  ].map(b => `
  <div class="perf-bar-wrap">
    <div class="perf-bar-label"><span>${e(b.label)}</span><span class="badge ${healthCls(b.value)}" style="font-size:11px">${b.value}%</span></div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:3px">${e(b.detail)}</div>
    <div class="perf-bar-outer"><div class="perf-bar-inner ${b.value<60?'fail':b.value<80?'warn':''}" style="width:${b.value}%"></div></div>
  </div>`).join('');

  const matrixRows = matrix.map(row => {
    const health = row.scenarios.length ? pct(row.pass, row.scenarios.length) : 0;
    return `<tr>
      <td><code class="issue-key">${e(row.requirementId)}</code></td>
      <td style="font-size:11px;color:var(--text1)">${e(row.userStory||'–')}</td>
      <td>${row.scenarios.length}</td>
      <td><span class="badge pass" style="font-size:10px">${row.pass}</span></td>
      <td><span class="badge fail" style="font-size:10px">${row.fail}</span></td>
      <td><span class="badge ${healthCls(health)}" style="font-size:10px">${health}%</span></td>
      <td>${row.defects?`<span style="color:var(--fail);font-size:11px">🐛 ${row.defects}</span>`:'–'}</td>
    </tr>`;
  }).join('');

  const gapWarnings = [
    orphans.length    ? `<div class="env-row" style="border-left:3px solid var(--skip)"><span class="env-key" style="color:var(--skip)">⚠ Orphan Scenarios</span><span class="env-val">${orphans.length} scenario${orphans.length!==1?'s':''} have no requirement or Jira link</span></div>` : '',
    reqWithNoTC.length? `<div class="env-row" style="border-left:3px solid var(--skip)"><span class="env-key" style="color:var(--skip)">⚠ TC Gap</span><span class="env-val">${reqWithNoTC.length} requirement${reqWithNoTC.length!==1?'s':''} have no Zephyr test case</span></div>` : '',
  ].filter(Boolean).join('');

  return `
<div class="two-col" style="gap:16px;margin-bottom:20px">
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:12px">Coverage Metrics</div>
    <div class="card-grid card-grid-2" style="margin-bottom:12px">
      ${[['Unique Requirements', c.uniqueRequirements],['Unique User Stories',c.uniqueUserStories],['Total Scenarios',c.total],['Pass Rate',`${c.passRate}%`]].map(([l,v])=>`<div class="card stat-big"><div class="stat-val info">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}
    </div>
    ${coverageBars}
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:12px">Coverage Gaps</div>
    ${gapWarnings || '<div style="color:var(--pass);font-size:13px;padding:8px">✅ No coverage gaps detected</div>'}
  </div>
</div>
<div class="card" style="overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Traceability Matrix — Requirement → Scenarios</div>
  <table class="data-table">
    <thead><tr><th>Requirement</th><th>User Story</th><th>Scenarios</th><th>Pass</th><th>Fail</th><th>Health</th><th>Defects</th></tr></thead>
    <tbody>${matrixRows||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:20px">No requirement data</td></tr>'}</tbody>
  </table>
</div>`;
}

// ─── Phase 3: Failure Intelligence Engine ────────────────────────────────────
function buildFailureIntelligence(clusterData) {
  if (!clusterData) return '<div class="empty-state">No failure cluster data.</div>';
  const { clusters, summary } = clusterData;

  if (!clusters.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:24px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Failures — All Scenarios Passed</div></div>`;

  const summaryCards = [
    { label: 'Total Failures',    value: summary.totalFailures,   color: 'var(--fail)' },
    { label: 'Failure Clusters',  value: summary.totalClusters,   color: 'var(--skip)' },
    { label: 'Critical Clusters', value: summary.criticalClusters,color: '#f85149' },
    { label: 'High Clusters',     value: summary.highClusters,    color: '#e3b341' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val" style="color:${c.color}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const clusterCards = clusters.map(c => {
    const col  = sevColor(c.severity);
    const pctW = summary.totalFailures ? Math.round(c.failureCount/summary.totalFailures*100) : 0;
    return `
<div class="card" style="border-left:4px solid ${col};margin-bottom:10px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <div style="font-size:32px">${c.icon||'⚠'}</div>
    <div style="flex:1">
      <div style="font-size:15px;font-weight:700">${e(c.name)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px">${e(c.module)} · ${e(c.component)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:28px;font-weight:900;color:${col}">${c.failureCount}</div>
      <span class="badge ${c.severity==='Critical'?'fail':c.severity==='High'?'skip':'info'}" style="font-size:10px">${e(c.severity)}</span>
    </div>
  </div>
  <div class="perf-bar-outer" style="margin-bottom:8px"><div class="perf-bar-inner" style="width:${pctW}%;background:${col}"></div></div>
  <div style="font-size:12px;color:var(--text1);margin-bottom:8px"><strong>Probable Root Cause:</strong> ${e(c.rootCause)}</div>
  <div style="display:flex;flex-wrap:wrap;gap:5px">
    ${c.affectedScenarios.slice(0,5).map(s=>`<span style="font-size:11px;background:var(--bg3);border:1px solid var(--border);padding:2px 8px;border-radius:4px"><code class="issue-key">${e(s.issueKey||'–')}</code> ${e((s.name||'').slice(0,36))}</span>`).join('')}
    ${c.affectedScenarios.length>5?`<span style="font-size:11px;color:var(--text2)">+${c.affectedScenarios.length-5} more</span>`:''}
  </div>
</div>`;
  }).join('');

  return `<div class="card-grid card-grid-4" style="margin-bottom:16px">${summaryCards}</div>${clusterCards}`;
}

// ─── Phase 4: AI Root Cause Analysis ─────────────────────────────────────────
function buildAiRootCause(aiAnalysis) {
  if (!aiAnalysis) return '<div class="empty-state">No AI analysis data.</div>';
  const { analyses, summary } = aiAnalysis;

  if (!analyses.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:24px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Failures to Analyse</div></div>`;

  const summaryHtml = `
<div class="card" style="margin-bottom:16px">
  <div class="card-grid card-grid-4" style="gap:10px">
    ${[['Failures Analysed',summary.total,'info'],['Recurrent Failures',summary.recurrences,'fail'],['Avg Confidence',`${summary.avgConfidence}%`,'pass'],['Top Owner',summary.topOwner||'–','skip']].map(([l,v,c])=>`<div class="card stat-big"><div class="stat-val ${c}">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}
  </div>
  ${summary.dominantPattern?`<div style="margin-top:12px;font-size:12px;color:var(--text1)">Dominant failure pattern: <strong style="color:var(--fail)">${e(summary.dominantPattern)}</strong> (${summary.dominantCount} occurrence${summary.dominantCount!==1?'s':''})</div>`:''}
</div>`;

  const cards = analyses.map(a => {
    const confColor = a.confidence>80?'#3fb950':a.confidence>60?'#e3b341':'#f85149';
    const sevColor2 = sevColor(a.severity);
    const signalHtml = a.signals.map(s=>`<span style="font-size:10px;background:var(--bg3);border:1px solid var(--border);padding:2px 7px;border-radius:4px;color:var(--text1)">${e(s.type)} (${s.count})</span>`).join(' ');
    return `
<div class="rc-card">
  <div style="display:flex;align-items:start;gap:12px;margin-bottom:10px">
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--fail);margin-bottom:4px">${e(a.patternLabel)}</div>
      <div style="font-size:13px;font-weight:600">${e(a.scenarioName)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px"><code class="issue-key">${e(a.issueKey)}</code> · ${e(a.featureName)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:22px;font-weight:900;color:${confColor}">${a.confidence}%</div>
      <div style="font-size:10px;color:var(--text2)">CONFIDENCE</div>
    </div>
  </div>
  <div class="ai-root-grid">
    <div><span class="ai-lbl">Cause</span><div class="ai-val">${e(a.cause)}</div></div>
    <div><span class="ai-lbl">Owner</span><div class="ai-val warn">${e(a.owner)}</div></div>
    <div><span class="ai-lbl">Severity</span><span class="badge fail" style="font-size:10px;background:${sevColor2}22;border-color:${sevColor2};color:${sevColor2}">${e(a.severity)}</span> <span class="ai-val">${e(a.priority)}</span></div>
    <div><span class="ai-lbl">Fix</span><div class="ai-val rc-fix">${e(a.fix)}</div></div>
    <div><span class="ai-lbl">Effort</span><div class="ai-val">${e(a.effort)}</div></div>
    <div><span class="ai-lbl">Pattern</span><div class="ai-val"><code style="font-size:10px">${e(a.patternFamily||a.patternId)}</code></div></div>
  </div>
  ${a.recurred?`<div style="margin-top:8px;padding:4px 8px;background:rgba(248,81,73,.08);border-radius:4px;font-size:11px;color:var(--fail)">⚠ Recurred from previous run · Last seen: ${e(a.lastSeen)} · ${a.recurrenceCount} occurrence${a.recurrenceCount!==1?'s':''}</div>`:''}
  ${signalHtml?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${signalHtml}</div>`:''}
</div>`;
  }).join('');

  return summaryHtml + cards;
}

// ─── Phase 6: Release Decision Engine ────────────────────────────────────────
function buildReleaseDecisionPanel(decision) {
  if (!decision) return '<div class="empty-state">No release decision available.</div>';

  const factorRows = decision.factors.map(f => {
    const stCol = f.status==='ok'?'var(--pass)':f.status==='blocker'?'var(--fail)':f.status==='risk'?'var(--skip)':'var(--info)';
    const stIco = f.status==='ok'?'✓':f.status==='blocker'?'🚫':f.status==='risk'?'⚠':'ℹ';
    return `<tr>
      <td style="font-size:12px;font-weight:600">${e(f.name)}</td>
      <td><code style="font-size:11px">${e(f.displayValue)}</code></td>
      <td><div class="perf-bar-outer" style="width:80px;display:inline-block"><div class="perf-bar-inner ${f.score<50?'fail':f.score<75?'warn':''}" style="width:${f.score}%"></div></div> <span style="font-size:11px;color:var(--text2)">${f.score}%</span></td>
      <td style="font-size:12px;font-weight:600">${e(f.weight)}%</td>
      <td><span style="color:${stCol};font-weight:700">${stIco} ${e(f.status?.toUpperCase())}</span></td>
      <td style="font-size:11px;color:var(--text1)">${e(f.description)}</td>
    </tr>`;
  }).join('');

  const recHtml = decision.recommendations.map((r,i)=>`<div style="display:flex;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--accent2);font-weight:700;min-width:20px">#${i+1}</span><span>${e(r)}</span></div>`).join('');

  return `
<div class="two-col" style="margin-bottom:20px;gap:16px">
  <div class="card" style="text-align:center;padding:36px;border:2px solid ${decision.color}">
    <div style="font-size:56px;margin-bottom:8px">${decision.icon}</div>
    <div style="font-size:28px;font-weight:900;color:${decision.color}">${e(decision.status)}</div>
    <div style="margin-top:12px;display:flex;gap:16px;justify-content:center">
      <div><div style="font-size:28px;font-weight:800;color:${decision.color}">${decision.confidenceScore}%</div><div style="font-size:11px;color:var(--text1)">CONFIDENCE</div></div>
      <div style="width:1px;background:var(--border)"></div>
      <div><div style="font-size:28px;font-weight:800;color:var(--fail)">${decision.riskScore}</div><div style="font-size:11px;color:var(--text1)">RISK SCORE</div></div>
    </div>
    <div style="margin-top:16px;font-size:12px;color:var(--text1);text-align:left;padding:10px;background:var(--bg2);border-radius:6px">${e(decision.reasoning)}</div>
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Release Recommendations</div>
    ${recHtml}
    ${decision.blockers.length?`<div style="margin-top:12px;padding:8px;background:rgba(248,81,73,.08);border-radius:6px;border:1px solid rgba(248,81,73,.3)"><div style="font-size:11px;font-weight:700;color:var(--fail);margin-bottom:6px">🚫 Release Blockers (${decision.blockers.length})</div>${decision.blockers.map(b=>`<div style="font-size:12px;color:var(--text1);padding:2px 0">• ${e(b.name)}: ${e(b.description)}</div>`).join('')}</div>`:''}
  </div>
</div>
<div class="card" style="overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Factor Scorecard</div>
  <table class="data-table"><thead><tr><th>Factor</th><th>Value</th><th>Score</th><th>Weight</th><th>Status</th><th>Detail</th></tr></thead>
  <tbody>${factorRows}</tbody></table>
</div>`;
}

// ─── Phase 7: Executive Intelligence ─────────────────────────────────────────
function buildExecutiveIntelligence(executive) {
  if (!executive) return '<div class="empty-state">No executive data.</div>';

  const healthPanels = [
    { key: 'qualityHealth',    label: 'Quality Health',    icon: '📊' },
    { key: 'deliveryHealth',   label: 'Delivery Health',   icon: '🚀' },
    { key: 'automationHealth', label: 'Automation Health', icon: '⚙' },
    { key: 'releaseHealth',    label: 'Release Health',    icon: '🎯' },
    { key: 'riskHealth',       label: 'Risk Health',       icon: '🔥' },
  ].map(p => {
    const h  = executive[p.key];
    if (!h)  return '';
    const sc = typeof h.score === 'number' ? h.score : 0;
    const col = sc >= 90 ? 'var(--pass)' : sc >= 70 ? 'var(--skip)' : 'var(--fail)';
    const arr = h.trend === 'improving' ? '↑' : h.trend === 'declining' ? '↓' : '→';
    return `
<div class="card" style="border-top:3px solid ${col}">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span style="font-size:20px">${p.icon}</span>
    <span style="font-size:13px;font-weight:700;color:var(--text1);flex:1">${e(p.label)}</span>
    <span style="font-size:11px;color:${h.trend==='improving'?'var(--pass)':h.trend==='declining'?'var(--fail)':'var(--text2)'};font-weight:700">${arr} ${e(h.trend||'stable')}</span>
  </div>
  <div style="font-size:32px;font-weight:900;color:${col};line-height:1;margin-bottom:6px">${typeof sc==='number'?sc+'%':e(String(sc))}</div>
  <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${e(h.label||'')}</div>
  <div style="font-size:12px;color:var(--text1);line-height:1.5">${e(h.narrative||'')}</div>
</div>`;
  }).join('');

  const actionsHtml = (executive.keyActions||[]).map(a=>{
    const urgColor = a.urgency==='IMMEDIATE'?'var(--fail)':a.urgency==='THIS SPRINT'?'var(--skip)':'var(--text2)';
    return `<div class="action-card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="badge fail" style="font-size:10px">${e(a.priority)}</span>
        <span style="font-size:12px;font-weight:700;flex:1">${e(a.action)}</span>
        <span style="font-size:11px;color:${urgColor};font-weight:600">${e(a.urgency)}</span>
      </div>
      <div style="font-size:12px;color:var(--text1);padding-left:44px">${e(a.detail)}</div>
    </div>`;
  }).join('');

  return `
<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text1);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:10px 14px;line-height:1.6">${e(executive.deltaInsights||'')}</div></div>
<div class="card-grid card-grid-3" style="margin-bottom:16px;gap:12px">${healthPanels}</div>
${actionsHtml?`<div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Priority Action Plan</div>${actionsHtml}</div>`:''}`;
}

// ─── Phase 8: Historical Trend Engine ────────────────────────────────────────
function buildTrendEngine(trends) {
  if (!trends?.available) return `<div class="card" style="text-align:center;padding:36px"><div style="font-size:32px">📈</div><div style="font-size:14px;font-weight:600;margin-top:12px">Trend data builds over time</div><div style="font-size:12px;color:var(--text1);margin-top:6px">Run the test suite multiple times to see quality trends.</div></div>`;

  const { summary, predictions, sprints, series } = trends;

  const summaryCards = [
    { label: '7-Day Avg Pass Rate',    value: `${summary.avg7DayPassRate}%`,    cls: healthCls(summary.avg7DayPassRate) },
    { label: '30-Run Avg Pass Rate',   value: `${summary.avg30RunPassRate}%`,   cls: 'info' },
    { label: 'Quality Trend',          value: summary.trend === 'improving' ? '↑ Improving' : summary.trend === 'declining' ? '↓ Declining' : '→ Stable', cls: summary.trend==='improving'?'pass':summary.trend==='declining'?'fail':'skip' },
    { label: 'Pass Streak',            value: `${summary.currentStreak} run${summary.currentStreak!==1?'s':''}`, cls: summary.currentStreak>5?'pass':summary.currentStreak>2?'skip':'info' },
    { label: 'Total Runs Recorded',    value: String(summary.totalRuns),         cls: 'info' },
    { label: 'Predicted Next',         value: `${predictions.nextPassRate}%`,    cls: healthCls(predictions.nextPassRate) },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${e(c.value)}</div><div class="stat-lbl">${e(c.label)}</div></div>`).join('');

  const sprintRows = sprints.map(s=>`<tr>
    <td>${e(s.label)}</td>
    <td><span class="badge ${healthCls(s.passRate)}">${s.passRate}%</span></td>
    <td>${s.failed}</td>
    <td>${s.runs}</td>
    <td style="font-size:11px;color:var(--text2)">${s.from?new Date(s.from).toLocaleDateString():''}</td>
  </tr>`).join('');

  const predColor = predictions.trend === 'improving' ? 'var(--pass)' : predictions.trend === 'declining' ? 'var(--fail)' : 'var(--skip)';

  return `
<div class="card-grid card-grid-3" style="margin-bottom:16px;gap:12px">${summaryCards}</div>
<div class="card" style="margin-bottom:16px;border-left:4px solid ${predColor}">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Quality Prediction — Next Execution</div>
  <div style="display:flex;gap:24px;align-items:center">
    <div><div style="font-size:32px;font-weight:900;color:${predColor}">${predictions.nextPassRate}%</div><div style="font-size:11px;color:var(--text2)">Predicted Pass Rate</div></div>
    <div><div style="font-size:24px;font-weight:700">${predictions.nextFailCount}</div><div style="font-size:11px;color:var(--text2)">Predicted Failures</div></div>
    <div><div style="font-size:18px;font-weight:700;color:${predColor}">${predictions.trend === 'improving'?'↑ Improving':predictions.trend==='declining'?'↓ Declining':'→ Stable'}</div><div style="font-size:11px;color:var(--text2)">Trend</div></div>
    <div><div style="font-size:18px;font-weight:700">${predictions.confidence}%</div><div style="font-size:11px;color:var(--text2)">Model Confidence</div></div>
  </div>
  <div style="font-size:11px;color:var(--text2);margin-top:8px">Based on linear regression over last ${Math.min(10,summary.totalRuns)} runs.</div>
</div>
${sprints.length?`<div class="card" style="overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Sprint-Level Quality Trend</div>
  <table class="data-table"><thead><tr><th>Sprint</th><th>Pass Rate</th><th>Failures</th><th>Runs</th><th>From</th></tr></thead>
  <tbody>${sprintRows}</tbody></table>
</div>`:''}`;
}

// ─── Phase 9: Failure Timeline ────────────────────────────────────────────────
function buildFailureTimeline(timelines) {
  if (!timelines || !timelines.length) return '<div class="empty-state">No failed scenarios — no timelines to display.</div>';

  return timelines.map((tl, ti) => {
    const clsMap = { fail:'var(--fail)', pass:'var(--pass)', warn:'var(--skip)', info:'var(--info)', skip:'var(--skip)' };
    const iconMap = { fail:'✗', pass:'✓', warn:'⚠', info:'ℹ', skip:'⊘' };

    const events = tl.events.map(ev => `
<div class="tl-node">
  <div class="tl-dot" style="background:${clsMap[ev.cls]||'var(--text2)'}"></div>
  <div class="tl-content" style="${ev.cls==='fail'?'border-left:3px solid var(--fail);background:rgba(248,81,73,.06)':''}">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="color:${clsMap[ev.cls]||'var(--text2)'};font-size:14px">${ev.icon||iconMap[ev.cls]||'·'}</span>
      <span class="tl-name">${e(ev.label)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text2);font-family:monospace">${fts(ev.ms)}</span>
      ${ev.duration?`<span style="font-size:10px;color:var(--text2)">[${fd(ev.duration)}]</span>`:''}
      ${ev.videoTs!==undefined&&tl.videoSrc?`<span style="font-size:10px;color:var(--info);cursor:pointer" onclick="seekTimelineVideo('tl-vid-${ti}',${(ev.videoTs/1000).toFixed(2)})">🎥${fts(ev.videoTs)}</span>`:''}
    </div>
    ${ev.detail?`<div style="font-size:11px;color:var(--text1);margin-top:4px;padding-left:22px;word-break:break-all">${e(ev.detail.slice(0,200))}</div>`:''}
  </div>
</div>`).join('');

    return `
<div class="card" style="margin-bottom:16px;border-left:3px solid var(--fail)">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span class="badge fail">FAIL</span>
    <code class="issue-key">${e(tl.issueKey)}</code>
    <span style="font-size:13px;font-weight:600">${e(tl.scenarioName)}</span>
    <span style="margin-left:auto;font-size:12px;color:var(--text2)">${fd(tl.totalMs)} total</span>
  </div>
  ${tl.videoSrc?`<div style="margin-bottom:12px"><video id="tl-vid-${ti}" class="test-video" controls preload="metadata" style="max-height:200px"><source src="${e(tl.videoSrc)}" type="video/webm"></video></div>`:''}
  <div class="timeline">${events}</div>
</div>`;
  }).join('');
}

// ─── Phase 10: Test Intelligence Dashboard ────────────────────────────────────
function buildTestIntelligenceDashboard(m, decision, executive, clusterData, twin, trends, delta, aiAnalysis) {
  const col = sc => sc>=90?'var(--pass)':sc>=70?'var(--skip)':'var(--fail)';

  // Mission Control — top-level status panels
  const missionPanels = [
    { label: 'Release Status',    value: decision?.status || 'UNKNOWN',   sub: `${decision?.confidenceScore||0}% confidence`, color: decision?.color || 'var(--text2)', big: true },
    { label: 'Quality Health',    value: `${m.passRate}%`,                sub: `${m.passed}P / ${m.failed}F / ${m.total}T`,  color: col(m.passRate) },
    { label: 'Overall Health',    value: `${twin?.overallHealth||0}`,     sub: 'Digital Twin Score / 100',                    color: col(twin?.overallHealth||0) },
    { label: 'Risk Score',        value: `${decision?.riskScore||0}/100`, sub: `${(decision?.blockers||[]).length} blockers`,  color: decision?.riskScore>50?'var(--fail)':'var(--pass)' },
    { label: 'Automation Health', value: `${m.automationCoverage||0}%`,  sub: `${m.withTag||0}/${m.total} Jira-linked`,   color: col(m.automationCoverage||0) },
    { label: 'Environment',       value: `${twin?.environment?.score||100}%`, sub: twin?.environment?.status||'OPERATIONAL', color: col(twin?.environment?.score||100) },
  ].map(p=>`
<div class="card ti-dash-panel" style="border-top:3px solid ${p.color}">
  <div style="font-size:${p.big?'24':'20'}px;font-weight:900;color:${p.color};line-height:1">${e(p.value)}</div>
  <div style="font-size:11px;font-weight:600;color:var(--text1);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">${e(p.label)}</div>
  <div style="font-size:11px;color:var(--text2);margin-top:2px">${e(p.sub)}</div>
</div>`).join('');

  // Top failing components
  const failComponents = (twin?.components||[]).filter(c=>c.failures>0).slice(0,5);
  const compRows = failComponents.map(c=>`
<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
  <span style="font-size:11px;width:110px;color:var(--text1);flex-shrink:0">${e(c.name)}</span>
  <div class="perf-bar-outer" style="flex:1"><div class="perf-bar-inner ${c.health<50?'fail':'warn'}" style="width:${c.health}%"></div></div>
  <span style="font-size:11px;font-weight:700;width:40px;text-align:right;color:${c.status==='critical'?'var(--fail)':c.status==='degraded'?'var(--skip)':'var(--pass)'}">${c.health}%</span>
  <span style="font-size:10px;color:var(--text2)">${c.failures}F</span>
</div>`).join('') || '<div style="font-size:12px;color:var(--pass);padding:8px">All components healthy</div>';

  // Defect leakage = failure rate as proxy
  const leakagePct = m.total ? Math.round(m.failed/m.total*100) : 0;
  const leakageColor = leakagePct === 0 ? 'var(--pass)' : leakagePct <= 10 ? 'var(--skip)' : 'var(--fail)';

  // Recent regressions
  const recentReg = (delta?.newFailures||[]).slice(0,5);
  const regRows = recentReg.map(s=>`<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span class="badge fail" style="font-size:10px">NEW</span><code class="issue-key">${e(s.issueKey||'–')}</code><span>${e((s.scenarioName||'').slice(0,45))}</span></div>`).join('') || '<div style="font-size:12px;color:var(--pass);padding:8px">✅ No new regressions</div>';

  // Cluster top-3
  const top3clusters = (clusterData?.clusters||[]).slice(0,3);
  const clusterMini = top3clusters.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:16px">${c.icon||'⚠'}</span>
    <span style="flex:1;font-size:12px;font-weight:600">${e(c.name)}</span>
    <span style="font-size:20px;font-weight:900;color:${sevColor(c.severity)}">${c.failureCount}</span>
    <span class="badge ${c.severity==='Critical'?'fail':'skip'}" style="font-size:10px">${e(c.severity)}</span>
  </div>`).join('') || '<div style="font-size:12px;color:var(--pass);padding:8px">No failure clusters</div>';

  // AI top analysis
  const topAI = (aiAnalysis?.analyses||[]).slice(0,2);
  const aiMini = topAI.map(a=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><code style="font-size:10px;color:var(--fail)">${e(a.patternId)}</code><span style="font-size:11px;font-weight:600;flex:1">${e(a.scenarioName.slice(0,40))}</span><span style="font-size:11px;color:var(--pass);font-weight:700">${a.confidence}%</span></div>
    <div style="font-size:11px;color:var(--text2);padding-left:4px">${e(a.cause.slice(0,80))}</div>
  </div>`).join('') || '<div style="font-size:12px;color:var(--pass);padding:8px">No failures analysed</div>';

  return `
<!-- Mission Control -->
<div class="ti-dash-grid-6" style="margin-bottom:16px">${missionPanels}</div>

<!-- Main Grid -->
<div class="ti-dash-grid-3" style="gap:16px">

  <div class="card">
    <div class="ti-dash-section-hdr">📡 Top Failing Components</div>
    ${compRows}
  </div>

  <div class="card">
    <div class="ti-dash-section-hdr">🔥 Failure Clusters</div>
    ${clusterMini}
  </div>

  <div class="card">
    <div class="ti-dash-section-hdr">🤖 AI Root Cause</div>
    ${aiMini}
  </div>

  <div class="card">
    <div class="ti-dash-section-hdr">🔄 Recent Regressions</div>
    ${regRows}
  </div>

  <div class="card">
    <div class="ti-dash-section-hdr">💉 Defect Leakage</div>
    <div style="display:flex;align-items:center;gap:16px;padding:10px 0">
      <div style="text-align:center">
        <div style="font-size:36px;font-weight:900;color:${leakageColor}">${leakagePct}%</div>
        <div style="font-size:11px;color:var(--text2)">LEAKAGE RATE</div>
      </div>
      <div style="flex:1">
        <div class="perf-bar-outer" style="height:10px"><div class="perf-bar-inner ${leakagePct>20?'fail':leakagePct>5?'warn':''}" style="width:${leakagePct}%;height:10px"></div></div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">${m.failed} failure${m.failed!==1?'s':''} of ${m.total} total</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="ti-dash-section-hdr">📈 Quality Velocity</div>
    ${trends?.available
      ?`<div style="padding:10px 0">
          <div style="display:flex;gap:16px">
            <div><div style="font-size:24px;font-weight:800;color:var(--pass)">${trends.summary.avg7DayPassRate}%</div><div style="font-size:11px;color:var(--text2)">7-day avg</div></div>
            <div><div style="font-size:24px;font-weight:800">${trends.summary.avg30RunPassRate}%</div><div style="font-size:11px;color:var(--text2)">30-run avg</div></div>
          </div>
          <div style="margin-top:8px;font-size:13px;font-weight:700;color:${trends.summary.trend==='improving'?'var(--pass)':trends.summary.trend==='declining'?'var(--fail)':'var(--skip)'}">${trends.summary.trend==='improving'?'↑ Improving':trends.summary.trend==='declining'?'↓ Declining':'→ Stable'}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${trends.summary.currentStreak} run pass streak</div>
        </div>`
      :'<div style="font-size:12px;color:var(--text2);padding:10px">Not enough history</div>'}
  </div>

</div>`;
}

// ─── Phase 11: Digital QA Twin ────────────────────────────────────────────────
function buildDigitalTwinPanel(twin) {
  if (!twin) return '<div class="empty-state">Digital twin not yet computed.</div>';

  const dims = [
    { label: 'Quality Health',    value: twin.qualityHealth,    color: twin.qualityHealth>=80?'#3fb950':twin.qualityHealth>=60?'#e3b341':'#f85149' },
    { label: 'Delivery Health',   value: twin.deliveryHealth,   color: twin.deliveryHealth>=80?'#58a6ff':twin.deliveryHealth>=60?'#e3b341':'#f85149' },
    { label: 'Automation Health', value: twin.automationHealth, color: '#a371f7' },
    { label: 'Release Health',    value: twin.releaseHealth,    color: twin.releaseHealth>=80?'#3fb950':twin.releaseHealth>=60?'#e3b341':'#f85149' },
    { label: 'Risk Score',        value: twin.riskScore,        color: twin.riskScore<20?'#3fb950':twin.riskScore<50?'#e3b341':'#f85149', inverse: true },
  ];

  const gauges = dims.map(d => {
    const displayVal = d.inverse ? `${d.value}/100` : `${d.value}%`;
    const barPct     = d.inverse ? 100 - d.value : d.value;
    return `
<div style="margin-bottom:12px">
  <div class="perf-bar-label"><span style="font-size:12px;color:var(--text1)">${e(d.label)}</span><span style="font-size:14px;font-weight:800;color:${d.color}">${displayVal}</span></div>
  <div class="perf-bar-outer" style="height:8px"><div style="height:8px;border-radius:3px;background:${d.color};width:${barPct}%;transition:width 1s ease"></div></div>
</div>`;
  }).join('');

  const compRows = (twin.components||[]).map(c => {
    const stCol = c.status==='healthy'?'var(--pass)':c.status==='degraded'?'var(--skip)':'var(--fail)';
    return `<div class="env-row" style="border-left:3px solid ${stCol}">
      <span class="env-key">${e(c.name)}</span>
      <span class="env-val" style="color:${stCol}">${c.health}% · ${e(c.status)}</span>
      ${c.failures?`<span style="margin-left:auto;font-size:11px;color:var(--fail)">${c.failures}F</span>`:''}
    </div>`;
  }).join('');

  const trendColor = twin.trend==='↑'?'var(--pass)':twin.trend==='↓'?'var(--fail)':'var(--skip)';

  return `
<div class="two-col" style="gap:16px;margin-bottom:16px">
  <div class="card" style="text-align:center;padding:28px">
    <div style="font-size:11px;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Overall System Health</div>
    <div style="font-size:72px;font-weight:900;color:${twin.overallHealth>=80?'var(--pass)':twin.overallHealth>=60?'var(--skip)':'var(--fail)'};line-height:1">${twin.overallHealth}</div>
    <div style="font-size:13px;color:var(--text1);margin:6px 0">/100 — Platform Health Score</div>
    <div style="font-size:24px;font-weight:700;color:${trendColor}">${twin.trend} ${e(twin.trendLabel)}</div>
    <div style="font-size:11px;color:var(--text2);margin-top:4px">Last updated: ${twin.lastUpdated ? new Date(twin.lastUpdated).toLocaleTimeString() : '–'}</div>
    <div style="margin-top:12px;padding:8px;background:var(--bg2);border-radius:6px;font-size:12px;color:var(--text1)">
      <code>${JSON.stringify({ qualityHealth: twin.qualityHealth, deliveryHealth: twin.deliveryHealth, automationHealth: twin.automationHealth, releaseHealth: twin.releaseHealth, riskScore: twin.riskScore }, null, 0)}</code>
    </div>
  </div>
  <div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:12px">Health Dimensions</div>${gauges}</div>
</div>
${compRows?`<div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Component Health Breakdown</div><div class="env-grid">${compRows}</div></div>`:''}`;
}

// ─── Phase 12: Execution Story ────────────────────────────────────────────────
function buildExecutionStory(story) {
  if (!story) return '<div class="empty-state">No story generated.</div>';

  const toneColor = story.tone==='positive'?'var(--pass)':story.tone==='cautious'?'var(--skip)':story.tone==='critical'?'var(--fail)':'var(--info)';
  const toneIcon  = story.tone==='positive'?'✅':story.tone==='cautious'?'⚠️':story.tone==='critical'?'🚫':'ℹ️';

  const metricsHtml = (story.keyMetrics||[]).map(m=>{
    const mc = m.status==='pass'?'var(--pass)':m.status==='fail'?'var(--fail)':m.status==='warn'?'var(--skip)':'var(--info)';
    return `<div class="card" style="text-align:center;padding:12px 8px"><div style="font-size:16px;font-weight:800;color:${mc}">${e(m.value)}</div><div style="font-size:10px;color:var(--text2);margin-top:3px;text-transform:uppercase;letter-spacing:.4px">${e(m.label)}</div></div>`;
  }).join('');

  const sections = story.sections || {};
  const sectionList = [
    { key: 'headline',  title: 'Executive Summary' },
    { key: 'execution', title: 'Execution Quality' },
    { key: 'failures',  title: 'Failure Analysis' },
    { key: 'release',   title: 'Release Assessment' },
    { key: 'trends',    title: 'Quality Trends' },
    { key: 'nextSteps', title: 'Recommended Actions' },
  ].filter(s => sections[s.key]);

  return `
<div class="card" style="margin-bottom:16px;border-top:3px solid ${toneColor}">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span style="font-size:24px">${toneIcon}</span>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text1)">Execution Tone: <strong style="color:${toneColor}">${e((story.tone||'').toUpperCase())}</strong></div>
    <div style="margin-left:auto;font-size:11px;color:var(--text2)">${story.generatedAt ? new Date(story.generatedAt).toLocaleTimeString() : ''}</div>
  </div>
  <div class="card-grid" style="grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">${metricsHtml}</div>
  ${sectionList.map(s=>`
  <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:6px">${e(s.title)}</div>
    <div style="font-size:13px;color:var(--text0);line-height:1.65">${e(sections[s.key]||'')}</div>
  </div>`).join('')}
</div>`;
}

// ─── Phase Styles ─────────────────────────────────────────────────────────────
function buildPhaseStyles() {
  return `
/* ── Phase 2–12 styles ── */
.ai-root-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;font-size:12px;}
.ai-lbl{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--text2);margin-bottom:2px;}
.ai-val{color:var(--text0);}
.ai-val.warn{color:var(--skip);font-weight:600;}
.rc-fix::before{content:'💡';margin-right:5px;}
.ti-dash-grid-6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;}
.ti-dash-grid-3{display:grid;grid-template-columns:repeat(3,1fr);}
.ti-dash-panel{padding:16px;text-align:center;}
.ti-dash-section-hdr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);}
@media(max-width:1100px){.ti-dash-grid-6{grid-template-columns:repeat(3,1fr);}.ti-dash-grid-3{grid-template-columns:repeat(2,1fr);}.ai-root-grid{grid-template-columns:1fr;}}
@media(max-width:760px){.ti-dash-grid-6{grid-template-columns:repeat(2,1fr);}.ti-dash-grid-3{grid-template-columns:1fr;}}
`;
}

// ─── Phase Scripts ────────────────────────────────────────────────────────────
function buildPhaseScripts() {
  return `
function seekTimelineVideo(id, t) {
  const v = document.getElementById(id);
  if (!v) return;
  v.currentTime = t;
  v.play().catch(() => {});
}`;
}

module.exports = {
  buildTraceabilityEngine,
  buildFailureIntelligence,
  buildAiRootCause,
  buildReleaseDecisionPanel,
  buildExecutiveIntelligence,
  buildTrendEngine,
  buildFailureTimeline,
  buildTestIntelligenceDashboard,
  buildDigitalTwinPanel,
  buildExecutionStory,
  buildPhaseStyles,
  buildPhaseScripts,
};
