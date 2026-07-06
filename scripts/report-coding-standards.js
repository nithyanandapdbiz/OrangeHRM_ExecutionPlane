'use strict';
/**
 * WI-046A — Coding Standards Compliance Report Section
 */

const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CATEGORY_ICONS = {
  'General Engineering':   '⚙',
  'Playwright Standards':  '▶',
  'App Automation':        '◉',
  'Authentication':        '🔒',
  'Jira Traceability':     '⇢',
  'Reporting':             '□',
  'AI Generated Code':     '🤖',
  'Performance':           '▷',
  'Security':              '🛡',
  'Architecture':          '⬡',
};

const SUCCESS_LABELS = {
  noWaitForTimeout:        'No waitForTimeout()',
  noNetworkIdle:           'No networkidle',
  noDuplicateLogic:        'No duplicate logic',
  noHardcodedCredentials:  'No hardcoded credentials',
  noWrapperDivInteraction: 'No wrapper DIV interactions',
  noDirectJiraInUiLayer:    'No direct Jira in UI layer',
  sharedSessionEnforced:   'Shared session enforced',
  jiraTraceabilityEnforced: 'Jira traceability enforced',
  aiGovernanceEnforced:    'AI governance enforced',
  reportGovernanceEnforced:'Report governance enforced',
};

function buildCodingStandards(cs) {
  if (!cs) return '<p style="color:var(--text2);padding:24px">Coding standards data unavailable.</p>';

  const { status, overallScore, scores, categoryScores, summary, violations, successCriteria } = cs;

  const statusColor = status === 'ENTERPRISE COMPLIANT' ? 'var(--pass)'
    : status === 'CONDITIONAL PASS' ? 'var(--skip)' : 'var(--fail)';

  // ── Score tiles ────────────────────────────────────────────────────────────
  const scoreItems = [
    { lbl: 'Governance',       val: scores.governance,      key: 'governance' },
    { lbl: 'Coding Standards', val: scores.codingStandards, key: 'coding' },
    { lbl: 'Architecture',     val: scores.architecture,    key: 'arch' },
    { lbl: 'App Compliance',   val: scores.appCompliance,   key: 'app' },
    { lbl: 'Jira Compliance',  val: scores.jiraCompliance,   key: 'jira' },
  ];

  const scoreTiles = scoreItems.map(s => {
    const c = s.val >= 90 ? 'var(--pass)' : s.val >= 70 ? 'var(--skip)' : 'var(--fail)';
    return `<div class="card" style="padding:16px;text-align:center">
      <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">${e(s.lbl)}</div>
      <div style="font-size:26px;font-weight:800;color:${c};letter-spacing:-.5px">${s.val}%</div>
      <div style="margin-top:8px;height:4px;background:var(--bg3);border-radius:2px">
        <div style="height:4px;width:${s.val}%;background:${c};border-radius:2px;transition:width .6s ease"></div>
      </div>
    </div>`;
  }).join('');

  // ── Success criteria checklist ─────────────────────────────────────────────
  const criteriaHtml = Object.entries(successCriteria).map(([k, pass]) => {
    const lbl = SUCCESS_LABELS[k] || k;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;color:${pass ? 'var(--pass)' : 'var(--fail)'}">${pass ? '✓' : '✗'}</span>
      <span style="font-size:12px;color:${pass ? 'var(--text0)' : 'var(--fail)'}">${e(lbl)}</span>
      <span style="margin-left:auto;font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:${pass ? 'var(--pass-bg)' : 'var(--fail-bg)'};color:${pass ? 'var(--pass)' : 'var(--fail)'};border:1px solid ${pass ? 'var(--pass-border)' : 'var(--fail-border)'}">
        ${pass ? 'PASS' : 'FAIL'}
      </span>
    </div>`;
  }).join('');

  // ── Category compliance bars ───────────────────────────────────────────────
  const catBars = Object.entries(categoryScores).map(([cat, score]) => {
    const icon = CATEGORY_ICONS[cat] || '◉';
    const c    = score >= 90 ? 'var(--pass)' : score >= 70 ? 'var(--skip)' : 'var(--fail)';
    const catViolationCount = (violations || []).filter(v => v.category === cat).length;
    return `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:13px">${icon}</span>
        <span style="font-size:12px;color:var(--text0);font-weight:500">${e(cat)}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:${c}">${score}%</span>
        ${catViolationCount > 0 ? `<span style="font-size:10px;color:var(--text2)">${catViolationCount} issue${catViolationCount !== 1 ? 's' : ''}</span>` : ''}
      </div>
      <div style="height:6px;background:var(--bg3);border-radius:3px">
        <div style="height:6px;width:${score}%;background:${c};border-radius:3px;transition:width .5s ease"></div>
      </div>
    </div>`;
  }).join('');

  // ── Violations table ───────────────────────────────────────────────────────
  let violationsHtml = '';
  if (violations && violations.length > 0) {
    const rows = violations.slice(0, 60).map(v => {
      const sc = v.severity === 'HARD_FAIL' ? 'fail' : 'warn';
      const bc = v.severity === 'HARD_FAIL' ? 'var(--fail-bg)' : 'var(--skip-bg)';
      const tc = v.severity === 'HARD_FAIL' ? 'var(--fail)' : 'var(--skip)';
      const bd = v.severity === 'HARD_FAIL' ? 'var(--fail-border)' : 'var(--skip-border)';
      return `<tr>
        <td style="padding:8px 10px;font-size:10.5px;font-weight:700;color:${tc};white-space:nowrap">${e(v.ruleId)}</td>
        <td style="padding:8px 10px">
          <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;background:${bc};color:${tc};border:1px solid ${bd}">${e(v.severity)}</span>
        </td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text1)">${e(v.category)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text0)">${e(v.description)}</td>
        <td style="padding:8px 10px;font-size:10px;color:var(--text2);font-family:monospace">${e(v.file)}${v.line ? ':' + v.line : ''}</td>
        <td style="padding:8px 10px;font-size:10px;color:var(--text2);font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e(v.context)}">${e((v.context || '').slice(0, 80))}</td>
      </tr>`;
    }).join('');

    const truncNote = violations.length > 60
      ? `<div style="padding:10px;font-size:11px;color:var(--text2);text-align:center">${violations.length - 60} additional violations in coding-standards-compliance.json</div>`
      : '';

    violationsHtml = `
    <div style="margin-top:24px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">
        Violations (${violations.length} total · ${summary.hardFails} hard fail · ${summary.warnings} warning)
      </div>
      <div style="overflow-x:auto;border-radius:var(--radius);border:1px solid var(--border)">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--bg2);border-bottom:1px solid var(--border)">
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left;white-space:nowrap">Rule</th>
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left">Severity</th>
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left">Category</th>
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left">Description</th>
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left">Location</th>
              <th style="padding:8px 10px;font-size:10px;font-weight:700;color:var(--text2);text-align:left">Context</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${truncNote}
    </div>`;
  } else {
    violationsHtml = `<div style="padding:16px;background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:var(--radius);color:var(--pass);font-size:12px;font-weight:500;margin-top:24px">
      ✓ No violations detected — all rules passed.
    </div>`;
  }

  return `
  <!-- Status banner -->
  <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:var(--radius);background:var(--bg2);border:1px solid var(--border);margin-bottom:20px">
    <div class="status-dot ${status === 'ENTERPRISE COMPLIANT' ? 'pass' : status === 'CONDITIONAL PASS' ? 'warn' : 'fail'}"></div>
    <div>
      <div style="font-size:15px;font-weight:800;color:${statusColor};letter-spacing:-.3px">${e(status)}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:1px">Overall Score: ${overallScore}/100 · ${summary.filesScanned} files scanned · ${summary.totalViolations} violations · ${summary.hardFails} hard fails</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div style="font-size:10px;color:var(--text2)">WI-046A</div>
      <div style="font-size:10px;color:var(--text2)">${summary.criteriaMet}/10 criteria met</div>
    </div>
  </div>

  <!-- Score tiles (5 domains) -->
  <div class="card-grid card-grid-5" style="gap:12px;margin-bottom:24px">${scoreTiles}</div>

  <!-- Two-column: criteria + category bars -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
    <div class="card" style="padding:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Success Criteria (${summary.criteriaMet}/10)</div>
      ${criteriaHtml}
    </div>
    <div class="card" style="padding:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Category Compliance</div>
      ${catBars}
    </div>
  </div>

  ${violationsHtml}`;
}

module.exports = { buildCodingStandards };
