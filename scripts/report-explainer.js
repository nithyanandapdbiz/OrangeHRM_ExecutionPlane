'use strict';
/**
 * report-explainer.js
 * Builds the Truthfulness Audit panel and the "Explain This Result" modal.
 * Consumes output from truthfulness-engine.js.
 */

const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const SEV_CLS  = { CRITICAL:'fail', HIGH:'fail', MEDIUM:'skip', LOW:'info' };
const TYPE_CLS = { RAW_FACT:'pass', CALCULATED:'info', PREDICTION:'skip', AI_OPINION:'warn' };
const TYPE_LBL = { RAW_FACT:'RAW FACT', CALCULATED:'CALCULATED', PREDICTION:'PREDICTION', AI_OPINION:'RULE-BASED OPINION' };

// ─── Audit Panel ─────────────────────────────────────────────────────────────
function buildTruthinessPanel(audit) {
  if (!audit) return '<div class="empty-state">Truthfulness audit unavailable.</div>';
  const { rawFacts, calculatedMetrics, predictions, aiOpinions, findings, summary } = audit;

  const twScore = summary.overallTrustworthiness;
  const twColor = twScore >= 80 ? 'var(--pass)' : twScore >= 60 ? 'var(--skip)' : 'var(--fail)';

  // ── Summary banner ──────────────────────────────────────────────────────────
  const banner = `
<div class="card" style="border:2px solid ${twColor};margin-bottom:16px">
  <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
    <div style="text-align:center;flex-shrink:0">
      <div style="font-size:56px;font-weight:900;color:${twColor};line-height:1">${twScore}</div>
      <div style="font-size:12px;font-weight:700;color:var(--text1);text-transform:uppercase;letter-spacing:.5px">TRUSTWORTHINESS<br>SCORE / 100</div>
    </div>
    <div style="flex:1;min-width:200px">
      <div style="font-size:14px;font-weight:700;color:var(--text0);margin-bottom:8px">Platform Accuracy Audit — ${summary.totalFindings} Finding(s)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${summary.critical?`<span class="badge fail">${summary.critical} CRITICAL</span>`:''}
        ${summary.high?`<span class="badge fail">${summary.high} HIGH</span>`:''}
        ${summary.medium?`<span class="badge skip">${summary.medium} MEDIUM</span>`:''}
        ${summary.low?`<span class="badge info">${summary.low} LOW</span>`:''}
      </div>
      <div style="font-size:12px;color:var(--text1);line-height:1.6">${e(summary.disclosure)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0;font-size:12px;color:var(--text2)">
      <div>${summary.rawFactCount} Raw Facts</div>
      <div>${summary.calculatedCount} Calculated Metrics</div>
      <div>${summary.predictionCount} Predictions</div>
      <div>${summary.aiOpinionCount} Rule-Based Opinions</div>
      <div style="margin-top:6px;color:var(--info)">${summary.explainableMetrics} metrics explainable</div>
    </div>
  </div>
</div>`;

  // ── Findings table ──────────────────────────────────────────────────────────
  const findingRows = findings.map(f => `
<div class="card" style="margin-bottom:8px;border-left:4px solid ${f.severity==='CRITICAL'||f.severity==='HIGH'?'var(--fail)':f.severity==='MEDIUM'?'var(--skip)':'var(--border)'}">
  <div style="display:flex;align-items:start;gap:12px">
    <span class="badge ${SEV_CLS[f.severity]||'info'}" style="flex-shrink:0;font-size:10px;margin-top:2px">${e(f.severity)}</span>
    <div style="flex:1">
      <div style="font-size:12px;font-weight:700;color:var(--text0);margin-bottom:3px">
        <code style="font-size:11px;color:var(--info);margin-right:6px">${e(f.id)}</code>${e(f.metric)}
      </div>
      <div style="font-size:11px;color:var(--text2);font-family:monospace;margin-bottom:5px">${e(f.engine)}</div>
      <div style="font-size:12px;color:var(--text1);margin-bottom:5px">${e(f.description)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">
        <div><span style="color:var(--fail);font-weight:600">Impact: </span>${e(f.impact)}</div>
        <div><span style="color:var(--pass);font-weight:600">Fix: </span>${e(f.fix)}</div>
      </div>
    </div>
  </div>
</div>`).join('');

  // ── Data type sections ──────────────────────────────────────────────────────
  const rfRows = rawFacts.map(r => `
<tr>
  <td><code style="font-size:10px;color:var(--info)">${e(r.id)}</code></td>
  <td style="font-size:12px;font-weight:600">${e(r.label)}</td>
  <td style="font-size:12px;font-weight:700;color:var(--pass)">${e(String(r.value))}</td>
  <td style="font-size:11px;color:var(--text2)">${e(r.source)}</td>
  <td style="font-size:11px;font-family:monospace;color:var(--text1)">${e(r.formula)}</td>
</tr>`).join('');

  const cmRows = calculatedMetrics.map(c => `
<tr style="${!c.verified?'border-left:3px solid var(--skip)':''}">
  <td><code style="font-size:10px;color:var(--info)">${e(c.id)}</code></td>
  <td style="font-size:12px;font-weight:600">${e(c.label)}</td>
  <td style="font-size:12px;font-weight:700;color:${c.verified?'var(--pass)':'var(--skip)'}">${e(String(c.value))}${e(c.unit||'')}</td>
  <td style="font-size:11px;font-family:monospace;color:var(--text1)">${e(c.formula)}</td>
  <td style="font-size:11px;color:var(--text2)">
    ${c.verified?'<span style="color:var(--pass)">✓ Verified</span>':'<span style="color:var(--skip)">⚠ Caveats</span>'}
    <br>${e(c.note)}
  </td>
</tr>`).join('');

  const prRows = predictions.map(p => `
<tr>
  <td><code style="font-size:10px;color:var(--info)">${e(p.id)}</code></td>
  <td style="font-size:12px;font-weight:600">${e(p.label)}</td>
  <td style="font-size:12px;font-weight:700;color:var(--skip)">${e(String(p.value??'N/A'))}</td>
  <td style="font-size:11px;font-family:monospace;color:var(--text1)">${e(p.formula)}</td>
  <td style="font-size:12px"><span style="color:${p.confidence>=70?'var(--pass)':p.confidence>=40?'var(--skip)':'var(--fail)'};font-weight:700">${p.confidence}%</span>
    <br><span style="font-size:10px;color:var(--text2)">${e(p.note)}</span>
  </td>
</tr>`).join('');

  const aoRows = aiOpinions.map(a => `
<tr>
  <td><code style="font-size:10px;color:var(--info)">${e(a.id)}</code></td>
  <td style="font-size:12px">
    <div style="font-weight:600">${e(a.label)}</div>
    <div style="font-size:10px;color:var(--fail);margin-top:2px">Labelled as: "${e(a.labelledAs)}"</div>
    <div style="font-size:10px;color:var(--pass);margin-top:1px">Actual: ${e(a.actualMethod)}</div>
  </td>
  <td style="font-size:12px;font-weight:700;color:var(--skip)">${e(String(a.confidence))}%</td>
  <td style="font-size:11px;color:var(--text1)">${e(a.method)}</td>
  <td style="font-size:11px">
    <div style="color:var(--fail)">⚠ FP: ${e(a.falsePositiveRisk?.slice(0,100)||'')}</div>
    <div style="color:var(--skip);margin-top:3px">⚠ FN: ${e(a.falseNegativeRisk?.slice(0,100)||'')}</div>
  </td>
</tr>`).join('');

  return `
${banner}

<!-- Findings -->
<div class="card" style="margin-bottom:16px">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text1);margin-bottom:12px">
    ⚠ Accuracy Findings — Action Required
  </div>
  ${findingRows}
</div>

<!-- RAW FACTS -->
<div class="card" style="margin-bottom:16px;overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--pass);margin-bottom:10px">
    ✓ RAW FACTS — Direct Measurements (No Inference)
  </div>
  <table class="data-table">
    <thead><tr><th>ID</th><th>Metric</th><th>Value</th><th>Source</th><th>Formula</th></tr></thead>
    <tbody>${rfRows}</tbody>
  </table>
</div>

<!-- CALCULATED METRICS -->
<div class="card" style="margin-bottom:16px;overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--info);margin-bottom:10px">
    ⚡ CALCULATED METRICS — Deterministic Formulas on Raw Facts
  </div>
  <table class="data-table">
    <thead><tr><th>ID</th><th>Metric</th><th>Value</th><th>Formula</th><th>Accuracy Note</th></tr></thead>
    <tbody>${cmRows}</tbody>
  </table>
</div>

<!-- PREDICTIONS -->
<div class="card" style="margin-bottom:16px;overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--skip);margin-bottom:10px">
    🔮 PREDICTIONS — Extrapolated / Forecasted Values (Not Measurements)
  </div>
  <table class="data-table">
    <thead><tr><th>ID</th><th>Metric</th><th>Value</th><th>Method</th><th>Confidence &amp; Caveats</th></tr></thead>
    <tbody>${prRows}</tbody>
  </table>
</div>

<!-- AI OPINIONS -->
<div class="card" style="margin-bottom:16px;overflow:auto">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--fail);margin-bottom:10px">
    🤖 RULE-BASED OPINIONS — Pattern Matching Heuristics (Labelled "AI" — No ML/LLM)
  </div>
  <table class="data-table">
    <thead><tr><th>ID</th><th>Label (Actual Method)</th><th>Confidence</th><th>Method</th><th>False Positive / Negative Risk</th></tr></thead>
    <tbody>${aoRows}</tbody>
  </table>
  <div style="margin-top:10px;padding:8px 12px;background:rgba(248,81,73,.08);border-radius:6px;font-size:12px;color:var(--fail)">
    <strong>Disclosure:</strong> None of the above sections use machine learning, neural networks, or language models.
    Confidence values are calibration constants embedded in pattern definitions, not statistically derived probabilities.
  </div>
</div>`;
}

// ─── Explain-This-Result Modal HTML ──────────────────────────────────────────
function buildExplainModal() {
  return `
<div id="explain-modal" style="display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);align-items:center;justify-content:center">
  <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;width:min(720px,95vw);max-height:90vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.5)">
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg1);z-index:1">
      <div id="explain-type-badge" class="badge info" style="flex-shrink:0;font-size:10px"></div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:700;color:var(--text0)" id="explain-title"></div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px" id="explain-id"></div>
      </div>
      <button onclick="closeExplain()" style="background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;padding:4px 8px">✕</button>
    </div>
    <div style="padding:20px;display:grid;gap:16px">
      <!-- Result -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px">RESULT</div>
        <div style="font-size:24px;font-weight:900;color:var(--pass)" id="explain-result"></div>
      </div>
      <!-- Source -->
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px">DATA SOURCE</div>
        <div style="font-size:13px;color:var(--text1)" id="explain-source"></div>
      </div>
      <!-- Formula -->
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px">FORMULA / METHOD</div>
        <pre style="font-size:12px;color:var(--info);background:var(--bg2);border:1px solid var(--border);padding:10px;border-radius:6px;margin:0;white-space:pre-wrap;font-family:monospace" id="explain-formula"></pre>
      </div>
      <!-- Inputs -->
      <div id="explain-inputs-section">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px">INPUTS USED</div>
        <div id="explain-inputs" style="font-size:12px;font-family:monospace;color:var(--text1);background:var(--bg2);border:1px solid var(--border);padding:10px;border-radius:6px"></div>
      </div>
      <!-- Decision Logic -->
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px">DECISION LOGIC</div>
        <div style="font-size:13px;color:var(--text1)" id="explain-logic"></div>
      </div>
      <!-- Confidence -->
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2)">CONFIDENCE</div>
        <div id="explain-confidence" style="font-size:18px;font-weight:800"></div>
      </div>
      <!-- Caveats -->
      <div id="explain-caveats-section">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--fail);margin-bottom:6px">⚠ KNOWN CAVEATS</div>
        <div id="explain-caveats" style="font-size:12px;color:var(--text1)"></div>
      </div>
    </div>
  </div>
</div>`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function buildExplainerStyles() {
  return `
/* ── Explainer & Audit ── */
[data-explain]{cursor:help;border-bottom:1px dashed var(--info);transition:opacity .15s}
[data-explain]:hover{opacity:.8}
.explain-btn{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--info);cursor:pointer;border:none;background:none;padding:2px 6px;border-radius:4px;border:1px solid var(--border)}
.explain-btn:hover{background:var(--bg2)}
`;
}

// ─── JS (embedded in page) ────────────────────────────────────────────────────
function buildExplainerScripts(audit) {
  const registry = audit?.explainRegistry || {};
  // Sanitise for JSON embedding — strip circular refs, limit size
  const safe = JSON.stringify(registry).replace(/<\/script>/gi, '<\\/script>');
  return `
(function(){
  var EXPLAIN = ${safe};

  window.openExplain = function(id) {
    var r = EXPLAIN[id];
    if (!r) return;
    var TYPE_CLS = { RAW_FACT:'pass', CALCULATED:'info', PREDICTION:'skip', AI_OPINION:'warn' };
    var TYPE_LBL = { RAW_FACT:'RAW FACT', CALCULATED:'CALCULATED METRIC', PREDICTION:'PREDICTION', AI_OPINION:'RULE-BASED OPINION' };
    document.getElementById('explain-title').textContent     = r.label || id;
    document.getElementById('explain-id').textContent        = id;
    document.getElementById('explain-result').textContent    = r.result || '–';
    document.getElementById('explain-source').textContent    = r.source || '–';
    document.getElementById('explain-formula').textContent   = r.formula || '–';
    document.getElementById('explain-logic').textContent     = r.decisionLogic || '–';
    var confEl = document.getElementById('explain-confidence');
    var conf   = r.confidence || 0;
    confEl.textContent = conf + '%';
    confEl.style.color = conf >= 90 ? 'var(--pass)' : conf >= 70 ? 'var(--skip)' : 'var(--fail)';
    var typeBadge = document.getElementById('explain-type-badge');
    typeBadge.textContent = TYPE_LBL[r.type] || r.type;
    typeBadge.className   = 'badge ' + (TYPE_CLS[r.type] || 'info');
    // Inputs
    var inp   = r.inputs || [];
    var inpEl = document.getElementById('explain-inputs');
    inpEl.textContent = Array.isArray(inp) ? inp.join('\\n') : JSON.stringify(inp, null, 2);
    // Caveats
    var cav   = r.caveats || [];
    var cavEl = document.getElementById('explain-caveats');
    cavEl.innerHTML = (Array.isArray(cav) ? cav : [cav]).filter(Boolean).map(function(c){
      return '<div style="padding:4px 0;border-bottom:1px solid var(--border)">' + c.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>';
    }).join('');
    var modal = document.getElementById('explain-modal');
    modal.style.display = 'flex';
    modal.onclick = function(ev){ if(ev.target===modal) window.closeExplain(); };
  };

  window.closeExplain = function() {
    document.getElementById('explain-modal').style.display = 'none';
  };

  document.addEventListener('keydown', function(e){ if(e.key==='Escape') window.closeExplain(); });

  // Wire all [data-explain] elements on click
  document.addEventListener('click', function(ev){
    var el = ev.target.closest('[data-explain]');
    if (el) { ev.preventDefault(); window.openExplain(el.getAttribute('data-explain')); }
  });
})();`;
}

module.exports = {
  buildTruthinessPanel,
  buildExplainModal,
  buildExplainerStyles,
  buildExplainerScripts,
};
