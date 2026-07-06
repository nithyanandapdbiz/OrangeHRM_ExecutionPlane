'use strict';
// report-command.js — WI-044B: Quality Command Center builders (Phases 1-12)

const e  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fD = ms => ms>=60000?`${(ms/60000).toFixed(1)}m`:ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`;

// ─── Phase 1: Mission Control Home ───────────────────────────────────────────
function buildMissionControl(m, rr, delta, healingEff, envHealth) {
  const light = val => val >= 80 ? '🟢' : val >= 55 ? '🟡' : '🔴';
  const col   = val => val >= 80 ? 'var(--pass)' : val >= 55 ? 'var(--skip)' : 'var(--fail)';
  const trend = delta.available
    ? (delta.newFailures.length > 0 ? '↓ Declining' : delta.resolved.length > 0 ? '↑ Improving' : '→ Stable')
    : '→ Baseline';
  const trendColor = trend.startsWith('↑') ? 'var(--pass)' : trend.startsWith('↓') ? 'var(--fail)' : 'var(--info)';

  const panels = [
    { id:'release',  icon:'🎯', title:'Release Readiness', val:rr.verdict,       sub:`Score: ${rr.score}/100`,   vc:rr.verdictColor,  extra:'' },
    { id:'risk',     icon:'⚠',  title:'Business Risk',     val:`${m.failed} Fail`, sub:`of ${m.total} scenarios`, vc:col(100-m.failed/Math.max(m.total,1)*100*3), extra:'' },
    { id:'health',   icon:'◉',  title:'Execution Health',  val:`${m.passRate}%`,  sub:`${m.passed}/${m.total} passed`, vc:col(m.passRate), extra:'' },
    { id:'healing',  icon:'⚕',  title:'AI Healing Health', val:`${healingEff.score}%`, sub:`${healingEff.events} events`, vc:col(healingEff.score), extra:'' },
    { id:'env',      icon:'🖥',  title:'Environment Health',val:`${envHealth.score}%`, sub:envHealth.status,      vc:col(envHealth.score), extra:'' },
    { id:'jira',     icon:'⬡',  title:'Jira Sync Health',  val:`${m.automationCoverage}%`, sub:`${m.withTag}/${m.total} linked`, vc:col(m.automationCoverage), extra:'' },
    { id:'trend',    icon:'📈', title:'Quality Trend',     val:trend,             sub:delta.available?`vs last run`:'First run', vc:trendColor, extra:'' },
  ];

  const panelHtml = panels.map(p => `
    <div class="mc-panel" onclick="scrollToSection('sec-${p.id}')">
      <div class="mc-panel-icon">${p.icon}</div>
      <div class="mc-panel-title">${e(p.title)}</div>
      <div class="mc-panel-val" style="color:${p.vc}">${e(p.val)}</div>
      <div class="mc-panel-sub">${e(p.sub)}</div>
    </div>`).join('');

  const criticalAlerts = [];
  if (m.failed > 0)          criticalAlerts.push(`${m.failed} scenario${m.failed>1?'s':''} failed`);
  if (delta.newFailures?.length) criticalAlerts.push(`${delta.newFailures.length} new failure${delta.newFailures.length>1?'s':''} since last run`);
  if (rr.verdict === 'NOT READY') criticalAlerts.push('Release not recommended');
  if (m.automationCoverage < 60) criticalAlerts.push(`Jira traceability low (${m.automationCoverage}%)`);

  const alertHtml = criticalAlerts.length
    ? `<div class="mc-alerts">${criticalAlerts.map(a=>`<div class="mc-alert"><span style="color:var(--fail)">⚠</span> ${e(a)}</div>`).join('')}</div>`
    : `<div class="mc-alerts" style="border-color:rgba(63,185,80,.3)"><div class="mc-alert" style="color:var(--pass)">✅ No critical alerts — platform healthy</div></div>`;

  return `<div class="mc-grid">${panelHtml}</div>${alertHtml}
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--text1)">
    <span>Last run: <strong style="color:var(--text0)">${m.total}</strong> scenarios in <strong>${fD(m.totalDuration)}</strong></span>
    <span>·</span><span>Evidence: <strong>${m.totalScreenshots}</strong> screenshots, <strong>${m.withVideo}</strong> videos</span>
    <span>·</span><span>Trend: <strong style="color:${trendColor}">${trend}</strong></span>
  </div>`;
}

// ─── Phase 2: Release Decision Engine ────────────────────────────────────────
function buildDecisionEngine(rr, m, scenarios) {
  const authFails = scenarios.filter(s => s.status === 'Fail' && s.errorClassification?.type === 'AUTH_FAILURE').length;
  const criticalFails = scenarios.filter(s => {
    if (s.status !== 'Fail') return false;
    const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
    const BIZ_IMPACT = { Dashboard:'HIGH', Admin:'CRITICAL', PIM:'CRITICAL', Leave:'HIGH', Time:'HIGH', Recruitment:'CRITICAL', Performance:'HIGH', Directory:'MEDIUM' };
    const stage = APP_STAGES.find(st => s.featureName?.toLowerCase().includes(st.toLowerCase()) || s.scenarioName?.toLowerCase().includes(st.toLowerCase())) || 'Directory';
    return BIZ_IMPACT[stage] === 'CRITICAL';
  }).length;

  let decision, decisionColor, explanation, conditions;
  if (authFails > 0 || criticalFails > 2 || m.passRate < 70) {
    decision = 'DO NOT RELEASE'; decisionColor = 'var(--fail)';
    explanation = `Release is blocked due to ${[
      authFails > 0 ? `${authFails} authentication failure${authFails>1?'s':''}` : null,
      criticalFails > 2 ? `${criticalFails} critical-path failures` : null,
      m.passRate < 70 ? `pass rate below minimum threshold (${m.passRate}% < 70%)` : null,
    ].filter(Boolean).join(', ')}.`;
  } else if (criticalFails > 0 || m.passRate < 90 || m.automationCoverage < 70) {
    decision = 'CONDITIONAL RELEASE'; decisionColor = 'var(--skip)';
    explanation = `Release may proceed with the following conditions addressed: ${[
      criticalFails > 0 ? `${criticalFails} critical-path failure${criticalFails>1?'s':''} must be investigated` : null,
      m.passRate < 90 ? `pass rate is ${m.passRate}% (target: 90%+)` : null,
      m.automationCoverage < 70 ? `Jira traceability is ${m.automationCoverage}% (target: 70%+)` : null,
    ].filter(Boolean).join('; ')}.`;
  } else {
    decision = 'APPROVED FOR RELEASE'; decisionColor = 'var(--pass)';
    explanation = `All release criteria satisfied. Pass rate ${m.passRate}%, ${m.failed === 0 ? 'zero failures' : `${m.failed} non-critical failure${m.failed>1?'s':''}`}, Jira traceability ${m.automationCoverage}%.`;
  }

  conditions = [
    { label:'Pass Rate ≥ 90%',           met: m.passRate >= 90,             val: `${m.passRate}%` },
    { label:'Zero Critical Path Failures',met: criticalFails === 0,          val: criticalFails === 0 ? 'Clear' : `${criticalFails} failed` },
    { label:'No Auth Failures',          met: authFails === 0,               val: authFails === 0 ? 'Clear' : `${authFails} failed` },
    { label:'Jira Coverage ≥ 70%',       met: m.automationCoverage >= 70,    val: `${m.automationCoverage}%` },
    { label:'Evidence Coverage ≥ 80%',   met: m.evidenceCoverage >= 80,      val: `${m.evidenceCoverage}%` },
    { label:'Environment Health ≥ 70%',  met: m.environmentReady >= 70,      val: `${m.environmentReady}%` },
  ];

  return `<div style="text-align:center;padding:24px;background:var(--bg2);border-radius:8px;margin-bottom:20px;border:2px solid ${decisionColor}22">
    <div style="font-size:11px;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Release Decision</div>
    <div style="font-size:36px;font-weight:900;color:${decisionColor};line-height:1">${decision}</div>
    <div style="font-size:13px;color:var(--text1);margin-top:12px;max-width:600px;margin-left:auto;margin-right:auto">${e(explanation)}</div>
  </div>
  <div class="card-grid card-grid-3">
    ${conditions.map(c => `<div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-left:3px solid ${c.met?'var(--pass)':'var(--fail)'}">
      <span style="font-size:18px">${c.met ? '✅' : '❌'}</span>
      <div><div style="font-size:12px;font-weight:600">${e(c.label)}</div>
        <div style="font-size:11px;color:${c.met?'var(--pass)':'var(--fail)'}">${e(c.val)}</div></div>
    </div>`).join('')}
  </div>`;
}

// ─── Phase 3: Quality Digital Twin ───────────────────────────────────────────
function buildDigitalTwin(scenarios) {
  const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const entities = [
    { id:'auth',  name:'Authentication', icon:'🔑', x:420, y:20,  relStages:[] },
    { id:'pim',   name:'PIM',            icon:'👤', x:80,  y:120, relStages:['PIM','Admin'] },
    { id:'leave', name:'Leave',          icon:'🌴', x:280, y:120, relStages:['Leave','Time'] },
    { id:'time',  name:'Time',           icon:'⏱️', x:480, y:120, relStages:['Time'] },
    { id:'recruit',name:'Recruitment',   icon:'📋', x:680, y:120, relStages:['Recruitment'] },
    { id:'perf',  name:'Performance',    icon:'🏆', x:280, y:240, relStages:['Performance','Directory'] },
    { id:'jira',  name:'Jira Sync',      icon:'⬡',  x:580, y:240, relStages:[] },
  ];
  const stageMap = {}; for(const st of APP_STAGES) stageMap[st]={pass:0,fail:0,total:0};
  for(const s of scenarios){const st=APP_STAGES.find(x=>s.featureName?.toLowerCase().includes(x.toLowerCase())||s.scenarioName?.toLowerCase().includes(x.toLowerCase()))||'Directory';stageMap[st].total++;if(s.status==='Pass')stageMap[st].pass++;if(s.status==='Fail')stageMap[st].fail++;}

  function entityHealth(ent) {
    if (ent.id === 'auth') {
      const authFails = scenarios.filter(s=>s.status==='Fail'&&s.errorClassification?.type==='AUTH_FAILURE').length;
      return authFails > 0 ? {pct:0,fail:authFails,total:scenarios.length} : {pct:100,fail:0,total:scenarios.length};
    }
    if (ent.id === 'jira') {
      const linked = scenarios.filter(s=>s.issueKey!=='–').length;
      return {pct:scenarios.length?Math.round(linked/scenarios.length*100):100,fail:0,total:scenarios.length};
    }
    const related = ent.relStages.flatMap(st=>stageMap[st]?[stageMap[st]]:[]);
    const total=related.reduce((a,s)=>a+s.total,0), fail=related.reduce((a,s)=>a+s.fail,0);
    return { pct: total?Math.round((total-fail)/total*100):100, fail, total };
  }

  const edges = [
    [420,50,420,90],[420,90,80,150],[420,90,280,150],[420,90,480,150],[420,90,680,150],
    [280,180,280,240],[480,180,580,240],
  ];
  const nodesSvg = entities.map(ent => {
    const h=entityHealth(ent), fill=h.pct>=80?'#238636':h.pct>=50?'#9e6a03':'#da3633';
    return `<g class="twin-node" onclick="highlightEntity('${ent.id}')" style="cursor:pointer">
      <circle cx="${ent.x}" cy="${ent.y+30}" r="36" fill="${fill}22" stroke="${fill}" stroke-width="2"/>
      <text x="${ent.x}" y="${ent.y+26}" text-anchor="middle" font-size="16">${ent.icon}</text>
      <text x="${ent.x}" y="${ent.y+42}" text-anchor="middle" fill="#e6edf3" font-size="9" font-weight="600">${e(ent.name)}</text>
      <text x="${ent.x}" y="${ent.y+54}" text-anchor="middle" fill="${fill}" font-size="8">${h.pct}%</text>
      ${h.fail>0?`<circle cx="${ent.x+28}" cy="${ent.y+4}" r="8" fill="#f85149"/><text x="${ent.x+28}" y="${ent.y+8}" text-anchor="middle" fill="#fff" font-size="8">${h.fail}</text>`:''}
    </g>`;
  }).join('');
  const edgesSvg = edges.map(([x1,y1,x2,y2])=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,.15)" stroke-width="1.5" stroke-dasharray="4 3"/>`).join('');

  const legend=`<div style="display:flex;gap:16px;font-size:11px;color:var(--text1);padding-top:8px">
    <span><span style="color:#3fb950">●</span> Healthy ≥80%</span>
    <span><span style="color:#e3b341">●</span> At Risk 50-79%</span>
    <span><span style="color:#f85149">●</span> Critical &lt;50%</span>
    <span style="color:var(--text2)">Click a node to navigate to its section</span>
  </div>`;

  return `<div class="card" style="overflow:auto">
    <svg width="800" height="310" viewBox="0 0 800 310" style="min-width:600px">
      ${edgesSvg}${nodesSvg}
    </svg>
    ${legend}
  </div>`;
}

// ─── Phase 4: Business Coverage Map ──────────────────────────────────────────
function buildCoverageMap(scenarios) {
  const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const TOTAL_EST = { Dashboard:3, Admin:4, PIM:5, Leave:4, Time:3, Recruitment:3, Performance:2, Directory:5 };
  const BIZ = { Dashboard:'Dashboard Overview', Admin:'User Administration', PIM:'Employee Management', Leave:'Leave Management', Time:'Time & Attendance', Recruitment:'Recruitment', Performance:'Performance Reviews', Directory:'Employee Directory' };
  const map = {};
  for(const st of APP_STAGES) map[st]={stage:st,total:0,pass:0,fail:0};
  for(const s of scenarios){
    const st=APP_STAGES.find(x=>s.featureName?.toLowerCase().includes(x.toLowerCase())||s.scenarioName?.toLowerCase().includes(x.toLowerCase()))||'Directory';
    map[st].total++;if(s.status==='Pass')map[st].pass++;if(s.status==='Fail')map[st].fail++;
  }
  const rows = APP_STAGES.map(st => {
    const d=map[st], est=TOTAL_EST[st]||3;
    const covered=d.total>0?Math.min(100,Math.round(d.total/est*100)):0;
    const automated=covered; // all executed are automated
    const healthy=d.total>0?Math.round(d.pass/d.total*100):0;
    const hColor=healthy===100?'var(--pass)':healthy>=60?'var(--skip)':'var(--fail)';
    return `<tr>
      <td style="font-size:13px;font-weight:600;padding:10px 12px">${e(BIZ[st])}</td>
      <td style="padding:10px 12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${covered}%;background:var(--accent);border-radius:3px"></div></div>
          <span style="font-size:12px;min-width:32px;text-align:right">${covered}%</span>
        </div>
      </td>
      <td style="padding:10px 12px;font-size:12px;color:var(--info)">${automated}%</td>
      <td style="padding:10px 12px;font-size:12px">${d.total} executed</td>
      <td style="padding:10px 12px"><span style="color:${hColor};font-weight:700;font-size:13px">${healthy}%</span></td>
    </tr>`;
  }).join('');
  return `<div class="card" style="overflow:auto"><table class="data-table"><thead>
    <tr><th>Business Capability</th><th>Coverage</th><th>Automated</th><th>Executed</th><th>Healthy</th></tr>
  </thead><tbody>${rows}</tbody></table></div>`;
}

// ─── Phase 5: Defect Economics ────────────────────────────────────────────────
function buildDefectEconomics(econ) {
  const cards = [
    { icon:'🤖', title:'Automation Saved',   val:econ.automationHours,  unit:'hrs', sub:'vs manual execution', color:'var(--pass)' },
    { icon:'⚕',  title:'AI Healing Saved',   val:econ.healingHours,     unit:'hrs', sub:'locator auto-repair', color:'var(--info)' },
    { icon:'🚀',  title:'Scenarios/Hour',     val:econ.scenariosPerHour, unit:'x',   sub:'throughput vs manual', color:'var(--accent2)' },
    { icon:'💰',  title:'Early Detection',    val:econ.defectsCaught,    unit:'',    sub:'defects found early', color:'var(--skip)' },
    { icon:'⏱',  title:'Execution Time',     val:econ.executionMins,    unit:'min', sub:'total automated run', color:'var(--text0)' },
    { icon:'📉',  title:'Manual Effort Saved',val:econ.manualHoursSaved, unit:'hrs', sub:'this run', color:'var(--pass)' },
  ];
  return `<div class="card-grid card-grid-3">
    ${cards.map(c=>`<div class="card" style="text-align:center;padding:20px">
      <div style="font-size:28px;margin-bottom:8px">${c.icon}</div>
      <div style="font-size:32px;font-weight:900;color:${c.color}">${c.val}<span style="font-size:16px;font-weight:400;color:var(--text1)">${e(c.unit)}</span></div>
      <div style="font-size:12px;font-weight:600;margin-top:4px">${e(c.title)}</div>
      <div style="font-size:11px;color:var(--text1);margin-top:2px">${e(c.sub)}</div>
    </div>`).join('')}
  </div>
  <div class="card" style="margin-top:14px;padding:16px 20px;border-left:4px solid var(--pass)">
    <div style="font-size:12px;color:var(--text1);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">ROI Summary</div>
    <div style="font-size:13px;color:var(--text0)">${econ.roiSummary}</div>
  </div>`;
}

// ─── Phase 6: AI Healing Effectiveness ───────────────────────────────────────
function buildHealingEffectiveness(healingEff, history) {
  const scoreColor = healingEff.score >= 80 ? 'var(--pass)' : healingEff.score >= 50 ? 'var(--skip)' : 'var(--fail)';
  const healingTrend = history.slice(-10).map(r => r.healingEvents || 0);
  function sparkline(vals, w=200, h=40, col='#39d353') {
    if(!vals||vals.length<2) return `<svg width="${w}" height="${h}"><text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,.2)" font-size="9">No data</text></svg>`;
    const max=Math.max(...vals)||1,min=Math.min(...vals),rng=max-min||1,pd=3;
    const pts=vals.map((v,i)=>[(pd+(i/(vals.length-1))*(w-pd*2)).toFixed(1),(h-pd-((v-min)/rng)*(h-pd*2)).toFixed(1)]);
    const poly=pts.map(p=>p.join(',')).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><path d="M${pts[0][0]},${h} ${poly} ${pts[pts.length-1][0]},${h}Z" fill="${col}" opacity=".12"/><polyline points="${poly}" fill="none" stroke="${col}" stroke-width="1.5"/><circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3" fill="${col}"/></svg>`;
  }
  const metrics = [
    { lbl:'Heals Attempted',    val:healingEff.events,          icon:'⚡' },
    { lbl:'Success Rate',       val:`${healingEff.score}%`,     icon:'✅' },
    { lbl:'Human Assisted',     val:healingEff.humanAssisted,   icon:'👤' },
    { lbl:'Promoted Selectors', val:healingEff.promoted,        icon:'⭐' },
  ];
  return `<div style="display:flex;gap:20px;align-items:center;margin-bottom:20px">
    <div style="text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:24px 32px">
      <div style="font-size:56px;font-weight:900;color:${scoreColor};line-height:1">${healingEff.score}</div>
      <div style="font-size:13px;color:var(--text1);margin-top:6px">Healing Score / 100</div>
    </div>
    <div style="flex:1"><div class="card-grid card-grid-2">
      ${metrics.map(m=>`<div class="card" style="padding:12px 16px"><div style="font-size:11px;color:var(--text1)">${m.icon} ${e(m.lbl)}</div><div style="font-size:22px;font-weight:800;margin-top:4px">${e(String(m.val))}</div></div>`).join('')}
    </div></div>
  </div>
  <div class="card">
    <div style="font-size:12px;color:var(--text1);margin-bottom:8px">Healing Events — Last 10 Runs</div>
    ${sparkline(healingTrend, 400, 48, '#39d353')}
    ${healingEff.events === 0 ? `<div style="font-size:12px;color:var(--text2);margin-top:8px;font-style:italic">No healing events in this run. Self-healing activates when locator drift is detected.</div>` : ''}
  </div>`;
}

// ─── Phase 7: Environment Observability ──────────────────────────────────────
function buildEnvironmentObservability(envHealth) {
  const comp = envHealth.components;
  const scoreColor = envHealth.score >= 80 ? 'var(--pass)' : envHealth.score >= 55 ? 'var(--skip)' : 'var(--fail)';
  const statusIcon = v => v >= 80 ? '🟢' : v >= 55 ? '🟡' : '🔴';
  return `<div class="two-col" style="align-items:start">
    <div class="card" style="text-align:center;padding:32px">
      <div style="font-size:56px;font-weight:900;color:${scoreColor};line-height:1">${envHealth.score}</div>
      <div style="font-size:16px;font-weight:700;color:${scoreColor};margin-top:6px">${e(envHealth.status)}</div>
      <div style="font-size:12px;color:var(--text1);margin-top:4px">Environment Score / 100</div>
    </div>
    <div class="card" style="flex:1">
      <div style="font-size:12px;font-weight:600;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Component Health</div>
      ${comp.map(c=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:14px">${statusIcon(c.score)}</span>
        <span style="flex:1;font-size:13px;font-weight:600">${e(c.name)}</span>
        <div style="width:120px;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${c.score}%;background:${c.score>=80?'var(--pass)':c.score>=55?'var(--skip)':'var(--fail)'};border-radius:3px"></div></div>
        <span style="font-size:12px;min-width:36px;text-align:right;color:${c.score>=80?'var(--pass)':c.score>=55?'var(--skip)':'var(--fail)'}">${c.score}%</span>
        <span style="font-size:11px;color:var(--text2);min-width:60px">${e(c.note)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

// ─── Phase 8: Intelligence Graph ─────────────────────────────────────────────
function buildIntelligenceGraph(scenarios) {
  const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const features = [...new Set(scenarios.map(s=>s.featureName))].slice(0,6);
  const W=780, H=320;
  const nodes=[], edges=[];
  let ni=0;

  // Layer 0 — Features
  features.forEach((f,i)=>{
    const fail=scenarios.filter(s=>s.featureName===f&&s.status==='Fail').length;
    const total=scenarios.filter(s=>s.featureName===f).length;
    nodes.push({id:`f${i}`,x:60+i*(W-80)/Math.max(features.length-1,1),y:50,label:f.slice(0,18),type:'feature',fail,total});
  });
  // Layer 1 — Scenarios (up to 12)
  const scenSample = scenarios.slice(0,Math.min(12, scenarios.length));
  scenSample.forEach((s,i)=>{
    const x=40+(i/(Math.max(scenSample.length-1,1)))*(W-80);
    nodes.push({id:`s${i}`,x,y:160,label:s.scenarioName.slice(0,16),type:'scenario',status:s.status,issueKey:s.issueKey});
    const fi=features.indexOf(s.featureName);
    if(fi>=0) edges.push([`f${fi}`,`s${i}`]);
  });
  // Layer 2 — Jira Keys (unique, up to 6)
  const issueKeys=[...new Set(scenarios.filter(s=>s.issueKey!=='–').map(s=>s.issueKey))].slice(0,6);
  issueKeys.forEach((k,i)=>{
    nodes.push({id:`a${i}`,x:80+i*(W-120)/Math.max(issueKeys.length-1,1),y:270,label:k,type:'jira'});
    scenarios.filter(s=>s.issueKey===k).forEach((s,_)=>{
      const si=scenSample.indexOf(s);
      if(si>=0) edges.push([`s${si}`,`a${i}`]);
    });
  });

  const nodeMap=Object.fromEntries(nodes.map(n=>[n.id,n]));
  const edgeSvg=edges.map(([a,b])=>{const na=nodeMap[a],nb=nodeMap[b];if(!na||!nb)return '';
    return `<line x1="${na.x}" y1="${na.y}" x2="${nb.x}" y2="${nb.y}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>`;}).join('');
  const nodeSvg=nodes.map(n=>{
    const fill=n.type==='feature'?'#1f6feb':n.type==='jira'?'#3fb950':n.status==='Pass'?'#238636':n.status==='Fail'?'#da3633':'#6e7681';
    const r=n.type==='scenario'?14:n.type==='feature'?16:12;
    return `<g><circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>
      <text x="${n.x}" y="${n.y+3}" text-anchor="middle" fill="#e6edf3" font-size="7" font-weight="600">${e(n.label.slice(0,10))}</text>
      ${n.fail>0?`<circle cx="${n.x+r-2}" cy="${n.y-r+2}" r="5" fill="#f85149"/><text x="${n.x+r-2}" y="${n.y-r+5}" text-anchor="middle" fill="#fff" font-size="6">${n.fail}</text>`:''}
    </g>`;}).join('');
  const legend=`<div style="display:flex;gap:16px;font-size:11px;color:var(--text1);padding-top:8px">
    <span><span style="color:#1f6feb">●</span> Feature</span>
    <span><span style="color:#3fb950">●</span> Jira Linked</span>
    <span><span style="color:#238636">●</span> Pass</span>
    <span><span style="color:#da3633">●</span> Fail</span>
  </div>`;
  return `<div class="card" style="overflow:auto">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="min-width:600px">${edgeSvg}${nodeSvg}</svg>
    ${legend}
    <div style="display:flex;justify-content:space-around;font-size:11px;color:var(--text2);margin-top:6px">
      <span>Layer 1: Features</span><span>Layer 2: Scenarios</span><span>Layer 3: Jira Keys</span>
    </div>
  </div>`;
}

// ─── Phase 9: Executive Narrative ────────────────────────────────────────────
function buildExecutiveNarrative(m, rr, delta, scenarios) {
  const lines = [];
  // What happened
  lines.push(`<p class="narrative-para">In this run, <strong>${m.total} automated scenarios</strong> were executed across <strong>${Object.keys(Object.fromEntries(scenarios.map(s=>[s.featureName,1]))).length} features</strong> of the OrangeHRM platform. The execution completed in <strong>${fD(m.totalDuration)}</strong>, with <strong>${m.passed} scenarios passing</strong> and <strong style="color:${m.failed>0?'var(--fail)':'var(--pass)'}">${m.failed} failing</strong> — a pass rate of <strong>${m.passRate}%</strong>.</p>`);
  // Release verdict
  lines.push(`<p class="narrative-para">Release readiness assessment: <strong style="color:${rr.verdictColor}">${rr.verdict}</strong> (score: ${rr.score}/100). ${rr.risks.length ? `Key concerns: ${rr.risks.slice(0,2).join('; ')}.` : 'No release-blocking risks were identified.'}</p>`);
  // What changed
  if (delta.available) {
    const parts = [];
    if (delta.newFailures.length)  parts.push(`<strong style="color:var(--fail)">${delta.newFailures.length} new failure${delta.newFailures.length>1?'s':''}</strong> appeared`);
    if (delta.resolved.length)     parts.push(`<strong style="color:var(--pass)">${delta.resolved.length} failure${delta.resolved.length>1?'s':''}</strong> were resolved`);
    if (delta.regressions.length)  parts.push(`<strong style="color:var(--skip)">${delta.regressions.length} scenario${delta.regressions.length>1?'s':''}</strong> regressed in performance`);
    if (delta.improvements.length) parts.push(`<strong style="color:var(--pass)">${delta.improvements.length} scenario${delta.improvements.length>1?'s':''}</strong> improved in performance`);
    lines.push(`<p class="narrative-para">Since the last run: ${parts.length ? parts.join(', ') + '.' : 'no status changes detected — results are consistent.'}</p>`);
  }
  // What should be fixed first
  if (m.failed > 0) {
    const topFail = [...scenarios].filter(s=>s.status==='Fail').sort((a,b)=>a.errorClassification.priority-b.errorClassification.priority)[0];
    lines.push(`<p class="narrative-para">Priority action: <strong>${e(topFail.errorClassification.fix)}</strong> — targeting scenario "<em>${e(topFail.scenarioName)}</em>" classified as <strong>${e(topFail.errorClassification.type)}</strong> with ${topFail.errorClassification.confidence}% confidence. Estimated resolution: ${e(topFail.errorClassification.effort)}.</p>`);
  } else {
    lines.push(`<p class="narrative-para">No failures require immediate attention. Continue monitoring quality trends and consider expanding test coverage to any uncovered OrangeHRM modules.</p>`);
  }
  // Quality direction
  const dir = m.passRate >= 95 ? 'the platform demonstrates strong quality maturity' : m.passRate >= 80 ? 'quality is maintained at an acceptable level' : 'quality requires improvement before production deployment';
  lines.push(`<p class="narrative-para">Overall quality assessment: ${dir}. Evidence coverage stands at <strong>${m.evidenceCoverage}%</strong> with <strong>${m.totalScreenshots} screenshots</strong> and <strong>${m.withVideo} video${m.withVideo!==1?'s':''}</strong> captured for traceability.</p>`);
  return `<div class="card narrative-card">${lines.join('')}</div>`;
}

// ─── Phase 10: Demo Experience ────────────────────────────────────────────────
function buildDemoExperience(scenarios) {
  const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
  const FLOW = [
    { stage:'Dashboard',   step:'Dashboard Loaded',     explanation:'After authenticating, the user lands on the OrangeHRM dashboard where summary widgets and quick actions are presented.', outcome:'Dashboard rendered for the signed-in user' },
    { stage:'Admin',       step:'User Provisioned',     explanation:'An administrator creates a system user and assigns a role under the Admin module, controlling platform access.',        outcome:'System user created and role assigned' },
    { stage:'PIM',         step:'Employee Added',       explanation:'A new employee record is created in PIM, capturing personal details, job title, and employment status.',               outcome:'Employee record saved in PIM' },
    { stage:'Leave',       step:'Leave Requested',      explanation:'An employee submits a leave request which is routed through the approval workflow for a supervisor decision.',          outcome:'Leave request submitted for approval' },
    { stage:'Time',        step:'Timesheet Submitted',  explanation:'An employee records worked hours and submits a timesheet in the Time module for review and approval.',                 outcome:'Timesheet submitted for the period' },
    { stage:'Recruitment', step:'Candidate Processed',  explanation:'A job candidate progresses through the recruitment pipeline as vacancies, applications, and interviews are managed.',    outcome:'Candidate advanced in hiring pipeline' },
    { stage:'Performance', step:'Review Completed',     explanation:'A performance review is created and tracked for an employee, recording appraisal outcomes and KPIs.',                   outcome:'Performance review recorded' },
    { stage:'Directory',   step:'Directory Searched',   explanation:'The employee directory is queried to locate colleagues by name, job title, or organizational unit.',                   outcome:'Directory results returned to the user' },
  ];
  const stageMap = {};
  for(const st of APP_STAGES) stageMap[st]=[];
  for(const s of scenarios){ const st=APP_STAGES.find(x=>s.featureName?.toLowerCase().includes(x.toLowerCase())||s.scenarioName?.toLowerCase().includes(x.toLowerCase()))||'Directory'; stageMap[st].push(s); }
  const activeFlow = FLOW.filter(f=>stageMap[f.stage].length>0);
  if(!activeFlow.length) return `<div class="empty-state">No OrangeHRM workflow scenarios found in this run.</div>`;
  return `<div class="demo-flow">
    ${activeFlow.map((f,i)=>{
      const scs=stageMap[f.stage];
      const allPass=scs.every(s=>s.status==='Pass');
      const shots=scs.flatMap(s=>s.screenshots).slice(0,4);
      const vid=scs.find(s=>s.videoSrc)?.videoSrc;
      return `<div class="demo-step">
        <div class="demo-connector ${i===0?'first':''}"></div>
        <div class="demo-step-content">
          <div class="demo-step-header">
            <div class="demo-step-num">${i+1}</div>
            <div><div class="demo-step-title">${e(f.step)}</div>
              <div class="demo-step-status" style="color:${allPass?'var(--pass)':'var(--skip)'}">${allPass?'✅ Demonstrated':'⚠ In Progress'}</div></div>
          </div>
          <div class="demo-step-body">
            <div class="demo-explanation">${e(f.explanation)}</div>
            ${shots.length?`<div class="demo-shots">${shots.map(sc=>`<img src="${sc.dataUrl}" alt="${e(sc.label)}" onclick="openLightbox(this)" loading="lazy" title="${e(sc.label)}">`).join('')}</div>`:''}
            ${vid?`<div style="margin-top:10px"><video controls preload="metadata" style="width:100%;max-height:180px;border-radius:6px"><source src="${e(vid)}" type="video/webm"></video></div>`:''}
            <div class="demo-outcome"><span style="color:var(--pass)">▶</span> ${e(f.outcome)}</div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Phase 11: Quality Prediction ─────────────────────────────────────────────
function buildQualityPrediction(pred, history) {
  function sparkline(vals, w=120, h=32, col) {
    if(!vals||vals.length<2) return '';
    const max=Math.max(...vals)||1,min=Math.min(...vals),rng=max-min||1;
    const pts=vals.map((v,i)=>[(4+(i/(vals.length-1))*(w-8)).toFixed(1),(h-4-((v-min)/rng)*(h-8)).toFixed(1)]);
    const poly=pts.map(p=>p.join(',')).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible" style="display:block"><polyline points="${poly}" fill="none" stroke="${col}" stroke-width="1.5"/><circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3" fill="${col}"/></svg>`;
  }
  const predictions = pred.predictions || [];
  if(!predictions.length) return `<div class="card" style="text-align:center;padding:36px"><div style="font-size:32px">📊</div><div style="font-size:14px;font-weight:600;margin-top:12px">Predictions build with history</div><div style="font-size:12px;color:var(--text1);margin-top:6px">${history.length} run${history.length!==1?'s':''} recorded · need 3+ for predictions</div></div>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <div class="card" style="padding:14px 20px"><div style="font-size:11px;color:var(--text1)">Predicted Pass Rate (next run)</div><div style="font-size:24px;font-weight:800;color:${pred.predictedPassRate>=80?'var(--pass)':pred.predictedPassRate>=60?'var(--skip)':'var(--fail)'}">${pred.predictedPassRate}%</div></div>
    <div class="card" style="padding:14px 20px"><div style="font-size:11px;color:var(--text1)">Release Confidence</div><div style="font-size:24px;font-weight:800;color:var(--info)">${pred.confidence}%</div></div>
    <div class="card" style="padding:14px 20px"><div style="font-size:11px;color:var(--text1)">Risk Trend</div><div style="font-size:24px;font-weight:800;color:${pred.riskTrend==='↓ Decreasing'?'var(--pass)':pred.riskTrend==='↑ Increasing'?'var(--fail)':'var(--skip)'}">${e(pred.riskTrend)}</div></div>
  </div>
  <div class="card-grid card-grid-2">
    ${predictions.map(p=>`<div class="card" style="display:flex;align-items:center;gap:12px;border-left:3px solid ${p.risk==='HIGH'?'var(--fail)':p.risk==='MEDIUM'?'var(--skip)':'var(--pass)'}">
      <div style="flex:1"><div style="font-size:13px;font-weight:600">${e(p.feature)}</div>
        <div style="font-size:11px;color:var(--text1);margin-top:2px">${e(p.prediction)}</div></div>
      ${sparkline(p.trend||[], 80, 28, p.risk==='HIGH'?'#f85149':p.risk==='MEDIUM'?'#e3b341':'#3fb950')}
      <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${p.risk==='HIGH'?'rgba(248,81,73,.15)':p.risk==='MEDIUM'?'rgba(227,179,65,.15)':'rgba(63,185,80,.15)'};color:${p.risk==='HIGH'?'var(--fail)':p.risk==='MEDIUM'?'var(--skip)':'var(--pass)'};font-weight:600">${e(p.risk)}</span>
    </div>`).join('')}
  </div>`;
}

// ─── Phase 12: Portfolio View ─────────────────────────────────────────────────
function buildPortfolioView(m) {
  const currentApp = {
    name: 'OrangeHRM',
    env: process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'OrangeHRM',
    scenarios: m.total, passRate: m.passRate, status: m.passRate >= 80 ? 'HEALTHY' : m.passRate >= 60 ? 'AT RISK' : 'CRITICAL',
    features: 'Dashboard · PIM · Leave · Recruitment · Login',
  };
  return `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--pass)">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="font-size:32px">🏢</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:700">${e(currentApp.name)}</div>
        <div style="font-size:12px;color:var(--text1);margin-top:2px">${e(currentApp.env)} · ${e(currentApp.features)}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:28px;font-weight:900;color:${currentApp.passRate>=80?'var(--pass)':currentApp.passRate>=60?'var(--skip)':'var(--fail)'}">${currentApp.passRate}%</div>
        <div style="font-size:10px;color:var(--text1)">Pass Rate</div>
      </div>
      <span style="padding:6px 14px;border-radius:12px;font-size:12px;font-weight:700;background:${currentApp.status==='HEALTHY'?'rgba(63,185,80,.15)':currentApp.status==='AT RISK'?'rgba(227,179,65,.15)':'rgba(248,81,73,.15)'};color:${currentApp.status==='HEALTHY'?'var(--pass)':currentApp.status==='AT RISK'?'var(--skip)':'var(--fail)'};border:1px solid currentColor">${currentApp.status}</span>
    </div>
    <div style="margin-top:12px;font-size:12px;color:var(--text1)">${m.total} scenarios · ${m.totalScreenshots} screenshots · ${m.withVideo} videos · ${m.withTag} Jira-linked</div>
  </div>
  <div class="card-grid card-grid-3">
    ${['Future Application 2','Future Application 3','Future Application 4'].map((app,i)=>`<div class="card" style="text-align:center;padding:24px;opacity:.4;border-style:dashed">
      <div style="font-size:24px;margin-bottom:8px">➕</div>
      <div style="font-size:13px;font-weight:600;color:var(--text1)">${e(app)}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">Configure via PORTFOLIO_APP_${i+2} env var</div>
    </div>`).join('')}
  </div>
  <div class="card" style="margin-top:16px;border-color:rgba(121,192,255,.3)">
    <div style="font-size:12px;color:var(--info);font-weight:600;margin-bottom:8px">Portfolio Expansion Guide</div>
    <div style="font-size:12px;color:var(--text1)">To add an application to the portfolio: set <code style="color:var(--info)">PORTFOLIO_APP_N=&lt;name&gt;</code>, <code style="color:var(--info)">PORTFOLIO_URL_N=&lt;url&gt;</code>, and <code style="color:var(--info)">PORTFOLIO_REPORT_N=&lt;path&gt;</code> environment variables. Each application runs its own Cucumber suite and reports are aggregated here.</div>
  </div>`;
}

// ─── Additional CSS for WI-044B ───────────────────────────────────────────────
function buildCommandCenterStyles() {
  return `
.mc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;}
@media(max-width:900px){.mc-grid{grid-template-columns:repeat(2,1fr);}}
.mc-panel{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 12px;text-align:center;cursor:pointer;transition:all .2s;}
.mc-panel:hover{background:var(--bg3);border-color:var(--accent);}
.mc-panel-icon{font-size:24px;margin-bottom:6px;}
.mc-panel-title{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:4px;}
.mc-panel-val{font-size:18px;font-weight:800;line-height:1.2;margin-bottom:2px;}
.mc-panel-sub{font-size:10px;color:var(--text2);}
.mc-alerts{background:var(--bg2);border:1px solid rgba(248,81,73,.3);border-radius:var(--radius);padding:10px 16px;}
.mc-alert{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;}
.narrative-card{line-height:1.7;}
.narrative-para{font-size:14px;color:var(--text0);margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.narrative-para:last-child{border-bottom:none;margin-bottom:0;}
.demo-flow{position:relative;}
.demo-step{display:flex;gap:0;margin-bottom:0;position:relative;}
.demo-connector{width:2px;background:var(--border);flex-shrink:0;margin-left:22px;min-height:20px;}
.demo-connector.first{min-height:0;}
.demo-step-content{flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin:0 0 12px 12px;padding:16px;}
.demo-step-header{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
.demo-step-num{width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;flex-shrink:0;}
.demo-step-title{font-size:15px;font-weight:700;}
.demo-step-status{font-size:12px;margin-top:2px;}
.demo-explanation{font-size:13px;color:var(--text1);margin-bottom:10px;line-height:1.5;}
.demo-shots{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.demo-shots img{width:160px;height:100px;object-fit:cover;border-radius:5px;border:2px solid var(--border);cursor:pointer;}
.demo-shots img:hover{border-color:var(--accent2);}
.demo-outcome{font-size:12px;color:var(--pass);margin-top:8px;padding:6px 10px;background:rgba(63,185,80,.08);border-radius:4px;}
.twin-node{cursor:pointer;} .twin-node:hover circle{stroke-width:3;}`;
}

// ─── WI-044B Additional JS ─────────────────────────────────────────────────────
function buildCommandCenterScripts() {
  return `
window.scrollToSection=function(id){const el=document.getElementById(id);if(el){el.scrollIntoView({behavior:'smooth'});document.querySelectorAll('.nav-link').forEach(l=>l.classList.toggle('active',l.dataset.section===id));}}
window.highlightEntity=function(id){const sectionMap={auth:'sec-env',pim:'sec-biz',leave:'sec-biz',time:'sec-biz',recruit:'sec-biz',perf:'sec-rc',jira:'sec-jira'};const sec=sectionMap[id];if(sec)window.scrollToSection(sec);}`;
}

module.exports = {
  buildMissionControl, buildDecisionEngine, buildDigitalTwin, buildCoverageMap,
  buildDefectEconomics, buildHealingEffectiveness, buildEnvironmentObservability,
  buildIntelligenceGraph, buildExecutiveNarrative, buildDemoExperience,
  buildQualityPrediction, buildPortfolioView,
  buildCommandCenterStyles, buildCommandCenterScripts,
};
