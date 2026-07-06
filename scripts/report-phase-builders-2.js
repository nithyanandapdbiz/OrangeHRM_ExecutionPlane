'use strict';
/**
 * report-phase-builders-2.js
 * HTML builders for Phase 13–20 (Autonomous Platform layer).
 */

const e   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fd  = ms => ms>=60000?`${(ms/60000).toFixed(1)}m`:ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`;
const col = (v, t1=90, t2=70) => v>=t1?'var(--pass)':v>=t2?'var(--skip)':'var(--fail)';
const pbar = (v, cls='') => `<div class="perf-bar-outer"><div class="perf-bar-inner${cls?' '+cls:''}" style="width:${Math.min(100,v)}%"></div></div>`;
const bBadge = (t, c) => `<span class="badge ${c||'info'}" style="font-size:10px">${e(t)}</span>`;
const sevColor = s => ({Critical:'#f85149',High:'#e3b341',Medium:'#79c0ff',Low:'#3fb950',CRITICAL:'#f85149',HIGH:'#e3b341',MEDIUM:'#79c0ff',LOW:'#3fb950'})[s]||'#8b949e';

// ─── Phase 13: Self-Healing Analysis ─────────────────────────────────────────
function buildSelfHealingPanel(healing) {
  if (!healing) return '<div class="empty-state">Self-healing data unavailable.</div>';
  const { recommendations, summary } = healing;

  if (!recommendations.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:28px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Failures — No Healing Analysis Required</div></div>`;

  const statsHtml = [
    { label:'Failures Analysed', value:summary.total,        cls:'fail' },
    { label:'Auto-Fixable',      value:summary.automatable,  cls:'pass' },
    { label:'Avg Confidence',    value:`${summary.avgConfidence}%`, cls:'info' },
    { label:'Systemic Issues',   value:summary.systemicIssues, cls:'warn' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const byTypeHtml = Object.entries(summary.byType||{}).map(([k,v])=>
    `<span style="font-size:11px;background:var(--bg3);border:1px solid var(--border);padding:3px 10px;border-radius:20px">${e(k)}: <strong>${v}</strong></span>`
  ).join(' ');

  const cards = recommendations.map(r => {
    const confColor = r.confidence > 85 ? 'var(--pass)' : r.confidence > 65 ? 'var(--skip)' : 'var(--fail)';
    const autoIcon  = r.automatable ? '🤖 AUTO-FIX ELIGIBLE' : '👤 MANUAL FIX';
    const autoColor = r.automatable ? 'var(--pass)' : 'var(--skip)';
    return `
<div class="rc-card" style="margin-bottom:12px;border-left-color:${r.impact?.blast==='HIGH'?'var(--fail)':r.impact?.blast==='MEDIUM'?'var(--skip)':'var(--border)'}">
  <div style="display:flex;align-items:start;gap:12px;margin-bottom:10px">
    <div style="flex:1">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--fail);margin-bottom:3px">${e(r.healingLabel)}</div>
      <div style="font-size:13px;font-weight:600">${e(r.scenarioName)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px"><code class="issue-key">${e(r.issueKey)}</code> · ${e(r.featureName)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:22px;font-weight:900;color:${confColor}">${r.confidence}%</div>
      <div style="font-size:10px;color:var(--text2)">CONFIDENCE</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:10px">
    <div><span style="font-size:10px;color:var(--text2);text-transform:uppercase">Suggested Fix</span><div style="margin-top:3px;color:var(--info)">💡 ${e(r.suggestedFix)}</div></div>
    <div><span style="font-size:10px;color:var(--text2);text-transform:uppercase">Impact</span><div style="margin-top:3px;color:var(--text1)">${e(r.impact?.level||'–')} — ${e(r.impact?.description||'')}</div></div>
    <div><span style="font-size:10px;color:var(--text2);text-transform:uppercase">Owner</span><div style="margin-top:3px;font-weight:600;color:var(--skip)">${e(r.owner)}</div></div>
    <div><span style="font-size:10px;color:var(--text2);text-transform:uppercase">Effort</span><div style="margin-top:3px">${e(r.effort)}</div></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="font-size:11px;font-weight:700;color:${autoColor}">${autoIcon}</span>
    ${r.recurred?'<span style="font-size:11px;color:var(--fail)">⟳ RECURRENT</span>':''}
    ${r.autoFixSaving>0?`<span style="font-size:11px;color:var(--pass)">⏱ Saves ~${r.autoFixSaving} min</span>`:''}
    ${r.errorSummary?`<span style="font-size:10px;color:var(--text2);font-family:monospace;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(r.errorSummary)}</span>`:''}
  </div>
</div>`;
  }).join('');

  return `
<div class="two-col" style="margin-bottom:16px">
  <div class="card-grid card-grid-4">${statsHtml}</div>
  <div class="card" style="padding:14px 18px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Failure Pattern Distribution</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${byTypeHtml}</div>
    <div style="margin-top:10px;font-size:12px;color:var(--text1)">
      <span style="color:var(--pass)">⏱ ${e(summary.timeToFix)}</span> total ·
      <span style="color:var(--pass)">💾 ${e(summary.autoSaving||'0 min saved')}</span>
    </div>
  </div>
</div>
${cards}`;
}

// ─── Phase 14: Test Case Generator ───────────────────────────────────────────
function buildTestGeneratorPanel(generated) {
  if (!generated) return '<div class="empty-state">Test generation data unavailable.</div>';
  const { generated: tcs, statistics } = generated;

  if (!tcs?.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:28px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Coverage Gaps Detected</div><div style="font-size:12px;color:var(--text1);margin-top:6px">All tested features have functional, negative, security, and boundary coverage.</div></div>`;

  const prioColor = p => p==='CRITICAL'?'var(--fail)':p==='HIGH'?'var(--skip)':p==='MEDIUM'?'var(--info)':'var(--pass)';
  const typeIco = t => ({NEGATIVE:'🚫',BOUNDARY:'⇔',SECURITY:'🔐',CONCURRENCY:'⟳',PERFORMANCE:'⚡',FUNCTIONAL:'✓'})[t]||'📋';

  const statsCards = [
    { label:'Generated TCs',    value:statistics.total,        cls:'info' },
    { label:'Critical Gaps',    value:statistics.criticalGaps, cls:'fail' },
    { label:'Features Scanned', value:statistics.features,     cls:'pass' },
    { label:'Unique Types',     value:Object.keys(statistics.byType||{}).length, cls:'skip' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const byTypeHtml = Object.entries(statistics.byType||{}).map(([k,v])=>`
  <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:16px">${typeIco(k)}</span>
    <span style="flex:1;font-size:12px;font-weight:600">${e(k)}</span>
    <span style="font-size:20px;font-weight:800;color:var(--info)">${v}</span>
  </div>`).join('');

  const tcCards = tcs.map(tc => `
<div class="card" style="margin-bottom:10px;border-left:4px solid ${prioColor(tc.priority)}">
  <div style="display:flex;align-items:start;gap:10px;margin-bottom:8px">
    <span style="font-size:20px">${typeIco(tc.type)}</span>
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${prioColor(tc.priority)};margin-bottom:3px">${e(tc.type)} · ${e(tc.priority)}</div>
      <div style="font-size:13px;font-weight:600">${e(tc.title)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px">Feature: ${e(tc.featureName)} · Req: <code class="issue-key">${e(tc.requirement||tc.reqId||'–')}</code></div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <code style="font-size:11px;color:var(--info)">${e(tc.id)}</code><br>
      <span style="font-size:10px;color:var(--text2)">${e(tc.issueTagSuggestion||'')}</span>
    </div>
  </div>
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
    <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-bottom:5px">Generated BDD Scenario</div>
    <pre style="font-size:11px;color:var(--pass);margin:0;white-space:pre-wrap;font-family:monospace">${e(tc.bddScenario||'')}</pre>
  </div>
  <div style="display:flex;gap:12px;font-size:11px;color:var(--text1)">
    <span style="color:var(--fail)">⚠ Gap: ${e(tc.coverageGap||'')}</span>
    <span style="margin-left:auto">Effort: ${e(tc.estimatedEffort||'–')}</span>
  </div>
</div>`).join('');

  return `
<div class="card-grid card-grid-4" style="margin-bottom:16px">${statsCards}</div>
<div class="two-col" style="margin-bottom:16px">
  <div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Generated by Type</div>${byTypeHtml}</div>
  <div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">By Priority</div>
    ${Object.entries(statistics.byPriority||{}).map(([k,v])=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:12px;color:${prioColor(k)};font-weight:600">${e(k)}</span><span style="font-size:18px;font-weight:800">${v}</span></div>`).join('')}
  </div>
</div>
${tcCards}`;
}

// ─── Phase 15: Requirement Risk ───────────────────────────────────────────────
function buildRequirementRiskPanel(reqRisk) {
  if (!reqRisk?.requirements?.length) return '<div class="empty-state">No requirement risk data. Ensure scenarios are tagged with @story- or @req- tags.</div>';
  const { requirements, summary } = reqRisk;

  const summCards = [
    { label:'Requirements', value:summary.total,        cls:'info' },
    { label:'High Risk',    value:summary.highRisk,     cls:'fail' },
    { label:'Critical',     value:summary.criticalCount,cls:'fail' },
    { label:'Avg Score',    value:`${summary.avgScore}`,cls:'pass' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const rows = requirements.map(r => {
    const sc  = sevColor(r.riskLevel);
    const scoreColor = col(r.qualityScore);
    return `
<div class="card" style="margin-bottom:10px;border-left:4px solid ${sc}">
  <div style="display:flex;align-items:start;gap:12px;margin-bottom:8px">
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;color:${sc};text-transform:uppercase;margin-bottom:3px">${e(r.riskLevel)}</div>
      <div style="font-size:13px;font-weight:600"><code class="issue-key">${e(r.requirementId)}</code> — ${e((r.userStory||'').slice(0,60))}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:28px;font-weight:900;color:${scoreColor}">${r.qualityScore}</div>
      <div style="font-size:10px;color:var(--text2)">QUALITY SCORE</div>
    </div>
  </div>
  ${r.risks.length?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">${r.risks.slice(0,4).map(rk=>`<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:${sevColor(rk.severity)}22;border:1px solid ${sevColor(rk.severity)}44;color:${sevColor(rk.severity)}">${e(rk.label)}</span>`).join('')}</div>`:''}
  <div style="display:flex;gap:16px;font-size:11px;color:var(--text1)">
    <span>${r.scenarioCount} scenario${r.scenarioCount!==1?'s':''}</span>
    <span style="color:var(--pass)">${r.passCount} pass</span>
    <span style="color:var(--fail)">${r.failCount} fail</span>
    ${r.openDefects?`<span style="color:var(--fail)">🐛 ${r.openDefects} defect(s)</span>`:''}
    ${r.ambiguityFlags.length?`<span style="color:var(--skip)">⚠ ${r.ambiguityFlags.length} ambiguity flag(s)</span>`:''}
    <span style="margin-left:auto;color:var(--info);font-style:italic">${e(r.recommendation)}</span>
  </div>
  ${r.securityGaps.length?`<div style="margin-top:6px;font-size:11px;color:var(--fail)">🔐 Security gap: ${e(r.securityGaps[0])}</div>`:''}
</div>`;
  }).join('');

  return `<div class="card-grid card-grid-4" style="margin-bottom:16px">${summCards}</div>${rows}`;
}

// ─── Phase 16: Defect Prediction ──────────────────────────────────────────────
function buildDefectPredictorPanel(defectPrediction) {
  if (!defectPrediction?.predictions?.length) return '<div class="empty-state">No defect prediction data.</div>';
  const { predictions, summary } = defectPrediction;

  const summCards = [
    { label:'Features Analysed',value:summary.totalFeatures,   cls:'info' },
    { label:'High-Risk Features',value:summary.highRiskFeatures,cls:'fail' },
    { label:'Predicted Defects', value:summary.totalPredicted,  cls:'warn' },
    { label:'Model Confidence',  value:`${summary.confidence}%`,cls:'pass' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const rows = predictions.map(p => {
    const rc = p.riskLevel === 'HIGH' ? 'var(--fail)' : p.riskLevel === 'MEDIUM' ? 'var(--skip)' : 'var(--pass)';
    return `
<div class="card" style="margin-bottom:10px;border-left:4px solid ${rc}">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700">${e(p.featureName)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px">${p.currentFailures} current failure(s) · ${p.totalScenarios} scenario(s) · ${p.historicRunsUsed} historical run(s)</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:28px;font-weight:900;color:${rc}">${p.riskScore}</div>
      <div style="font-size:10px;color:var(--text2)">RISK SCORE</div>
    </div>
    <div style="text-align:right;flex-shrink:0;min-width:60px">
      <div style="font-size:24px;font-weight:800;color:${rc}">${p.predictedDefects}</div>
      <div style="font-size:10px;color:var(--text2)">PREDICTED</div>
    </div>
    <div style="text-align:right;flex-shrink:0;min-width:60px">
      <div style="font-size:18px;font-weight:700">${p.confidence}%</div>
      <div style="font-size:10px;color:var(--text2)">CONFIDENCE</div>
    </div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
    ${(p.factors||[]).map(f=>`<div style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:5px 8px">
      <div style="font-size:10px;color:var(--text2)">${e(f.name)}</div>
      <div style="font-size:11px;font-weight:600;color:var(--text0)">${e(String(f.display))}</div>
      <div style="font-size:10px;color:var(--info)">${f.contribution}% contribution</div>
    </div>`).join('')}
  </div>
</div>`;
  }).join('');

  return `
<div class="card-grid card-grid-4" style="margin-bottom:16px">${summCards}</div>
<div class="card" style="margin-bottom:16px;padding:12px 16px;border-left:4px solid var(--info)">
  <div style="font-size:12px;color:var(--text1)">${e(summary.modelNote||'')}</div>
</div>
${rows}`;
}

// ─── Phase 17: Impact Analysis ────────────────────────────────────────────────
function buildImpactAnalysisPanel(impact) {
  if (!impact?.available) return `<div class="card" style="text-align:center;padding:36px"><div style="font-size:28px">🔄</div><div style="font-size:14px;font-weight:600;margin-top:12px">No Delta Available</div><div style="font-size:12px;color:var(--text1);margin-top:6px">Run the test suite again to compute test impact analysis.</div></div>`;
  const { summary, impactedRequirements, impactedTestCases, changedFeatures, regressionScope } = impact;

  if (!changedFeatures?.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:28px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Changes Detected Since Last Run</div></div>`;

  const summCards = [
    { label:'Changed Features',     value:summary.changedFeatureCount,      cls:'warn' },
    { label:'Impacted Requirements',value:summary.impactedRequirementCount, cls:'fail' },
    { label:'Impacted Test Cases',  value:summary.impactedTestCaseCount,    cls:'fail' },
    { label:'New Failures',         value:summary.newFailures,              cls:'fail' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const regColor  = regressionScope.runAll ? 'var(--fail)' : 'var(--skip)';
  const regBadge  = regressionScope.runAll ? 'FULL REGRESSION' : 'TARGETED REGRESSION';

  const reqRows = (impactedRequirements||[]).map(r=>`
<div class="env-row" style="border-left:3px solid ${r.riskLevel==='HIGH'?'var(--fail)':'var(--skip)'}">
  <span class="env-key"><code class="issue-key">${e(r.requirementId)}</code></span>
  <span class="env-val">${e((r.userStory||'').slice(0,50))}</span>
  <span style="margin-left:auto;font-size:11px;color:var(--text2)">${e(r.changedFeature)}</span>
  <span class="${r.riskLevel==='HIGH'?'badge fail':'badge skip'}" style="font-size:10px">${e(r.riskLevel)}</span>
</div>`).join('');

  return `
<div class="card-grid card-grid-4" style="margin-bottom:16px">${summCards}</div>
<div class="two-col" style="gap:16px;margin-bottom:16px">
  <div class="card" style="border:2px solid ${regColor}">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Regression Scope Recommendation</div>
    <div style="font-size:22px;font-weight:900;color:${regColor};margin-bottom:8px">${regBadge}</div>
    <div style="font-size:12px;color:var(--text1);margin-bottom:8px">${e(regressionScope.reasoning)}</div>
    <div style="display:flex;gap:12px;font-size:12px">
      <span>⏱ <strong>${e(regressionScope.estimatedDuration)}</strong></span>
      <span>📋 <strong>${e(regressionScope.priority)}</strong></span>
    </div>
    ${regressionScope.clusterRisk?`<div style="margin-top:8px;font-size:11px;color:var(--fail)">⚡ ${e(regressionScope.clusterRisk)}</div>`:''}
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Changed Features</div>
    ${(changedFeatures||[]).map(f=>`<div style="font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">${e(f)}</div>`).join('')}
    <div style="margin-top:10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:6px">Must-Run Test Cases</div>
    ${(impactedTestCases||[]).slice(0,8).map(k=>`<code class="issue-key" style="display:inline-block;margin:2px">${e(k)}</code>`).join('')}
    ${(impactedTestCases||[]).length>8?`<span style="font-size:11px;color:var(--text2)">+${(impactedTestCases||[]).length-8} more</span>`:''}
  </div>
</div>
${reqRows?`<div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Impacted Requirements</div><div class="env-grid">${reqRows}</div></div>`:''}`;
}

// ─── Phase 18: Release Command Center ────────────────────────────────────────
function buildReleaseCommandCenterPanel(commandCenter) {
  if (!commandCenter) return '<div class="empty-state">Command center data unavailable.</div>';
  const { panels, alerts, recommendation } = commandCenter;

  const panelOrder = ['qualityHealth','deliveryHealth','riskHealth','releaseConfidence','defectPrediction','productionReadiness'];
  const panelHtml = panelOrder.map(k => {
    const p = panels[k];
    if (!p) return '';
    const tc = p.status?.tier === 'PASS' ? 'var(--pass)' : p.status?.tier === 'WARN' ? 'var(--skip)' : 'var(--fail)';
    return `
<div class="card" style="border-top:3px solid ${p.color};text-align:center;padding:20px 14px">
  <div style="font-size:28px;font-weight:900;color:${p.color};line-height:1">${e(String(p.value))}${e(p.unit||'')}</div>
  <div style="font-size:12px;font-weight:700;color:var(--text1);margin:4px 0;text-transform:uppercase;letter-spacing:.4px">${e(p.label)}</div>
  <div style="font-size:11px;font-weight:700;color:${tc}">${e(p.status?.label||'')}</div>
  <div style="font-size:10px;color:var(--text2);margin-top:4px">${e(p.detail||'')}</div>
</div>`;
  }).join('');

  const alertHtml = (alerts||[]).map(a => {
    const ac = a.severity==='CRITICAL'?'var(--fail)':a.severity==='HIGH'?'#f85149':a.severity==='MEDIUM'?'var(--skip)':'var(--info)';
    return `
<div class="env-row" style="border-left:3px solid ${ac}">
  <span style="font-size:14px">${a.icon||'⚠'}</span>
  <span style="flex:1;font-size:12px">${e(a.message)}</span>
  <span class="badge ${a.severity==='CRITICAL'||a.severity==='HIGH'?'fail':'skip'}" style="font-size:10px">${e(a.severity)}</span>
  <span style="font-size:11px;color:var(--info);margin-left:8px;cursor:pointer;flex-shrink:0">${e(a.action||'')}</span>
</div>`;
  }).join('') || '<div style="font-size:12px;color:var(--pass);padding:8px">✅ No active alerts</div>';

  const recColor = recommendation?.color || 'var(--text2)';

  return `
<!-- Cockpit panels -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px">${panelHtml}</div>

<!-- Alert strip + recommendation -->
<div class="two-col" style="gap:16px;margin-bottom:16px">
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">⚡ Active Alerts</div>
    <div class="env-grid" style="grid-template-columns:1fr">${alertHtml}</div>
  </div>
  <div class="card" style="text-align:center;padding:28px;border:2px solid ${recColor}">
    <div style="font-size:48px;margin-bottom:8px">${recommendation?.icon||'❓'}</div>
    <div style="font-size:24px;font-weight:900;color:${recColor}">${e(recommendation?.status||'UNKNOWN')}</div>
    <div style="margin-top:12px;display:flex;gap:16px;justify-content:center">
      <div><div style="font-size:28px;font-weight:800;color:${recColor}">${recommendation?.confidence||0}%</div><div style="font-size:11px;color:var(--text2)">CONFIDENCE</div></div>
      <div style="width:1px;background:var(--border)"></div>
      <div><div style="font-size:28px;font-weight:800;color:var(--info)">${commandCenter.cockpitScore||0}</div><div style="font-size:11px;color:var(--text2)">COCKPIT SCORE</div></div>
      <div style="width:1px;background:var(--border)"></div>
      <div><div style="font-size:28px;font-weight:800;color:${recommendation?.grade==='A'?'var(--pass)':recommendation?.grade==='B'?'var(--info)':'var(--fail)'}">${recommendation?.grade||'–'}</div><div style="font-size:11px;color:var(--text2)">GRADE</div></div>
    </div>
    <div style="margin-top:16px;font-size:12px;color:var(--text1);text-align:left;background:var(--bg2);border-radius:6px;padding:10px">${e(recommendation?.reasoning||'')}</div>
    ${recommendation?.topAction?`<div style="margin-top:10px;font-size:12px;color:var(--info)">💡 ${e(recommendation.topAction)}</div>`:''}
    ${(recommendation?.blockers||[]).length?`<div style="margin-top:10px;padding:8px;background:rgba(248,81,73,.1);border-radius:6px;font-size:12px;color:var(--fail)">🚫 ${(recommendation?.blockers||[]).length} blocker(s): ${(recommendation?.blockers||[]).map(b=>b.name).join(', ')}</div>`:''}
  </div>
</div>`;
}

// ─── Phase 19: Production Correlation ────────────────────────────────────────
function buildProductionCorrelationPanel(correlation) {
  if (!correlation) return '<div class="empty-state">Production correlation data unavailable.</div>';
  const { leakageAnalytics, correlations, missedCoverage, defectDensity } = correlation;

  if (!correlations.length && !missedCoverage.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:28px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Jira Bugs Found — No Leakage to Analyse</div></div>`;

  const la = leakageAnalytics;
  const leakColor = la.leakageRate === 0 ? 'var(--pass)' : la.leakageRate <= 20 ? 'var(--skip)' : 'var(--fail)';

  const summCards = [
    { label:'Total Bugs',      value:la.totalBugs,           cls:'fail' },
    { label:'Caught by Tests', value:la.caught,              cls:'pass' },
    { label:'False Passes',    value:la.falsePasses,         cls:'fail' },
    { label:'Coverage Gaps',   value:la.coverageGaps,        cls:'fail' },
    { label:'Leakage Rate',    value:`${la.leakageRate}%`,   cls: la.leakageRate===0?'pass':la.leakageRate<=20?'skip':'fail' },
    { label:'Detection Rate',  value:`${la.defectDetectionRate||0}%`, cls:'info' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  const LEAK_COLORS = { CAUGHT: 'var(--pass)', FALSE_PASS: 'var(--fail)', COVERAGE_GAP: 'var(--skip)', LINKED: 'var(--info)' };
  const LEAK_ICONS  = { CAUGHT: '✓', FALSE_PASS: '✗', COVERAGE_GAP: '⚠', LINKED: 'ℹ' };

  const corrRows = correlations.map(c=>`
<tr>
  <td><code class="issue-key" style="color:var(--fail)">${e(c.bugKey)}</code></td>
  <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e((c.scenario||'').slice(0,50))}</td>
  <td><code class="issue-key">${e(c.testCaseKey)}</code></td>
  <td style="font-size:11px">${e(c.featureName)}</td>
  <td><span style="font-weight:700;color:${LEAK_COLORS[c.leakageType]||'var(--text2)'}">${LEAK_ICONS[c.leakageType]||'?'} ${e(c.leakageType?.replace('_',' ')||'')}</span></td>
  <td style="font-size:11px;color:var(--text1);max-width:200px">${e(c.recommendation||'')}</td>
</tr>`).join('');

  const densityRows = (defectDensity||[]).slice(0,6).map(d=>`
<div class="env-row" style="border-left:3px solid ${d.risk==='HIGH'?'var(--fail)':d.risk==='MEDIUM'?'var(--skip)':'var(--pass)'}">
  <span class="env-key">${e(d.feature)}</span>
  <span class="env-val">${d.bugs} bug(s) / ${d.scenarios} scenario(s)</span>
  <span style="margin-left:auto;font-size:11px;font-weight:700;color:${d.risk==='HIGH'?'var(--fail)':d.risk==='MEDIUM'?'var(--skip)':'var(--pass)'}">${d.density.toFixed(2)} density</span>
</div>`).join('');

  return `
<div class="card-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">${summCards}</div>
<div class="two-col" style="gap:16px;margin-bottom:16px">
  <div class="card">
    <div style="display:flex;align-items:center;gap:16px;padding:8px 0">
      <div style="text-align:center">
        <div style="font-size:42px;font-weight:900;color:${leakColor}">${la.leakageRate}%</div>
        <div style="font-size:11px;color:var(--text2)">DEFECT LEAKAGE RATE</div>
      </div>
      <div style="flex:1">${pbar(la.leakageRate, la.leakageRate>20?'fail':la.leakageRate>5?'warn':'')}</div>
    </div>
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">Defect Density by Feature</div>
    <div class="env-grid" style="grid-template-columns:1fr">${densityRows||'<div style="font-size:12px;color:var(--pass);padding:6px">No defects recorded</div>'}</div>
  </div>
</div>
${corrRows?`<div class="card" style="overflow:auto"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">Defect Correlation Matrix</div><table class="data-table"><thead><tr><th>Bug Key</th><th>Scenario</th><th>Zephyr TC</th><th>Feature</th><th>Leakage Type</th><th>Recommendation</th></tr></thead><tbody>${corrRows}</tbody></table></div>`:''}
${missedCoverage.length?`<div class="card" style="margin-top:14px;border-color:rgba(248,81,73,.3)"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--fail);margin-bottom:8px">⚠ Missed Coverage Areas (${missedCoverage.length})</div>${missedCoverage.map(m=>`<div style="font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><code class="issue-key">${e(m.requirementId)}</code> ${e((m.userStory||'').slice(0,60))} — <span style="color:var(--fail)">${e(m.recommendation)}</span></div>`).join('')}</div>`:''}`;
}

// ─── Phase 20: Autonomous QA Agent ───────────────────────────────────────────
function buildAutonomousAgentPanel(agent) {
  if (!agent) return '<div class="empty-state">Autonomous agent has not run.</div>';
  const { investigations, defectCandidates, ownerAssignments, autoFixCandidates, releaseSummary, summary } = agent;

  const summCards = [
    { label:'Failures Investigated', value:summary.failuresInvestigated,  cls:'fail' },
    { label:'Defect Candidates',     value:summary.defectCandidates,      cls:'fail' },
    { label:'Ready to Create',       value:summary.readyToCreate,         cls:'warn' },
    { label:'Auto-Fix Eligible',     value:summary.autoFixEligible,       cls:'pass' },
    { label:'Owner Groups',          value:summary.ownerCount,            cls:'info' },
    { label:'Release Status',        value:summary.releaseStatus,         cls:summary.releaseStatus==='GO'?'pass':summary.releaseStatus==='CONDITIONAL GO'?'skip':'fail' },
  ].map(c=>`<div class="card stat-big"><div class="stat-val ${c.cls}">${c.value}</div><div class="stat-lbl">${c.label}</div></div>`).join('');

  // Release summary card
  const relColor = releaseSummary.recommendation === 'RELEASE APPROVED' ? 'var(--pass)' : releaseSummary.recommendation === 'RELEASE WITH CAUTION' ? 'var(--skip)' : 'var(--fail)';

  const relCard = `
<div class="card" style="margin-bottom:16px;border:2px solid ${relColor}">
  <div style="display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:4px">Agent Release Recommendation</div>
      <div style="font-size:22px;font-weight:900;color:${relColor}">${e(releaseSummary.recommendation)}</div>
      <div style="font-size:12px;color:var(--text1);margin-top:6px">${e(releaseSummary.narrative?.slice(0,200)||'')}</div>
    </div>
    <div style="text-align:center;flex-shrink:0">
      <div style="font-size:48px;font-weight:900;color:${relColor}">${e(releaseSummary.grade)}</div>
      <div style="font-size:11px;color:var(--text2)">QUALITY GRADE</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:24px;font-weight:800">${releaseSummary.qualityScore||0}</div>
      <div style="font-size:10px;color:var(--text2)">COCKPIT SCORE</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${releaseSummary.passRate}%</div>
      <div style="font-size:10px;color:var(--text2)">PASS RATE</div>
    </div>
  </div>
  ${releaseSummary.immediateActions?.length?`<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">${releaseSummary.immediateActions.map(a=>`<div style="font-size:12px;color:var(--fail);padding:3px 0">🔴 [IMMEDIATE] ${e(a)}</div>`).join('')}</div>`:''}
</div>`;

  // Owner assignments
  const ownersHtml = (ownerAssignments||[]).map(o=>`
<div class="env-row">
  <span class="env-key" style="color:var(--skip)">${e(o.owner)}</span>
  <span class="env-val">${o.count} failure${o.count!==1?'s':''}</span>
  <span style="margin-left:auto;font-size:10px;color:var(--text2)">${(o.items||[]).map(i=>i.issueKey||'–').join(', ')}</span>
</div>`).join('');

  // Defect candidates
  const defectHtml = (defectCandidates||[]).slice(0,5).map(d=>`
<div class="action-card" style="border-left-color:${d.readyToCreate?'var(--fail)':'var(--skip)'}">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <span class="${d.readyToCreate?'badge fail':'badge skip'}" style="font-size:10px">${d.readyToCreate?'READY TO CREATE':'REVIEW FIRST'}</span>
    <code class="issue-key">${e(d.issueKey)}</code>
    <span style="flex:1;font-size:12px;font-weight:600">${e(d.suggestedTitle?.slice(0,70)||'')}</span>
    <span style="font-size:14px;font-weight:700;color:var(--pass)">${d.confidence}%</span>
  </div>
  <div style="display:flex;gap:12px;font-size:11px;color:var(--text1)">
    <span>Severity: ${e(d.severity||'–')}</span>
    <span>Priority: ${e(d.priority||'–')}</span>
    <span>Assign: <strong>${e(d.assignTo||'QA Team')}</strong></span>
    ${d.automatable?'<span style="color:var(--pass)">🤖 Auto-fix eligible</span>':''}
  </div>
</div>`).join('');

  // Investigation cards
  const invCards = (investigations||[]).slice(0,4).map(inv=>`
<div class="rc-card" style="border-left-color:${inv.confidence>=80?'var(--fail)':inv.confidence>=60?'var(--skip)':'var(--border)'}">
  <div style="display:flex;align-items:start;gap:10px;margin-bottom:8px">
    <div style="flex:1">
      <div style="font-size:10px;color:var(--fail);font-weight:700;text-transform:uppercase;margin-bottom:2px">${e(inv.failureType)}</div>
      <div style="font-size:12px;font-weight:600">${e(inv.scenarioName)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:18px;font-weight:800;color:${col(inv.confidence)}">${inv.confidence}%</div>
    </div>
  </div>
  <div style="font-size:11px;color:var(--text1);margin-bottom:4px">💡 ${e(inv.suggestedFix?.slice(0,120)||'')}</div>
  <div style="font-size:11px;color:${inv.automatable?'var(--pass)':'var(--skip)'};font-weight:600">${inv.agentVerdict||''}</div>
  <div style="font-size:10px;color:var(--text2);margin-top:4px">Owner: <strong>${e(inv.owner)}</strong> · Effort: ${e(inv.effort)}</div>
</div>`).join('');

  return `
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">${summCards}</div>
${relCard}
<div class="two-col" style="gap:16px;margin-bottom:16px">
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">👤 Owner Assignments</div>
    <div class="env-grid" style="grid-template-columns:1fr">${ownersHtml||'<div style="color:var(--pass);font-size:12px">No failures to assign</div>'}</div>
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">🔬 Top Investigations</div>
    ${invCards||'<div style="color:var(--pass);font-size:12px">No failures investigated</div>'}
  </div>
</div>
${defectHtml?`<div class="card"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:10px">🐛 Defect Candidates (${defectCandidates.length})</div>${defectHtml}</div>`:''}`;
}

// ─── Phase 13–20 Styles ───────────────────────────────────────────────────────
function buildPhaseStyles2() {
  return `
/* ── Phase 13–20 autonomous platform styles ── */
.cockpit-grid-6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;}
.cockpit-panel{padding:18px;text-align:center;border-top:3px solid transparent;}
@media(max-width:1100px){.cockpit-grid-6{grid-template-columns:repeat(3,1fr);}}
@media(max-width:760px){.cockpit-grid-6{grid-template-columns:repeat(2,1fr);}}
`;
}

// ─── Phase 13–20 Scripts ──────────────────────────────────────────────────────
function buildPhaseScripts2() {
  return `
// Phase 20 — copy BDD scenario to clipboard
function copyBdd(id) {
  const el = document.getElementById('bdd-'+id);
  if (el) { navigator.clipboard?.writeText(el.innerText).then(()=>{ const btn=document.getElementById('cpybtn-'+id); if(btn){btn.textContent='✓ Copied';setTimeout(()=>btn.textContent='Copy',2000);} }); }
}`;
}

module.exports = {
  buildSelfHealingPanel,
  buildTestGeneratorPanel,
  buildRequirementRiskPanel,
  buildDefectPredictorPanel,
  buildImpactAnalysisPanel,
  buildReleaseCommandCenterPanel,
  buildProductionCorrelationPanel,
  buildAutonomousAgentPanel,
  buildPhaseStyles2,
  buildPhaseScripts2,
};
