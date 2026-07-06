'use strict';
/**
 * perfLogger.js — Step and page-object performance instrumentation  (WI-038D)
 *
 * logStepTiming  — appends one JSONL line to logs/step-timings.jsonl
 * logPageAction  — appends one entry to reports/page-object-performance.json
 *                  and prints a console line for live visibility
 * writeCreateEmployeeDiagnostic — writes reports/create-employee-diagnostic.json
 */

const fs   = require('fs');
const path = require('path');

const PERF_REPORT = path.join(process.cwd(), 'reports', 'page-object-performance.json');
const STEP_LOG    = path.join(process.cwd(), 'logs',    'step-timings.jsonl');
const EMPLOYEE_DIAG = path.join(process.cwd(), 'reports', 'create-employee-diagnostic.json');

// ─── logStepTiming ────────────────────────────────────────────────────────────

function logStepTiming({ scenario, step, durationMs, status, error }) {
  try {
    const logsDir = path.dirname(STEP_LOG);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(
      STEP_LOG,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        scenario:  scenario || null,
        step,
        durationMs,
        status,
        error: error || null,
      }) + '\n',
      'utf8'
    );
  } catch { /* non-fatal */ }
}

// ─── logPageAction ────────────────────────────────────────────────────────────

function logPageAction({ component, method, durationMs, status, meta = {} }) {
  console.log(`[${component}] ${method}() ${status} in ${durationMs}ms`);
  try {
    const reportsDir = path.dirname(PERF_REPORT);
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    let entries = [];
    if (fs.existsSync(PERF_REPORT)) {
      try {
        const raw = JSON.parse(fs.readFileSync(PERF_REPORT, 'utf8'));
        if (Array.isArray(raw)) entries = raw;
      } catch { entries = []; }
    }
    entries.push({ timestamp: new Date().toISOString(), component, method, durationMs, status, ...meta });
    if (entries.length > 500) entries = entries.slice(-500);
    fs.writeFileSync(PERF_REPORT, JSON.stringify(entries, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

// ─── writeCreateEmployeeDiagnostic ────────────────────────────────────────────

function writeCreateEmployeeDiagnostic(data) {
  try {
    const reportsDir = path.dirname(EMPLOYEE_DIAG);
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      EMPLOYEE_DIAG,
      JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

// ─── writeEmployeeBreakdown ───────────────────────────────────────────────────

function writeEmployeeBreakdown(data) {
  try {
    const reportsDir = path.dirname(EMPLOYEE_DIAG);
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportsDir, 'create-employee-breakdown.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

module.exports = { logStepTiming, logPageAction, writeCreateEmployeeDiagnostic, writeEmployeeBreakdown };
