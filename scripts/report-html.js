'use strict';
// report-html.js — WI-044A: HTML builders, CSS, JS for generate-report.js

const fs   = require('fs');
const path = require('path');
const REPORT_MODE = process.env.REPORT_MODE || 'executive';
const { buildTestIntelligence, buildIntelligenceStyles, buildIntelligenceScripts } = require('./report-intelligence');
const { buildTraceabilityEngine, buildFailureIntelligence, buildAiRootCause, buildReleaseDecisionPanel, buildExecutiveIntelligence, buildTrendEngine, buildFailureTimeline, buildTestIntelligenceDashboard, buildDigitalTwinPanel, buildExecutionStory, buildPhaseStyles, buildPhaseScripts } = require('./report-phase-builders');
const { buildSelfHealingPanel, buildTestGeneratorPanel, buildRequirementRiskPanel, buildDefectPredictorPanel, buildImpactAnalysisPanel, buildReleaseCommandCenterPanel, buildProductionCorrelationPanel, buildAutonomousAgentPanel, buildPhaseStyles2, buildPhaseScripts2 } = require('./report-phase-builders-2');
const { buildTruthinessPanel, buildExplainModal, buildExplainerStyles, buildExplainerScripts } = require('./report-explainer');
const { buildTrustDashboard, buildTrustDashboardStyles } = require('./report-trust-dashboard');
const { buildCodingStandards }     = require('./report-coding-standards');
const { buildGovernanceDashboard }   = require('./report-governance');
const { buildRemediationDashboard }  = require('./report-remediation');

const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtD = ms => ms>=60000?`${(ms/60000).toFixed(1)}m`:ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`;

// ─── SVG helpers ──────────────────────────────────────────────────────────────
function svgRing(pct,color,lbl,sub,sz=108){
  const r=38,cx=sz/2,cy=sz/2,circ=2*Math.PI*r;
  const fill=Math.min(pct/100,1)*circ;
  const gap=circ-fill;
  const offset=(circ/4).toFixed(1);
  return `<div class="kpi-ring"><svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="7"
      stroke-dasharray="${fill.toFixed(1)} ${gap.toFixed(1)}" stroke-dashoffset="${offset}" stroke-linecap="round"
      style="transition:stroke-dasharray 1.2s cubic-bezier(.22,.61,.36,1)"/>
    <text x="${cx}" y="${cy-2}" text-anchor="middle" fill="${color}" font-size="15" font-weight="700">${Math.round(pct)}%</text>
    <text x="${cx}" y="${cy+13}" text-anchor="middle" fill="rgba(255,255,255,.38)" font-size="8.5" letter-spacing=".5">${e(lbl)}</text>
  </svg><div class="kpi-label" style="font-size:10px">${e(sub||lbl)}</div></div>`;
}
function donut(p,f,sk,t){
  if(!t) return '<div class="donut-empty">No Data</div>';
  const pp=p/t*100,fp=f/t*100,sp=sk/t*100;
  const g=`conic-gradient(#3fb950 0% ${pp}%,#f85149 ${pp}% ${pp+fp}%,#e3b341 ${pp+fp}% ${pp+fp+sp}%,#30363d ${pp+fp+sp}% 100%)`;
  return `<div class="donut-wrap"><div class="donut" style="background:${g}"><div class="donut-hole"><span class="donut-pct">${Math.round(pp)}%</span><span class="donut-sub">Pass</span></div></div>
  <div class="donut-legend"><div class="dl-row"><span class="dl-dot pass"></span>${p} Pass</div><div class="dl-row"><span class="dl-dot fail"></span>${f} Fail</div><div class="dl-row"><span class="dl-dot skip"></span>${sk} Skip</div></div></div>`;
}
function sparkline(vals,w=200,h=44,col='#3fb950'){
  if(!vals||vals.length<2) return `<svg width="${w}" height="${h}"><text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,.2)" font-size="10">No data</text></svg>`;
  const max=Math.max(...vals)||1,min=Math.min(...vals),rng=max-min||1,pd=4;
  const pts=vals.map((v,i)=>[( pd+(i/(vals.length-1))*(w-pd*2)).toFixed(1),(h-pd-((v-min)/rng)*(h-pd*2)).toFixed(1)]);
  const poly=pts.map(p=>p.join(',')).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">
    <path d="M${pts[0][0]},${h} ${poly} ${pts[pts.length-1][0]},${h}Z" fill="${col}" opacity=".12"/>
    <polyline points="${poly}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3" fill="${col}"/>
  </svg>`;
}

// ─── Phase 1: Release Readiness ───────────────────────────────────────────────
function buildReleaseReadiness(rr) {
  const vc=rr.verdictColor;
  const factors=[
    {lbl:'Execution Success', val:rr.factors.executionSuccess, icon:'✓'},
    {lbl:'Critical Coverage',  val:rr.factors.criticalCoverage, icon:'◉'},
    {lbl:'Environment Health', val:rr.factors.envHealth, icon:'⚙'},
    {lbl:'Jira Sync',          val:rr.factors.jiraSync, icon:'⬡'},
    {lbl:'Evidence Coverage',  val:rr.factors.evidence, icon:'▦'},
    {lbl:'Healing Confidence', val:rr.factors.healing, icon:'⚕'},
  ];
  const bars=factors.map(f=>`<div class="perf-bar-wrap">
    <div class="perf-bar-label">
      <span style="display:flex;align-items:center;gap:6px"><span style="color:var(--text2);font-size:11px">${f.icon}</span>${e(f.lbl)}</span>
      <span style="font-weight:600;color:${f.val<60?'var(--fail)':f.val<80?'var(--skip)':'var(--pass)'}">${Math.round(f.val)}%</span>
    </div>
    <div class="perf-bar-outer"><div class="perf-bar-inner ${f.val<60?'fail':f.val<80?'warn':''}" style="width:${Math.round(f.val)}%"></div></div>
  </div>`).join('');
  const scoreColor = rr.score>=80?'var(--pass)':rr.score>=60?'var(--skip)':'var(--fail)';
  const scoreBg = rr.score>=80?'rgba(34,197,94,.08)':rr.score>=60?'rgba(251,191,36,.08)':'rgba(248,113,113,.08)';
  return `<div class="two-col" style="align-items:start">
    <div class="card" style="text-align:center;padding:36px 24px;background:${scoreBg};border-color:${vc}44">
      <div style="font-size:72px;font-weight:900;color:${scoreColor};line-height:1;letter-spacing:-3px">${rr.score}</div>
      <div style="font-size:11px;color:var(--text1);text-transform:uppercase;letter-spacing:.8px;margin-top:6px">out of 100</div>
      <div style="display:inline-block;background:${vc}22;border:1px solid ${vc}44;color:${vc};font-size:14px;font-weight:800;padding:6px 20px;border-radius:20px;margin-top:14px;letter-spacing:.3px">${e(rr.verdict)}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:14px">Release Readiness Score</div>
    </div>
    <div class="card" style="flex:1">
      <div style="font-size:10.5px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Readiness Factors</div>
      ${bars}
      ${rr.risks.length
        ? `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
            <div style="font-size:10.5px;font-weight:700;color:var(--skip);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">⚠ Release Risks</div>
            ${rr.risks.map(r=>`<div style="font-size:12px;color:var(--text1);padding:4px 0;display:flex;gap:6px"><span style="color:var(--skip)">·</span>${e(r)}</div>`).join('')}
           </div>`
        : `<div style="margin-top:16px;display:flex;align-items:center;gap:8px;color:var(--pass);font-size:13px;font-weight:500">
             <div class="status-dot pass"></div> No release-blocking risks identified
           </div>`}
    </div>
  </div>`;
}

// ─── Phase 2: Business Impact ─────────────────────────────────────────────────
function buildBusinessImpact(caps) {
  if(!caps.length) return '<div class="empty-state">No business capability data.</div>';
  const impColor={CRITICAL:'#f87171',HIGH:'#fbbf24',MEDIUM:'#60a5fa',LOW:'#22c55e'};
  const impBg={CRITICAL:'rgba(248,113,113,.1)',HIGH:'rgba(251,191,36,.1)',MEDIUM:'rgba(96,165,250,.1)',LOW:'rgba(34,197,94,.1)'};
  return caps.map(c=>{
    const ic=impColor[c.impact]||'var(--text1)';
    const ib=impBg[c.impact]||'transparent';
    const health=c.total?Math.round(c.pass/c.total*100):0;
    const hColor=health===100?'var(--pass)':health>60?'var(--skip)':'var(--fail)';
    const failed=c.scenarios.filter(s=>s.status==='Fail');
    return `<div class="card" style="margin-bottom:10px;border-left:3px solid ${ic};transition:box-shadow var(--t2)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:${c.fail>0?'12':'0'}px">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;letter-spacing:-.1px">${e(c.name)}</div>
          <div style="font-size:11px;color:var(--text1);margin-top:3px">${e(c.process)}</div>
        </div>
        <span style="background:${ib};border:1px solid ${ic}35;color:${ic};font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.3px">${e(c.impact)}</span>
        <div style="text-align:right;min-width:60px">
          <div style="font-size:22px;font-weight:800;color:${hColor};letter-spacing:-.5px">${health}%</div>
          <div style="font-size:10px;color:var(--text2)">${c.pass}P · ${c.fail}F · ${c.total}T</div>
        </div>
      </div>
      ${failed.length?`<div style="padding-top:10px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:5px">
        ${failed.map(s=>`<span style="font-size:10.5px;background:var(--fail-bg);border:1px solid var(--fail-border);color:var(--fail);padding:2px 8px;border-radius:10px">${e(s.scenarioName.slice(0,42)+(s.scenarioName.length>42?'…':''))}</span>`).join('')}
      </div>`:''}
    </div>`;
  }).join('');
}

// ─── Phase 3: Quality Trends ──────────────────────────────────────────────────
function buildTrendCharts(history) {
  if(!history||history.length<2) return `<div class="card" style="text-align:center;padding:36px">
    <div style="font-size:32px">📈</div>
    <div style="font-size:14px;font-weight:600;margin-top:12px">Trend data builds over time</div>
    <div style="font-size:12px;color:var(--text1);margin-top:6px">Run the test suite multiple times to see quality trends</div>
    <div style="font-size:11px;color:var(--text2);margin-top:4px">${history.length} run${history.length!==1?'s':''} recorded · need at least 2</div>
  </div>`;
  const last30=history.slice(-30), last7=history.slice(-7);
  const passRates=last30.map(r=>r.passRate||0);
  const failCounts=last30.map(r=>r.failed||0);
  const durations=last30.map(r=>Math.round((r.totalDuration||0)/1000));
  const healing=last30.map(r=>r.healingEvents||0);
  const trendCards=[
    {title:'Pass Rate Trend (last 30 runs)',data:passRates,color:'#3fb950',unit:'%',latest:passRates[passRates.length-1]},
    {title:'Failure Count Trend',          data:failCounts,color:'#f85149',unit:'',latest:failCounts[failCounts.length-1]},
    {title:'Execution Duration (s)',        data:durations, color:'#58a6ff',unit:'s',latest:durations[durations.length-1]},
    {title:'Healing Events',               data:healing,   color:'#39d353',unit:'',latest:healing[healing.length-1]},
  ];
  const cards=trendCards.map(tc=>`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div>
        <div style="font-size:10.5px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.6px">${e(tc.title)}</div>
        <div style="font-size:24px;font-weight:800;color:${tc.color};margin-top:2px;letter-spacing:-.5px">${tc.latest}${tc.unit}</div>
      </div>
      <div style="background:${tc.color}15;border:1px solid ${tc.color}30;border-radius:6px;padding:4px 8px;font-size:10px;color:${tc.color};font-weight:600">LIVE</div>
    </div>
    ${sparkline(tc.data,280,52,tc.color)}
  </div>`).join('');
  const l7pr=last7.length?Math.round(last7.reduce((a,r)=>a+(r.passRate||0),0)/last7.length):0;
  const l30pr=Math.round(passRates.reduce((a,b)=>a+b,0)/passRates.length);
  const isImproving=l7pr>=l30pr;
  const trend=isImproving?'↑ Improving':'↓ Declining';
  const summaryCards=[
    {lbl:'7-Day Avg',val:`${l7pr}%`,color:'var(--pass)'},
    {lbl:'30-Run Avg',val:`${l30pr}%`,color:'var(--text0)'},
    {lbl:'Quality Trend',val:trend,color:isImproving?'var(--pass)':'var(--fail)'},
    {lbl:'Total Runs',val:history.length,color:'var(--info)'},
  ];
  return `<div class="card-grid card-grid-4" style="gap:10px;margin-bottom:16px">
    ${summaryCards.map(s=>`<div class="card" style="padding:14px 16px">
      <div style="font-size:10.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">${s.lbl}</div>
      <div style="font-size:22px;font-weight:800;color:${s.color};letter-spacing:-.3px">${s.val}</div>
    </div>`).join('')}
  </div>
  <div class="card-grid card-grid-2">${cards}</div>`;
}

// ─── Phase 4: Delta ───────────────────────────────────────────────────────────
function buildDeltaView(delta) {
  if(!delta.available) return `<div class="card" style="text-align:center;padding:36px">
    <div style="font-size:32px">🔄</div>
    <div style="font-size:14px;font-weight:600;margin-top:12px">No Previous Run Found</div>
    <div style="font-size:12px;color:var(--text1);margin-top:6px">Run the suite again to see what changed since this run.</div>
  </div>`;
  const hasChanges=delta.newFailures.length||delta.resolved.length||delta.regressions.length||delta.improvements.length||delta.newScenarios.length;
  if(!hasChanges) return `<div class="card" style="text-align:center;padding:36px"><div style="font-size:32px">✅</div><div style="font-size:14px;font-weight:600;margin-top:12px">No Changes Since Last Run</div></div>`;
  function block(title, icon, color, items, fn) {
    if(!items.length) return '';
    return `<div class="card" style="border-left:4px solid ${color};margin-bottom:10px"><div style="font-size:13px;font-weight:700;color:${color};margin-bottom:10px">${icon} ${e(title)} (${items.length})</div>${items.map(fn).join('')}</div>`;
  }
  return block('New Failures','🔴','var(--fail)',delta.newFailures,s=>`<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span class="issue-key">${e(s.issueKey)}</span><span style="font-size:12px">${e(s.scenarioName)}</span></div>`)
    +block('Resolved Since Last Run','✅','var(--pass)',delta.resolved,s=>`<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span class="issue-key">${e(s.issueKey)}</span><span style="font-size:12px">${e(s.scenarioName)}</span></div>`)
    +block('Performance Regressions','⚠','var(--skip)',delta.regressions,s=>`<div style="font-size:12px;padding:4px 0">${e(s.scenarioName)} <span style="color:var(--fail)">(+${fmtD(s.durationMs)} now)</span></div>`)
    +block('Performance Improvements','⚡','var(--info)',delta.improvements,s=>`<div style="font-size:12px;padding:4px 0">${e(s.scenarioName)} <span style="color:var(--pass)">(${fmtD(s.durationMs)} now)</span></div>`)
    +block('New Scenarios Added','✨','var(--info)',delta.newScenarios,s=>`<div style="font-size:12px;padding:4px 0">${e(s.scenarioName)}</div>`);
}

// ─── Phase 5: AI Insights ─────────────────────────────────────────────────────
function buildAiInsights(m) {
  const insights=[
    {icon:'⚠',color:'var(--fail)',title:'Most Unstable Feature',val:m.mostUnstable?m.mostUnstable[0].slice(0,38):'All stable',sub:m.mostUnstable?`${m.mostUnstable[1].fail} failure(s)`:undefined},
    {icon:'◉',color:'var(--info)',title:'Most Executed Feature',val:m.mostExecuted?m.mostExecuted[0].slice(0,38):'No data',sub:m.mostExecuted?`${m.mostExecuted[1].total} scenarios`:undefined},
    {icon:'⏱',color:'var(--skip)',title:'Longest Scenario',val:m.longestScenario?fmtD(m.longestScenario.durationMs):'–',sub:m.longestScenario?.scenarioName?.slice(0,34)},
    {icon:'↻',color:'var(--fail)',title:'Most Common Failure',val:m.mostCommonError?m.mostCommonError[0]:'None',sub:m.mostCommonError?`${m.mostCommonError[1]} occurrence(s)`:undefined},
    {icon:'▦',color:'var(--pass)',title:'Evidence Coverage',val:`${m.evidenceCoverage}%`,sub:`${m.withScreenshots}/${m.total} with screenshots`},
    {icon:'⬡',color:'var(--accent2)',title:'Jira Traceability',val:`${m.automationCoverage}%`,sub:`${m.withTag} of ${m.total} linked`},
  ];
  const featureHealthBars=Object.entries(m.featureGroups).map(([nm,d])=>{
    const rate=d.total?Math.round(d.pass/d.total*100):0, cls=rate===100?'':rate>=60?'warn':'fail';
    return `<div class="perf-bar-wrap">
      <div class="perf-bar-label">
        <span style="display:flex;align-items:center;gap:6px">
          <span style="width:6px;height:6px;border-radius:50%;background:${rate===100?'var(--pass)':rate>=60?'var(--skip)':'var(--fail)'};flex-shrink:0"></span>
          ${e(nm.slice(0,50)+(nm.length>50?'…':''))}
        </span>
        <span style="font-weight:600;color:${rate===100?'var(--pass)':rate>=60?'var(--skip)':'var(--fail)'}">${rate}%</span>
      </div>
      <div class="perf-bar-outer"><div class="perf-bar-inner ${cls}" style="width:${rate}%"></div></div>
    </div>`;
  }).join('');
  return `<div class="card-grid" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    ${insights.map(i=>`<div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:10.5px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.6px">${e(i.title)}</div>
        <span style="font-size:14px;color:${i.color};opacity:.7">${i.icon}</span>
      </div>
      <div style="font-size:18px;font-weight:800;color:${i.color};letter-spacing:-.2px">${e(i.val)}</div>
      ${i.sub?`<div style="font-size:11px;color:var(--text2);margin-top:4px">${e(i.sub)}</div>`:''}</div>`).join('')}
  </div>
  <div class="card">
    <div style="font-size:10.5px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Feature Health Breakdown</div>
    ${featureHealthBars||'<div class="empty-state">No feature data</div>'}
  </div>`;
}

// ─── Phase 6: Risk Heatmap ────────────────────────────────────────────────────
function buildRiskHeatmap(scenarios) {
  const riskCols=['Locator','Timeout','Auth','Navigation','Data','Integration'];
  const features=[...new Set(scenarios.map(s=>s.featureName))].slice(0,8);
  function riskScore(featureName, riskType) {
    const fs=scenarios.filter(s=>s.featureName===featureName&&s.status==='Fail');
    if(!fs.length) return 0;
    const typeMap={Locator:'LOCATOR_DRIFT',Timeout:'TIMEOUT',Auth:'AUTH_FAILURE',Navigation:'NAVIGATION_FAILURE',Data:'UNEXPECTED_ERROR',Integration:'UNEXPECTED_ERROR'};
    const matches=fs.filter(s=>s.errorClassification.type===typeMap[riskType]);
    return Math.min(4,matches.length+(fs.length>0?1:0));
  }
  const cells=features.map(f=>`<tr><td style="font-size:11px;color:var(--text1);padding:6px 10px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis">${e(f.slice(0,30))}</td>
    ${riskCols.map(rc=>{const s=riskScore(f,rc);const bg=s===0?'rgba(63,185,80,.15)':s===1?'rgba(227,179,65,.2)':s===2?'rgba(248,81,73,.2)':s>=3?'rgba(248,81,73,.4)':'transparent';const col=s===0?'var(--pass)':s===1?'var(--skip)':'var(--fail)';return `<td style="text-align:center;padding:6px;background:${bg};border:1px solid var(--border)"><span style="font-size:10px;color:${col};font-weight:700">${['—','LOW','MED','HIGH','CRIT'][s]||'–'}</span></td>`;}).join('')}
  </tr>`).join('');
  return `<div class="card" style="overflow:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border)">Feature</th>
      ${riskCols.map(c=>`<th style="text-align:center;padding:8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border)">${e(c)}</th>`).join('')}</tr></thead>
    <tbody>${cells||'<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text2)">No feature data</td></tr>'}</tbody>
  </table>
  <div style="display:flex;gap:16px;padding:10px 0;font-size:11px;color:var(--text1)">
    <span style="color:var(--pass)">● CLEAR</span><span style="color:var(--skip)">● LOW</span><span style="color:#ec775c">● MED</span><span style="color:var(--fail)">● HIGH/CRITICAL</span>
  </div></div>`;
}

// ─── Phase 7: Failure Clusters ────────────────────────────────────────────────
function buildFailureClusters(scenarios) {
  const failed=scenarios.filter(s=>s.status==='Fail');
  if(!failed.length) return `<div class="card" style="text-align:center;padding:44px">
    <div style="width:48px;height:48px;border-radius:50%;background:var(--pass-bg);border:1px solid var(--pass-border);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px">✓</div>
    <div style="color:var(--pass);font-weight:700;font-size:15px">No Failures to Cluster</div>
    <div style="color:var(--text2);font-size:12px;margin-top:6px">All scenarios passed this run</div>
  </div>`;
  const clusters={};
  const COLOR_MAP={LOCATOR_DRIFT:'#fbbf24',TIMEOUT:'#f87171',AUTH_FAILURE:'#f87171',NAVIGATION_FAILURE:'#fb923c',ELEMENT_HIDDEN:'#60a5fa',UNEXPECTED_ERROR:'#94a3b8'};
  for (const s of failed) {
    const t=s.errorClassification.type, l=s.errorClassification.label;
    if(!clusters[t]) clusters[t]={type:t,label:l,fix:s.errorClassification.fix,scenarios:[],color:COLOR_MAP[t]||'#94a3b8'};
    clusters[t].scenarios.push(s);
  }
  const sorted=Object.values(clusters).sort((a,b)=>b.scenarios.length-a.scenarios.length);
  const total=failed.length;
  return sorted.map(c=>{
    const pct=Math.round(c.scenarios.length/total*100);
    return `<div class="card" style="border-left:3px solid ${c.color};margin-bottom:12px;transition:box-shadow var(--t2)">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <div style="min-width:52px;height:52px;border-radius:var(--radius-sm);background:${c.color}18;border:1px solid ${c.color}35;display:flex;align-items:center;justify-content:center">
          <span style="font-size:26px;font-weight:900;color:${c.color}">${c.scenarios.length}</span>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;letter-spacing:-.1px">${e(c.label)}</div>
          <div style="font-size:11px;color:var(--text1);margin-top:3px">${e(c.fix)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:18px;font-weight:800;color:${c.color}">${pct}%</div>
          <div style="font-size:10px;color:var(--text2)">of failures</div>
        </div>
      </div>
      <div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:12px">
        <div style="height:100%;width:${pct}%;background:${c.color};border-radius:2px;transition:width 1s ease"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${c.scenarios.map(s=>`<span style="font-size:11px;background:var(--bg3);border:1px solid var(--border);padding:3px 9px;border-radius:12px;display:inline-flex;align-items:center;gap:5px">
          <span class="issue-key" style="font-size:10.5px">${e(s.issueKey)}</span>
          <span style="color:var(--text1)">${e(s.scenarioName.slice(0,38)+(s.scenarioName.length>38?'…':''))}</span>
        </span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// ─── Phase 8: Executive One-Pager ────────────────────────────────────────────
function buildExecutiveOnePager(m, rr, delta, runDate) {
  const ac=[];
  if((m.errorTypes||{}).AUTH_FAILURE)         ac.push({p:1,fix:'Refresh OrangeHRM auth: node scripts/manual-auth.js',effort:'10 min'});
  if((m.errorTypes||{}).LOCATOR_DRIFT)        ac.push({p:1,fix:'Run self-healing agent for locator repair',effort:'15 min'});
  if((m.errorTypes||{}).TIMEOUT)              ac.push({p:2,fix:'Increase CUCUMBER_STEP_TIMEOUT_MS',effort:'30 min'});
  if((m.errorTypes||{}).NAVIGATION_FAILURE)   ac.push({p:1,fix:'Verify TEST_BASE_URL connectivity',effort:'20 min'});
  if(!ac.length) ac.push({p:0,fix:'No actions required — all scenarios passed',effort:'–'});
  return `<div id="one-pager">
    <div class="op-header"><div><div class="op-title">OrangeHRM QA — Release Readiness Report</div><div class="op-date">${e(runDate)}</div></div>
      <button onclick="window.print()" style="background:var(--accent);border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer">🖨 Print</button></div>
    <div class="op-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;margin:16px 0">
      <div class="op-kpi"><div class="op-kpi-val" style="color:${rr.verdictColor}">${rr.score}</div><div class="op-kpi-lbl">Readiness Score</div></div>
      <div class="op-kpi"><div class="op-kpi-val" style="color:var(--pass)">${m.passed}</div><div class="op-kpi-lbl">Passed</div></div>
      <div class="op-kpi"><div class="op-kpi-val" style="color:var(--fail)">${m.failed}</div><div class="op-kpi-lbl">Failed</div></div>
      <div class="op-kpi"><div class="op-kpi-val">${m.passRate}%</div><div class="op-kpi-lbl">Pass Rate</div></div>
    </div>
    <div style="font-size:28px;font-weight:900;color:${rr.verdictColor};text-align:center;padding:16px;border:2px solid ${rr.verdictColor};border-radius:8px;margin-bottom:16px">${e(rr.verdict)}</div>
    <div class="two-col">
      <div><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text1);margin-bottom:8px">Top Risks</div>
        ${rr.risks.slice(0,4).map(r=>`<div style="font-size:13px;color:var(--skip);padding:4px 0">⚠ ${e(r)}</div>`).join('')||'<div style="color:var(--pass);font-size:13px">No release-blocking risks</div>'}
      </div>
      <div><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text1);margin-bottom:8px">Recommended Actions</div>
        ${ac.map((a,i)=>`<div style="display:flex;gap:8px;font-size:12px;padding:4px 0"><span style="color:var(--accent2);font-weight:700">#${a.p||i+1}</span><span style="flex:1">${e(a.fix)}</span><span style="color:var(--text2)">${e(a.effort)}</span></div>`).join('')}
      </div>
    </div>
    ${delta.available?`<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;font-size:13px">
      ${delta.newFailures.length?`<span style="color:var(--fail);margin-right:16px">🔴 ${delta.newFailures.length} new failure${delta.newFailures.length>1?'s':''} since last run</span>`:''}
      ${delta.resolved.length?`<span style="color:var(--pass)">✅ ${delta.resolved.length} resolved since last run</span>`:''}
    </div>`:''}
  </div>`;
}

// ─── Phase 9: Test Case Value ─────────────────────────────────────────────────
function buildTestCaseValue(scenarios) {
  const map={};
  for (const s of scenarios) {
    const k=s.issueKey; if(!map[k]) map[k]={issueKey:k,name:s.scenarioName,runs:0,fails:0,ms:0};
    map[k].runs++; if(s.status==='Fail') map[k].fails++; map[k].ms+=s.durationMs;
  }
  const entries=Object.values(map).map(e=>({...e,failRate:e.runs?Math.round(e.fails/e.runs*100):0,avgMs:e.runs?Math.round(e.ms/e.runs):0}));
  const row=(arr,emptyMsg)=>arr.length?`<table class="data-table"><thead><tr><th>Jira Key</th><th>Scenario</th><th>Fail Rate</th><th>Avg Duration</th></tr></thead><tbody>
    ${arr.map(r=>`<tr class="${r.fails>0?'fail':'pass'}-row"><td><code class="issue-key">${e(r.issueKey)}</code></td><td style="font-size:12px">${e(r.name.slice(0,50))}</td>
      <td><span class="badge ${r.failRate===0?'pass':r.failRate<50?'skip':'fail'}">${r.failRate}%</span></td><td>${fmtD(r.avgMs)}</td></tr>`).join('')}
  </tbody></table>`:`<div class="empty-state">${emptyMsg}</div>`;
  return `<div class="two-col" style="margin-bottom:16px">
    <div class="card"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Most Stable (Highest Value)</div>${row([...entries].filter(r=>r.issueKey!=='–').sort((a,b)=>a.failRate-b.failRate).slice(0,5),'No Jira-linked scenarios')}</div>
    <div class="card"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Most Frequently Failing</div>${row([...entries].sort((a,b)=>b.fails-a.fails).slice(0,5),'No failures')}</div>
  </div>
  <div class="card"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Longest Running</div>${row([...entries].sort((a,b)=>b.avgMs-a.avgMs).slice(0,8),'No data')}</div>`;
}

// ─── Phase 10: AI Actions ─────────────────────────────────────────────────────
function buildAiActions(scenarios, BIZ_MAP, getAppStage) {
  const APP_STAGES=['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const failed=scenarios.filter(s=>s.status==='Fail');
  if(!failed.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:24px">✅</div><div style="color:var(--pass);font-weight:700;margin-top:8px">No Actions Required</div></div>`;
  const getBiz=s=>{const st=APP_STAGES.find(x=>s.featureName.toLowerCase().includes(x.toLowerCase())||s.scenarioName.toLowerCase().includes(x.toLowerCase()))||'Directory';return BIZ_MAP[st]||BIZ_MAP.Directory;};
  return [...failed].sort((a,b)=>a.errorClassification.priority-b.errorClassification.priority).map((s,i)=>{
    const ec=s.errorClassification, bc=getBiz(s);
    const ic={CRITICAL:'var(--fail)',HIGH:'var(--skip)',MEDIUM:'var(--info)',LOW:'var(--pass)'}[bc.impact]||'var(--text1)';
    return `<div class="action-card" style="border-left-color:${i<2?'var(--fail)':'var(--accent)'}">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div style="min-width:28px;height:28px;background:${i<2?'var(--fail)':'var(--accent)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff">${ec.priority}</div>
        <div style="flex:1;font-size:13px;font-weight:600">${e(ec.fix)}</div>
      </div>
      <div style="font-size:12px;color:var(--text1);margin-bottom:8px">${e(s.scenarioName)} · <span class="issue-key">${e(s.issueKey)}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text1)">
        <span>⚠ <strong>${e(ec.type)}</strong></span><span>🎯 <strong>${ec.confidence}%</strong> confidence</span>
        <span>⏱ <strong>${e(ec.effort)}</strong></span><span>👤 <strong>${e(ec.owner)}</strong></span>
        <span style="color:${ic}">📊 <strong>${e(bc.impact)}</strong> impact</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Story Mode HTML ──────────────────────────────────────────────────────────
function buildStoryHtml(scenarios, m, runDate, buildStyles) {
  const APP_STAGES=['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const icons={Dashboard:'📊',Admin:'🛠️',PIM:'👤',Leave:'🌴',Time:'⏱️',Recruitment:'📋',Performance:'🏆',Directory:'📇'};
  const stageMap={};
  for (const st of APP_STAGES) stageMap[st]=[];
  for (const s of scenarios) {
    const matched=APP_STAGES.find(st=>s.featureName.toLowerCase().includes(st.toLowerCase())||s.scenarioName.toLowerCase().includes(st.toLowerCase()))||'Directory';
    stageMap[matched].push(s);
  }
  const stages=APP_STAGES.filter(st=>stageMap[st].length).map(st=>{
    const scs=stageMap[st], allPass=scs.every(s=>s.status==='Pass');
    return `<div class="story-stage">
      <div class="story-stage-header"><div class="story-stage-icon">${icons[st]||'●'}</div>
        <div><div class="story-stage-name">${st}</div>
          <div style="font-size:12px;color:${allPass?'var(--pass)':'var(--skip)'};margin-top:2px">${allPass?'Demonstrated Successfully':'Demonstration In Progress'} · ${scs.length} workflow${scs.length>1?'s':''}</div>
        </div></div>
      ${scs.map(s=>`<div class="story-scenario"><div style="font-size:14px;font-weight:600;color:var(--text0);margin-bottom:10px">${e(s.scenarioName)}</div>
        ${s.screenshots.length?`<div class="story-filmstrip">${s.screenshots.map((sc,i)=>`<div class="story-frame"><img src="${sc.dataUrl}" alt="${e(sc.label)}" onclick="openLightbox(this)" loading="lazy"><div style="font-size:10px;color:var(--text1);margin-top:4px">${i+1}. ${e(sc.label)}</div></div>`).join('')}</div>`:'<div style="font-size:12px;color:var(--text2);font-style:italic">No screenshots available</div>'}
        ${s.videoSrc?`<div style="margin-top:12px"><video controls preload="metadata" style="width:100%;max-height:200px;border-radius:6px"><source src="${e(s.videoSrc)}" type="video/webm"></video></div>`:''}
      </div>`).join('')}
    </div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrangeHRM — Platform Demonstration</title>${buildStyles()}</head>
<body data-theme="dark" data-mode="client-demo">
<div style="max-width:960px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;padding:40px 0 32px;border-bottom:1px solid var(--border);margin-bottom:32px">
    <div style="font-size:12px;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Platform Demonstration</div>
    <div style="font-size:36px;font-weight:900;color:var(--text0)">OrangeHRM</div>
    <div style="font-size:16px;color:var(--text1);margin-top:8px">End-to-End Business Workflow Validation</div>
    <div style="margin-top:16px;display:flex;gap:20px;justify-content:center;font-size:13px;color:var(--text1)">
      <span>📅 ${e(runDate)}</span><span style="color:var(--pass)">✅ ${m.passed} workflows demonstrated</span>
      ${m.failed?`<span style="color:var(--skip)">⚠ ${m.failed} in progress</span>`:''}
    </div>
  </div>
  ${stages}
</div>
<div id="lightbox"><button id="lightbox-close">✕</button><img id="lightbox-img" src="" alt="Screenshot"></div>
<script>(function(){const lb=document.getElementById('lightbox'),lbi=document.getElementById('lightbox-img');window.openLightbox=img=>{lbi.src=img.src;lb.classList.add('open');};document.getElementById('lightbox-close').addEventListener('click',()=>lb.classList.remove('open'));lb.addEventListener('click',ev=>{if(ev.target===lb)lb.classList.remove('open');});document.addEventListener('keydown',ev=>{if(ev.key==='Escape')lb.classList.remove('open');});}());</script>
</body></html>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
function buildStyles() {
  return `<style>
/* ═══════════════════════════════════════════════════════════
   ENTERPRISE DESIGN SYSTEM — OrangeHRM QA Platform
   ═══════════════════════════════════════════════════════════ */
:root{
  /* Backgrounds — layered depth */
  --bg0:#070c14;--bg1:#0d1421;--bg2:#131d2e;--bg3:#1a2740;--bg4:#22334f;
  /* Borders */
  --border:#1e2d45;--border2:#2a3f60;--border-hi:#3d6099;
  /* Text */
  --text0:#dce8f8;--text1:#7a90b0;--text2:#4a5f7a;--text3:#2e3e54;
  /* Accents */
  --accent:#2563eb;--accent2:#60a5fa;--accent-glow:rgba(37,99,235,.18);
  /* Semantic status */
  --pass:#22c55e;--pass-bg:rgba(34,197,94,.1);--pass-border:rgba(34,197,94,.28);
  --fail:#f87171;--fail-bg:rgba(248,113,113,.1);--fail-border:rgba(248,113,113,.28);
  --skip:#fbbf24;--skip-bg:rgba(251,191,36,.1);--skip-border:rgba(251,191,36,.28);
  --info:#60a5fa;--info-bg:rgba(96,165,250,.1);--info-border:rgba(96,165,250,.28);
  /* Layout */
  --sidebar-w:252px;--header-h:60px;--radius:10px;--radius-sm:6px;--radius-lg:16px;
  /* Shadows */
  --shadow-xs:0 1px 3px rgba(0,0,0,.6);
  --shadow-sm:0 2px 8px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.03);
  --shadow-md:0 4px 20px rgba(0,0,0,.5);
  --shadow-lg:0 8px 40px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03);
  --shadow-accent:0 0 24px rgba(37,99,235,.3);
  /* Transitions */
  --t1:120ms ease;--t2:220ms ease;--t3:380ms ease;
}
[data-theme="light"]{
  --bg0:#eef2f8;--bg1:#ffffff;--bg2:#f4f7fd;--bg3:#e8edf8;--bg4:#dde4f5;
  --border:#ccd6eb;--border2:#b8c6df;--border-hi:#5b8dd9;
  --text0:#1a2540;--text1:#4a5f80;--text2:#7a90a8;--text3:#aabbcc;
  --shadow-xs:0 1px 3px rgba(0,0,0,.1);
  --shadow-sm:0 2px 8px rgba(0,0,0,.08);
  --shadow-md:0 4px 16px rgba(0,0,0,.1);
  --shadow-lg:0 8px 32px rgba(0,0,0,.12);
}

/* ── Reset & Base ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif;background:var(--bg0);color:var(--text0);min-height:100vh;font-size:14px;-webkit-font-smoothing:antialiased;}

/* ── Keyframes ────────────────────────────────────────── */
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes ring-draw{from{stroke-dashoffset:var(--ring-full)}to{stroke-dashoffset:var(--ring-gap)}}
@keyframes count-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
@keyframes slide-in-right{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}

/* ── View Modes ───────────────────────────────────────── */
[data-mode="executive"] .technical-only,[data-mode="executive"] .forensic-only,[data-mode="executive"] .raw-error-block{display:none!important;}
[data-mode="client-demo"] .technical-only,[data-mode="client-demo"] .forensic-only,[data-mode="client-demo"] .raw-error-block,[data-mode="client-demo"] .qa-only{display:none!important;}
[data-mode="qalead"] .forensic-only{display:none!important;}

/* ── App Layout ───────────────────────────────────────── */
#app{display:grid;grid-template-rows:var(--header-h) 1fr;grid-template-columns:var(--sidebar-w) 1fr;min-height:100vh;}

/* ── Header ───────────────────────────────────────────── */
#header{
  grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:0 24px;
  background:var(--bg1);border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:200;
  box-shadow:0 1px 0 var(--border),0 2px 12px rgba(0,0,0,.4);
  backdrop-filter:blur(12px);
}
.hdr-brand{display:flex;align-items:center;gap:10px;}
.hdr-logo-mark{
  width:30px;height:30px;border-radius:7px;
  background:linear-gradient(135deg,#2563eb,#7c3aed);
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:900;color:#fff;letter-spacing:-.5px;
  box-shadow:0 2px 8px rgba(37,99,235,.4);flex-shrink:0;
}
.hdr-logo{font-weight:700;font-size:15px;letter-spacing:-.2px;}
.hdr-logo span{color:var(--accent2);}
.hdr-sep{width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;}
.hdr-run-info{font-size:12px;color:var(--text1);}
.hdr-kpis{display:flex;gap:2px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:3px;overflow:hidden;}
.hdr-kpi{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:12px;cursor:default;}
.hdr-kpi-val{font-weight:700;font-size:13px;}
.hdr-kpi-val.pass{color:var(--pass);} .hdr-kpi-val.fail{color:var(--fail);} .hdr-kpi-val.skip{color:var(--skip);}
.hdr-spacer{flex:1;}
.mode-selector{display:flex;background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;padding:3px;gap:2px;}
.mode-btn{background:none;border:none;color:var(--text1);padding:4px 11px;cursor:pointer;font-size:11px;font-weight:500;border-radius:5px;transition:all var(--t1);white-space:nowrap;}
.mode-btn.active{background:var(--accent);color:#fff;box-shadow:0 1px 4px rgba(37,99,235,.4);}
.mode-btn:hover:not(.active){background:var(--bg3);color:var(--text0);}
.theme-btn{
  background:var(--bg2);border:1px solid var(--border);border-radius:8px;
  color:var(--text1);padding:6px 10px;cursor:pointer;font-size:13px;
  transition:all var(--t1);flex-shrink:0;
}
.theme-btn:hover{border-color:var(--border2);color:var(--text0);}

/* ── Sidebar ──────────────────────────────────────────── */
#sidebar{
  background:var(--bg1);border-right:1px solid var(--border);
  position:sticky;top:var(--header-h);height:calc(100vh - var(--header-h));
  overflow-y:auto;padding:12px 0 24px;
  scrollbar-width:thin;scrollbar-color:var(--border) transparent;
}
#sidebar::-webkit-scrollbar{width:4px;}
#sidebar::-webkit-scrollbar-track{background:transparent;}
#sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
.nav-group-label{
  font-size:9.5px;font-weight:700;color:var(--text2);
  text-transform:uppercase;letter-spacing:1px;
  padding:14px 16px 5px;margin-top:4px;
}
.nav-group-label:first-child{margin-top:0;}
.nav-link{
  display:flex;align-items:center;gap:9px;padding:6px 12px 6px 16px;
  color:var(--text1);text-decoration:none;font-size:12.5px;
  border-left:2px solid transparent;cursor:pointer;
  transition:color var(--t1),background var(--t1),border-color var(--t1);
  border-radius:0 6px 6px 0;margin-right:8px;
}
.nav-link:hover{color:var(--text0);background:var(--bg2);}
.nav-link.active{
  color:var(--accent2);border-left-color:var(--accent2);
  background:linear-gradient(90deg,rgba(37,99,235,.1),rgba(37,99,235,.04));
  font-weight:500;
}
.nav-icon{font-size:13px;flex-shrink:0;width:16px;text-align:center;}
.nav-badge{
  margin-left:auto;background:var(--bg3);border:1px solid var(--border);
  color:var(--text2);font-size:9.5px;font-weight:600;
  padding:1px 6px;border-radius:10px;flex-shrink:0;
}
.nav-badge.fail{background:var(--fail-bg);border-color:var(--fail-border);color:var(--fail);}
.nav-badge.pass{background:var(--pass-bg);border-color:var(--pass-border);color:var(--pass);}
.nav-badge.warn{background:var(--skip-bg);border-color:var(--skip-border);color:var(--skip);}

/* ── Main Content ─────────────────────────────────────── */
#main{padding:28px 32px;overflow-x:hidden;}

/* ── Sections ─────────────────────────────────────────── */
.section{margin-bottom:40px;scroll-margin-top:calc(var(--header-h) + 12px);}
.section.animate-in{animation:fadeUp .35s ease both;}
.section-header{
  display:flex;align-items:flex-start;gap:12px;margin-bottom:20px;
  padding-bottom:14px;border-bottom:1px solid var(--border);
  position:relative;
}
.section-header::before{
  content:'';position:absolute;bottom:-1px;left:0;width:40px;height:2px;
  background:linear-gradient(90deg,var(--accent),var(--accent2));
  border-radius:2px;
}
.section-title{font-size:17px;font-weight:700;letter-spacing:-.3px;line-height:1.3;}
.section-subtitle{font-size:12px;color:var(--text1);margin-top:3px;line-height:1.4;}
.section-header-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0;}

/* ── Cards ────────────────────────────────────────────── */
.card{
  background:var(--bg1);border:1px solid var(--border);
  border-radius:var(--radius);padding:18px;
  box-shadow:var(--shadow-sm);
  transition:border-color var(--t2),box-shadow var(--t2);
}
.card:hover{border-color:var(--border2);}
.card-glass{
  background:linear-gradient(135deg,rgba(255,255,255,.03),rgba(255,255,255,0));
  backdrop-filter:blur(8px);
}
.card-accent{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),var(--shadow-accent);}
.card-pass{border-left:3px solid var(--pass);}
.card-fail{border-left:3px solid var(--fail);}
.card-warn{border-left:3px solid var(--skip);}
.card-grid{display:grid;gap:14px;}
.card-grid-5{grid-template-columns:repeat(5,1fr);}
.card-grid-4{grid-template-columns:repeat(4,1fr);}
.card-grid-3{grid-template-columns:repeat(3,1fr);}
.card-grid-2{grid-template-columns:repeat(2,1fr);}

/* ── KPI / Stat Cards ─────────────────────────────────── */
.stat-big{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}
.stat-val{font-size:36px;font-weight:800;line-height:1;letter-spacing:-.5px;animation:count-in .4s ease both;}
.stat-lbl{font-size:10.5px;color:var(--text1);margin-top:5px;text-transform:uppercase;letter-spacing:.6px;}
.stat-val.pass{color:var(--pass);} .stat-val.fail{color:var(--fail);} .stat-val.info{color:var(--info);} .stat-val.warn{color:var(--skip);}

/* ── KPI Rings ────────────────────────────────────────── */
.kpi-grid{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:10px 0;}
.kpi-ring{display:flex;flex-direction:column;align-items:center;gap:5px;}
.kpi-ring svg circle:last-child{animation:ring-draw 1.2s ease both;}
.kpi-label{font-size:10.5px;color:var(--text1);text-align:center;max-width:88px;line-height:1.3;}

/* ── Health Number ────────────────────────────────────── */
.health-num{font-size:56px;font-weight:900;line-height:1;letter-spacing:-2px;}
.health-num.green{color:var(--pass);} .health-num.yellow{color:var(--skip);} .health-num.red{color:var(--fail);}

/* ── Donut Chart ──────────────────────────────────────── */
.donut-wrap{display:flex;align-items:center;gap:20px;}
.donut{width:120px;height:120px;border-radius:50%;position:relative;}
.donut-hole{position:absolute;inset:16px;border-radius:50%;background:var(--bg1);display:flex;flex-direction:column;align-items:center;justify-content:center;}
.donut-pct{font-size:18px;font-weight:800;color:var(--pass);} .donut-sub{font-size:10px;color:var(--text1);}
.donut-legend{display:flex;flex-direction:column;gap:7px;}
.dl-row{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text1);}
.dl-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.dl-dot.pass{background:var(--pass);} .dl-dot.fail{background:var(--fail);} .dl-dot.skip{background:var(--skip);}
.donut-empty{color:var(--text2);font-size:13px;padding:20px;}

/* ── Badges ───────────────────────────────────────────── */
.badge{display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.1px;}
.badge.pass{background:var(--pass-bg);color:var(--pass);border:1px solid var(--pass-border);}
.badge.fail{background:var(--fail-bg);color:var(--fail);border:1px solid var(--fail-border);}
.badge.skip{background:var(--skip-bg);color:var(--skip);border:1px solid var(--skip-border);}
.badge.info{background:var(--info-bg);color:var(--info);border:1px solid var(--info-border);}

/* ── Data Tables ──────────────────────────────────────── */
.data-table{width:100%;border-collapse:collapse;font-size:13px;}
.data-table th{background:var(--bg2);color:var(--text1);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;padding:9px 13px;border-bottom:1px solid var(--border);text-align:left;}
.data-table td{padding:9px 13px;border-bottom:1px solid var(--border);vertical-align:top;}
.data-table tbody tr:hover{background:var(--bg2);}
.data-table tr.fail-row td:first-child{border-left:3px solid var(--fail);}
.data-table tr.pass-row td:first-child{border-left:3px solid var(--pass);}

/* ── Jira Key ──────────────────────────────────────────── */
.issue-key{color:var(--info);font-family:'SF Mono',Consolas,monospace;font-size:11.5px;letter-spacing:.2px;}

/* ── HR Module Pipeline ─────────────────────────────────────── */
.hr-pipeline{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding-bottom:8px;}
.hr-stage{
  flex:1;min-width:90px;background:var(--bg2);border:1px solid var(--border);
  border-right:none;padding:12px 8px;cursor:pointer;transition:background var(--t1),box-shadow var(--t1);text-align:center;
}
.hr-stage:first-child{border-radius:var(--radius) 0 0 var(--radius);}
.hr-stage:last-child{border-right:1px solid var(--border);border-radius:0 var(--radius) var(--radius) 0;}
.hr-stage:hover{background:var(--bg3);box-shadow:inset 0 0 0 1px var(--border2);}
.pass-stage{border-top:3px solid var(--pass);}
.fail-stage{border-top:3px solid var(--fail);}
.empty-stage{border-top:3px solid var(--border);}
.hr-stage-icon{font-size:18px;margin-bottom:4px;}
.hr-stage-name{font-weight:700;font-size:11.5px;}
.hr-stage-counts{font-size:10px;color:var(--text1);margin-top:3px;}
.hr-arrow{display:flex;align-items:center;color:var(--border2);font-size:16px;padding:0 2px;flex-shrink:0;}
.hr-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
.hr-modal.open{display:flex;}
.hr-modal-box{
  background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);
  padding:28px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;
  box-shadow:var(--shadow-lg);animation:fadeUp .2s ease;
}
.hr-modal-title{font-size:16px;font-weight:700;margin-bottom:16px;}
.hr-modal-close{float:right;background:none;border:none;color:var(--text1);cursor:pointer;font-size:18px;line-height:1;}

/* ── Evidence / Storyboard ───────────────────────────── */
.storyboard{overflow-x:auto;padding-bottom:8px;}
.filmstrip{display:flex;gap:12px;min-width:max-content;}
.frame{flex-shrink:0;width:180px;}
.frame-img{
  width:180px;height:112px;object-fit:cover;border-radius:6px;
  border:2px solid var(--border);cursor:pointer;
  transition:border-color var(--t1),transform var(--t1);
}
.frame-img:hover{border-color:var(--accent2);transform:scale(1.02);}
.frame-label{font-size:10px;color:var(--text1);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
.storyboard-scenario{margin-bottom:24px;}
.storyboard-scenario-title{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;font-weight:600;}
.video-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px;transition:border-color var(--t2);}
.video-card:hover{border-color:var(--border2);}
.video-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;}
.test-video{width:100%;max-height:360px;border-radius:4px;background:#000;}

/* ── Timeline ─────────────────────────────────────────── */
.timeline{position:relative;padding-left:28px;}
.timeline::before{content:'';position:absolute;left:9px;top:6px;bottom:6px;width:2px;background:linear-gradient(to bottom,var(--border),var(--border2),var(--border));}
.tl-node{position:relative;margin-bottom:12px;}
.tl-dot{position:absolute;left:-24px;top:5px;width:12px;height:12px;border-radius:50%;border:2px solid var(--bg1);box-shadow:0 0 0 2px var(--border);}
.tl-dot.pass{background:var(--pass);box-shadow:0 0 0 2px rgba(34,197,94,.3);}
.tl-dot.fail{background:var(--fail);box-shadow:0 0 0 2px rgba(248,113,113,.3);}
.tl-dot.skip{background:var(--skip);}
.tl-content{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;transition:border-color var(--t1);}
.tl-content:hover{border-color:var(--border2);}
.tl-name{font-size:13px;font-weight:600;}
.tl-meta{font-size:11px;color:var(--text1);margin-top:3px;}

/* ── Root Cause Cards ─────────────────────────────────── */
.rc-card{background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--fail);border-radius:var(--radius);padding:16px;margin-bottom:12px;transition:border-color var(--t1);}
.rc-card:hover{border-color:var(--border2);}
.rc-type{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--fail);margin-bottom:6px;}
.rc-scenario{font-size:13px;font-weight:600;margin-bottom:6px;}
.rc-fix{font-size:12px;color:var(--info);margin-top:8px;padding-left:20px;position:relative;}
.rc-fix::before{content:'💡';position:absolute;left:0;}

/* ── Healing ──────────────────────────────────────────── */
.healing-event{
  background:var(--bg2);border:1px solid var(--border);
  border-left:3px solid #22c55e;border-radius:var(--radius);
  padding:12px 16px;margin-bottom:8px;
  transition:border-color var(--t1);
}
.healing-event:hover{border-color:var(--border2);}
.healing-agent{font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:.5px;}
.healing-time{font-size:11px;color:var(--text2);margin-top:2px;}
.healing-empty{color:var(--text2);font-size:13px;font-style:italic;padding:24px;text-align:center;}

/* ── Traceability Chain ───────────────────────────────── */
.trace-chain{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:12px;}
.trace-node{background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:3px 8px;transition:border-color var(--t1);}
.trace-node.issue{border-color:var(--info-border);color:var(--info);}
.trace-node.pass{border-color:var(--pass-border);color:var(--pass);}
.trace-node.fail{border-color:var(--fail-border);color:var(--fail);}
.trace-sep{color:var(--text2);padding:0 2px;}
.trace-row{border-bottom:1px solid var(--border);transition:background var(--t1);}
.trace-row:hover{background:var(--bg2);}

/* ── Scenario Detail Cards ────────────────────────────── */
.scenario-card{background:var(--bg1);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;transition:border-color var(--t2);}
.scenario-card:hover{border-color:var(--border2);}
.scenario-card.fail-card{border-left:3px solid var(--fail);}
.scenario-card.pass-card{border-left:3px solid var(--pass);}
.scenario-summary{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;user-select:none;transition:background var(--t1);}
.scenario-summary:hover{background:var(--bg2);}
.sc-issue{font-family:'SF Mono',Consolas,monospace;font-size:11.5px;color:var(--info);flex-shrink:0;}
.sc-name{flex:1;font-size:13px;font-weight:600;}
.sc-dur{font-size:11.5px;color:var(--text1);flex-shrink:0;}
.sc-toggle{color:var(--text2);font-size:12px;transition:transform var(--t2);}
.sc-toggle.open{transform:rotate(180deg);}
.scenario-body{display:none;padding:0 16px 16px;border-top:1px solid var(--border);}
.scenario-body.open{display:block;animation:fadeIn .2s ease;}
.step-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.03);font-size:12px;}
.step-kw{color:var(--info);font-weight:600;flex-shrink:0;}
.step-name{flex:1;}
.step-dur{color:var(--text2);font-family:'SF Mono',Consolas,monospace;font-size:11px;flex-shrink:0;}
.step-err{
  background:var(--fail-bg);border:1px solid var(--fail-border);border-radius:5px;
  padding:10px;margin:4px 0;font-family:'SF Mono',Consolas,monospace;
  font-size:11px;color:var(--fail);white-space:pre-wrap;word-break:break-all;
  max-height:160px;overflow-y:auto;
}

/* ── Inline Screenshots ───────────────────────────────── */
.inline-shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.inline-shot{width:140px;}
.inline-shot img{
  width:140px;height:88px;object-fit:cover;border-radius:5px;
  border:2px solid var(--border);cursor:pointer;
  transition:border-color var(--t1),transform var(--t1);
}
.inline-shot img:hover{border-color:var(--accent2);transform:scale(1.03);}
.inline-shot-label{font-size:10px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;}

/* ── Performance Bars ─────────────────────────────────── */
.perf-bar-wrap{margin-bottom:11px;}
.perf-bar-label{display:flex;justify-content:space-between;font-size:12px;color:var(--text1);margin-bottom:4px;}
.perf-bar-outer{height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;}
.perf-bar-inner{height:100%;border-radius:3px;background:var(--accent);transition:width 1.2s cubic-bezier(.22,.61,.36,1);}
.perf-bar-inner.warn{background:var(--skip);}
.perf-bar-inner.fail{background:var(--fail);}

/* ── Environment Grid ─────────────────────────────────── */
.env-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;}
.env-row{
  display:flex;gap:8px;background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;
  transition:border-color var(--t1);
}
.env-row:hover{border-color:var(--border2);}
.env-key{color:var(--info);font-family:'SF Mono',Consolas,monospace;flex-shrink:0;min-width:150px;}
.env-val{font-family:'SF Mono',Consolas,monospace;word-break:break-all;color:var(--text1);}

/* ── Two Column ───────────────────────────────────────── */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;}

/* ── Tags ─────────────────────────────────────────────── */
.tag{
  display:inline-block;background:var(--info-bg);border:1px solid var(--info-border);
  color:var(--info);font-size:10px;padding:2px 7px;border-radius:10px;
  margin:1px;font-family:'SF Mono',Consolas,monospace;
}

/* ── Empty State ──────────────────────────────────────── */
.empty-state{
  text-align:center;padding:44px 20px;color:var(--text2);font-size:13px;
  border:1px dashed var(--border);border-radius:var(--radius);
  background:linear-gradient(135deg,rgba(255,255,255,.01),transparent);
}

/* ── Action Cards ─────────────────────────────────────── */
.action-card{
  background:var(--bg2);border:1px solid var(--border);
  border-left:3px solid var(--accent);border-radius:var(--radius);
  padding:16px;margin-bottom:10px;transition:border-color var(--t2),box-shadow var(--t2);
}
.action-card:hover{border-color:var(--border2);box-shadow:var(--shadow-sm);}
.action-meta{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text1);}

/* ── One Pager ────────────────────────────────────────── */
#one-pager{background:var(--bg1);border:1px solid var(--border);border-radius:var(--radius);padding:28px;}
.op-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;}
.op-title{font-size:16px;font-weight:700;letter-spacing:-.2px;}
.op-date{font-size:12px;color:var(--text1);margin-top:4px;}
.op-grid{display:grid;gap:12px;}
.op-kpi{text-align:center;}
.op-kpi-val{font-size:28px;font-weight:800;letter-spacing:-.5px;}
.op-kpi-lbl{font-size:10.5px;color:var(--text1);text-transform:uppercase;letter-spacing:.6px;}

/* ── Story Mode ───────────────────────────────────────── */
.story-stage{margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--border);}
.story-stage-header{display:flex;align-items:center;gap:16px;margin-bottom:20px;}
.story-stage-icon{font-size:36px;}
.story-stage-name{font-size:20px;font-weight:800;letter-spacing:-.3px;}
.story-scenario{margin-bottom:20px;}
.story-filmstrip{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;}
.story-frame{flex-shrink:0;width:200px;}
.story-frame img{
  width:200px;height:125px;object-fit:cover;border-radius:7px;
  border:2px solid var(--border);cursor:pointer;transition:border-color var(--t1),transform var(--t1);
}
.story-frame img:hover{border-color:var(--accent2);transform:scale(1.02);}

/* ── Lightbox ─────────────────────────────────────────── */
#lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:2000;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
#lightbox.open{display:flex;animation:fadeIn .18s ease;}
#lightbox img{max-width:95vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);}
#lightbox-close{
  position:absolute;top:16px;right:20px;font-size:26px;color:rgba(255,255,255,.8);
  cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
  border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  transition:all var(--t1);
}
#lightbox-close:hover{background:rgba(255,255,255,.15);color:#fff;}

/* ── Skeleton Loader ──────────────────────────────────── */
.skeleton{
  background:linear-gradient(90deg,var(--bg2) 0%,var(--bg3) 50%,var(--bg2) 100%);
  background-size:400% 100%;animation:shimmer 1.6s ease-in-out infinite;
  border-radius:4px;
}

/* ── Status Dot ───────────────────────────────────────── */
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.status-dot.pass{background:var(--pass);box-shadow:0 0 6px var(--pass);}
.status-dot.fail{background:var(--fail);box-shadow:0 0 6px var(--fail);animation:pulse-dot 2s ease infinite;}
.status-dot.warn{background:var(--skip);}

/* ── Responsive ───────────────────────────────────────── */
@media print{
  #app{display:block;}#sidebar{display:none;}#header{display:none;}
  #main>*:not(#sec-onepager){display:none;}#one-pager{border:none;}
  body{background:#fff;color:#000;}
}
@media(max-width:1100px){
  :root{--sidebar-w:220px;}
}
@media(max-width:960px){
  #app{grid-template-columns:1fr;}
  #sidebar{display:none;}
  .card-grid-4{grid-template-columns:repeat(2,1fr);}
  .two-col{grid-template-columns:1fr;}
  #main{padding:20px 16px;}
}
@media(max-width:600px){
  .card-grid-5,.card-grid-4,.card-grid-3,.card-grid-2{grid-template-columns:1fr;}
}
/* ── Information Architecture ─────────────────────────── */
/* Persona nav filtering */
body[data-persona="cto"] .nav-l2,body[data-persona="cto"] .nav-l3,body[data-persona="cto"] .nav-l4{display:none!important;}
body[data-persona="qa-director"] .nav-l3,body[data-persona="qa-director"] .nav-l4{display:none!important;}
body[data-persona="eng-manager"] .nav-l4{display:none!important;}
/* Persona section filtering via JS-assigned data-level */
body[data-persona="cto"] [data-level="2"],body[data-persona="cto"] [data-level="3"],body[data-persona="cto"] [data-level="4"]{display:none!important;}
body[data-persona="qa-director"] [data-level="3"],body[data-persona="qa-director"] [data-level="4"]{display:none!important;}
body[data-persona="eng-manager"] [data-level="4"]{display:none!important;}
/* Center dividers */
.center-start{display:flex;align-items:center;gap:10px;margin:36px 0 20px;padding-top:24px;border-top:1px solid var(--border);}
.center-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text2);}
.center-persona-tag{font-size:9.5px;padding:2px 8px;border-radius:10px;border:1px solid var(--border2);color:var(--text2);background:var(--bg2);}
.center-sep{flex:1;height:1px;background:var(--border);}
/* Persona selector */
.persona-selector{display:flex;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:3px;gap:2px;}
.persona-btn{background:none;border:none;color:var(--text1);padding:4px 10px;cursor:pointer;font-size:11px;font-weight:500;border-radius:5px;transition:all var(--t1);white-space:nowrap;}
.persona-btn.active{background:var(--accent);color:#fff;}
.persona-btn:hover:not(.active){background:var(--bg3);color:var(--text0);}
/* Mission Control hero */
.mc-hero-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--radius);margin-bottom:20px;}
.mc-entry-card{padding:18px;cursor:pointer;transition:border-color var(--t2);}
.mc-entry-card:hover{border-color:var(--border-hi);}
.mc-entry-needs{font-size:11px;color:var(--text2);margin:3px 0;}
/* Level badge on section headers */
.level-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;padding:2px 7px;border-radius:10px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);}
.scroll-anchor{scroll-margin-top:calc(var(--header-h) + 8px);}
${buildIntelligenceStyles()}
${buildPhaseStyles()}
${buildPhaseStyles2()}
${buildExplainerStyles()}
${buildTrustDashboardStyles()}
</style>`;
}

// ─── JavaScript ───────────────────────────────────────────────────────────────
function buildScripts(scenarios, APP_STAGES, getAppStage) {
  const appData = JSON.stringify((() => {
    const map = {};
    for (const st of APP_STAGES) map[st] = [];
    for (const s of scenarios) {
      const matched = APP_STAGES.find(x => s.featureName.toLowerCase().includes(x.toLowerCase()) || s.scenarioName.toLowerCase().includes(x.toLowerCase())) || 'Directory';
      map[matched].push({ name: s.scenarioName, issue: s.issueKey, status: s.status });
    }
    return map;
  })());
  return `<script>
(function(){
  const body=document.body;
  // Persona switching + progressive disclosure
  const SECTION_LEVELS={'sec-home':1,'sec-release-ei':1,'sec-onepager':1,'sec-biz':1,'sec-narrative':1,'sec-exec-ei':1,'sec-mission':1,'sec-decision':1,
    'sec-release':2,'sec-exec':2,'sec-delta':2,'sec-trends':2,'sec-insights':2,'sec-modules':2,'sec-coverage':2,'sec-predict':2,'sec-command-center':2,'sec-trend-ei':2,'sec-trust-dashboard':2,'sec-truthfulness':2,'sec-standards':2,'sec-governance':2,'sec-remediation':2,
    'sec-clusters':3,'sec-ai-rca':3,'sec-heatmap':3,'sec-actions':3,'sec-fail-intel':3,'sec-ti-dashboard':3,'sec-timeline-ei':3,'sec-self-healing':3,'sec-defect-predictor':3,'sec-impact-analysis':3,'sec-prod-correlation':3,'sec-autonomous-agent':3,'sec-traceability-ei':3,'sec-req-risk':3,'sec-test-generator':3,'sec-rc':3,'sec-graph':3,
    'sec-scenarios':4,'sec-storyboard':4,'sec-video':4,'sec-journey':4,'sec-jira':4,'sec-perf':4,'sec-trace':4,'sec-intelligence':4,'sec-twin-ei':4,'sec-story-ei':4,'sec-env':4,'sec-twin':4,'sec-demo':4,'sec-portfolio':4,'sec-value':4,'sec-econ':4,'sec-healeff':4,'sec-envobs':4,'sec-healing':4
  };
  Object.entries(SECTION_LEVELS).forEach(([id,lv])=>{const el=document.getElementById(id);if(el)el.dataset.level=String(lv);});
  const PERSONA_MODE={'cto':'executive','qa-director':'executive','eng-manager':'qalead','qa-engineer':'architect'};
  window.setPersona=function(p){
    body.dataset.persona=p;
    body.dataset.mode=PERSONA_MODE[p]||'executive';
    document.querySelectorAll('.persona-btn').forEach(b=>b.classList.toggle('active',b.dataset.persona===p));
    localStorage.setItem('qa-persona',p);
  };
  document.querySelectorAll('.persona-btn').forEach(b=>b.addEventListener('click',function(){window.setPersona(this.dataset.persona);}));
  const sp=localStorage.getItem('qa-persona')||'qa-engineer';
  window.setPersona(sp);
  // Theme
  const tb=document.getElementById('theme-btn');
  if(tb) tb.addEventListener('click',function(){
    const l=body.dataset.theme!=='light';body.dataset.theme=l?'light':'dark';
    this.textContent=l?'🌙':'☀';localStorage.setItem('qa-theme',body.dataset.theme);
  });
  const st=localStorage.getItem('qa-theme')||'dark';body.dataset.theme=st;
  if(tb) tb.textContent=st==='light'?'🌙':'☀';
  // Nav scroll
  document.querySelectorAll('.nav-link[data-section]').forEach(l=>l.addEventListener('click',function(){
    document.getElementById(this.dataset.section)?.scrollIntoView({behavior:'smooth'});
    document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));
    this.classList.add('active');
  }));
  const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){const id=e.target.id;document.querySelectorAll('.nav-link').forEach(l=>l.classList.toggle('active',l.dataset.section===id));}}),{rootMargin:'-20% 0px -70% 0px'});
  document.querySelectorAll('.section[id]').forEach(s=>obs.observe(s));
  // Entrance animations
  const animObs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('animate-in');animObs.unobserve(e.target);}}),{threshold:.05});
  document.querySelectorAll('.section').forEach(s=>animObs.observe(s));
  // Animate perf bars on visibility
  const barObs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.querySelectorAll('.perf-bar-inner').forEach(b=>{const w=b.style.width;b.style.width='0';requestAnimationFrame(()=>requestAnimationFrame(()=>{b.style.width=w;}));});barObs.unobserve(e.target);}}),{threshold:.1});
  document.querySelectorAll('.card').forEach(c=>{if(c.querySelector('.perf-bar-inner'))barObs.observe(c);});
  // Scenario cards
  document.querySelectorAll('.scenario-summary').forEach(s=>s.addEventListener('click',function(){
    this.nextElementSibling.classList.toggle('open');
    this.querySelector('.sc-toggle').classList.toggle('open');
  }));
  // Lightbox
  const lb=document.getElementById('lightbox'),lbi=document.getElementById('lightbox-img');
  window.openLightbox=img=>{lbi.src=img.src;lb.classList.add('open');};
  document.getElementById('lightbox-close').addEventListener('click',()=>lb.classList.remove('open'));
  lb.addEventListener('click',ev=>{if(ev.target===lb)lb.classList.remove('open');});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape')lb.classList.remove('open');});
  // HR module modal
  const appData=${appData};
  const cm=document.getElementById('hr-modal'),cmt=document.getElementById('hr-modal-title'),cmb=document.getElementById('hr-modal-body');
  if(cm){document.querySelectorAll('.hr-stage[data-stage]').forEach(btn=>btn.addEventListener('click',function(){
    const st=this.dataset.stage,items=appData[st]||[];
    cmt.textContent=st+' Stage — Scenarios';
    cmb.innerHTML=!items.length?'<div class="empty-state">No scenarios mapped to this stage</div>':
      items.map(it=>'<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span class="badge '+(it.status==='Pass'?'pass':'fail')+'">'+it.status+'</span><span class="issue-key">'+it.issue+'</span><span style="font-size:13px">'+it.name+'</span></div>').join('');
    cm.classList.add('open');
  }));
  document.getElementById('hr-modal-close').addEventListener('click',()=>cm.classList.remove('open'));
  cm.addEventListener('click',ev=>{if(ev.target===cm)cm.classList.remove('open');});}
}());
</script>`;
}

// ─── Existing WI-044 section builders ────────────────────────────────────────
function buildExecutiveDashboard(m, runDate) {
  const hc=m.executionHealth>=80?'green':m.executionHealth>=60?'yellow':'red';
  const overall=Math.round(m.executionHealth*0.35+m.qualityConfidence*0.25+m.automationCoverage*0.15+m.evidenceCoverage*0.1+m.jiraSyncHealth*0.15);
  const grade=overall>=90?'EXCELLENT':overall>=75?'GOOD':overall>=60?'FAIR':'NEEDS ATTENTION';
  const gradeColor=overall>=90?'var(--pass)':overall>=75?'var(--info)':overall>=60?'var(--skip)':'var(--fail)';
  const rings=[
    svgRing(m.executionHealth,'#22c55e','EXEC HEALTH',`${m.passed}/${m.total}`),
    svgRing(m.qualityConfidence,'#60a5fa','QUALITY CONF','Confidence'),
    svgRing(m.automationCoverage,'#a78bfa','AUTO COV',`${m.withTag} linked`),
    svgRing(m.evidenceCoverage,'#fb923c','EVIDENCE',`${m.withScreenshots} w/ SS`),
    svgRing(m.defectLeakageRisk,'#fbbf24','DEFECT RISK',`${m.failed} failures`),
    svgRing(m.healingScore,'#34d399','HEALING','Self-Heal'),
    svgRing(m.jiraSyncHealth,'#60a5fa','JIRA SYNC',`${m.withTag} synced`),
    svgRing(m.environmentReady,'#c084fc','ENV READY','Readiness'),
  ].join('');
  const kpiCard=(val,lbl,cls)=>`<div class="card stat-big" style="padding:16px 12px">
    <div class="stat-val ${cls}" style="font-size:32px">${val}</div>
    <div class="stat-lbl">${lbl}</div>
  </div>`;
  return `<div class="two-col" style="align-items:start">
    <div>
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px">
        <div style="text-align:center;padding:16px 20px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);min-width:110px">
          <div class="health-num ${hc}" style="font-size:48px">${overall}</div>
          <div style="font-size:10.5px;color:var(--text1);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Platform Health</div>
          <div style="display:inline-block;background:${gradeColor}18;border:1px solid ${gradeColor}30;color:${gradeColor};font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-top:6px;letter-spacing:.4px">${grade}</div>
        </div>
        ${donut(m.passed,m.failed,m.skipped,m.total)}
      </div>
      <div class="card-grid card-grid-4" style="gap:10px">
        ${kpiCard(m.total,'Total','info')}
        ${kpiCard(m.passed,'Passed','pass')}
        ${kpiCard(m.failed,'Failed','fail')}
        ${kpiCard(m.skipped,'Skipped','warn')}
      </div>
    </div>
    <div class="card" style="flex:1">
      <div style="font-size:10.5px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Quality KPI Rings</div>
      <div class="kpi-grid">${rings}</div>
    </div>
  </div>
  <div class="card" style="margin-top:14px;padding:12px 18px">
    <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--text1)">
      <span>Run: <strong style="color:var(--text0)">${e(runDate)}</strong></span>
      <span>Duration: <strong style="color:var(--text0)">${fmtD(m.totalDuration)}</strong></span>
      <span>Screenshots: <strong style="color:var(--text0)">${m.totalScreenshots}</strong></span>
      <span>Videos: <strong style="color:var(--text0)">${m.withVideo}</strong></span>
      <span>Jira Linked: <strong style="color:var(--text0)">${m.withTag}/${m.total}</strong></span>
      <span style="margin-left:auto">Mode: <strong style="color:var(--accent2);font-size:11px;text-transform:uppercase;letter-spacing:.4px">${e(REPORT_MODE)}</strong></span>
    </div>
  </div>`;
}
function buildTraceability(scenarios) {
  if(!scenarios.length) return '<div class="empty-state">No scenarios.</div>';
  return `<div class="card">${scenarios.map(s=>{const cls=s.status==='Pass'?'pass':s.status==='Fail'?'fail':'skip';
    return `<div class="trace-row" style="padding:10px 0"><div class="trace-chain">
      <span class="trace-node" style="color:var(--text1);font-size:11px">${e(s.featureName.slice(0,24))}</span><span class="trace-sep">›</span>
      <span class="trace-node">${e(s.scenarioName.slice(0,38))}</span><span class="trace-sep">›</span>
      <span class="trace-node issue">${e(s.issueKey)}</span><span class="trace-sep">›</span>
      <span class="trace-node ${cls}">${s.status}</span>
      ${s.screenshots.length?`<span class="trace-sep">·</span><span class="trace-node">${s.screenshots.length} SS</span>`:''}
      ${s.videoSrc?'<span class="trace-node">Video</span>':''}
      <span style="margin-left:auto;font-size:11px;color:var(--text2)">${fmtD(s.durationMs)}</span>
    </div></div>`; }).join('')}</div>`;
}
function buildAppPipeline(scenarios,APP_STAGES,getAppStage) {
  const icons={Dashboard:'📊',Admin:'🛠️',PIM:'👤',Leave:'🌴',Time:'⏱️',Recruitment:'📋',Performance:'🏆',Directory:'📇'};
  const sm={}; for(const st of APP_STAGES) sm[st]={pass:0,fail:0,total:0};
  for(const s of scenarios){const st=getAppStage(s);sm[st].total++;if(s.status==='Pass')sm[st].pass++;if(s.status==='Fail')sm[st].fail++;}
  const stages=APP_STAGES.map((st,i)=>{const d=sm[st];const cls=d.total===0?'empty-stage':d.fail>0?'fail-stage':'pass-stage';
    return `<div class="hr-stage ${cls}" data-stage="${e(st)}"><div class="hr-stage-icon">${icons[st]||'●'}</div><div class="hr-stage-name">${st}</div><div class="hr-stage-counts">${d.pass}P·${d.fail}F·${d.total}T</div></div>${i<APP_STAGES.length-1?'<div class="hr-arrow">›</div>':''}`;}).join('');
  return `<div class="card hr-pipeline">${stages}</div><div id="hr-modal" class="hr-modal"><div class="hr-modal-box"><button id="hr-modal-close" class="hr-modal-close">✕</button><div id="hr-modal-title" class="hr-modal-title"></div><div id="hr-modal-body"></div></div></div>`;
}
function buildExecutionJourney(scenarios){
  if(!scenarios.length) return '<div class="empty-state">No scenarios.</div>';
  let cum=0;const total=scenarios.reduce((a,s)=>a+s.durationMs,0)||1;
  return `<div class="card"><div class="timeline">${scenarios.map(s=>{const cls=s.status==='Pass'?'pass':s.status==='Fail'?'fail':'skip';const st=cum;cum+=s.durationMs;
    return `<div class="tl-node"><div class="tl-dot ${cls}"></div><div class="tl-content"><div style="display:flex;align-items:center;gap:8px"><span class="badge ${cls}">${s.status}</span><span class="tl-name">${e(s.scenarioName)}</span></div>
      <div class="tl-meta">+${fmtD(st)} · ${fmtD(s.durationMs)} · ${Math.round(s.durationMs/total*100)}% · <span class="issue-key">${e(s.issueKey)}</span></div></div></div>`; }).join('')}</div></div>`;
}
function buildStoryboard(scenarios){
  const ws=scenarios.filter(s=>s.screenshots.length>0);
  if(!ws.length) return '<div class="empty-state">No screenshots captured.</div>';
  return ws.map(s=>{const cls=s.status==='Pass'?'pass':'fail';
    return `<div class="storyboard-scenario"><div class="storyboard-scenario-title"><span class="badge ${cls}">${s.status}</span><span class="issue-key">${e(s.issueKey)}</span><span>${e(s.scenarioName)}</span><span style="color:var(--text2);font-size:11px">${s.screenshots.length} frames</span></div>
      <div class="storyboard"><div class="filmstrip">${s.screenshots.map((sc,i)=>`<div class="frame"><img class="frame-img" src="${sc.dataUrl}" alt="${e(sc.label)}" loading="lazy" onclick="openLightbox(this)"><div class="frame-label">${i+1}. ${e(sc.label)}</div></div>`).join('')}</div></div></div>`;}).join('');
}
function buildVideoIntelligence(scenarios){
  const wv=scenarios.filter(s=>s.videoSrc);
  if(!wv.length) return '<div class="empty-state">No videos. Run with SESSION_MODE=scenario CAPTURE_VIDEO=true.</div>';
  return wv.map(s=>{const cls=s.status==='Pass'?'pass':'fail';
    return `<div class="video-card"><div class="video-header"><span class="badge ${cls}">${s.status}</span><span class="issue-key">${e(s.issueKey)}</span><strong>${e(s.scenarioName)}</strong><span style="margin-left:auto;font-size:12px;color:var(--text1)">${fmtD(s.durationMs)}</span></div>
      <div style="padding:12px"><video class="test-video" controls preload="metadata"><source src="${e(s.videoSrc)}" type="video/webm"></video></div>
      ${s.steps.length?`<div style="padding:4px 16px 12px;display:flex;flex-wrap:wrap;gap:6px">${s.steps.map(st=>`<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg3);border:1px solid ${st.status==='failed'?'var(--fail)':'var(--border)'};color:${st.status==='failed'?'var(--fail)':'var(--text1)'}">${e(st.keyword)} ${e(st.name.slice(0,28))}</span>`).join('')}</div>`:''}</div>`;}).join('');
}
function buildRootCauseCenter(scenarios){
  const f=scenarios.filter(s=>s.status==='Fail');
  if(!f.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-size:24px">✅</div><div style="margin-top:8px;color:var(--pass);font-weight:700">No Failures</div></div>`;
  const bt={};for(const s of f){const t=s.errorClassification.type;if(!bt[t])bt[t]={ec:s.errorClassification,count:0};bt[t].count++;}
  const sum=Object.entries(bt).map(([,d])=>`<div class="card" style="display:flex;gap:12px;align-items:center;padding:12px 16px"><div style="font-size:22px;font-weight:900;color:var(--fail)">${d.count}</div><div><div style="font-size:12px;font-weight:700;color:var(--fail);text-transform:uppercase">${e(d.ec.label)}</div><div style="font-size:11px;color:var(--text1)">Conf: ${d.ec.confidence}%</div></div></div>`).join('');
  const cards=f.map(s=>`<div class="rc-card"><div class="rc-type">⚠ ${e(s.errorClassification.type)}</div><div class="rc-scenario">${e(s.scenarioName)}</div><span class="issue-key">${e(s.issueKey)}</span>
    ${s.errorMsg?`<div class="raw-error-block" style="background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:4px;padding:8px;margin-top:8px;font-family:monospace;font-size:11px;color:var(--fail);white-space:pre-wrap;word-break:break-all;max-height:100px;overflow-y:auto">${e(s.errorMsg.slice(0,400))}</div>`:''}
    <div class="rc-fix">${e(s.errorClassification.fix)}</div></div>`).join('');
  return `<div class="card-grid card-grid-4" style="margin-bottom:16px">${sum}</div>${cards}`;
}
function buildHealingCenter(hd){
  const ev=hd.events||[];
  if(!ev.length) return '<div class="healing-empty">No healing events recorded.<br>Self-healing agents activate on locator drift.</div>';
  return ev.map(ev2=>`<div class="healing-event"><div class="healing-agent">⚕ ${e(ev2.agent)}</div><div class="healing-time">${e(ev2.timestamp)}</div></div>`).join('');
}
function buildJiraIntelligence(scenarios, jiraBugs){
  const linked=scenarios.filter(s=>s.issueKey!=='–'),unlinked=scenarios.filter(s=>s.issueKey==='–');
  const bugs = (jiraBugs?.bugs||[]);
  const createdBugs = bugs.filter(b=>b.action==='created');
  const bugSummaryHtml = bugs.length ? `
  <div class="card" style="margin-bottom:16px;border-color:rgba(248,81,73,.35)">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--fail);font-weight:600;margin-bottom:12px">🐛 Auto-Created Bugs (WI-045)</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:${createdBugs.length?'12':'0'}px">
      <div style="display:flex;gap:6px;align-items:center"><span style="font-size:22px;font-weight:800;color:var(--fail)">${createdBugs.length}</span><span style="font-size:12px;color:var(--text1)">Created</span></div>
      <div style="display:flex;gap:6px;align-items:center"><span style="font-size:22px;font-weight:800;color:var(--skip)">${bugs.filter(b=>b.action==='commented').length}</span><span style="font-size:12px;color:var(--text1)">Recurrence</span></div>
      <div style="display:flex;gap:6px;align-items:center"><span style="font-size:22px;font-weight:800;color:var(--info)">${bugs.filter(b=>b.resultLinked).length}</span><span style="font-size:12px;color:var(--text1)">Result-Linked</span></div>
      <div style="display:flex;gap:6px;align-items:center"><span style="font-size:22px;font-weight:800;color:var(--info)">${bugs.filter(b=>b.testCaseLinked).length}</span><span style="font-size:12px;color:var(--text1)">TC-Linked</span></div>
    </div>
    ${createdBugs.length?`<table class="data-table" style="margin-top:4px"><thead><tr><th>Bug</th><th>Scenario</th><th>Category</th><th>Severity</th><th>Result</th><th>TC</th></tr></thead><tbody>
    ${createdBugs.map(b=>`<tr><td><code class="issue-key" style="color:var(--fail)">${e(b.bugKey)}</code></td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e((b.scenario||'').slice(0,60))}</td><td><span style="font-size:11px;color:var(--text1)">${e(b.classification?.category||'')}</span></td><td><span class="badge fail">${e(b.classification?.severity||'')}</span></td><td>${b.resultLinked?'<span style="color:var(--pass)">✓</span>':'<span style="color:var(--text2)">–</span>'}</td><td>${b.testCaseLinked?'<span style="color:var(--pass)">✓</span>':'<span style="color:var(--text2)">–</span>'}</td></tr>`).join('')}
    </tbody></table>`:''}
  </div>` : '';
  return `${bugSummaryHtml}<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <div class="card" style="padding:12px 20px;display:flex;gap:8px;align-items:center"><span style="font-size:24px;font-weight:800;color:var(--pass)">${linked.length}</span><span style="font-size:12px;color:var(--text1)">Jira-Linked</span></div>
    <div class="card" style="padding:12px 20px;display:flex;gap:8px;align-items:center"><span style="font-size:24px;font-weight:800;color:var(--skip)">${unlinked.length}</span><span style="font-size:12px;color:var(--text1)">Unlinked</span></div>
    <div class="card" style="padding:12px 20px;display:flex;gap:8px;align-items:center"><span style="font-size:24px;font-weight:800;color:var(--info)">${scenarios.length?Math.round(linked.length/scenarios.length*100):0}%</span><span style="font-size:12px;color:var(--text1)">Traceability</span></div>
  </div>
  ${linked.length?`<div class="card" style="overflow:auto"><table class="data-table"><thead><tr><th>Jira Key</th><th>Scenario</th><th>Status</th><th>Duration</th></tr></thead><tbody>
    ${linked.map(s=>`<tr class="${s.status==='Pass'?'pass':'fail'}-row"><td><code class="issue-key">${e(s.issueKey)}</code></td><td>${e(s.scenarioName)}</td><td><span class="badge ${s.status==='Pass'?'pass':'fail'}">${s.status}</span></td><td>${fmtD(s.durationMs)}</td></tr>`).join('')}</tbody></table></div>`:''}
  ${unlinked.length?`<div class="card" style="margin-top:14px;border-color:rgba(227,179,65,.3)"><div style="font-size:12px;color:var(--skip);font-weight:600;margin-bottom:8px">⚠ ${unlinked.length} unlinked</div>${unlinked.map(s=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);color:var(--text1)">${e(s.scenarioName)}</div>`).join('')}</div>`:''}`;
}
function buildPerformanceAnalytics(scenarios){
  if(!scenarios.length) return '<div class="empty-state">No data.</div>';
  const sorted=[...scenarios].sort((a,b)=>b.durationMs-a.durationMs),max=sorted[0]?.durationMs||1;
  const avg=scenarios.reduce((a,s)=>a+s.durationMs,0)/(scenarios.length||1);
  const p50=sorted[Math.floor(sorted.length*.5)]?.durationMs||0,p90=sorted[Math.floor(sorted.length*.9)]?.durationMs||0;
  return `<div class="card-grid card-grid-4" style="margin-bottom:16px">
    <div class="card stat-big"><div class="stat-val info">${fmtD(avg)}</div><div class="stat-lbl">Average</div></div>
    <div class="card stat-big"><div class="stat-val">${fmtD(p50)}</div><div class="stat-lbl">Median</div></div>
    <div class="card stat-big"><div class="stat-val warn">${fmtD(p90)}</div><div class="stat-lbl">p90</div></div>
    <div class="card stat-big"><div class="stat-val fail">${fmtD(max)}</div><div class="stat-lbl">Slowest</div></div>
  </div>
  <div class="card">${sorted.slice(0,15).map(s=>{const p=Math.round(s.durationMs/max*100);return `<div class="perf-bar-wrap"><div class="perf-bar-label"><span>${e(s.scenarioName.slice(0,50))}</span><span>${fmtD(s.durationMs)}</span></div><div class="perf-bar-outer"><div class="perf-bar-inner ${p>80?'fail':p>50?'warn':''}" style="width:${p}%"></div></div></div>`;}).join('')}</div>`;
}
function buildScenarioDetail(scenarios, bugByScenario){
  if(!scenarios.length) return '<div class="empty-state">No scenarios.</div>';
  const bMap = bugByScenario || {};
  return scenarios.map((s,idx)=>{const cls=s.status==='Pass'?'pass':s.status==='Fail'?'fail':'skip';const icon=s.status==='Pass'?'✓':s.status==='Fail'?'✗':'⊘';
    const steps=s.steps.map(st=>{const si=st.status==='passed'?'<span style="color:var(--pass)">✓</span>':st.status==='failed'?'<span style="color:var(--fail)">✗</span>':'<span style="color:var(--skip)">⊘</span>';
      return `<div class="step-row">${si}<span class="step-kw">${e(st.keyword)}</span><span class="step-name">${e(st.name)}</span><span class="step-dur">${fmtD(st.durationMs)}</span></div>${st.error?`<div class="step-err raw-error-block">${e(st.error.slice(0,800))}</div>`:''}`; }).join('');
    const shots=s.screenshots.length?`<div style="margin-top:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:8px">${s.screenshots.length} Screenshots</div><div class="inline-shots">${s.screenshots.map((sc,i)=>`<div class="inline-shot"><img src="${sc.dataUrl}" alt="${e(sc.label)}" loading="lazy" onclick="openLightbox(this)"><div class="inline-shot-label">${i+1}. ${e(sc.label)}</div></div>`).join('')}</div></div>`:'';
    const vid=s.videoSrc?`<div style="margin-top:14px"><video class="test-video" controls preload="metadata" style="max-height:240px"><source src="${e(s.videoSrc)}" type="video/webm"></video></div>`:'';
    const bug=bMap[s.scenarioName];
    const bugBadge=bug?`<span class="badge fail" style="font-size:10px;margin-left:6px;cursor:default" title="${e(bug.classification?.category||'')} · ${e(bug.classification?.severity||'')}">🐛 ${e(bug.bugKey)}</span>`:'';
    return `<div class="scenario-card ${cls}-card" id="sc-${idx}"><div class="scenario-summary"><span style="color:var(--${cls==='pass'?'pass':cls==='fail'?'fail':'skip'})">${icon}</span><span class="sc-issue">${e(s.issueKey)}</span><span class="sc-name">${e(s.scenarioName)}</span><span class="sc-dur">${fmtD(s.durationMs)}</span><span class="badge ${cls}">${s.status}</span>${bugBadge}<span class="sc-toggle">▾</span></div>
      <div class="scenario-body"><div style="font-size:11px;color:var(--text1);padding:10px 0 6px">${e(s.featureName)}</div>${steps?`<div style="margin-top:4px">${steps}</div>`:''}${shots}${vid}${bug?`<div style="margin-top:10px;padding:8px 12px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.25);border-radius:6px;font-size:11px"><span style="color:var(--fail);font-weight:600">🐛 Bug Filed: ${e(bug.bugKey)}</span> &nbsp;·&nbsp; <span style="color:var(--text1)">${e(bug.classification?.category||'')}</span> &nbsp;·&nbsp; <span style="color:var(--text1)">Severity: ${e(bug.classification?.severity||'')}</span>${bug.resultLinked?' &nbsp;·&nbsp; <span style="color:var(--pass)">Result linked ✓</span>':''}${bug.testCaseLinked?' &nbsp;·&nbsp; <span style="color:var(--pass)">TC linked ✓</span>':''}</div>`:''}
      </div></div>`;}).join('');
}
function buildEnvironment(){
  const ks=['TEST_BASE_URL','APP_BASE_URL','AUTH_MODE','SESSION_MODE','CAPTURE_VIDEO','PW_HEADLESS','CUCUMBER_STEP_TIMEOUT_MS','REPORT_MODE','AI_ENRICH_ENABLED','DOMAIN_MODE','JIRA_BASE_URL','JIRA_PROJECT_KEY','NODE_ENV','CI'];
  const rows=ks.map(k=>process.env[k]?`<div class="env-row"><span class="env-key">${e(k)}</span><span class="env-val">${e(process.env[k])}</span></div>`:'').filter(Boolean).join('');
  return `<div class="card"><div class="env-grid">${rows||'<div style="color:var(--text2)">No environment variables configured.</div>'}</div></div>`;
}

// ─── Main HTML assembler ──────────────────────────────────────────────────────
function buildHtml(scenarios, m, rr, delta, bizCaps, history, healingData, runDate, APP_STAGES, getAppStage, BIZ_MAP, wb44b) {
  const cmd = wb44b?.cmd || {};
  const healingEff = wb44b?.healingEff || { events:0, score:100, humanAssisted:0, promoted:0 };
  const envHealth  = wb44b?.envHealth  || { score:100, status:'OPERATIONAL', components:[] };
  const defectEcon = wb44b?.defectEcon || { automationHours:0, healingHours:0, scenariosPerHour:0, defectsCaught:0, executionMins:0, manualHoursSaved:0, roiSummary:'' };
  const prediction = wb44b?.prediction || { predictions:[], predictedPassRate:0, confidence:0, riskTrend:'→' };
  const jiraBugs    = wb44b?.jiraBugs      || { bugs: [], summary: {} };
  const lastSnapshot    = wb44b?.lastSnapshot    || [];
  const traceability    = wb44b?.traceability    || null;
  const clusterData     = wb44b?.clusterData     || null;
  const aiAnalysis      = wb44b?.aiAnalysis      || null;
  const releaseDecision = wb44b?.releaseDecision || null;
  const executive       = wb44b?.executive       || null;
  const trends          = wb44b?.trends          || null;
  const timelines       = wb44b?.timelines       || [];
  const twin            = wb44b?.twin            || null;
  const story           = wb44b?.story           || null;
  const healing         = wb44b?.healing         || null;
  const generated       = wb44b?.generated       || null;
  const reqRisk         = wb44b?.reqRisk         || null;
  const defectPrediction= wb44b?.defectPrediction|| null;
  const impact          = wb44b?.impact          || null;
  const commandCenter   = wb44b?.commandCenter   || null;
  const correlation      = wb44b?.correlation      || null;
  const agent            = wb44b?.agent            || null;
  const audit            = wb44b?.audit            || null;
  const metricRegistry   = wb44b?.metricRegistry   || null;
  const decisionRegistry = wb44b?.decisionRegistry || null;
  const dataLineage      = wb44b?.dataLineage      || null;
  const almValidation    = wb44b?.almValidation    || null;
  const traceCert        = wb44b?.traceCert        || null;
  const codingStandards       = wb44b?.codingStandards       || null;
  const governanceEnforcement = wb44b?.governanceEnforcement || null;
  const remediationPlan       = wb44b?.remediationPlan       || null;
  const bugByScenario = Object.fromEntries((jiraBugs.bugs||[]).filter(b=>b.bugKey).map(b=>[b.scenario, b]));
  const fc=m.failed;
  // ─── 6-Center Navigation (Persona-based IA) ──────────────────────────────────
  const trustScore = audit?.summary?.overallTrustworthiness ?? 0;
  const navGroups=[
    {label:'MISSION CONTROL', lv:1, links:[
      {id:'sec-home',    icon:'⌂', lbl:'Overview',          lv:1, badge:fc>0?{t:fc+' FAIL',c:'fail'}:null},
    ]},
    {label:'EXECUTIVE SUMMARY', lv:1, links:[
      {id:'sec-release-ei',icon:'🚦',lbl:'Release Decision',  lv:1, badge:null},
      {id:'sec-onepager',  icon:'□', lbl:'One-Pager',          lv:1, badge:null},
      {id:'sec-biz',       icon:'◈', lbl:'Business Impact',    lv:1, badge:null},
      {id:'sec-narrative', icon:'▷', lbl:'Executive Story',    lv:1, badge:null},
      {id:'sec-exec-ei',   icon:'▲', lbl:'Executive Intel',    lv:1, badge:null},
    ]},
    {label:'RELEASE READINESS', lv:2, links:[
      {id:'sec-release',  icon:'◉', lbl:'Readiness Score',  lv:2, badge:null},
      {id:'sec-exec',     icon:'⬡', lbl:'Health Dashboard', lv:2, badge:null},
      {id:'sec-delta',    icon:'⇄', lbl:'What Changed',     lv:2, badge:delta.newFailures?.length?{t:delta.newFailures.length,c:'fail'}:null},
      {id:'sec-trends',   icon:'↗', lbl:'Quality Trends',   lv:2, badge:null},
      {id:'sec-insights', icon:'◈', lbl:'Insights',         lv:2, badge:null},
      {id:'sec-modules',      icon:'⬡', lbl:'HR Module Pipeline', lv:2, badge:null},
    ]},
    {label:'FAILURE INTELLIGENCE', lv:3, links:[
      {id:'sec-clusters',    icon:'⚙', lbl:'Failure Clusters', lv:3, badge:fc>0?{t:fc,c:'fail'}:null},
      {id:'sec-ai-rca',      icon:'⚠', lbl:'Root Cause',       lv:3, badge:fc>0?{t:fc,c:'fail'}:null},
      {id:'sec-heatmap',     icon:'◼', lbl:'Risk Heatmap',     lv:3, badge:null},
      {id:'sec-actions',     icon:'⚡',lbl:'Actions',           lv:3, badge:fc>0?{t:fc,c:'fail'}:null},
      {id:'sec-fail-intel',  icon:'▲', lbl:'Failure Intel',    lv:3, badge:fc>0?{t:fc,c:'fail'}:null},
      {id:'sec-self-healing',icon:'⚕', lbl:'Self-Healing',     lv:3, badge:null},
    ]},
    {label:'EVIDENCE CENTER', lv:4, links:[
      {id:'sec-scenarios',  icon:'≡', lbl:'Scenario Detail',  lv:4, badge:null},
      {id:'sec-storyboard', icon:'▦', lbl:'Screenshots',      lv:4, badge:{t:m.totalScreenshots}},
      {id:'sec-video',      icon:'▶', lbl:'Videos',            lv:4, badge:{t:m.withVideo}},
      {id:'sec-jira',        icon:'⬡', lbl:'Jira Intelligence', lv:4, badge:null},
      {id:'sec-perf',       icon:'▷', lbl:'Performance',       lv:4, badge:null},
      {id:'sec-trace',      icon:'⇢', lbl:'Traceability',      lv:4, badge:null},
    ]},
    {label:'GOVERNANCE & TRUST', lv:2, links:[
      {id:'sec-trust-dashboard',icon:'🛡',lbl:'Trust Center',       lv:2, badge:{t:String(trustScore),c:trustScore>=80?'pass':'warn'}},
      {id:'sec-truthfulness',   icon:'✓', lbl:'Accuracy Audit',     lv:2, badge:{t:'AUDIT',c:'warn'}},
      {id:'sec-standards',      icon:'⚙', lbl:'Code Standards',     lv:2, badge:codingStandards?{t:String(codingStandards.overallScore)+'%',c:codingStandards.overallScore>=90?'pass':codingStandards.overallScore>=75?'warn':'fail'}:null},
      {id:'sec-governance',     icon:'⚖', lbl:'Enforcement',        lv:2, badge:governanceEnforcement?.enforcement?.decision?{t:governanceEnforcement.enforcement.decision.slice(0,4),c:governanceEnforcement.enforcement.decision==='PASS'?'pass':governanceEnforcement.enforcement.decision==='BLOCKED'?'fail':'warn'}:null},
      {id:'sec-remediation',    icon:'⚡',lbl:'Remediation Plan',   lv:2, badge:remediationPlan?.plan?.summary?{t:remediationPlan.plan.summary.p1Critical+'P1',c:remediationPlan.plan.summary.p1Critical>0?'fail':'pass'}:null},
      {id:'sec-traceability-ei',icon:'⇢', lbl:'Cert Chains',        lv:3, badge:null},
      {id:'sec-req-risk',       icon:'⚠', lbl:'Requirement Risk',   lv:3, badge:null},
    ]},
  ];
  const nav=navGroups.map(g=>`<div class="nav-group-label nav-l${g.lv}">${g.label}</div>`+g.links.map(l=>`<a class="nav-link nav-l${l.lv}" data-section="${l.id}"><span class="nav-icon">${l.icon}</span>${e(l.lbl)}${l.badge&&l.badge.t?`<span class="nav-badge ${l.badge.c||''}">${l.badge.t}</span>`:''}</a>`).join('')).join('');
  const personaHtml=['cto','qa-director','eng-manager','qa-engineer'].map((p,i)=>`<button class="persona-btn" data-persona="${p}">${['CTO / CIO','QA Director','Eng Manager','QA Engineer'][i]}</button>`).join('');

  const { buildCommandCenterStyles, buildCommandCenterScripts,
    buildMissionControl, buildDecisionEngine, buildDigitalTwin, buildCoverageMap,
    buildDefectEconomics, buildHealingEffectiveness, buildEnvironmentObservability,
    buildIntelligenceGraph, buildExecutiveNarrative, buildDemoExperience,
    buildQualityPrediction, buildPortfolioView } = cmd;

  const hasMission = typeof buildMissionControl === 'function';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Intelligence Command Center — ${e(runDate)}</title>${buildStyles()}${hasMission?`<style>${buildCommandCenterStyles()}</style>`:''}</head>
<body data-theme="dark" data-mode="${e(REPORT_MODE)}">
<div id="app">
<header id="header">
  <div class="hdr-brand">
    <div class="hdr-logo-mark">OH</div>
    <div class="hdr-logo">Orange<span>HRM</span> QA</div>
  </div>
  <div class="hdr-sep"></div>
  <div class="hdr-run-info">${e(runDate)}</div>
  <div class="hdr-sep"></div>
  <div class="hdr-kpis">
    <div class="hdr-kpi"><span class="status-dot ${fc===0?'pass':'fail'}"></span><span class="hdr-kpi-val ${fc===0?'pass':'fail'}">${fc===0?'ALL PASS':`${fc} FAIL`}</span></div>
    <div class="hdr-sep"></div>
    <div class="hdr-kpi" style="gap:4px"><span style="font-size:11px;color:var(--text1)">${m.passed}P</span><span style="color:var(--text2)">·</span><span style="font-size:11px;color:var(--text1)">${m.failed}F</span><span style="color:var(--text2)">·</span><span style="font-size:11px;color:var(--text1)">${m.total}T</span></div>
  </div>
  <div class="hdr-spacer"></div>
  <div class="persona-selector" id="persona-selector">${personaHtml}</div>
  <button id="theme-btn" class="theme-btn" title="Toggle theme">☀</button>
</header>
<nav id="sidebar">${nav}</nav>
<main id="main">

<div class="section scroll-anchor" id="sec-home">
<div class="section-header">
  <div><div class="section-title">Mission Control</div><div class="section-subtitle">Quality Command Center — select your role to navigate to relevant insights</div></div>
  <div class="section-header-meta"><span style="font-size:11px;color:var(--text2)">${e(runDate)}</span></div>
</div>
<div class="mc-hero-bar" style="background:${fc===0?'var(--pass-bg)':'var(--fail-bg)'};border:1px solid ${fc===0?'var(--pass-border)':'var(--fail-border)'}">
  <div class="status-dot ${fc===0?'pass':'fail'}"></div>
  <span style="font-size:13px;font-weight:700;color:${fc===0?'var(--pass)':'var(--fail)'}">${fc===0?'ALL SYSTEMS OPERATIONAL':'FAILURES DETECTED — ACTION REQUIRED'}</span>
  <span style="margin-left:auto;font-size:12px;color:var(--text1)">${m.total} scenarios · ${fmtD(m.totalDuration)}</span>
</div>
<div class="card-grid card-grid-4" style="gap:12px;margin-bottom:24px">
  <div class="card" style="padding:16px;text-align:center">
    <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Pass Rate</div>
    <div style="font-size:28px;font-weight:800;color:${m.passRate>=85?'var(--pass)':m.passRate>=70?'var(--skip)':'var(--fail)'};letter-spacing:-.5px">${m.passRate}%</div>
    <div style="font-size:10.5px;color:var(--text2);margin-top:5px">${m.passed} of ${m.total} passed</div>
  </div>
  <div class="card" style="padding:16px;text-align:center">
    <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Release Decision</div>
    <div style="font-size:${((releaseDecision?.governanceBlocked?'BLOCKED':releaseDecision?.status||rr.verdict||'').length>9?'16':'22')}px;font-weight:800;color:${releaseDecision?.color||rr.verdictColor};letter-spacing:-.3px">${e((releaseDecision?.governanceBlocked?'BLOCKED':releaseDecision?.status||rr.verdict||'UNKNOWN').slice(0,14))}</div>
    <div style="font-size:10.5px;color:var(--text2);margin-top:5px">Gate score ${releaseDecision?.qualityGateScore??'–'}/100</div>
  </div>
  <div class="card" style="padding:16px;text-align:center">
    <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Jira Coverage</div>
    <div style="font-size:28px;font-weight:800;color:${m.automationCoverage>=85?'var(--pass)':'var(--skip)'};letter-spacing:-.5px">${m.automationCoverage}%</div>
    <div style="font-size:10.5px;color:var(--text2);margin-top:5px">${m.withTag} of ${m.total} linked</div>
  </div>
  <div class="card" style="padding:16px;text-align:center">
    <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Trust Score</div>
    <div style="font-size:28px;font-weight:800;color:${trustScore>=80?'var(--pass)':'var(--skip)'};letter-spacing:-.5px">${trustScore}</div>
    <div style="font-size:10.5px;color:var(--text2);margin-top:5px">Metric trustworthiness</div>
  </div>
</div>
<div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Navigate by role</div>
<div class="card-grid card-grid-4" style="gap:12px;margin-bottom:20px">
  <div class="card mc-entry-card" onclick="window.setPersona('cto');document.getElementById('sec-release-ei')?.scrollIntoView({behavior:'smooth'})">
    <div style="font-size:13px;font-weight:700;color:#60a5fa;margin-bottom:10px">CTO / CIO</div>
    <div class="mc-entry-needs">▸ Release decision</div>
    <div class="mc-entry-needs">▸ Business risks</div>
    <div class="mc-entry-needs">▸ Executive summary</div>
    <div style="margin-top:12px;font-size:11px;color:#60a5fa;font-weight:600">Executive Summary →</div>
  </div>
  <div class="card mc-entry-card" onclick="window.setPersona('qa-director');document.getElementById('sec-exec')?.scrollIntoView({behavior:'smooth'})">
    <div style="font-size:13px;font-weight:700;color:#22c55e;margin-bottom:10px">QA Director</div>
    <div class="mc-entry-needs">▸ Quality health</div>
    <div class="mc-entry-needs">▸ Coverage & trends</div>
    <div class="mc-entry-needs">▸ Readiness score</div>
    <div style="margin-top:12px;font-size:11px;color:#22c55e;font-weight:600">Release Readiness →</div>
  </div>
  <div class="card mc-entry-card" onclick="window.setPersona('eng-manager');document.getElementById('sec-clusters')?.scrollIntoView({behavior:'smooth'})">
    <div style="font-size:13px;font-weight:700;color:#fbbf24;margin-bottom:10px">Engineering Manager</div>
    <div class="mc-entry-needs">▸ Failure analysis</div>
    <div class="mc-entry-needs">▸ Root causes</div>
    <div class="mc-entry-needs">▸ Defect intelligence</div>
    <div style="margin-top:12px;font-size:11px;color:#fbbf24;font-weight:600">Failure Intelligence →</div>
  </div>
  <div class="card mc-entry-card" onclick="window.setPersona('qa-engineer');document.getElementById('sec-scenarios')?.scrollIntoView({behavior:'smooth'})">
    <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:10px">QA Engineer</div>
    <div class="mc-entry-needs">▸ Scenario evidence</div>
    <div class="mc-entry-needs">▸ Step logs & errors</div>
    <div class="mc-entry-needs">▸ Screenshots & video</div>
    <div style="margin-top:12px;font-size:11px;color:#a78bfa;font-weight:600">Evidence Center →</div>
  </div>
</div>
<div style="display:flex;flex-direction:column;gap:8px">${(()=>{
  const al=[];
  if(fc>0) al.push({s:'fail',m:`${fc} scenario${fc!==1?'s':''} failed this run`});
  if(delta?.newFailures?.length) al.push({s:'fail',m:`${delta.newFailures.length} new regression${delta.newFailures.length!==1?'s':''} since last run`});
  if(almValidation?.governanceStatus==='WARN') al.push({s:'warn',m:`Jira: ${almValidation.summary.orphanRate}% orphan rate — traceability gap`});
  if(!al.length) al.push({s:'pass',m:'All scenarios passed — no active issues detected'});
  return al.map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${a.s==='pass'?'var(--pass-bg)':a.s==='fail'?'var(--fail-bg)':'var(--skip-bg)'};border:1px solid ${a.s==='pass'?'var(--pass-border)':a.s==='fail'?'var(--fail-border)':'var(--skip-border)'};border-radius:var(--radius-sm)"><div class="status-dot ${a.s==='warn'?'warn':a.s}"></div><span style="font-size:12px;font-weight:500;color:${a.s==='pass'?'var(--pass)':a.s==='fail'?'var(--fail)':'var(--skip)'}">${e(a.m)}</span></div>`).join('');
})()}</div>
</div>

<div class="center-start"><span class="center-label">Executive Summary</span><span class="center-persona-tag">CTO / CIO</span><span class="center-sep"></span></div>

${hasMission?`
<div class="section scroll-anchor" id="sec-decision">
<div class="section-header"><div class="section-title">Release Decision Engine</div><div class="section-subtitle">APPROVED · CONDITIONAL · DO NOT RELEASE — with weighted factor scoring</div></div>
${buildDecisionEngine(rr, m, scenarios)}</div>

<div class="section scroll-anchor" id="sec-narrative">
<div class="section-header"><div class="section-title">Executive Narrative</div><div class="section-subtitle">Plain English summary — suitable for leadership reviews</div></div>
${buildExecutiveNarrative(m, rr, delta, scenarios)}</div>
`:''}

<div class="section scroll-anchor" id="sec-onepager">
<div class="section-header"><div class="section-title">Executive One-Pager</div><div class="section-subtitle">Printable · CIO/CTO ready</div></div>
${buildExecutiveOnePager(m, rr, delta, runDate)}</div>

${hasMission?`
<div class="section scroll-anchor" id="sec-twin">
<div class="section-header"><div class="section-title">Quality Digital Twin</div><div class="section-subtitle">Live application entity health visualization</div></div>
${buildDigitalTwin(scenarios)}</div>

<div class="section scroll-anchor" id="sec-coverage">
<div class="section-header"><div class="section-title">Business Coverage Map</div><div class="section-subtitle">Coverage · Automated · Executed · Healthy per capability</div></div>
${buildCoverageMap(scenarios)}</div>
`:''}

<div class="section scroll-anchor" id="sec-biz">
<div class="section-header"><div class="section-title">Business Impact View</div><div class="section-subtitle">Failures mapped to business processes with CRITICAL/HIGH/MEDIUM/LOW impact</div></div>
${buildBusinessImpact(bizCaps)}</div>

${hasMission?`
<div class="section scroll-anchor" id="sec-demo">
<div class="section-header"><div class="section-title">Client Demo Experience</div><div class="section-subtitle">Business workflow narrative with screenshots and video evidence</div></div>
${buildDemoExperience(scenarios)}</div>
`:''}

<div class="section scroll-anchor" id="sec-modules">
<div class="section-header"><div class="section-title">HR Module Pipeline</div><div class="section-subtitle">Click a stage to view mapped scenarios</div></div>
${buildAppPipeline(scenarios, APP_STAGES, getAppStage)}</div>

<div class="section scroll-anchor" id="sec-release">
<div class="section-header">
  <div><div class="section-title">Release Readiness Score</div><div class="section-subtitle">Go / No-Go factor analysis</div></div>
  <div class="section-header-meta">
    <span style="font-size:12px;font-weight:700;color:${rr.verdictColor}">${e(rr.verdict)}</span>
  </div>
</div>
${buildReleaseReadiness(rr)}</div>

<div class="center-start"><span class="center-label">Release Readiness</span><span class="center-persona-tag">QA Director +</span><span class="center-sep"></span></div>

<div class="section scroll-anchor" id="sec-exec">
<div class="section-header">
  <div><div class="section-title">Health Dashboard</div><div class="section-subtitle">8 quality KPIs with composite platform score</div></div>
  <div class="section-header-meta">
    <span style="font-size:11px;background:var(--bg2);border:1px solid var(--border);color:var(--text1);padding:3px 10px;border-radius:6px">${m.total} scenarios · ${fmtD(m.totalDuration)}</span>
  </div>
</div>
${buildExecutiveDashboard(m, runDate)}</div>

<div class="section scroll-anchor" id="sec-trace">
<div class="section-header"><div class="section-title">Story-to-Execution Traceability</div><div class="section-subtitle">Feature → Scenario → Jira → Status → Evidence</div></div>
${buildTraceability(scenarios)}</div>

<div class="section scroll-anchor" id="sec-delta">
<div class="section-header"><div class="section-title">What Changed Since Last Run</div><div class="section-subtitle">New failures · Resolved · Regressions · Improvements</div></div>
${buildDeltaView(delta)}</div>

<div class="section scroll-anchor" id="sec-trends">
<div class="section-header"><div class="section-title">Quality Trend Analytics</div><div class="section-subtitle">Pass rate · Failures · Duration · Healing across runs</div></div>
${buildTrendCharts(history)}</div>

${hasMission?`<div class="section scroll-anchor" id="sec-predict">
<div class="section-header"><div class="section-title">Quality Prediction</div><div class="section-subtitle">Likely failures · Unstable features · Release confidence based on history</div></div>
${buildQualityPrediction(prediction, history)}</div>`:''}

<div class="section scroll-anchor" id="sec-insights">
<div class="section-header"><div class="section-title">Quality Insights</div><div class="section-subtitle">Most unstable · Most valuable · Coverage analytics</div></div>
${buildAiInsights(m)}</div>

<div class="section scroll-anchor" id="sec-heatmap">
<div class="section-header"><div class="section-title">Risk Heatmap</div><div class="section-subtitle">Feature × Risk category matrix</div></div>
${buildRiskHeatmap(scenarios)}</div>

<div class="center-start"><span class="center-label">Failure Intelligence</span><span class="center-persona-tag">Engineering Manager +</span><span class="center-sep"></span></div>

<div class="section scroll-anchor" id="sec-clusters">
<div class="section-header">
  <div><div class="section-title">Failure Clusters</div><div class="section-subtitle">Failures grouped by root cause type</div></div>
  <div class="section-header-meta">
    ${fc>0?`<span style="background:var(--fail-bg);border:1px solid var(--fail-border);color:var(--fail);font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">${fc} FAILED</span>`:'<span style="background:var(--pass-bg);border:1px solid var(--pass-border);color:var(--pass);font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">CLEAN</span>'}
  </div>
</div>
${buildFailureClusters(scenarios)}</div>

<div class="section scroll-anchor" id="sec-actions">
<div class="section-header"><div class="section-title">AI Recommended Actions</div><div class="section-subtitle">Priority-ordered fixes with effort and owner</div></div>
${buildAiActions(scenarios, BIZ_MAP, getAppStage)}</div>

${hasMission?`<div class="section scroll-anchor" id="sec-graph">
<div class="section-header"><div class="section-title">Test Intelligence Graph</div><div class="section-subtitle">Feature → Scenario → Jira relationship visualization</div></div>
${buildIntelligenceGraph(scenarios)}</div>`:''}

${hasMission?`<div class="section scroll-anchor" id="sec-econ">
<div class="section-header"><div class="section-title">Defect Economics</div><div class="section-subtitle">Automation ROI · Time saved · Defect detection value</div></div>
${buildDefectEconomics(defectEcon)}</div>`:''}

${hasMission?`<div class="section scroll-anchor" id="sec-healeff">
<div class="section-header"><div class="section-title">AI Healing Effectiveness</div><div class="section-subtitle">Healing score · Events · Success rate · Trend</div></div>
${buildHealingEffectiveness(healingEff, history)}</div>`:''}

${hasMission?`<div class="section scroll-anchor" id="sec-envobs">
<div class="section-header"><div class="section-title">Environment Observability</div><div class="section-subtitle">Auth · Session · App · Environment score</div></div>
${buildEnvironmentObservability(envHealth)}</div>`:''}

${hasMission?`<div class="section scroll-anchor" id="sec-value">
<div class="section-header"><div class="section-title">Test Case Value Analysis</div><div class="section-subtitle">Most stable · Most failing · Longest running</div></div>
${buildTestCaseValue(scenarios)}</div>`:'<div class="section scroll-anchor" id="sec-value"><div class="section-header"><div class="section-title">Test Case Value Analysis</div></div>'+buildTestCaseValue(scenarios)+'</div>'}

<div class="center-start"><span class="center-label">Evidence Center</span><span class="center-persona-tag">QA Engineer</span><span class="center-sep"></span></div>

<div class="section scroll-anchor" id="sec-journey">
<div class="section-header"><div class="section-title">Execution Journey</div><div class="section-subtitle">Sequential timeline with cumulative offsets</div></div>
${buildExecutionJourney(scenarios)}</div>

<div class="section scroll-anchor" id="sec-storyboard">
<div class="section-header"><div class="section-title">Screenshot Storyboard</div><div class="section-subtitle">Visual execution journey per scenario — click to enlarge</div></div>
${buildStoryboard(scenarios)}</div>

<div class="section scroll-anchor" id="sec-video">
<div class="section-header"><div class="section-title">Video Intelligence</div><div class="section-subtitle">Per-scenario recordings with step annotations</div></div>
${buildVideoIntelligence(scenarios)}</div>

<div class="section scroll-anchor" id="sec-rc">
<div class="section-header"><div class="section-title">Root Cause Center</div><div class="section-subtitle">Error classification by pattern matching — not ML/AI</div></div>
${buildRootCauseCenter(scenarios)}</div>

<div class="section scroll-anchor" id="sec-value">
<div class="section-header"><div class="section-title">Test Case Value Analysis</div><div class="section-subtitle">Most stable · Most failing · Slowest — Phase 9</div></div>
${buildTestCaseValue(scenarios)}</div>

<div class="section scroll-anchor" id="sec-perf">
<div class="section-header"><div class="section-title">Performance Analytics</div><div class="section-subtitle">Duration distribution · p50/p90 · Slowest scenarios</div></div>
${buildPerformanceAnalytics(scenarios)}</div>

<div class="section scroll-anchor" id="sec-jira">
<div class="section-header"><div class="section-title">Jira Intelligence</div><div class="section-subtitle">Jira traceability coverage</div></div>
${buildJiraIntelligence(scenarios, jiraBugs)}</div>

${hasMission?`<div class="section scroll-anchor" id="sec-portfolio">
<div class="section-header"><div class="section-title">Portfolio View</div><div class="section-subtitle">Multi-application · Multi-environment · Single dashboard</div></div>
${buildPortfolioView(m)}</div>`:''}

<div class="section scroll-anchor" id="sec-healing">
<div class="section-header"><div class="section-title">Healing Center</div><div class="section-subtitle">Self-healing agent events and locator repairs</div></div>
<div class="card">${buildHealingCenter(healingData)}</div></div>

<div class="section scroll-anchor" id="sec-ti-dashboard">
<div class="section-header"><div class="section-title">🛰 Test Intelligence Dashboard</div><div class="section-subtitle">Mission Control · Release Health · Failure Clusters · Components · Regressions · Velocity</div></div>
${buildTestIntelligenceDashboard(m, releaseDecision, executive, clusterData, twin, trends, delta, aiAnalysis)}</div>

<div class="section scroll-anchor" id="sec-traceability-ei">
<div class="section-header"><div class="section-title">🔗 Complete Traceability Engine</div><div class="section-subtitle">Portfolio → Program → Epic → Feature → Story → Requirement → Test Case → Scenario</div></div>
${buildTraceabilityEngine(traceability)}</div>

<div class="section scroll-anchor" id="sec-fail-intel">
<div class="section-header"><div class="section-title">⚡ Failure Intelligence Engine</div><div class="section-subtitle">Failures clustered by module · API · component · exception · environment</div></div>
${buildFailureIntelligence(clusterData)}</div>

<div class="section scroll-anchor" id="sec-ai-rca">
<div class="section-header"><div class="section-title">🔍 Root Cause Analyzer <span style="font-size:11px;font-weight:400;opacity:.6">(Pattern-Based)</span></div><div class="section-subtitle">Multi-signal regex pattern analysis · calibrated score · owner · severity · fix</div></div>
${buildAiRootCause(aiAnalysis)}</div>

<div class="section scroll-anchor" id="sec-release-ei">
<div class="section-header"><div class="section-title">🚦 Release Decision Engine</div><div class="section-subtitle">GO / CONDITIONAL GO / NO GO — weighted factor scoring</div></div>
${buildReleaseDecisionPanel(releaseDecision)}</div>

<div class="section scroll-anchor" id="sec-exec-ei">
<div class="section-header"><div class="section-title">👔 Executive Intelligence</div><div class="section-subtitle">Management-ready narratives · health dimensions · priority action plan</div></div>
${buildExecutiveIntelligence(executive)}</div>

<div class="section scroll-anchor" id="sec-trend-ei">
<div class="section-header"><div class="section-title">📈 Historical Trend Engine</div><div class="section-subtitle">Daily · Sprint · Release trends · linear regression predictions</div></div>
${buildTrendEngine(trends)}</div>

<div class="section scroll-anchor" id="sec-timeline-ei">
<div class="section-header"><div class="section-title">⏱ Failure Timeline</div><div class="section-subtitle">Chronological event timeline per failed scenario with video seek</div></div>
${buildFailureTimeline(timelines)}</div>

<div class="section scroll-anchor" id="sec-twin-ei">
<div class="section-header"><div class="section-title">🌐 Digital QA Twin</div><div class="section-subtitle">Continuously-updated system health model · component breakdown</div></div>
${buildDigitalTwinPanel(twin)}</div>

<div class="section scroll-anchor" id="sec-story-ei">
<div class="section-header"><div class="section-title">📖 Execution Story</div><div class="section-subtitle">Rule-based executive narrative · tone-classified · key metrics</div></div>
${buildExecutionStory(story)}</div>

<div class="section scroll-anchor" id="sec-command-center">
<div class="section-header"><div class="section-title">🚀 Release Command Center</div><div class="section-subtitle">6-dimension cockpit · alerts · single release recommendation · quality gate score</div></div>
${buildReleaseCommandCenterPanel(commandCenter)}</div>

<div class="section scroll-anchor" id="sec-self-healing">
<div class="section-header"><div class="section-title">🔧 Self-Healing Failure Analysis</div><div class="section-subtitle">Pattern detection · auto-fix eligibility · confidence scoring · owner assignment</div></div>
${buildSelfHealingPanel(healing)}</div>

<div class="section scroll-anchor" id="sec-test-generator">
<div class="section-header"><div class="section-title">⚗ Test Gap Detector <span style="font-size:11px;font-weight:400;opacity:.6">(Pattern-Based)</span></div><div class="section-subtitle">Coverage gap analysis by name matching · BDD template generation · priority classification</div></div>
${buildTestGeneratorPanel(generated)}</div>

<div class="section scroll-anchor" id="sec-req-risk">
<div class="section-header"><div class="section-title">⚠ Requirement Risk Analyzer</div><div class="section-subtitle">Ambiguity detection · missing validations · security gaps · quality scoring</div></div>
${buildRequirementRiskPanel(reqRisk)}</div>

<div class="section scroll-anchor" id="sec-defect-predictor">
<div class="section-header"><div class="section-title">🔮 Defect Prediction Engine <span style="font-size:11px;font-weight:400;opacity:.6">(Heuristic)</span></div><div class="section-subtitle">Weighted risk scoring · estimated defect count · calibrated confidence per feature</div></div>
${buildDefectPredictorPanel(defectPrediction)}</div>

<div class="section scroll-anchor" id="sec-impact-analysis">
<div class="section-header"><div class="section-title">🎯 Test Impact Analysis</div><div class="section-subtitle">Changed features · impacted requirements · regression scope recommendation</div></div>
${buildImpactAnalysisPanel(impact)}</div>

<div class="section scroll-anchor" id="sec-prod-correlation">
<div class="section-header"><div class="section-title">🐛 Production Defect Correlation</div><div class="section-subtitle">Leakage analytics · false passes · coverage gaps · defect density</div></div>
${buildProductionCorrelationPanel(correlation)}</div>

<div class="section scroll-anchor" id="sec-autonomous-agent">
<div class="section-header"><div class="section-title">🤖 Autonomous QA Agent</div><div class="section-subtitle">Virtual QA Manager · investigations · defect candidates · owner assignments · release summary</div></div>
${buildAutonomousAgentPanel(agent)}</div>

<div class="center-start"><span class="center-label">Governance &amp; Trust</span><span class="center-persona-tag">QA Director +</span><span class="center-sep"></span></div>

<div class="section scroll-anchor" id="sec-trust-dashboard">
<div class="section-header"><div class="section-title">🛡 Trust Score Dashboard</div><div class="section-subtitle">Trustworthiness score · Jira Validation · Traceability Certification · Metric Registry · Decision Registry · Data Lineage · Architecture Limits</div></div>
${buildTrustDashboard(audit, metricRegistry, decisionRegistry, dataLineage, almValidation, traceCert)}</div>

<div class="section scroll-anchor" id="sec-truthfulness">
<div class="section-header"><div class="section-title">🔍 Report Truthfulness Audit</div><div class="section-subtitle">Data lineage · formula verification · RAW FACTS vs CALCULATED vs PREDICTIONS vs RULE-BASED OPINIONS · accuracy findings · Explain This Result</div></div>
${buildTruthinessPanel(audit)}</div>

<div class="section scroll-anchor" id="sec-standards">
<div class="section-header"><div class="section-title">⚙ Coding Standards Compliance</div><div class="section-subtitle">WI-046A · 10 categories · 40+ rules · Governance Score · Architecture · App · Jira · Security</div></div>
${buildCodingStandards(codingStandards)}</div>

<div class="section scroll-anchor" id="sec-governance">
<div class="section-header"><div class="section-title">⚖ Governance Enforcement</div><div class="section-subtitle">WI-046B · 15 phases · Decision Engine · CI/CD Gates · Tech Debt · Team Governance · Release Governance</div></div>
${buildGovernanceDashboard(governanceEnforcement, codingStandards)}</div>

<div class="section scroll-anchor" id="sec-remediation">
<div class="section-header"><div class="section-title">⚡ Governance Remediation Plan</div><div class="section-subtitle">WI-046C · P1–P4 prioritization · Effort estimation · Owner mapping · Burn-down · Auto-generated fix recommendations</div></div>
${buildRemediationDashboard(remediationPlan)}</div>

<div class="section scroll-anchor" id="sec-intelligence">
<div class="section-header"><div class="section-title">🧠 Test Intelligence Platform</div><div class="section-subtitle">Drill-down: Feature → Scenario → Step → Evidence · AI Root Cause · Video Timestamps</div></div>
${buildTestIntelligence(scenarios, runDate, lastSnapshot, m)}</div>

<div class="section scroll-anchor technical-only" id="sec-scenarios">
<div class="section-header"><div class="section-title">Scenario Detail</div><div class="section-subtitle">Step-level results · Inline screenshots · Error traces</div></div>
${buildScenarioDetail(scenarios, bugByScenario)}</div>

<div class="section scroll-anchor technical-only" id="sec-env">
<div class="section-header"><div class="section-title">Environment Variables</div><div class="section-subtitle">Runtime configuration</div></div>
${buildEnvironment()}</div>

</main></div>
<div id="lightbox"><button id="lightbox-close">✕</button><img id="lightbox-img" src="" alt="Screenshot"></div>
${buildScripts(scenarios, APP_STAGES, getAppStage)}
${hasMission?`<script>${buildCommandCenterScripts()}</script>`:''}
<script>${buildIntelligenceScripts()}</script>
<script>${buildPhaseScripts()}</script>
<script>${buildPhaseScripts2()}</script>
<script>${buildExplainerScripts(audit)}</script>
${buildExplainModal()}
</body></html>`;
}

module.exports = { buildHtml, buildStoryHtml, buildStyles };

