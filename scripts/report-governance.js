'use strict';
/**
 * WI-046B Phase 14 — Governance Dashboard Section Builder
 */

const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DECISION_COLORS = {
  'PASS':                    { bg: 'var(--pass-bg)',  border: 'var(--pass-border)',  text: 'var(--pass)'  },
  'PASS_WITH_WARNINGS':      { bg: 'var(--skip-bg)',  border: 'var(--skip-border)',  text: 'var(--skip)'  },
  'CONDITIONAL':             { bg: 'var(--skip-bg)',  border: 'var(--skip-border)',  text: 'var(--skip)'  },
  'BLOCKED':                 { bg: 'var(--fail-bg)',  border: 'var(--fail-border)',  text: 'var(--fail)'  },
  'ARCHITECT_REVIEW_REQUIRED':{ bg: 'var(--info-bg)', border: 'var(--info-border)', text: 'var(--info)'  },
};

function dc(status) {
  return DECISION_COLORS[status] || DECISION_COLORS['CONDITIONAL'];
}

function statusDot(s) {
  const cls = s === 'PASS' ? 'pass' : s === 'BLOCKED' ? 'fail' : 'warn';
  return `<div class="status-dot ${cls}"></div>`;
}

function statusBadge(status, label) {
  const c = dc(status);
  const lbl = label || status;
  return `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:10px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:.5px">${e(lbl)}</span>`;
}

// ─── Phase 1+2: Decision Engine panel ────────────────────────────────────────

function buildDecisionPanel(decisionResult) {
  if (!decisionResult) return '';
  const { decision, overallScore, gates = [], reasons = [], summary = {}, recommendations = [] } = decisionResult;
  const { bg, border, text } = dc(decision);

  const gateRows = gates.map(g => {
    const pass = g.status === 'PASS';
    const warn = g.status === 'PASS_WITH_WARNINGS';
    const icon = pass ? '✓' : warn ? '⚠' : '✗';
    const tc   = pass ? 'var(--pass)' : warn ? 'var(--skip)' : 'var(--fail)';
    const delta = g.delta >= 0 ? `+${g.delta}%` : `${g.delta}%`;
    return `<tr>
      <td style="padding:7px 10px;font-size:11px;font-weight:600;color:${tc}">${e(icon)} ${e(g.id)}</td>
      <td style="padding:7px 10px;font-size:11px;color:var(--text0)">${e(g.gate)}</td>
      <td style="padding:7px 10px;font-size:11px;font-weight:700;color:${tc};text-align:right">${g.actual}%</td>
      <td style="padding:7px 10px;font-size:11px;color:var(--text2);text-align:right">${g.threshold}%</td>
      <td style="padding:7px 10px;font-size:11px;color:${tc};text-align:right">${delta}</td>
      <td style="padding:7px 10px">${statusBadge(g.status)}</td>
    </tr>`;
  }).join('');

  return `
  <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:var(--radius);background:${bg};border:1px solid ${border};margin-bottom:20px">
    ${statusDot(decision)}
    <div>
      <div style="font-size:16px;font-weight:800;color:${text};letter-spacing:-.3px">GOVERNANCE DECISION: ${e(decision)}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:2px">WI-046B · Overall Score: ${overallScore}/100 · ${summary.failedGates || 0} gates failed · ${summary.hardFails || 0} hard violations</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div style="font-size:24px;font-weight:800;color:${text}">${overallScore}</div>
      <div style="font-size:10px;color:var(--text2)">/ 100</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
    <div class="card" style="padding:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Quality Gates (${summary.totalGates || 0})</div>
      <div style="overflow:auto;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--bg2)">
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Gate</th>
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Domain</th>
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:right">Actual</th>
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:right">Min</th>
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:right">Delta</th>
            <th style="padding:6px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Status</th>
          </tr></thead>
          <tbody>${gateRows}</tbody>
        </table>
      </div>
    </div>
    <div class="card" style="padding:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Decision Reasons</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
        ${reasons.slice(0, 5).map(r => `<div style="font-size:11.5px;color:var(--text0);padding:6px 10px;background:var(--bg2);border-radius:var(--radius-sm);border-left:3px solid ${text}">▸ ${e(r)}</div>`).join('') || '<div style="color:var(--text2);font-size:11px">No issues — all gates passed</div>'}
      </div>
      ${recommendations.length ? `
      <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Recommendations</div>
      ${recommendations.map(r => `<div style="font-size:11px;color:var(--text1);padding:4px 0;border-bottom:1px solid var(--border)">→ ${e(r)}</div>`).join('')}
      ` : ''}
    </div>
  </div>`;
}

// ─── Enforcement status grid ──────────────────────────────────────────────────

function buildEnforcementGrid(enforcement) {
  if (!enforcement) return '';
  const { appEnforcement: app, jiraEnforcement: jira, authEnforcement: auth,
          playwrightEnforcement: pw, aiEnforcement: ai, healerEnforcement: healer,
          reportEnforcement: report, bugEnforcement: bugs } = enforcement;

  const phases = [
    { ph:'Phase 3',  name:'App Compliance',    status: app?.status,    hard: app?.summary?.totalBlockingViolations,  warn: app?.summary?.totalConditionalViolations },
    { ph:'Phase 4',  name:'Jira Traceability', status: jira?.status,   hard: jira?.summary?.blockingViolations,      warn: jira?.summary?.conditionalViolations },
    { ph:'Phase 5',  name:'Authentication',    status: auth?.status,   hard: auth?.summary?.blockingViolations,      warn: auth?.summary?.conditionalViolations },
    { ph:'Phase 6',  name:'Playwright',        status: pw?.status,     hard: pw?.summary?.blockingViolations,        warn: pw?.summary?.conditionalViolations },
    { ph:'Phase 7',  name:'AI Governance',     status: ai?.status,     hard: ai?.checks ? Object.values(ai.checks).filter(c => !c.pass).length : 0, warn: 0 },
    { ph:'Phase 8',  name:'Healer Governance', status: healer?.status, hard: 0, warn: healer?.quarantine?.itemsQuarantined || 0 },
    { ph:'Phase 9',  name:'Report Governance', status: report?.status, hard: report?.certification?.certified ? 0 : 1, warn: 0 },
    { ph:'Phase 10', name:'Bug Governance',    status: bugs?.status,   hard: 0, warn: bugs?.enforcement?.failedScenariosRequireBug?.unlinkedCount || 0 },
  ].filter(p => p.status !== undefined);

  const cards = phases.map(p => {
    const { bg, border, text } = dc(p.status || 'PASS');
    const hardLabel = p.hard > 0 ? `<span style="font-size:10px;color:var(--fail);font-weight:600">${p.hard} blocking</span>` : '';
    const warnLabel = p.warn > 0 ? `<span style="font-size:10px;color:var(--skip)">${p.warn} warn</span>` : '';
    return `<div class="card" style="padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:9.5px;font-weight:700;color:var(--text2)">${e(p.ph)}</span>
        ${statusBadge(p.status || 'PASS')}
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text0);margin-bottom:6px">${e(p.name)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${hardLabel}${warnLabel}${!hardLabel && !warnLabel ? '<span style="font-size:10px;color:var(--pass)">✓ Clean</span>' : ''}</div>
    </div>`;
  }).join('');

  return `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Phase Enforcement Status</div>
  <div class="card-grid card-grid-4" style="gap:12px;margin-bottom:24px">${cards}</div>`;
}

// ─── CI/CD gate strip ─────────────────────────────────────────────────────────

function buildCicdGates(cicdGates) {
  if (!cicdGates || !cicdGates.length) return '';
  const bars = cicdGates.map(g => {
    const pass = g.status === 'PASS';
    const bc   = pass ? 'var(--pass-bg)' : 'var(--fail-bg)';
    const bd   = pass ? 'var(--pass-border)' : 'var(--fail-border)';
    const tc   = pass ? 'var(--pass)' : 'var(--fail)';
    return `<div style="flex:1;min-width:120px;padding:12px 14px;background:${bc};border:1px solid ${bd};border-radius:var(--radius-sm);text-align:center">
      <div style="font-size:9.5px;font-weight:700;color:${tc};text-transform:uppercase;letter-spacing:.6px">${e(g.id)}</div>
      <div style="font-size:11px;font-weight:600;color:var(--text0);margin:4px 0">${e(g.name)}</div>
      <div style="font-size:18px;font-weight:800;color:${tc}">${g.score}%</div>
      <div style="font-size:9px;color:var(--text2)">min: ${g.threshold}%</div>
    </div>`;
  }).join('');
  return `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Phase 11 — CI/CD Gates</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">${bars}</div>`;
}

// ─── Tech Debt summary ────────────────────────────────────────────────────────

function buildTechDebtSummary(techDebt) {
  if (!techDebt) return '';
  const { summary, burndown, debtByRule = [] } = techDebt;

  const ruleRows = debtByRule.map(d => {
    const tc = d.totalCount > 10 ? 'var(--fail)' : d.totalCount > 5 ? 'var(--skip)' : 'var(--text1)';
    return `<tr>
      <td style="padding:6px 10px;font-size:11px;font-weight:600;color:var(--text0)">${e(d.ruleId)}</td>
      <td style="padding:6px 10px;font-size:10.5px;color:var(--text1)">${e(d.description)}</td>
      <td style="padding:6px 10px;font-size:11px;font-weight:700;color:${tc};text-align:center">${d.totalCount}</td>
      <td style="padding:6px 10px;font-size:10.5px;color:var(--text2);text-align:center">${d.legacyCount}</td>
      <td style="padding:6px 10px;font-size:10.5px;color:var(--text2);text-align:center">${d.currentCount}</td>
      <td style="padding:6px 10px;font-size:10.5px;color:var(--text2);text-align:center">${d.sprintTarget} / sprint</td>
    </tr>`;
  }).join('');

  return `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Phase 13 — Technical Debt Register</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    ${[
      { lbl:'Total Debt Items',  val: summary.totalDebtItems,   c:'var(--fail)' },
      { lbl:'Legacy Violations', val: summary.legacyViolations, c:'var(--skip)' },
      { lbl:'Current Violations',val: summary.currentViolations,c:'var(--text0)'},
      { lbl:'Sprints to Zero',   val: summary.estimatedSprintsToZero, c:'var(--info)' },
    ].map(s => `<div class="card" style="padding:12px;text-align:center">
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">${e(s.lbl)}</div>
      <div style="font-size:22px;font-weight:800;color:${s.c}">${s.val}</div>
    </div>`).join('')}
  </div>
  ${ruleRows ? `<div style="border-radius:var(--radius);border:1px solid var(--border);overflow:auto;margin-bottom:24px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--bg2)">
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Rule</th>
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Description</th>
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:center">Total</th>
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:center">Legacy</th>
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:center">Current</th>
        <th style="padding:7px 10px;font-size:9px;font-weight:700;color:var(--text2);text-align:center">Burndown</th>
      </tr></thead>
      <tbody>${ruleRows}</tbody>
    </table>
  </div>` : ''}
  <div style="padding:10px 14px;background:var(--bg2);border-radius:var(--radius-sm);font-size:11px;color:var(--text2)">
    Burndown target: <strong style="color:var(--text0)">${burndown?.sprintTarget || 10} items/sprint</strong> ·
    Projected close: <strong style="color:var(--text0)">${burndown?.projectedCloseDate || 'TBD'}</strong>
  </div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

function buildGovernanceDashboard(governanceEnforcement, codingStandards) {
  if (!governanceEnforcement) {
    return '<p style="color:var(--text2);padding:24px">Governance enforcement data unavailable — run governance gate first.</p>';
  }

  const { decision, enforcement, appEnforcement, jiraEnforcement, authEnforcement,
          playwrightEnforcement, aiEnforcement, healerEnforcement, reportEnforcement,
          bugEnforcement, techDebt, teamGovernance, releaseGovernance, cicdGates } = governanceEnforcement;

  const dec  = decision?.decision || 'UNKNOWN';
  const team = teamGovernance;
  const rg   = releaseGovernance;

  const teamHtml = team ? `
  <div class="card" style="padding:16px;margin-top:20px">
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Phase 15 — Team Governance</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      ${statusDot(team.status === 'PASS' ? 'PASS' : 'CONDITIONAL')}
      <span style="font-size:12px;font-weight:600;color:var(--text0)">${e(team.status)}</span>
      ${team.recentChangesToCriticalFiles?.length ? `<span style="font-size:11px;color:var(--skip)">${team.recentChangesToCriticalFiles.length} critical file(s) changed — architect review required</span>` : '<span style="font-size:11px;color:var(--pass)">No changes to framework-critical files</span>'}
    </div>
    <div style="font-size:10px;color:var(--text2)">Critical areas: ${(team.frameworkCriticalAreas || []).map(a => `<code style="background:var(--bg3);padding:1px 5px;border-radius:3px">${e(a)}</code>`).join(' ')}</div>
  </div>` : '';

  const releaseHtml = rg ? `
  <div style="padding:12px 16px;border-radius:var(--radius-sm);background:${rg.releaseBlocked ? 'var(--fail-bg)' : 'var(--pass-bg)'};border:1px solid ${rg.releaseBlocked ? 'var(--fail-border)' : 'var(--pass-border)'};margin-top:16px;margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;color:${rg.releaseBlocked ? 'var(--fail)' : 'var(--pass)'};margin-bottom:4px">
      Phase 12 — Release Governance: ${rg.releaseBlocked ? '🚫 BLOCKED' : '✓ APPROVED'}
    </div>
    <div style="font-size:11.5px;color:var(--text0)">${e(rg.recommendation)}</div>
    ${rg.blockReasons?.length ? `<ul style="margin:8px 0 0;padding-left:18px">${rg.blockReasons.map(r => `<li style="font-size:11px;color:var(--fail)">${e(r)}</li>`).join('')}</ul>` : ''}
  </div>` : '';

  return `
  ${buildDecisionPanel(decision)}
  ${releaseHtml}
  ${buildCicdGates(cicdGates)}
  ${buildEnforcementGrid({ appEnforcement, jiraEnforcement, authEnforcement, playwrightEnforcement, aiEnforcement, healerEnforcement, reportEnforcement, bugEnforcement })}
  ${buildTechDebtSummary(techDebt)}
  ${teamHtml}`;
}

module.exports = { buildGovernanceDashboard };
