'use strict';
/**
 * WI-046C — Governance Remediation Dashboard Section Builder
 */

const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const P_META = {
  P1: { label: 'P1 — Critical', color: 'var(--fail)',  bg: 'var(--fail-bg)',  border: 'var(--fail-border)',  dot: 'fail' },
  P2: { label: 'P2 — High',     color: '#f97316',      bg: 'rgba(249,115,22,.1)', border: 'rgba(249,115,22,.28)', dot: 'warn' },
  P3: { label: 'P3 — Medium',   color: 'var(--skip)',  bg: 'var(--skip-bg)',  border: 'var(--skip-border)',  dot: 'warn' },
  P4: { label: 'P4 — Low',      color: 'var(--info)',  bg: 'var(--info-bg)',  border: 'var(--info-border)',  dot: 'pass' },
};

const OWNER_COLORS = {
  'Architect':             '#a78bfa',
  'QA Lead':              '#60a5fa',
  'Automation Engineer':  '#fbbf24',
  'QA Engineer':          '#22c55e',
};

// ─── Summary KPIs ─────────────────────────────────────────────────────────────

function buildKpiRow(plan) {
  const { summary } = plan;
  const kpis = [
    { lbl:'P1 Critical', val: summary.p1Critical, c:'var(--fail)' },
    { lbl:'P2 High',     val: summary.p2High,     c:'#f97316' },
    { lbl:'P3 Medium',   val: summary.p3Medium,   c:'var(--skip)' },
    { lbl:'P4 Low',      val: summary.p4Low,      c:'var(--info)' },
    { lbl:'Quick Wins',  val: summary.quickWins,  c:'var(--pass)' },
    { lbl:'Total Hours', val: summary.totalEstimatedHours + 'h', c:'var(--text0)' },
    { lbl:'Est. Sprints',val: summary.estimatedSprints, c:'var(--text0)' },
  ];
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:24px">
    ${kpis.map(k => `<div class="card" style="padding:12px;text-align:center">
      <div style="font-size:9px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px">${e(k.lbl)}</div>
      <div style="font-size:20px;font-weight:800;color:${k.c}">${e(String(k.val))}</div>
    </div>`).join('')}
  </div>`;
}

// ─── Priority matrix ───────────────────────────────────────────────────────────

function buildPriorityMatrix(matrix) {
  const total = Object.values(matrix.priorities).reduce((s, p) => s + p.count, 0);

  const rows = Object.entries(matrix.priorities).map(([pKey, p]) => {
    const meta  = P_META[pKey] || P_META.P4;
    const pct   = total > 0 ? Math.round((p.count / total) * 100) : 0;
    const topItems = (p.items || []).slice(0, 3).map(i =>
      `<div style="font-size:9.5px;color:var(--text2);padding:2px 0;border-bottom:1px solid var(--border)">${e(i.ruleId)} · ${e(i.file.split('/').pop())}:${i.line} · ${e(i.effort)}</div>`
    ).join('');

    return `<div class="card" style="padding:14px;border-left:3px solid ${meta.color}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div class="status-dot ${meta.dot}"></div>
        <span style="font-size:12px;font-weight:700;color:${meta.color}">${e(meta.label)}</span>
        <span style="margin-left:auto;font-size:18px;font-weight:800;color:${meta.color}">${p.count}</span>
      </div>
      <div style="font-size:10.5px;color:var(--text1);margin-bottom:8px">${e(p.description)}</div>
      <div style="height:5px;background:var(--bg3);border-radius:3px;margin-bottom:8px">
        <div style="height:5px;width:${pct}%;background:${meta.color};border-radius:3px"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:9.5px;color:var(--text2)">${p.totalEstimatedHours}h</span>
        <span style="font-size:9.5px;color:var(--text2)">·</span>
        ${(p.owners || []).map(o => `<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:var(--bg3);color:${OWNER_COLORS[o] || 'var(--text1)'}">${e(o)}</span>`).join('')}
      </div>
      ${topItems ? `<div style="margin-top:6px">${topItems}</div>` : ''}
    </div>`;
  }).join('');

  // Quick wins panel
  const quickWinRows = (matrix.quickWins || []).slice(0, 8).map(qw =>
    `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:10px;font-weight:700;color:var(--fail-border);width:70px;flex-shrink:0">${e(qw.ruleId)}</span>
      <span style="font-size:10.5px;color:var(--text0);flex:1">${e(qw.fix)}</span>
      <span style="font-size:9.5px;color:${OWNER_COLORS[qw.owner] || 'var(--text1)'};">${e(qw.owner)}</span>
      <span style="font-size:9px;color:var(--pass)">15 min</span>
    </div>`
  ).join('');

  return `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Priority Matrix</div>
  <div class="card-grid card-grid-4" style="gap:12px;margin-bottom:24px">${rows}</div>
  ${quickWinRows ? `
  <div class="card" style="padding:16px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:13px">⚡</span>
      <span style="font-size:11px;font-weight:700;color:var(--pass);text-transform:uppercase;letter-spacing:.8px">Quick Wins — P1/P2 items resolvable in 15 minutes</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text2)">${matrix.quickWins?.length || 0} items</span>
    </div>
    ${quickWinRows}
  </div>` : ''}`;
}

// ─── Fix recommendation cards (top P1 + P2) ──────────────────────────────────

function buildFixCards(items) {
  const p1p2 = items.filter(i => i.priority === 'P1' || i.priority === 'P2').slice(0, 8);

  const cards = p1p2.map(item => {
    const meta  = P_META[item.priority] || P_META.P4;
    const steps = (item.fix?.steps || []).map((s, idx) =>
      `<div style="display:flex;gap:6px;padding:3px 0">
        <span style="font-size:9px;font-weight:700;color:${meta.color};min-width:14px">${idx + 1}.</span>
        <span style="font-size:10.5px;color:var(--text1)">${e(s)}</span>
      </div>`
    ).join('');

    const impactBadges = Object.entries(item.releaseImpact || {})
      .filter(([, v]) => v)
      .map(([k]) => {
        const lbl = {
          blocksRelease:       'Blocks Release',
          impactsStability:    'Stability',
          impactsTraceability: 'Traceability',
          impactsSecurity:     'Security',
        }[k] || k;
        const c = k === 'blocksRelease' || k === 'impactsSecurity' ? 'var(--fail)' : 'var(--skip)';
        return `<span style="font-size:9px;padding:1px 6px;border-radius:8px;border:1px solid ${c};color:${c};background:${c === 'var(--fail)' ? 'var(--fail-bg)' : 'var(--skip-bg)'}">${lbl}</span>`;
      }).join('');

    return `<div class="card" style="padding:16px;border-top:3px solid ${meta.color}">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:${meta.bg};color:${meta.color};border:1px solid ${meta.border};white-space:nowrap">${e(item.priority)}</span>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:var(--text0)">${e(item.ruleId)}</div>
          <div style="font-size:10px;color:var(--text2);margin-top:1px">${e(item.file)}:${item.line}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:10.5px;font-weight:600;color:${OWNER_COLORS[item.owner] || 'var(--text1)'}">${e(item.owner)}</div>
          <div style="font-size:10px;color:var(--text2)">${e(item.effort)}</div>
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--text0);font-weight:500;margin-bottom:10px">${e(item.fix?.summary)}</div>
      ${item.fix?.before ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:var(--fail-bg);border:1px solid var(--fail-border);border-radius:var(--radius-sm);padding:8px">
          <div style="font-size:9px;font-weight:700;color:var(--fail);margin-bottom:4px">BEFORE</div>
          <code style="font-size:10px;color:var(--fail);word-break:break-all">${e(item.fix.before)}</code>
        </div>
        <div style="background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:var(--radius-sm);padding:8px">
          <div style="font-size:9px;font-weight:700;color:var(--pass);margin-bottom:4px">AFTER</div>
          <code style="font-size:10px;color:var(--pass);word-break:break-all">${e(item.fix.after)}</code>
        </div>
      </div>` : ''}
      ${steps ? `<div style="margin-bottom:8px">${steps}</div>` : ''}
      ${impactBadges ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${impactBadges}</div>` : ''}
    </div>`;
  }).join('');

  return cards ? `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Auto-Generated Fix Recommendations — P1 &amp; P2</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">${cards}</div>` : '';
}

// ─── Owner breakdown ──────────────────────────────────────────────────────────

function buildOwnerBreakdown(ownerSummary) {
  const maxH = Math.max(...ownerSummary.map(o => o.estimatedHours), 1);

  const rows = ownerSummary.map(o => {
    const c   = OWNER_COLORS[o.owner] || 'var(--text1)';
    const pct = Math.round((o.estimatedHours / maxH) * 100);
    return `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600;color:${c};min-width:160px">${e(o.owner)}</span>
        <span style="font-size:11px;color:var(--text0);font-weight:600">${o.count} items</span>
        ${o.p1Items ? `<span style="font-size:9.5px;padding:1px 6px;border-radius:8px;background:var(--fail-bg);color:var(--fail);border:1px solid var(--fail-border)">${o.p1Items} P1</span>` : ''}
        ${o.p2Items ? `<span style="font-size:9.5px;padding:1px 6px;border-radius:8px;background:rgba(249,115,22,.1);color:#f97316;border:1px solid rgba(249,115,22,.28)">${o.p2Items} P2</span>` : ''}
        <span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--text0)">${o.estimatedHours}h</span>
      </div>
      <div style="height:5px;background:var(--bg3);border-radius:3px">
        <div style="height:5px;width:${pct}%;background:${c};border-radius:3px;opacity:.75"></div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="card" style="padding:18px;margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:16px">Ownership Mapping</div>
    ${rows}
  </div>`;
}

// ─── Burndown chart ────────────────────────────────────────────────────────────

function buildBurndownChart(burndown) {
  const history  = burndown?.history || [];
  const sparkline = burndown?.sparkline || [];
  const trend    = burndown?.trend || 'BASELINE';
  const velocity = burndown?.velocity || 0;

  if (sparkline.length === 0) return '';

  const max  = Math.max(...sparkline, 1);
  const w    = 600;
  const h    = 80;
  const padL = 8;
  const padR = 8;
  const pts  = sparkline.map((v, i) => {
    const x = padL + (i / Math.max(sparkline.length - 1, 1)) * (w - padL - padR);
    const y = h - 8 - (v / max) * (h - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const trendColor = trend === 'IMPROVING' ? 'var(--pass)' : trend === 'REGRESSING' ? 'var(--fail)' : 'var(--skip)';
  const trendLabel = trend === 'IMPROVING' ? '↓ Improving' : trend === 'REGRESSING' ? '↑ Regressing' : '→ Stable';

  const recentHistory = history.slice(-10).map((h2, i) =>
    `<div style="text-align:center;flex:1">
      <div style="font-size:10px;font-weight:600;color:var(--text0)">${h2.total}</div>
      <div style="font-size:8.5px;color:var(--text2)">${h2.date.slice(5)}</div>
    </div>`
  ).join('');

  return `
  <div class="card" style="padding:18px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px">Governance Burn-down</span>
      <span style="font-size:11px;font-weight:600;color:${trendColor}">${trendLabel}</span>
      ${velocity !== 0 ? `<span style="font-size:10.5px;color:var(--text2)">${velocity > 0 ? '−' : '+'}${Math.abs(velocity)} violations since last run</span>` : ''}
      <span style="margin-left:auto;font-size:11px;color:var(--text2)">Projected zero: <strong style="color:var(--text0)">${e(burndown?.projectedZeroDate || 'TBD')}</strong></span>
    </div>
    <svg width="100%" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible" preserveAspectRatio="none">
      <defs><linearGradient id="bd-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${trendColor}" stop-opacity=".35"/>
        <stop offset="100%" stop-color="${trendColor}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${pts} ${(w - padR).toFixed(1)},${h} ${padL},${h}" fill="url(#bd-grad)"/>
      <polyline points="${pts}" fill="none" stroke="${trendColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${sparkline.map((v, i) => {
        const x = padL + (i / Math.max(sparkline.length - 1, 1)) * (w - padL - padR);
        const y = h - 8 - (v / max) * (h - 16);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${trendColor}"/>`;
      }).join('')}
    </svg>
    ${history.length > 1 ? `<div style="display:flex;gap:2px;margin-top:6px">${recentHistory}</div>` : '<div style="font-size:10.5px;color:var(--text2);margin-top:8px">Run the governance gate multiple times to build burn-down history.</div>'}
  </div>`;
}

// ─── Sprint plan table ────────────────────────────────────────────────────────

function buildSprintPlan(effortBySprint) {
  if (!effortBySprint?.length) return '';
  const rows = effortBySprint.map(s =>
    `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--accent)">${e(s.sprint)}</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--text0)">${s.count} items</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--text0)">${s.estimatedHours}h</td>
    </tr>`
  ).join('');

  return `
  <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px">Sprint Remediation Plan</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--bg2)">
        <th style="padding:8px 12px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Sprint</th>
        <th style="padding:8px 12px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Items</th>
        <th style="padding:8px 12px;font-size:9px;font-weight:700;color:var(--text2);text-align:left">Est. Effort</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Release impact panel ─────────────────────────────────────────────────────

function buildReleaseImpact(releaseImpact) {
  const items = [
    { key: 'blocksRelease',       lbl: 'Blocking Release',        c: 'var(--fail)' },
    { key: 'impactsStability',    lbl: 'Impacts Stability',       c: 'var(--skip)' },
    { key: 'impactsTraceability', lbl: 'Impacts Traceability',    c: 'var(--skip)' },
    { key: 'impactsSecurity',     lbl: 'Impacts Security',        c: 'var(--fail)' },
  ];
  const tiles = items.map(it => {
    const count = releaseImpact?.[it.key] || 0;
    return `<div class="card" style="padding:14px;text-align:center">
      <div style="font-size:9.5px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px">${e(it.lbl)}</div>
      <div style="font-size:22px;font-weight:800;color:${count > 0 ? it.c : 'var(--pass)'}">${count}</div>
      <div style="font-size:9.5px;color:var(--text2)">violation${count !== 1 ? 's' : ''}</div>
    </div>`;
  }).join('');

  return `
  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Release Impact</div>
  <div class="card-grid card-grid-4" style="gap:12px;margin-bottom:24px">${tiles}</div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

function buildRemediationDashboard(remediation) {
  if (!remediation) {
    return '<p style="color:var(--text2);padding:24px">Remediation data unavailable.</p>';
  }

  const { plan, matrix, burndown } = remediation;
  if (!plan || !matrix) {
    return '<p style="color:var(--text2);padding:24px">Remediation plan not yet generated.</p>';
  }

  const items = plan.remediationItems || [];

  return `
  ${buildKpiRow(plan)}
  ${buildReleaseImpact(matrix.releaseImpact)}
  ${buildPriorityMatrix(matrix)}
  ${buildBurndownChart(burndown)}
  ${buildFixCards(items)}
  ${buildOwnerBreakdown(plan.ownerSummary || [])}
  ${buildSprintPlan(plan.effortBySprint)}`;
}

module.exports = { buildRemediationDashboard };
