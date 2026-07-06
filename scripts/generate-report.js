'use strict';
/**
 * generate-report.js — WI-044A
 * Enterprise QA Intelligence Platform — Decision Support System
 *
 * 12 phases: Release Readiness · Business Impact · Quality Trends · Delta ·
 * AI Insights · Risk Heatmap · Failure Clusters · Executive One-Pager ·
 * Test Case Value · AI Actions · Story Mode · Certification
 *
 * Usage : node scripts/generate-report.js
 *         REPORT_MODE=story node scripts/generate-report.js
 */

const fs   = require('fs');
const path = require('path');
require('./ensure-dirs');

const ROOT          = path.resolve(__dirname, '..');
const CUCUMBER_FILE = path.join(ROOT, 'reports', 'cucumber-report.json');
const REPORTS_DIR   = path.join(ROOT, 'reports');
const OUT_DIR       = path.join(ROOT, 'custom-report');
const OUT_FILE      = path.join(OUT_DIR, 'index.html');
const HISTORY_FILE  = path.join(REPORTS_DIR, 'run-history.json');
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'last-run-snapshot.json');
const REPORT_MODE   = process.env.REPORT_MODE || 'executive';

// ─── Loader ───────────────────────────────────────────────────────────────────
function loadJson(filename, def) {
  try {
    const fp = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(fp)) return def;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { return def; }
}
function writePhaseJson(filename, data) {
  try {
    fs.writeFileSync(path.join(REPORTS_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
    console.log(`  ✓ ${filename}`);
  } catch (e) { console.warn(`  ⚠ ${filename}: ${e.message}`); }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const escHtml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtDuration = ms => ms>=60000?`${(ms/60000).toFixed(1)}m`:ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`;

function classifyError(msg) {
  if (!msg) return { type:'UNKNOWN', label:'Unknown', confidence:0, fix:'Review test logs.', effort:'–', owner:'QA Team', priority:5 };
  const m = msg.toLowerCase();
  if (m.includes('timeout')||m.includes('timed out'))
    return { type:'TIMEOUT', label:'Timeout', confidence:92, priority:2, effort:'30 min', owner:'QA Automation',
      fix:'Increase CUCUMBER_STEP_TIMEOUT_MS or verify page load triggers. Check network latency.' };
  if (m.includes('no element')||m.includes('locator')||m.includes('selector')||m.includes('not found'))
    return { type:'LOCATOR_DRIFT', label:'Locator Drift', confidence:95, priority:1, effort:'15 min', owner:'QA Automation',
      fix:'Run self-healing agent to re-detect selector. Check for DOM changes after recent deployment.' };
  if (m.includes('hidden')||m.includes('not visible')||m.includes('obscured'))
    return { type:'ELEMENT_HIDDEN', label:'Element Hidden', confidence:88, priority:3, effort:'30 min', owner:'QA Automation',
      fix:'Add scroll-into-view or wait-for-visible before interaction.' };
  if (m.includes('navigation')||m.includes('net::err')||m.includes('failed to load'))
    return { type:'NAVIGATION_FAILURE', label:'Navigation Failure', confidence:90, priority:1, effort:'20 min', owner:'DevOps',
      fix:'Verify TEST_BASE_URL environment variable and network connectivity.' };
  if (m.includes('auth')||m.includes('login')||m.includes('401')||m.includes('403')||m.includes('storage'))
    return { type:'AUTH_FAILURE', label:'Auth Failure', confidence:93, priority:1, effort:'10 min', owner:'DevOps/QA Manager',
      fix:'Re-run: node scripts/manual-auth.js  Storage state expires after 55 minutes.' };
  return { type:'UNEXPECTED_ERROR', label:'Unexpected Error', confidence:60, priority:4, effort:'60 min', owner:'QA Automation',
    fix:'Review full stack trace. Consider adding targeted error handling.' };
}

function svgRing(pct, color, label, sub, size=110) {
  const r=40, cx=size/2, cy=size/2, circ=2*Math.PI*r;
  const fill=Math.min(pct/100,1)*circ;
  return `<div class="kpi-ring"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="8"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
      stroke-dasharray="${fill.toFixed(2)} ${circ.toFixed(2)}" stroke-dashoffset="${(circ/4).toFixed(2)}"
      stroke-linecap="round"/>
    <text x="${cx}" y="${cy-4}" text-anchor="middle" fill="${color}" font-size="16" font-weight="700">${Math.round(pct)}%</text>
    <text x="${cx}" y="${cy+14}" text-anchor="middle" fill="rgba(255,255,255,.45)" font-size="9">${escHtml(label)}</text>
  </svg><div class="kpi-label">${escHtml(sub||label)}</div></div>`;
}

function donutChart(passed, failed, skipped, total) {
  if (!total) return `<div class="donut-empty">No Data</div>`;
  const pp=(passed/total)*100, fp=(failed/total)*100, sp=(skipped/total)*100;
  const g=`conic-gradient(#3fb950 0% ${pp}%, #f85149 ${pp}% ${pp+fp}%, #e3b341 ${pp+fp}% ${pp+fp+sp}%, #30363d ${pp+fp+sp}% 100%)`;
  return `<div class="donut-wrap"><div class="donut" style="background:${g}"><div class="donut-hole"><span class="donut-pct">${Math.round(pp)}%</span><span class="donut-sub">Pass</span></div></div>
  <div class="donut-legend"><div class="dl-row"><span class="dl-dot pass"></span>${passed} Pass</div>
  <div class="dl-row"><span class="dl-dot fail"></span>${failed} Fail</div>
  <div class="dl-row"><span class="dl-dot skip"></span>${skipped} Skip</div></div></div>`;
}

function svgSparkline(values, w=200, h=48, color='#3fb950', filled=true) {
  if (!values||values.length<2) return `<svg width="${w}" height="${h}"><text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,.2)" font-size="10">No data</text></svg>`;
  const max=Math.max(...values)||1, min=Math.min(...values), range=max-min||1;
  const pad=4;
  const pts=values.map((v,i)=>{
    const x=(pad+(i/(values.length-1))*(w-pad*2)).toFixed(1);
    const y=(h-pad-((v-min)/range)*(h-pad*2)).toFixed(1);
    return [x,y];
  });
  const poly=pts.map(p=>p.join(',')).join(' ');
  const fillPath=filled?`<path d="M${pts[0][0]},${h} ${poly} ${pts[pts.length-1][0]},${h}Z" fill="${color}" opacity=".12"/>`: '';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">
    ${fillPath}<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3" fill="${color}"/>
  </svg>`;
}

// ─── Business capability map ──────────────────────────────────────────────────
const BIZ_MAP = {
  Dashboard:   { name:'Dashboard Overview',     impact:'HIGH',     process:'HR Dashboard Entry',        color:'#e3b341' },
  Admin:       { name:'Admin User Management',  impact:'CRITICAL', process:'User Provisioning Gate',     color:'#f85149' },
  PIM:         { name:'PIM Employee Management',impact:'CRITICAL', process:'Employee Lifecycle',         color:'#f85149' },
  Leave:       { name:'Leave Management',       impact:'HIGH',     process:'Leave Workflow',             color:'#e3b341' },
  Time:        { name:'Time & Attendance',      impact:'HIGH',     process:'Timesheet Processing',       color:'#e3b341' },
  Recruitment: { name:'Recruitment',            impact:'CRITICAL', process:'Hiring Pipeline',            color:'#f85149' },
  Performance: { name:'Performance Reviews',    impact:'HIGH',     process:'Appraisal Processing',       color:'#e3b341' },
  Directory:   { name:'Directory',              impact:'MEDIUM',   process:'Employee Directory Lookup',  color:'#79c0ff' },
  Auth:        { name:'Authentication',         impact:'CRITICAL', process:'Platform Access Control',    color:'#f85149' },
  Jira:        { name:'Jira Integration',       impact:'HIGH',     process:'Test Management Sync',       color:'#e3b341' },
};
const APP_STAGES = ['Dashboard','Admin','PIM','Leave','Time','Recruitment','Performance','Directory'];
function getAppStage(s) {
  return APP_STAGES.find(st=>
    s.featureName.toLowerCase().includes(st.toLowerCase())||
    s.scenarioName.toLowerCase().includes(st.toLowerCase()))||'Directory';
}
function getBizCap(s) {
  const stage = getAppStage(s);
  return BIZ_MAP[stage]||BIZ_MAP.Directory;
}

// ─── Requirement ID extraction ────────────────────────────────────────────────
function extractRequirementId(tags) {
  for (const t of tags) {
    const m = t.replace(/^@/,'').match(/^(?:story|req|requirement)-?(\d+)$/i);
    if (m) return m[1];
  }
  return process.env.ISSUE_KEY || 'OHRM-1';
}

// ─── Cucumber parser — deep intelligence extraction ───────────────────────────
function parseCucumber(features) {
  const scenarios = [];
  for (const feature of (features||[])) {
    const featureName = feature.name||'Unknown Feature';
    const featureUri  = feature.uri||'';
    for (const element of (feature.elements||[])) {
      if (element.type==='background') continue;
      const scenarioName = element.name||'Unknown Scenario';
      const tags   = (element.tags||[]).map(t=>t.name||'').filter(Boolean);
      const issueTag = tags.find(t=>/^@?AI_SDLC-T\d+$/i.test(t))||null;
      const issueKey = issueTag?issueTag.replace(/^@/,''):'–';
      const requirementId = extractRequirementId(tags);

      let totalNs=0, status='passed', errorMsg='', errorStack='';
      const steps=[], screenshots=[];
      let videoDataUrl=null, videoRelPath=null;
      let consoleLogs=[], networkLogs=[], apiCalls=[];
      let cumulativeMs=0;

      for (const step of (element.steps||[])) {
        const ss  = step.result?.status||'skipped';
        const ns  = step.result?.duration||0;
        const stepMs = Math.round(ns/1_000_000);
        totalNs  += ns;

        // Per-step screenshots (from step-level embeddings)
        const stepShots=[];
        for (const emb of (step.embeddings||[])) {
          if (emb.mime_type==='image/png'&&emb.data) {
            const isHook = !!step.hidden;
            const label  = isHook
              ? (step.keyword?.trim()==='Before'?'Before hook':'After hook — end state')
              : `${(step.keyword||'').trim()} ${step.name||''}`.trim();
            const entry  = {label,dataUrl:'data:image/png;base64,'+emb.data,fromHook:isHook,stepKeyword:(step.keyword||'').trim(),stepName:step.name||''};
            screenshots.push(entry);
            if (!isHook) stepShots.push({label:entry.label,dataUrl:entry.dataUrl});
          }
          if (emb.mime_type==='video/webm'&&emb.data&&!videoDataUrl&&!videoRelPath) {
            videoDataUrl='data:video/webm;base64,'+emb.data;
          }
          if (emb.mime_type==='text/plain'&&emb.data) {
            try {
              const txt=Buffer.from(emb.data,'base64').toString('utf8');
              if (txt.startsWith('video:')    && !videoRelPath)  videoRelPath=txt.slice(6).trim();
              else if (txt.startsWith('console:')) { try{consoleLogs=JSON.parse(txt.slice(8));}catch{} }
              else if (txt.startsWith('network:')) { try{networkLogs=JSON.parse(txt.slice(8));}catch{} }
              else if (txt.startsWith('api:'))     { try{apiCalls=JSON.parse(txt.slice(4));}catch{} }
            } catch {}
          }
        }

        // Status tracking
        if (ss==='failed') {
          status='failed';
          const raw=step.result?.error_message||'';
          // Split first line (message) from rest (stack trace)
          const nl=raw.indexOf('\n');
          errorMsg   = nl>-1 ? raw.slice(0,nl).trim() : raw.trim();
          errorStack = nl>-1 ? raw.slice(nl+1).trim() : '';
        } else if (status!=='failed'&&ss==='skipped') {
          status='skipped';
        }

        // Build step object with per-step intelligence fields
        if (!step.hidden) {
          const stepErr = step.result?.error_message||null;
          let stepErrMsg=null, stepErrStack=null;
          if (stepErr) {
            const nl=stepErr.indexOf('\n');
            stepErrMsg   = nl>-1 ? stepErr.slice(0,nl).trim() : stepErr.trim();
            stepErrStack = nl>-1 ? stepErr.slice(nl+1).trim() : null;
          }
          steps.push({
            keyword:         (step.keyword||'').trim(),
            name:            step.name||'',
            status:          ss,
            durationMs:      stepMs,
            error:           stepErrMsg,
            stack:           stepErrStack,
            screenshots:     stepShots,
            videoTimestampMs: cumulativeMs,   // cumulative offset = when this step started
          });
        }
        cumulativeMs += stepMs;
      }

      const durationMs=Math.round(totalNs/1_000_000);
      const normalized=status==='passed'?'Pass':status==='failed'?'Fail':status==='skipped'?'Skipped':'Pending';
      scenarios.push({
        featureName, featureUri, scenarioName, tags, issueKey, requirementId,
        status: normalized, durationMs, errorMsg, errorStack, steps, screenshots,
        videoDataUrl, videoRelPath, videoSrc: videoRelPath||videoDataUrl||null,
        consoleLogs, networkLogs, apiCalls,
        errorClassification: classifyError(errorMsg),
      });
    }
  }
  return scenarios;
}

// ─── Core metrics ─────────────────────────────────────────────────────────────
function computeMetrics(scenarios) {
  const total=scenarios.length, passed=scenarios.filter(s=>s.status==='Pass').length,
    failed=scenarios.filter(s=>s.status==='Fail').length,
    skipped=scenarios.filter(s=>s.status==='Skipped'||s.status==='Pending').length;
  const passRate=total?Math.round(passed/total*100):0;
  const withScreenshots=scenarios.filter(s=>s.screenshots.length>0).length;
  const withVideo=scenarios.filter(s=>s.videoSrc).length;
  const withTag=scenarios.filter(s=>s.issueKey!=='–').length;
  const totalScreenshots=scenarios.reduce((a,s)=>a+s.screenshots.length,0);
  const durations=scenarios.map(s=>s.durationMs).filter(d=>d>0);
  const avgDuration=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0;
  const totalDuration=durations.reduce((a,b)=>a+b,0);
  const executionHealth=passRate;
  const qualityConfidence=total?Math.round(((passed+skipped*0.3)/total)*100):0;
  const automationCoverage=total?Math.round(withTag/total*100):0;
  const evidenceCoverage=total?Math.round(withScreenshots/total*100):0;
  const defectLeakageRisk=failed>0?Math.max(0,100-Math.round(failed/total*100*3)):100;
  // healingScore: proxy derived from absence of systemic failure patterns (AUTH/ENV/5XX).
  // Hardcoded constant removed — now reflects actual failure signal quality.
  const systemicFails=scenarios.filter(s=>s.status==='Fail'&&['AUTH_FAILURE','NAVIGATION_FAILURE'].includes(s.errorClassification?.type)).length;
  const healingScore=total?Math.round(Math.max(30, 100 - (systemicFails/Math.max(total,1))*200)):100;
  const jiraSyncHealth=automationCoverage;
  // environmentReady: compute from absence of auth/nav failures, not from pass/fail proxy.
  const authFails2=scenarios.filter(s=>s.status==='Fail'&&s.errorClassification?.type==='AUTH_FAILURE').length;
  const navFails2 =scenarios.filter(s=>s.status==='Fail'&&s.errorClassification?.type==='NAVIGATION_FAILURE').length;
  const environmentReady=authFails2>0?0:navFails2>0?Math.round(40+passed/Math.max(total,1)*40):passed>0?Math.round(70+passed/Math.max(total,1)*30):50;
  const featureGroups={};
  for (const s of scenarios) {
    if (!featureGroups[s.featureName]) featureGroups[s.featureName]={pass:0,fail:0,total:0};
    featureGroups[s.featureName].total++;
    if (s.status==='Pass') featureGroups[s.featureName].pass++;
    if (s.status==='Fail') featureGroups[s.featureName].fail++;
  }
  const sortedByFail=Object.entries(featureGroups).sort(([,a],[,b])=>b.fail-a.fail);
  const sortedByTotal=Object.entries(featureGroups).sort(([,a],[,b])=>b.total-a.total);
  const longestScenario=[...scenarios].sort((a,b)=>b.durationMs-a.durationMs)[0];
  const errorTypes={};
  for (const s of scenarios.filter(s=>s.status==='Fail')) { const t=s.errorClassification.type; errorTypes[t]=(errorTypes[t]||0)+1; }
  const mostCommonError=Object.entries(errorTypes).sort(([,a],[,b])=>b-a)[0];
  return { total,passed,failed,skipped,passRate,withScreenshots,withVideo,withTag,totalScreenshots,
    avgDuration,totalDuration,executionHealth,qualityConfidence,automationCoverage,evidenceCoverage,
    defectLeakageRisk,healingScore,jiraSyncHealth,environmentReady,
    featureGroups,mostUnstable:sortedByFail[0],mostExecuted:sortedByTotal[0],
    longestScenario,mostCommonError,errorTypes };
}

// ─── Phase 1: Release Readiness ───────────────────────────────────────────────
function computeReleaseReadiness(m, scenarios) {
  const criticalFails = scenarios.filter(s=>{
    const biz=getBizCap(s);
    return s.status==='Fail'&&(biz.impact==='CRITICAL'||biz.impact==='HIGH');
  }).length;
  const criticalCoverage = m.total?Math.max(0,100-Math.round(criticalFails/m.total*100*2)):100;
  const score = Math.round(
    m.executionHealth*0.30 + criticalCoverage*0.20 + m.environmentReady*0.15 +
    m.jiraSyncHealth*0.15 + m.evidenceCoverage*0.10 + m.healingScore*0.10);
  const verdict = score>=85?'READY':score>=65?'READY WITH RISKS':'NOT READY';
  const verdictColor = score>=85?'#3fb950':score>=65?'#e3b341':'#f85149';
  const risks=[];
  if (m.failed>0)              risks.push(`${m.failed} scenario${m.failed>1?'s':''} failed`);
  if (criticalFails>0)         risks.push(`${criticalFails} critical-path failure${criticalFails>1?'s':''}`);
  if (m.automationCoverage<80) risks.push(`Jira traceability at ${m.automationCoverage}% (target: 80%)`);
  if (m.evidenceCoverage<90)   risks.push(`Evidence coverage at ${m.evidenceCoverage}% (target: 90%)`);
  return {score,verdict,verdictColor,criticalCoverage,risks,
    factors:{executionSuccess:m.executionHealth,criticalCoverage,envHealth:m.environmentReady,
      jiraSync:m.jiraSyncHealth,evidence:m.evidenceCoverage,healing:m.healingScore}};
}

// ─── Phase 2: Business Impact ─────────────────────────────────────────────────
function computeBusinessImpact(scenarios) {
  const caps={};
  for (const s of scenarios) {
    const biz=getBizCap(s), k=biz.name;
    if (!caps[k]) caps[k]={...biz,scenarios:[],pass:0,fail:0,total:0};
    caps[k].scenarios.push(s); caps[k].total++;
    if (s.status==='Pass') caps[k].pass++;
    if (s.status==='Fail') caps[k].fail++;
  }
  return Object.values(caps).sort((a,b)=>{
    const order={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};
    return (order[a.impact]??4)-(order[b.impact]??4)||(b.fail-a.fail);
  });
}

// ─── Phase 3: Run History ─────────────────────────────────────────────────────
function loadRunHistory() {
  try { if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')); } catch {}
  return [];
}
function appendRunHistory(entry) {
  const history=loadRunHistory();
  history.push(entry);
  const trimmed=history.slice(-90);
  try { fs.writeFileSync(HISTORY_FILE,JSON.stringify(trimmed,null,2),'utf8'); } catch {}
  return trimmed;
}

// ─── Phase 4: Delta (What Changed) ───────────────────────────────────────────
function computeDelta(scenarios) {
  let prev=[];
  try { if (fs.existsSync(SNAPSHOT_FILE)) prev=JSON.parse(fs.readFileSync(SNAPSHOT_FILE,'utf8')); } catch {}
  if (!prev.length) return {available:false,newFailures:[],resolved:[],regressions:[],improvements:[],newScenarios:[]};
  const prevMap=Object.fromEntries(prev.map(s=>[s.scenarioName,s]));
  const currMap=Object.fromEntries(scenarios.map(s=>[s.scenarioName,s]));
  const newFailures=scenarios.filter(s=>s.status==='Fail'&&(!prevMap[s.scenarioName]||prevMap[s.scenarioName].status!=='Fail'));
  const resolved=scenarios.filter(s=>s.status==='Pass'&&prevMap[s.scenarioName]?.status==='Fail');
  const newScenarios=scenarios.filter(s=>!prevMap[s.scenarioName]);
  const regressions=scenarios.filter(s=>{ const p=prevMap[s.scenarioName]; return p&&s.durationMs>p.durationMs*1.3&&s.durationMs-p.durationMs>500; });
  const improvements=scenarios.filter(s=>{ const p=prevMap[s.scenarioName]; return p&&p.durationMs>s.durationMs*1.3&&p.durationMs-s.durationMs>500; });
  return {available:true,newFailures,resolved,regressions,improvements,newScenarios};
}
function saveSnapshot(scenarios) {
  const snap=scenarios.map(s=>({scenarioName:s.scenarioName,status:s.status,durationMs:s.durationMs,issueKey:s.issueKey}));
  try { fs.writeFileSync(SNAPSHOT_FILE,JSON.stringify(snap,null,2),'utf8'); } catch {}
}

// ─── Phase JSON generators (WI-043 preserved) ────────────────────────────────
function generatePhaseJsons(scenarios, runDate, supplemental) {
  const now=new Date().toISOString();
  writePhaseJson('screenshot-integration-analysis.json',{
    generatedAt:now,totalScenarios:scenarios.length,
    scenariosWithScreenshots:scenarios.filter(s=>s.screenshots.length>0).length,
    totalScreenshots:scenarios.reduce((a,s)=>a+s.screenshots.length,0),
    scenarios:scenarios.map(s=>({scenarioName:s.scenarioName,issueKey:s.issueKey,status:s.status,
      screenshotCount:s.screenshots.length,hookScreenshots:s.screenshots.filter(sc=>sc.fromHook).length,
      hasEndStateShot:s.screenshots.some(sc=>sc.fromHook&&sc.stepKeyword==='After'),
      hasFailureShot:s.status==='Fail'&&s.screenshots.length>0}))
  });
  writePhaseJson('video-integration-analysis.json',{
    generatedAt:now,scenariosWithVideo:scenarios.filter(s=>s.videoSrc).length,totalScenarios:scenarios.length,
    scenarios:scenarios.map(s=>({scenarioName:s.scenarioName,issueKey:s.issueKey,status:s.status,
      hasVideo:!!s.videoSrc,videoSource:s.videoRelPath?'file-path':s.videoDataUrl?'base64':'none'}))
  });
  let cum=0;
  writePhaseJson('execution-timeline.json',{generatedAt:now,runDate,
    totalDurationMs:(cum=scenarios.reduce((a,s)=>a+s.durationMs,0)),totalDurationFormatted:fmtDuration(cum),
    scenarios:scenarios.map((s,i)=>({index:i+1,scenarioName:s.scenarioName,issueKey:s.issueKey,status:s.status,durationMs:s.durationMs}))
  });
  const autopsiesRaw=supplemental.autopsies;
  const autopsies=Array.isArray(autopsiesRaw)?autopsiesRaw:autopsiesRaw&&Array.isArray(autopsiesRaw.autopsies)?autopsiesRaw.autopsies:[];
  const failedS=scenarios.filter(s=>s.status==='Fail');
  writePhaseJson('failure-diagnostics.json',{generatedAt:now,totalFailures:failedS.length,
    diagnostics:failedS.map(s=>{
      const a=autopsies.find(x=>x.scenarioName===s.scenarioName)||{};
      return {scenarioName:s.scenarioName,issueKey:s.issueKey,errorMessage:s.errorMsg||null,
        errorType:s.errorClassification.type,screenshotCount:s.screenshots.length,
        hasVideo:!!s.videoSrc,url:a.url||null,consoleErrors:a.consoleErrors||[],networkFailures:a.networkFailures||[]};
    })
  });
  const healingEvents=[];
  try { const {readDecisions}=require('../src/agents/agentDecisionLog'); const d=readDecisions({limit:200});
    for (const x of (d||[])) if (x.agentName?.toLowerCase().includes('heal')) healingEvents.push({timestamp:x.timestamp,agent:x.agentName,output:x.output||{}}); } catch {}
  writePhaseJson('healing-visibility.json',{generatedAt:now,healingEventCount:healingEvents.length,events:healingEvents});
  const jiraDbg=supplemental.jiraDebug||{};
  writePhaseJson('jira-sync-visibility.json',{generatedAt:now,totalScenarios:scenarios.length,
    scenariosWithIssueKey:scenarios.filter(s=>s.issueKey!=='–').length,
    scenarios:scenarios.map(s=>({scenarioName:s.scenarioName,issueKey:s.issueKey,status:s.status,hasIssueKey:s.issueKey!=='–'}))
  });
  const stageMap={};
  for (const st of APP_STAGES) stageMap[st]={stage:st,scenarios:[],pass:0,fail:0,blocked:0};
  for (const s of scenarios) {
    const st=getAppStage(s); stageMap[st].scenarios.push({name:s.scenarioName,issueKey:s.issueKey,status:s.status});
    if (s.status==='Pass') stageMap[st].pass++;
    else if (s.status==='Fail') stageMap[st].fail++;
    else stageMap[st].blocked++;
  }
  writePhaseJson('app-process-visualization.json',{generatedAt:now,
    stages:Object.values(stageMap).map(st=>({...st,total:st.scenarios.length,
      health:st.total===0?'EMPTY':st.fail>0?'FAIL':st.blocked>0?'BLOCKED':'PASS'}))
  });
  const issues=[];
  for (const s of scenarios) {
    if (!s.screenshots.length) issues.push({scenarioName:s.scenarioName,issue:'NO_SCREENSHOTS',severity:'warn'});
    if (s.status==='Fail'&&!s.videoSrc) issues.push({scenarioName:s.scenarioName,issue:'FAIL_NO_VIDEO',severity:'info'});
    if (s.issueKey==='–') issues.push({scenarioName:s.scenarioName,issue:'NO_ISSUE_TAG',severity:'warn'});
  }
  writePhaseJson('report-attachment-validation.json',{generatedAt:now,
    validationPassed:!issues.some(i=>i.severity==='error'),issueCount:issues.length,issues});
}

// ─── WI-044B Computation Functions ───────────────────────────────────────────
function computeDefectEconomics(m, scenarios, healingData) {
  const scenariosPerHour = m.totalDuration > 0 ? Math.round(m.total / (m.totalDuration / 3600000) * 10) / 10 : 0;
  const manualMinsPerScenario = 8; // avg manual execution time per scenario in minutes
  const manualHoursSaved = Math.round(m.total * manualMinsPerScenario / 60 * 10) / 10;
  const automationHours  = manualHoursSaved;
  const healingEvents = healingData?.events?.length || 0;
  const healingHours  = Math.round(healingEvents * 0.5 * 10) / 10; // 30 min avg per heal
  const defectsCaught = m.failed;
  const executionMins = Math.round(m.totalDuration / 60000);
  const roiSummary = `This run automated ${m.total} scenarios saving approximately ${automationHours} hours of manual effort. AI healing saved ~${healingHours} hours of locator-fix rework. ${defectsCaught > 0 ? `${defectsCaught} defect${defectsCaught>1?'s':''} detected early, avoiding potential production incidents.` : 'All scenarios passed — zero defect leakage risk.'}`;
  return { automationHours, healingHours, scenariosPerHour, defectsCaught, executionMins, manualHoursSaved, roiSummary };
}

function computeHealingEffectiveness(healingData, history) {
  const events = healingData?.events?.length || 0;
  const score = events === 0 ? 100 : Math.min(100, 70 + Math.round((events / Math.max(events, 5)) * 30));
  return { events, score, humanAssisted: 0, promoted: 0 };
}

function computeEnvironmentHealth(m, scenarios) {
  const authFails  = scenarios.filter(s => s.status === 'Fail' && s.errorClassification?.type === 'AUTH_FAILURE').length;
  const navFails   = scenarios.filter(s => s.status === 'Fail' && s.errorClassification?.type === 'NAVIGATION_FAILURE').length;
  const authScore  = authFails  > 0 ? 0   : 100;
  const appScore   = navFails   > 0 ? 30  : m.passRate;
  // dataScore: derived from absence of API 5xx and null-reference errors (not from pass rate proxy).
  const api5xxCount= scenarios.filter(s=>s.status==='Fail'&&s.errorClassification?.type==='API_5XX').length;
  const nullRefCount=scenarios.filter(s=>s.status==='Fail'&&s.errorClassification?.type==='UNEXPECTED_ERROR').length;
  const dataScore  = Math.round(Math.max(0, 100 - api5xxCount*25 - nullRefCount*10));
  const overallScore = Math.round((authScore * 0.35 + appScore * 0.35 + dataScore * 0.30));
  const status = overallScore >= 80 ? 'OPERATIONAL' : overallScore >= 55 ? 'DEGRADED' : 'UNHEALTHY';
  const components = [
    { name: 'Authentication (Session)', score: authScore,  note: authFails > 0 ? `${authFails} failures` : 'OK' },
    { name: 'OrangeHRM Application',     score: appScore,   note: navFails  > 0 ? `${navFails} nav errors` : 'Responsive' },
    { name: 'REST API',                  score: dataScore,  note: m.passed > 0 ? 'Accessible' : 'Unknown' },
    { name: 'Test Environment',       score: m.environmentReady, note: 'Based on pass rate' },
  ];
  return { score: overallScore, status, components };
}

function computePrediction(scenarios, history) {
  if (history.length < 3) return { predictions: [], predictedPassRate: 0, confidence: 0, riskTrend: '→ Insufficient data' };
  const recent = history.slice(-5);
  const avgPassRate = Math.round(recent.reduce((a, r) => a + (r.passRate || 0), 0) / recent.length);
  const trend = recent.length >= 2 ? recent[recent.length-1].passRate - recent[0].passRate : 0;
  const predictedPassRate = Math.min(100, Math.max(0, avgPassRate + Math.round(trend * 0.3)));
  const confidence = Math.min(95, 50 + history.length * 5);
  const riskTrend = trend > 5 ? '↓ Decreasing' : trend < -5 ? '↑ Increasing' : '→ Stable';
  const featureGroups = {};
  for (const s of scenarios) {
    if (!featureGroups[s.featureName]) featureGroups[s.featureName] = { pass: 0, fail: 0, total: 0 };
    featureGroups[s.featureName].total++;
    if (s.status === 'Pass') featureGroups[s.featureName].pass++;
    if (s.status === 'Fail') featureGroups[s.featureName].fail++;
  }
  const predictions = Object.entries(featureGroups).map(([name, data]) => {
    const failRate = data.total ? data.fail / data.total : 0;
    const risk = failRate >= 0.5 ? 'HIGH' : failRate > 0 ? 'MEDIUM' : 'LOW';
    const trendData = history.slice(-7).map(r => r.passRate || 0);
    const prediction = risk === 'HIGH' ? `High instability — likely to fail again` : risk === 'MEDIUM' ? `Occasional failures observed` : `Stable — expected to pass`;
    return { feature: name.slice(0, 30), risk, prediction, trend: trendData };
  }).sort((a, b) => { const o = { HIGH: 0, MEDIUM: 1, LOW: 2 }; return o[a.risk] - o[b.risk]; }).slice(0, 6);
  return { predictions, predictedPassRate, confidence, riskTrend };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const { buildHtml, buildStoryHtml, buildStyles } = require('./report-html');
  const cmd = require('./report-command');
  const { computeTraceability }      = require('./intelligence/traceability-engine');
  const { detectClusters }           = require('./intelligence/failure-clusters');
  const { analyzeAllFailures }       = require('./intelligence/ai-root-cause');
  const { computeReleaseDecision }   = require('./intelligence/release-engine');
  const { computeExecutiveInsights } = require('./intelligence/executive-intelligence');
  const { computeTrends }            = require('./intelligence/trend-engine');
  const { buildFailureTimelines }    = require('./intelligence/timeline-builder');
  const { computeDigitalTwin }       = require('./intelligence/digital-twin');
  const { generateStory }            = require('./intelligence/storytelling');
  const { analyzeForHealing }        = require('./intelligence/self-healing');
  const { generateTestCases }        = require('./intelligence/test-generator');
  const { analyzeRequirementRisk }   = require('./intelligence/requirement-risk');
  const { predictDefects }           = require('./intelligence/defect-predictor');
  const { analyzeImpact }            = require('./intelligence/impact-analyzer');
  const { buildReleaseCommandCenter }= require('./intelligence/release-command');
  const { correlateProductionDefects}= require('./intelligence/production-correlation');
  const { runAutonomousAgent }       = require('./intelligence/autonomous-agent');
  const { buildAuditReport }         = require('./intelligence/truthfulness-engine');
  const { buildMetricRegistry }             = require('./intelligence/metric-registry');
  const { buildDecisionRegistry }           = require('./intelligence/decision-registry');
  const { buildDataLineageRegistry }        = require('./intelligence/data-lineage-registry');
  const { validateAlmSoTSync }              = require('./intelligence/alm-validation');
  const { buildTraceabilityCertification }  = require('./intelligence/traceability-certification');
  const { buildValidationHistory }          = require('./intelligence/validation-history');
  const { buildEvidenceIndex }              = require('./intelligence/evidence-manager');
  const { runCodingStandards }             = require('./intelligence/coding-standards-engine');
  const { runGovernanceEnforcement }      = require('./intelligence/governance-enforcement-engine');
  const { runRemediationEngine }          = require('./intelligence/governance-remediation-engine');

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  QA Intelligence Platform — WI-044A        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (!fs.existsSync(CUCUMBER_FILE)) {
    console.error(`✗ cucumber-report.json not found:\n  ${CUCUMBER_FILE}`);
    process.exit(1);
  }
  let features;
  try { features = JSON.parse(fs.readFileSync(CUCUMBER_FILE, 'utf8')); }
  catch (e) { console.error(`✗ Parse error: ${e.message}`); process.exit(1); }

  const scenarios  = parseCucumber(features);
  const m          = computeMetrics(scenarios);
  const rr         = computeReleaseReadiness(m, scenarios);
  const bizCaps    = computeBusinessImpact(scenarios);
  const lastSnapshot = loadJson('last-run-snapshot.json', []);
  const delta      = computeDelta(scenarios);
  const history    = loadRunHistory();
  const runDate    = new Date().toISOString().replace('T',' ').slice(0,19)+' UTC';
  const supplemental = {
    autopsies: loadJson('app-autopsy.json', []),
    jiraDebug: loadJson('jira-debug.json',  {}),
  };
  const healingData = loadJson('healing-visibility.json', { events: [] });
  const jiraBugs    = loadJson('jira-bdd-bugs.json', { bugs: [], summary: {} });

  const healingEff  = computeHealingEffectiveness(healingData, history);
  const envHealth   = computeEnvironmentHealth(m, scenarios);
  const defectEcon  = computeDefectEconomics(m, scenarios, healingData);
  const prediction  = computePrediction(scenarios, history);

  // ── Phase 2–12 intelligence engines ─────────────────────────────────────────
  const traceability    = computeTraceability(scenarios, jiraBugs);
  const clusterData     = detectClusters(scenarios);
  const aiAnalysis      = analyzeAllFailures(scenarios, lastSnapshot);

  // ── E1: Jira Source of Truth Validation (must run before release decision) ──
  const almValidation   = validateAlmSoTSync(scenarios);

  // ── E2: Traceability Certification (depends on E1) ───────────────────────
  const traceCert       = buildTraceabilityCertification(scenarios, traceability, jiraBugs, almValidation);

  // ── E9: Release decision now receives Jira + traceability governance data ──
  const releaseDecision = computeReleaseDecision(m, rr, scenarios, envHealth, clusterData, aiAnalysis, delta, almValidation, traceCert);
  const trends          = computeTrends(history, m);
  const executive       = computeExecutiveInsights(m, rr, delta, history, releaseDecision, clusterData, lastSnapshot);
  const timelines       = buildFailureTimelines(scenarios);
  const twin            = computeDigitalTwin(m, envHealth, releaseDecision, trends, clusterData);
  const story           = generateStory(m, rr, delta, releaseDecision, executive, trends, twin, clusterData);

  // ── Phase 13–20 intelligence engines (dependency order) ─────────────────────
  const healing         = analyzeForHealing(scenarios, history, lastSnapshot);
  const generated       = generateTestCases(scenarios, traceability, jiraBugs);
  const reqRisk         = analyzeRequirementRisk(scenarios, traceability, jiraBugs);
  const defectPrediction= predictDefects(scenarios, history, traceability, clusterData, aiAnalysis);
  const impact          = analyzeImpact(delta, scenarios, traceability, clusterData);
  const commandCenter   = buildReleaseCommandCenter(m, releaseDecision, twin, executive, trends, defectPrediction, healing);
  const correlation     = correlateProductionDefects(scenarios, traceability, jiraBugs);
  const agent           = runAutonomousAgent(scenarios, aiAnalysis, healing, traceability, releaseDecision, story, executive, m, commandCenter);
  const audit           = buildAuditReport({ m, rr, releaseDecision, envHealth, traceability, defectPrediction, healing, trends, twin, aiAnalysis, clusterData, delta, history, reqRisk, correlation, commandCenter, agent, metricRegistry: null, decisionRegistry: null, dataLineage: null, almValidation, traceCert });
  // Registries need the audit bundle; compute after audit
  const metricRegistry  = buildMetricRegistry({ m, rr, releaseDecision, traceability, twin, defectPrediction, trends, healing, audit, envHealth, history });
  const decisionRegistry= buildDecisionRegistry(releaseDecision, twin, clusterData, envHealth, m, rr);
  const dataLineage     = buildDataLineageRegistry({ m, rr, releaseDecision, traceability, defectPrediction, trends, healing, envHealth, twin, history });

  // ── E3: Historical Validation (records prediction vs actual, rolling stats)
  const validationHistory = buildValidationHistory({ m, releaseDecision, trends, almValidation, traceCert, runDate });

  // ── E4: Evidence Index (catalog all captured evidence) ───────────────────
  const evidenceIndex   = buildEvidenceIndex(scenarios);

  // ── WI-046A: Coding Standards Governance ─────────────────────────────────
  const codingStandards = runCodingStandards();

  // ── WI-046B: Governance Enforcement ──────────────────────────────────────
  const governanceEnforcement = runGovernanceEnforcement(codingStandards, {
    scenarios, evidenceIndex, releaseDecision,
  });

  // ── WI-046C: Governance Remediation Intelligence ──────────────────────────
  const remediationPlan = runRemediationEngine(codingStandards);
  // Re-inject registries into audit summary (for trust score bonus calculation)
  // Re-compute bonuses now that all registries are available
  audit.summary.bonuses = {
    'Metric Registry':        metricRegistry?.totalMetrics   ? 4 : 0,
    'Decision Registry':      decisionRegistry?.totalDecisions ? 4 : 0,
    'Data Lineage':           dataLineage?.totalEntries       ? 4 : 0,
    'Jira Validation Engine': almValidation?.validatedAt      ? 3 : 0,
    'Traceability Cert':      traceCert?.certifiedAt          ? 2 : 0,
    'Explainer Modal':        3,
    'Disclosure Banner':      3,
  };
  // Strip zero-value entries for cleaner display
  for (const k of Object.keys(audit.summary.bonuses)) {
    if (!audit.summary.bonuses[k]) delete audit.summary.bonuses[k];
  }
  const bonusTotal = Object.values(audit.summary.bonuses).reduce((a, b) => a + b, 0);
  const penaltyTotal = Math.min(25, audit.summary.critical * 12) + Math.min(20, audit.summary.high * 5) + Math.min(12, audit.summary.medium * 2) + Math.min(5, audit.summary.low * 1);
  audit.summary.overallTrustworthiness = Math.min(90, Math.max(20, 100 - penaltyTotal + Math.min(15, bonusTotal)));

  console.log(`  Scenarios : ${scenarios.length} (${m.passed}P / ${m.failed}F / ${m.skipped}S)`);
  console.log(`  Readiness : ${rr.verdict} (${rr.score}/100)`);
  console.log(`  Decision  : ${m.passRate >= 90 && m.failed === 0 ? 'APPROVED FOR RELEASE' : m.passRate < 70 ? 'DO NOT RELEASE' : 'CONDITIONAL RELEASE'}`);
  console.log(`  Delta     : ${delta.available ? `${delta.newFailures.length} new failures, ${delta.resolved.length} resolved` : 'first run'}`);
  console.log(`  History   : ${history.length} runs recorded`);
  console.log('\n  Generating phase JSONs…');
  generatePhaseJsons(scenarios, runDate, supplemental);

  console.log('  Generating intelligence phase JSONs…');
  writePhaseJson('traceability-report.json',         traceability);
  writePhaseJson('failure-clusters-report.json',     clusterData);
  writePhaseJson('ai-root-cause-report.json',        { analyses: aiAnalysis.analyses, summary: aiAnalysis.summary });
  writePhaseJson('release-decision-report.json',     { status: releaseDecision.status, confidenceScore: releaseDecision.confidenceScore, riskScore: releaseDecision.riskScore, factors: releaseDecision.factors, blockers: releaseDecision.blockers, risks: releaseDecision.risks, warnings: releaseDecision.warnings, recommendations: releaseDecision.recommendations, reasoning: releaseDecision.reasoning });
  writePhaseJson('executive-intelligence-report.json',{ qualityHealth: executive.qualityHealth, deliveryHealth: executive.deliveryHealth, automationHealth: executive.automationHealth, releaseHealth: executive.releaseHealth, riskHealth: executive.riskHealth, deltaInsights: executive.deltaInsights, keyActions: executive.keyActions });
  writePhaseJson('trends-report.json',               { available: trends.available, summary: trends.summary, predictions: trends.predictions, sprints: trends.sprints });
  writePhaseJson('failure-timelines-report.json',    timelines.map(t => ({ scenarioName: t.scenarioName, issueKey: t.issueKey, totalMs: t.totalMs, eventCount: t.events.length })));
  writePhaseJson('execution-story-report.json',      { narrative: story.narrative, tone: story.tone, sections: story.sections, generatedAt: story.generatedAt });

  console.log('  Generating autonomous platform phase JSONs…');
  writePhaseJson('self-healing-report.json',          { recommendations: healing.recommendations.map(r=>({ scenarioName:r.scenarioName, issueKey:r.issueKey, featureName:r.featureName, healingLabel:r.healingLabel, healingType:r.healingType, suggestedFix:r.suggestedFix, confidence:r.confidence, automatable:r.automatable, effort:r.effort, owner:r.owner, recurred:r.recurred, impact:r.impact, autoFixSaving:r.autoFixSaving })), summary: healing.summary });
  writePhaseJson('test-generator-report.json',        { generated: (generated.generated||[]).map(t=>({ id:t.id, type:t.type, priority:t.priority, title:t.title, featureName:t.featureName, reqId:t.reqId, coverageGap:t.coverageGap, bddScenario:t.bddScenario, estimatedEffort:t.estimatedEffort, issueTagSuggestion:t.issueTagSuggestion })), statistics: generated.statistics });
  writePhaseJson('requirement-risk-report.json',      { requirements: reqRisk.requirements.map(r=>({ requirementId:r.requirementId, userStory:r.userStory, qualityScore:r.qualityScore, riskLevel:r.riskLevel, risks:r.risks, scenarioCount:r.scenarioCount, passCount:r.passCount, failCount:r.failCount, openDefects:r.openDefects, ambiguityFlags:r.ambiguityFlags, securityGaps:r.securityGaps, recommendation:r.recommendation })), summary: reqRisk.summary });
  writePhaseJson('defect-prediction-report.json',     { predictions: defectPrediction.predictions.map(p=>({ featureName:p.featureName, riskScore:p.riskScore, riskLevel:p.riskLevel, predictedDefects:p.predictedDefects, confidence:p.confidence, currentFailures:p.currentFailures, totalScenarios:p.totalScenarios, historicRunsUsed:p.historicRunsUsed, factors:p.factors })), summary: defectPrediction.summary });
  writePhaseJson('impact-analysis-report.json',       { available: impact.available, changedFeatures: impact.changedFeatures, impactedRequirements: impact.impactedRequirements, impactedTestCases: impact.impactedTestCases, regressionScope: impact.regressionScope, summary: impact.summary });
  writePhaseJson('release-command-report.json',       { panels: commandCenter.panels, alerts: commandCenter.alerts, recommendation: commandCenter.recommendation, cockpitScore: commandCenter.cockpitScore, generatedAt: commandCenter.generatedAt });
  writePhaseJson('production-correlation-report.json',{ correlations: correlation.correlations, missedCoverage: correlation.missedCoverage, defectDensity: correlation.defectDensity, leakageAnalytics: correlation.leakageAnalytics });
  writePhaseJson('autonomous-agent-report.json',      { agentName: agent.agentName, runAt: agent.runAt, investigations: agent.investigations, defectCandidates: agent.defectCandidates, ownerAssignments: agent.ownerAssignments, autoFixCandidates: agent.autoFixCandidates, impactedTests: agent.impactedTests, releaseSummary: agent.releaseSummary, summary: agent.summary });
  writePhaseJson('truthfulness-audit-report.json',    { summary: audit.summary, findings: audit.findings, rawFactCount: audit.rawFacts.length, calculatedCount: audit.calculatedMetrics.length, predictionCount: audit.predictions.length, aiOpinionCount: audit.aiOpinions.length, generatedAt: audit.generatedAt });
  writePhaseJson('metric-registry-report.json',        { metrics: metricRegistry.metrics, maturitySummary: metricRegistry.maturitySummary, totalMetrics: metricRegistry.totalMetrics, stablePercent: metricRegistry.stablePercent, registeredAt: metricRegistry.registeredAt });
  writePhaseJson('decision-registry-report.json',      { decisions: decisionRegistry.decisions, totalDecisions: decisionRegistry.totalDecisions, explainabilityRate: decisionRegistry.explainabilityRate, registeredAt: decisionRegistry.registeredAt });
  writePhaseJson('data-lineage-report.json',           { lineageEntries: dataLineage.lineageEntries, certificationRate: dataLineage.certificationRate, avgConfidence: dataLineage.avgConfidence, registeredAt: dataLineage.registeredAt });
  writePhaseJson('alm-validation-report.json',         { validatedAt: almValidation.validatedAt, validationMode: almValidation.validationMode, governanceStatus: almValidation.governanceStatus, summary: almValidation.summary, issues: almValidation.issues });
  writePhaseJson('traceability-certification.json',    { certifiedAt: traceCert.certifiedAt, certifiedRate: traceCert.certifiedRate, brokenChains: traceCert.brokenChains, summary: traceCert.summary, issues: traceCert.issues });
  writePhaseJson('validation-history-report.json',     { generatedAt: validationHistory.generatedAt, rollingStats: validationHistory.rollingStats, totalEntries: validationHistory.totalEntries });
  writePhaseJson('evidence-index.json',                { indexedAt: evidenceIndex.indexedAt, totalItems: evidenceIndex.totalItems, totalSizeKb: evidenceIndex.totalSizeKb, summary: evidenceIndex.summary, coverageGaps: evidenceIndex.coverageGaps });
  writePhaseJson('coding-standards-compliance.json',   { status: codingStandards.status, overallScore: codingStandards.overallScore, scores: codingStandards.scores, categoryScores: codingStandards.categoryScores, summary: codingStandards.summary, successCriteria: codingStandards.successCriteria, violations: codingStandards.violations, generatedAt: codingStandards.generatedAt });
  writePhaseJson('governance-scorecard.json',          { status: codingStandards.status, overallScore: codingStandards.overallScore, scores: codingStandards.scores, categoryScores: codingStandards.categoryScores, successCriteria: codingStandards.successCriteria, summary: codingStandards.summary, generatedAt: codingStandards.generatedAt });
  writePhaseJson('governance-enforcement.json',        { decision: governanceEnforcement.enforcement.decision, overallScore: governanceEnforcement.enforcement.overallScore, cicdGates: governanceEnforcement.cicdGates, enforcement: governanceEnforcement.enforcement.enforcement, techDebt: governanceEnforcement.techDebt?.summary, generatedAt: governanceEnforcement.enforcement.generatedAt });
  writePhaseJson('governance-remediation-plan.json',   { standard:'WI-046C', summary: remediationPlan.plan?.summary, effortBySprint: remediationPlan.plan?.effortBySprint, ownerSummary: remediationPlan.plan?.ownerSummary, releaseImpact: remediationPlan.plan?.releaseImpact, generatedAt: remediationPlan.plan?.generatedAt });
  writePhaseJson('governance-priority-matrix.json',    { standard:'WI-046C', priorities: remediationPlan.matrix?.priorities, quickWins: remediationPlan.matrix?.quickWins, releaseImpact: remediationPlan.matrix?.releaseImpact, ownerSummary: remediationPlan.matrix?.ownerSummary, generatedAt: remediationPlan.matrix?.generatedAt });
  writePhaseJson('governance-burndown.json',           remediationPlan.burndown || {});

  appendRunHistory({
    timestamp: runDate, total: m.total, passed: m.passed, failed: m.failed,
    skipped: m.skipped, passRate: m.passRate, totalDuration: m.totalDuration,
    healingEvents: healingData.events?.length || 0, jiraLinked: m.withTag,
  });
  saveSnapshot(scenarios);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let html;
  if (REPORT_MODE === 'story') {
    console.log('\n  Building Story Mode…');
    html = buildStoryHtml(scenarios, m, runDate, buildStyles);
  } else {
    console.log('\n  Building Intelligence Dashboard…');
    html = buildHtml(scenarios, m, rr, delta, bizCaps, history, healingData,
      runDate, APP_STAGES, getAppStage, BIZ_MAP,
      { cmd, healingEff, envHealth, defectEcon, prediction, jiraBugs, lastSnapshot,
        traceability, clusterData, aiAnalysis, releaseDecision, executive, trends, timelines, twin, story,
        healing, generated, reqRisk, defectPrediction, impact, commandCenter, correlation, agent, audit,
        metricRegistry, decisionRegistry, dataLineage,
        almValidation, traceCert, validationHistory, evidenceIndex, codingStandards, governanceEnforcement, remediationPlan });
  }

  // ── E5: Performance — lazy-load embedded images + defer video ──────────────
  // Converts embedded base64 images to IntersectionObserver-deferred loads.
  // Reduces initial parse cost for large reports with many screenshots.
  const lazyScript = `<script>
(function(){
  if(!('IntersectionObserver' in window)) return; // graceful fallback for older browsers
  var obs = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      var el=e.target, s=el.getAttribute('data-lazy');
      if(s){ el.src=s; el.removeAttribute('data-lazy'); }
      obs.unobserve(el);
    });
  }, { rootMargin:'300px' });
  document.querySelectorAll('img[data-lazy]').forEach(function(img){ obs.observe(img); });
})();
</script>`;
  html = html
    .replace(/ src="(data:image\/[^"]{20,})"/g, ' src="" data-lazy="$1"')  // defer base64 images
    .replace(/<video /g, '<video preload="none" ')                           // defer video load
    .replace('</body>', lazyScript + '\n</body>');

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);

  console.log(`\n✓ Report: ${OUT_FILE}`);
  console.log(`  Size    : ${kb} KB`);
  console.log(`  Mode    : ${REPORT_MODE}`);
  console.log(`  Verdict : ${rr.verdict} (${rr.score}/100)\n`);
}

main();

