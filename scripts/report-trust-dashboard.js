'use strict';
/**
 * Trust Score Dashboard — HTML builder
 * Renders: trustworthiness score, metric registry, decision registry, data lineage,
 *          Jira validation summary, traceability certification summary.
 */

const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MATURITY_COLOR = {
  STABLE:               '#3fb950',
  MATURING:             '#79c0ff',
  EXPERIMENTAL:         '#e3b341',
  ARCHITECTURE_LIMIT:   '#f85149',
};
const MATURITY_LABEL = {
  STABLE:               'STABLE',
  MATURING:             'MATURING',
  EXPERIMENTAL:         'EXPERIMENTAL',
  ARCHITECTURE_LIMIT:   'ARCH LIMIT',
};

function matBadge(maturity) {
  const color = MATURITY_COLOR[maturity] || '#888';
  const label = MATURITY_LABEL[maturity] || maturity;
  return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};border:1px solid ${color}55">${label}</span>`;
}

function confBar(min, max) {
  const avg = Math.round((min + max) / 2);
  const color = avg >= 90 ? '#3fb950' : avg >= 70 ? '#79c0ff' : avg >= 50 ? '#e3b341' : '#f85149';
  return `<div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">
      <div style="width:${avg}%;height:100%;background:${color};border-radius:3px"></div>
    </div>
    <span style="font-size:11px;color:${color};min-width:35px">${min === max ? `${min}%` : `${min}–${max}%`}</span>
  </div>`;
}

// ── Trust Score Summary ────────────────────────────────────────────────────────
function buildTrustSummary(audit, metricRegistry, decisionRegistry, dataLineage) {
  const score = audit?.summary?.overallTrustworthiness ?? 0;
  const scoreColor = score >= 80 ? '#3fb950' : score >= 60 ? '#e3b341' : '#f85149';
  const scoreLabel = score >= 85 ? 'HIGH TRUST' : score >= 70 ? 'MODERATE TRUST' : score >= 50 ? 'LOW TRUST' : 'UNTRUSTED';

  const finds = audit?.findings || [];
  const archLimits  = finds.filter(f => f.id?.startsWith('AL'));
  const fixedCount  = (audit?.summary?.totalFixed ?? 0);
  const remaining   = finds.length;

  const bonuses = audit?.summary?.bonuses || {};

  return `
<div style="display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:start;margin-bottom:20px">

  <!-- Score Ring -->
  <div class="card" style="text-align:center;padding:28px 16px">
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="55" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"/>
      <circle cx="70" cy="70" r="55" fill="none" stroke="${scoreColor}" stroke-width="10"
        stroke-dasharray="${(Math.min(score/100,1)*2*Math.PI*55).toFixed(1)} ${(2*Math.PI*55).toFixed(1)}"
        stroke-dashoffset="${(2*Math.PI*55/4).toFixed(1)}" stroke-linecap="round"/>
      <text x="70" y="64" text-anchor="middle" fill="${scoreColor}" font-size="28" font-weight="900">${score}</text>
      <text x="70" y="82" text-anchor="middle" fill="rgba(255,255,255,.5)" font-size="10">/100</text>
    </svg>
    <div style="font-size:13px;font-weight:800;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
    <div style="font-size:11px;color:var(--text1);margin-top:4px">Trustworthiness Score</div>
  </div>

  <!-- Score Breakdown -->
  <div class="card" style="padding:20px">
    <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text0)">Score Breakdown</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="padding:10px;background:rgba(248,81,73,.07);border-radius:6px;border:1px solid rgba(248,81,73,.2)">
        <div style="font-size:20px;font-weight:800;color:#f85149">${audit?.summary?.critical ?? 0}</div>
        <div style="font-size:11px;color:var(--text1)">Critical findings</div>
        <div style="font-size:10px;color:rgba(255,255,255,.35)">−12 pts each (cap 25)</div>
      </div>
      <div style="padding:10px;background:rgba(227,179,65,.07);border-radius:6px;border:1px solid rgba(227,179,65,.2)">
        <div style="font-size:20px;font-weight:800;color:#e3b341">${audit?.summary?.high ?? 0}</div>
        <div style="font-size:11px;color:var(--text1)">High findings</div>
        <div style="font-size:10px;color:rgba(255,255,255,.35)">−5 pts each (cap 20)</div>
      </div>
      <div style="padding:10px;background:rgba(121,192,255,.07);border-radius:6px;border:1px solid rgba(121,192,255,.2)">
        <div style="font-size:20px;font-weight:800;color:#79c0ff">${audit?.summary?.medium ?? 0}</div>
        <div style="font-size:11px;color:var(--text1)">Medium findings</div>
        <div style="font-size:10px;color:rgba(255,255,255,.35)">−2 pts each (cap 12)</div>
      </div>
      <div style="padding:10px;background:rgba(63,185,80,.07);border-radius:6px;border:1px solid rgba(63,185,80,.2)">
        <div style="font-size:20px;font-weight:800;color:#3fb950">${audit?.summary?.low ?? 0}</div>
        <div style="font-size:11px;color:var(--text1)">Low / Arch limits</div>
        <div style="font-size:10px;color:rgba(255,255,255,.35)">−1 pt each (cap 5)</div>
      </div>
    </div>

    <!-- Bonuses -->
    <div style="font-size:12px;font-weight:600;color:var(--text1);margin-bottom:8px">Transparency Bonuses</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${Object.entries(bonuses || {}).map(([k, v]) =>
        `<div style="padding:4px 10px;border-radius:12px;background:rgba(63,185,80,.12);border:1px solid rgba(63,185,80,.3);font-size:11px;color:#3fb950">+${v} ${e(k)}</div>`
      ).join('')}
    </div>

    <div style="margin-top:12px;padding:10px;background:rgba(255,255,255,.04);border-radius:6px">
      <div style="font-size:11px;color:var(--text1)">${e(audit?.summary?.disclosure || '')}</div>
    </div>
  </div>
</div>`;
}

// ── Metric Registry Table ──────────────────────────────────────────────────────
function buildMetricRegistryTable(metricRegistry) {
  if (!metricRegistry?.metrics?.length) return '<div style="color:var(--text1);font-size:13px">Metric registry unavailable.</div>';

  const rows = metricRegistry.metrics.map(met => `
    <tr>
      <td style="font-size:12px;font-weight:600;color:var(--text0)">${e(met.label)}</td>
      <td>${matBadge(met.maturity)}</td>
      <td><span style="font-size:10px;color:var(--text1)">${e(met.type)}</span></td>
      <td style="font-size:12px;color:var(--text0)">${met.value !== null && met.value !== undefined ? `${e(String(met.value))}${e(met.unit || '')}` : '<span style="opacity:.4">N/A</span>'}</td>
      <td>${confBar(met.confidence?.min ?? 0, met.confidence?.max ?? 0)}</td>
      <td style="max-width:220px">
        <div style="font-size:10px;color:var(--text1);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e(met.formula)}">${e(met.formula)}</div>
        ${met.limitations?.length ? `<div style="font-size:10px;color:#e3b341;margin-top:3px">⚠ ${e(met.limitations[0])}</div>` : ''}
      </td>
    </tr>`).join('');

  const { STABLE = 0, MATURING = 0, EXPERIMENTAL = 0, ARCHITECTURE_LIMIT = 0 } = metricRegistry.maturitySummary || {};

  return `
<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
  <div style="padding:8px 14px;border-radius:6px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.25);font-size:12px">
    <span style="color:#3fb950;font-weight:700">${STABLE}</span> <span style="color:var(--text1)">Stable</span>
  </div>
  <div style="padding:8px 14px;border-radius:6px;background:rgba(121,192,255,.08);border:1px solid rgba(121,192,255,.25);font-size:12px">
    <span style="color:#79c0ff;font-weight:700">${MATURING}</span> <span style="color:var(--text1)">Maturing</span>
  </div>
  <div style="padding:8px 14px;border-radius:6px;background:rgba(227,179,65,.08);border:1px solid rgba(227,179,65,.25);font-size:12px">
    <span style="color:#e3b341;font-weight:700">${EXPERIMENTAL}</span> <span style="color:var(--text1)">Experimental</span>
  </div>
  <div style="padding:8px 14px;border-radius:6px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.25);font-size:12px">
    <span style="color:#f85149;font-weight:700">${ARCHITECTURE_LIMIT}</span> <span style="color:var(--text1)">Arch Limits</span>
  </div>
  <div style="margin-left:auto;padding:8px 14px;font-size:12px;color:var(--text1)">
    ${metricRegistry.stablePercent}% of metrics are STABLE
  </div>
</div>
<div style="overflow-x:auto">
<table style="width:100%;border-collapse:collapse;font-size:12px">
  <thead>
    <tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:160px">METRIC</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:120px">MATURITY</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:110px">TYPE</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:80px">VALUE</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:140px">CONFIDENCE</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px">FORMULA / CAVEATS</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</div>`;
}

// ── Decision Registry Table ────────────────────────────────────────────────────
function buildDecisionRegistryTable(decisionRegistry) {
  if (!decisionRegistry?.decisions?.length) return '<div style="color:var(--text1);font-size:13px">Decision registry unavailable.</div>';

  const topDecisions = decisionRegistry.decisions.filter(d => !d.id.startsWith('DEC-FACTOR') && !d.id.startsWith('DEC-CLUSTER')).slice(0, 8);

  const rows = topDecisions.map(dec => {
    const outColor = dec.output?.includes('GO') && !dec.output?.includes('NO') ? '#3fb950'
      : dec.output?.includes('CONDITIONAL') ? '#e3b341'
      : dec.output?.includes('NO GO') ? '#f85149'
      : '#79c0ff';
    return `
    <tr style="border-bottom:1px solid rgba(255,255,255,.05)">
      <td style="padding:8px 6px;font-size:12px;font-weight:600;color:var(--text0)">${e(dec.name)}</td>
      <td style="padding:8px 6px">
        <span style="font-size:12px;font-weight:700;color:${outColor}">${e(String(dec.output))}</span>
      </td>
      <td style="padding:8px 6px;max-width:200px">
        <div style="font-size:10px;color:var(--text1);font-family:monospace;white-space:pre-line">${e(dec.logic)}</div>
      </td>
      <td style="padding:8px 6px;font-size:11px;color:var(--text1);max-width:200px">${e(dec.reasoning || '')}</td>
      <td style="padding:8px 6px">
        ${confBar(dec.confidence || 0, dec.confidence || 0)}
        ${dec.caveat ? `<div style="font-size:10px;color:#e3b341;margin-top:4px">⚠ ${e(dec.caveat)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `
<div style="margin-bottom:12px;font-size:12px;color:var(--text1)">
  ${decisionRegistry.totalDecisions} decisions recorded · ${decisionRegistry.explainabilityRate}% fully explainable
</div>
<table style="width:100%;border-collapse:collapse;font-size:12px">
  <thead>
    <tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:160px">DECISION</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:140px">OUTPUT</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:180px">LOGIC</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px">REASONING</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-weight:600;font-size:11px;width:160px">CONFIDENCE</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

// ── Data Lineage Table ─────────────────────────────────────────────────────────
function buildDataLineageTable(dataLineage) {
  if (!dataLineage?.lineageEntries?.length) return '<div style="color:var(--text1);font-size:13px">Data lineage unavailable.</div>';

  const STAGE_COLOR = {
    SOURCE: '#79c0ff', PARSE: '#a8dadc', FILTER: '#79c0ff', CLASSIFY: '#e3b341',
    AGGREGATE: '#3fb950', CALCULATE: '#3fb950', SCORE: '#3fb950', BAND: '#e3b341',
    FACTOR: '#a371f7', REGRESSION: '#a371f7', PREDICT: '#a371f7', DECISION: '#e3b341',
    DISPLAY: '#f0f6fc',
  };

  const cards = dataLineage.lineageEntries.map(lin => {
    const certified = lin.certifiedAccurate;
    const confColor = lin.confidence >= 90 ? '#3fb950' : lin.confidence >= 70 ? '#79c0ff' : lin.confidence >= 50 ? '#e3b341' : '#f85149';

    const chainHtml = lin.chain.map((step, i) => {
      const col = STAGE_COLOR[step.stage] || '#888';
      return `<div style="display:flex;align-items:start;gap:8px;padding:6px 0;${i < lin.chain.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.05)' : ''}">
        <span style="min-width:76px;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;background:${col}22;color:${col};border:1px solid ${col}44;text-align:center">${e(step.stage)}</span>
        <div>
          <div style="font-size:10px;font-weight:600;color:var(--text0)">${e(step.file)}</div>
          <div style="font-size:10px;color:var(--text1)">${e(step.detail)}</div>
        </div>
      </div>`;
    }).join('');

    return `
<div class="card" style="margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div>
      <span style="font-size:13px;font-weight:700;color:var(--text0)">${e(lin.metric)}</span>
      <span style="margin-left:8px;font-size:11px;color:${confColor}">→ ${e(lin.displayValue)}</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${confColor}22;color:${confColor};border:1px solid ${confColor}44">${lin.confidence}% confidence</span>
      ${certified
        ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#3fb95022;color:#3fb950;border:1px solid #3fb95044">✓ CERTIFIED</span>'
        : '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#e3b34122;color:#e3b341;border:1px solid #e3b34144">ESTIMATE</span>'}
    </div>
  </div>
  <div style="border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:10px">
    ${chainHtml}
  </div>
  ${lin.caveats?.length ? `<div style="margin-top:8px">${lin.caveats.map(c => `<div style="font-size:10px;color:#e3b341;padding:2px 0">⚠ ${e(c)}</div>`).join('')}</div>` : ''}
</div>`;
  }).join('');

  return `
<div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap">
  <span style="font-size:12px;color:var(--text1)">${dataLineage.totalEntries} metrics traced</span>
  <span style="font-size:12px;color:#3fb950">✓ ${dataLineage.certifiedAccurate} certified accurate</span>
  <span style="font-size:12px;color:var(--text1)">Avg confidence: ${dataLineage.avgConfidence}%</span>
</div>
${cards}`;
}

// ── Architecture Limitations ───────────────────────────────────────────────────
function buildArchLimitations(findings) {
  const archFinds = (findings || []).filter(f => f.id?.startsWith('AL'));
  if (!archFinds.length) return '';

  const rows = archFinds.map(f => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.05)">
      <td style="padding:8px 6px;font-size:11px;font-weight:700;color:#f85149">${e(f.id)}</td>
      <td style="padding:8px 6px;font-size:12px;color:var(--text0)">${e(f.metric)}</td>
      <td style="padding:8px 6px;font-size:11px;color:var(--text1)">${e(f.description)}</td>
      <td style="padding:8px 6px;font-size:11px;color:#79c0ff">${e(f.fix)}</td>
    </tr>`).join('');

  return `
<div style="margin-bottom:8px;font-size:12px;color:var(--text1)">
  These limitations require schema or infrastructure changes — not fixable by changing report logic alone.
</div>
<table style="width:100%;border-collapse:collapse;font-size:12px">
  <thead>
    <tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-size:11px;width:60px">ID</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-size:11px;width:160px">METRIC</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-size:11px">LIMITATION</th>
      <th style="text-align:left;padding:8px 6px;color:var(--text1);font-size:11px;width:200px">RESOLUTION PATH</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

// ── Jira Validation Panel ─────────────────────────────────────────────────────
function buildAlmValidationPanel(almValidation) {
  if (!almValidation) return '<div style="color:var(--text1);font-size:13px">Jira validation data unavailable.</div>';
  const s = almValidation.summary;
  const govColor = almValidation.governanceStatus === 'PASS' ? '#3fb950'
    : almValidation.governanceStatus === 'WARN' ? '#e3b341' : '#f85149';
  const govIcon  = almValidation.governanceStatus === 'PASS' ? '✓' : almValidation.governanceStatus === 'WARN' ? '⚠' : '✗';

  const metaRows = [
    ['Validation Mode',       almValidation.validationMode],
    ['Zephyr Test Cycle ID',  s.suiteInfo?.planId   ?? '–'],
    ['Zephyr Test Cycle Size',`${s.suiteInfo?.planSize ?? 0} test cases`],
    ['Total Scenarios',       s.totalScenarios],
    ['With Jira Tag',         `${s.withTag} (${Math.round(s.withTag/Math.max(s.totalScenarios,1)*100)}%)`],
    ['Orphan Scenarios',      `${s.orphanScenarios} (${s.orphanRate}%)`],
    ['Valid Test Cases',      s.validTestCases],
    ['Broken Links',          s.brokenLinks],
    ['Suite Not Executed',    s.suiteNotExecuted],
    ['Validation Coverage',   `${s.validationCoverage}%`],
  ].map(([k, v]) => `<tr>
    <td style="font-size:12px;color:var(--text1);padding:6px 8px;width:200px">${e(k)}</td>
    <td style="font-size:12px;font-weight:600;color:var(--text0);padding:6px 8px">${e(String(v))}</td>
  </tr>`).join('');

  const issueSection = (title, items, colorVar) => items.length === 0 ? '' : `
    <div style="margin-top:12px">
      <div style="font-size:11px;font-weight:700;color:${colorVar};text-transform:uppercase;margin-bottom:6px">${title}</div>
      ${items.slice(0, 10).map(i => `<div style="font-size:12px;color:var(--text1);padding:4px 0;border-bottom:1px solid var(--border)">${e(i.scenarioName || i)} — ${e(i.featureName || i.issues?.[0] || '')}</div>`).join('')}
      ${items.length > 10 ? `<div style="font-size:11px;color:var(--text2);margin-top:4px">…and ${items.length - 10} more</div>` : ''}
    </div>`;

  return `
<div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;margin-bottom:16px;padding:14px;background:${govColor}11;border:1px solid ${govColor}33;border-radius:8px">
  <div style="font-size:36px;font-weight:900;color:${govColor}">${govIcon}</div>
  <div>
    <div style="font-size:15px;font-weight:800;color:${govColor}">Jira Governance: ${almValidation.governanceStatus}</div>
    <div style="font-size:12px;color:var(--text1);margin-top:3px">Validated at ${almValidation.validatedAt?.slice(0,19).replace('T',' ')} UTC</div>
  </div>
</div>
<div class="card" style="overflow:auto;margin-bottom:12px">
  <table class="data-table"><tbody>${metaRows}</tbody></table>
</div>
${issueSection('Orphan Scenarios (No Jira Tag)', almValidation.issues?.orphans || [], '#f85149')}
${issueSection('Invalid Format Tags', almValidation.issues?.invalidFormat || [], '#e3b341')}
${issueSection('Test Cases Not in Suite', almValidation.issues?.notInSuite || [], '#e3b341')}
${(almValidation.issues?.suiteMissing || []).length > 0 ? `
<div style="margin-top:12px">
  <div style="font-size:11px;font-weight:700;color:#79c0ff;text-transform:uppercase;margin-bottom:6px">Zephyr Suite TCs Not Executed</div>
  ${almValidation.issues.suiteMissing.map(i => `<div style="font-size:12px;color:var(--text1);padding:4px 0;border-bottom:1px solid var(--border)">TC ${e(String(i.testCaseId))} — ${e(i.issue)}</div>`).join('')}
</div>` : ''}`;
}

// ── Traceability Certification Panel ──────────────────────────────────────────
function buildTraceCertPanel(traceCert) {
  if (!traceCert) return '<div style="color:var(--text1);font-size:13px">Traceability certification data unavailable.</div>';
  const s = traceCert.summary;
  const certColor = s.certifiedRate >= 80 ? '#3fb950' : s.certifiedRate >= 50 ? '#e3b341' : '#f85149';

  const linkRows = s.linkCoverage
    ? Object.entries(s.linkCoverage).map(([link, pct]) => {
        const color = pct === null ? '#8b949e' : pct >= 90 ? '#3fb950' : pct >= 60 ? '#e3b341' : '#f85149';
        const display = pct === null ? 'N/A' : `${pct}%`;
        return `<tr>
          <td style="font-size:12px;color:var(--text1);padding:5px 8px;text-transform:capitalize">${e(link)}</td>
          <td style="font-size:12px;font-weight:700;color:${color};padding:5px 8px">${display}</td>
          <td style="padding:5px 8px">
            ${pct !== null ? `<div style="width:${Math.max(pct,0)}%;height:5px;background:${color};border-radius:2px;max-width:120px"></div>` : '<span style="font-size:11px;color:var(--text2)">not applicable</span>'}
          </td>
        </tr>`;
      }).join('')
    : '';

  const chainStatusRows = [
    ['CERTIFIED', traceCert.summary.certified, '#3fb950'],
    ['PARTIAL',   traceCert.summary.partial,   '#e3b341'],
    ['BROKEN',    traceCert.summary.broken,    '#f85149'],
  ].map(([status, count, color]) => count > 0 ? `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;font-weight:700;color:${color};width:80px">${status}</span>
      <div style="flex:1;height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden">
        <div style="width:${Math.round(count/Math.max(s.total,1)*100)}%;height:100%;background:${color}"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${color};min-width:32px;text-align:right">${count}</span>
    </div>` : '').join('');

  return `
<div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;margin-bottom:16px;padding:14px;background:${certColor}11;border:1px solid ${certColor}33;border-radius:8px">
  <div style="font-size:36px;font-weight:900;color:${certColor}">${s.certifiedRate}%</div>
  <div>
    <div style="font-size:15px;font-weight:800;color:${certColor}">Traceability Certified</div>
    <div style="font-size:12px;color:var(--text1);margin-top:3px">${s.certified} of ${s.total} scenario chains fully certified</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
  <div class="card">
    <div style="font-size:11px;font-weight:700;color:var(--text1);margin-bottom:10px;text-transform:uppercase">Chain Status</div>
    ${chainStatusRows}
    ${s.orphanExecutions > 0 ? `<div style="margin-top:8px;font-size:12px;color:#f85149">⚠ ${s.orphanExecutions} orphan execution(s) — no Zephyr TC or requirement</div>` : ''}
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;color:var(--text1);margin-bottom:10px;text-transform:uppercase">Link Coverage</div>
    <table class="data-table"><tbody>${linkRows}</tbody></table>
  </div>
</div>

${(traceCert.issues?.broken || []).length > 0 ? `
<div class="card" style="border-left:3px solid #f85149">
  <div style="font-size:11px;font-weight:700;color:#f85149;margin-bottom:8px;text-transform:uppercase">Broken Chains</div>
  ${traceCert.issues.broken.slice(0,8).map(b => `
    <div style="font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text0)">${e(b.scenarioName)}</span>
      <span style="color:#f85149;margin-left:8px;font-size:11px">Missing: ${(b.missing||[]).join(', ')}</span>
    </div>`).join('')}
</div>` : ''}`;
}

// ── Main builder ──────────────────────────────────────────────────────────────
function buildTrustDashboard(audit, metricRegistry, decisionRegistry, dataLineage, almValidation, traceCert) {
  const score = audit?.summary?.overallTrustworthiness ?? 0;
  const scoreColor = score >= 80 ? '#3fb950' : score >= 60 ? '#e3b341' : '#f85149';
  const jiraStatus  = almValidation?.governanceStatus || '–';
  const jiraColor   = jiraStatus === 'PASS' ? '#3fb950' : jiraStatus === 'WARN' ? '#e3b341' : '#f85149';
  const certRate   = traceCert?.certifiedRate ?? 0;
  const certColor  = certRate >= 80 ? '#3fb950' : certRate >= 50 ? '#e3b341' : '#f85149';
  const ALL_TAB_IDS = ['trust-tab-metrics','trust-tab-decisions','trust-tab-lineage','trust-tab-arch','trust-tab-jira','trust-tab-tracecert'];

  return `
<!-- Trust Score Summary -->
${buildTrustSummary(audit, metricRegistry, decisionRegistry, dataLineage)}

<!-- Jira + Traceability Status Banner -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
  <div class="card" style="padding:14px;border-top:3px solid ${jiraColor}">
    <div style="font-size:11px;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Jira Source of Truth</div>
    <div style="font-size:20px;font-weight:800;color:${jiraColor}">${jiraStatus}</div>
    <div style="font-size:11px;color:var(--text2);margin-top:3px">${almValidation?.summary?.validationCoverage ?? 0}% valid · ${almValidation?.summary?.orphanScenarios ?? 0} orphans · ${almValidation?.summary?.brokenLinks ?? 0} broken</div>
  </div>
  <div class="card" style="padding:14px;border-top:3px solid ${certColor}">
    <div style="font-size:11px;color:var(--text1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Traceability Certification</div>
    <div style="font-size:20px;font-weight:800;color:${certColor}">${certRate}%</div>
    <div style="font-size:11px;color:var(--text2);margin-top:3px">${traceCert?.summary?.certified ?? 0} certified · ${traceCert?.brokenChains ?? 0} broken chains</div>
  </div>
</div>

<!-- Tab Navigation -->
<div style="display:flex;gap:2px;margin-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
  ${[
    ['trust-tab-metrics',   'Metric Registry',        `${metricRegistry?.totalMetrics ?? 0}`],
    ['trust-tab-decisions', 'Decision Registry',       `${decisionRegistry?.totalDecisions ?? 0}`],
    ['trust-tab-lineage',   'Data Lineage',            `${dataLineage?.totalEntries ?? 0}`],
    ['trust-tab-jira',       'Jira Validation',         jiraStatus],
    ['trust-tab-tracecert', 'Traceability Cert',       `${certRate}%`],
    ['trust-tab-arch',      'Architecture Limits',     `${(audit?.findings||[]).filter(f=>f.id?.startsWith('AL')).length}`],
  ].map(([id, lbl, badge], i) => `
    <button onclick="trustTab('${id}')" id="${id}-btn"
      style="padding:8px 14px;background:${i===0?'rgba(255,255,255,.08)':'none'};border:none;border-bottom:${i===0?'2px solid #79c0ff':'2px solid transparent'};color:${i===0?'var(--text0)':'var(--text1)'};font-size:12px;font-weight:600;cursor:pointer;border-radius:4px 4px 0 0;white-space:nowrap">
      ${e(lbl)} <span style="font-size:10px;opacity:.6">${e(badge)}</span>
    </button>`
  ).join('')}
</div>

<!-- Tab Content -->
<div id="trust-tab-metrics" class="trust-tab">
  ${buildMetricRegistryTable(metricRegistry)}
</div>
<div id="trust-tab-decisions" class="trust-tab" style="display:none">
  ${buildDecisionRegistryTable(decisionRegistry)}
</div>
<div id="trust-tab-lineage" class="trust-tab" style="display:none">
  ${buildDataLineageTable(dataLineage)}
</div>
<div id="trust-tab-jira" class="trust-tab" style="display:none">
  ${buildAlmValidationPanel(almValidation)}
</div>
<div id="trust-tab-tracecert" class="trust-tab" style="display:none">
  ${buildTraceCertPanel(traceCert)}
</div>
<div id="trust-tab-arch" class="trust-tab" style="display:none">
  ${buildArchLimitations(audit?.findings)}
</div>

<script>
function trustTab(activeId) {
  document.querySelectorAll('.trust-tab').forEach(t => t.style.display = 'none');
  document.getElementById(activeId).style.display = 'block';
  ${JSON.stringify(ALL_TAB_IDS)}.forEach(function(id){
    var btn = document.getElementById(id + '-btn');
    if (!btn) return;
    var active = id === activeId;
    btn.style.background = active ? 'rgba(255,255,255,.08)' : 'none';
    btn.style.borderBottomColor = active ? '#79c0ff' : 'transparent';
    btn.style.color = active ? 'var(--text0)' : 'var(--text1)';
  });
}
</script>`;
}

function buildTrustDashboardStyles() {
  return `
.trust-tab table tr:hover { background:rgba(255,255,255,.02); }
.trust-tab table td { vertical-align:top; }
`;
}

module.exports = { buildTrustDashboard, buildTrustDashboardStyles };
