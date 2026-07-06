/**
 * Integration Validation Script
 * Tests live connectivity for Jira REST API v3 and Zephyr (via the ALM facade).
 * Run: node scripts/validate-integration.js
 */
'use strict';

require("dotenv").config();
const axios = require("axios");
const AlmClient = require("../clients/alm.client");

const jiraBaseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const jiraProject = process.env.JIRA_PROJECT_KEY;
const jiraEmail   = process.env.JIRA_EMAIL;
const jiraToken   = process.env.JIRA_API_TOKEN;
const issueKey    = process.env.ISSUE_KEY;
const apiVer      = process.env.JIRA_API_VERSION || "3";

const jiraRoot = jiraBaseUrl ? `${jiraBaseUrl}/rest/api/${apiVer}` : "";

const jiraHeaders = jiraEmail && jiraToken
  ? { Authorization: `Basic ${Buffer.from(`${jiraEmail}:${jiraToken}`).toString("base64")}`, "Content-Type": "application/json" }
  : {};

let passed = 0;
let failed = 0;

async function check(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    const result = await fn();
    console.log(`\x1b[32mPASS\x1b[0m${result ? " — " + result : ""}`);
    passed++;
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data).slice(0, 120)}`
      : err.message;
    console.log(`\x1b[31mFAIL\x1b[0m — ${msg}`);
    failed++;
  }
}

(async () => {
  console.log("\n\x1b[1m══════════════════════════════════════════\x1b[0m");
  console.log("\x1b[1m  Jira / Zephyr Integration Validator\x1b[0m");
  console.log("\x1b[1m══════════════════════════════════════════\x1b[0m\n");

  // ── ENV PRESENCE ─────────────────────────────
  console.log("\x1b[1m[1] Environment Variables\x1b[0m");
  await check("JIRA_BASE_URL set",    () => { if (!jiraBaseUrl) throw new Error("missing"); return jiraBaseUrl; });
  await check("JIRA_PROJECT_KEY set", () => { if (!jiraProject) throw new Error("missing"); return jiraProject; });
  await check("JIRA_EMAIL set",       () => { if (!jiraEmail)   throw new Error("missing"); return jiraEmail; });
  await check("JIRA_API_TOKEN set",   () => { if (!jiraToken)   throw new Error("missing"); return "***"; });
  await check("ISSUE_KEY set",        () => { if (!issueKey)    throw new Error("missing"); return issueKey; });

  // ── JIRA CONNECTIVITY ────────────────────────
  console.log("\n\x1b[1m[2] Jira Connectivity\x1b[0m");

  await check("GET /rest/api/3/myself (auth check)", async () => {
    const r = await axios.get(`${jiraRoot}/myself`, { headers: jiraHeaders });
    return `authenticated as ${r.data.displayName || r.data.emailAddress || r.data.accountId}`;
  });

  await check(`GET /rest/api/3/project/${jiraProject}`, async () => {
    const r = await axios.get(`${jiraRoot}/project/${encodeURIComponent(jiraProject)}`, { headers: jiraHeaders });
    return `project "${r.data.name}" found (id: ${r.data.id})`;
  });

  // ── JIRA ISSUES ──────────────────────────────
  console.log("\n\x1b[1m[3] Jira Issues\x1b[0m");

  await check(`GET issue for ISSUE_KEY (${issueKey})`, async () => {
    // Jira keys are alphanumeric ("PROJ-N"); fetch directly, then JQL fallback by summary.
    try {
      const r = await axios.get(`${jiraRoot}/issue/${encodeURIComponent(issueKey)}`, { headers: jiraHeaders });
      const title = r.data.fields?.summary || "(no summary)";
      return `"${String(title).slice(0, 60)}"`;
    } catch (err) {
      if (err.response && err.response.status !== 404) throw err;
      // JQL fallback: search by summary text
      const jql = `project = "${jiraProject}" AND summary ~ "${issueKey}"`;
      const r = await axios.get(`${jiraRoot}/search`, { headers: jiraHeaders, params: { jql, maxResults: 5 } });
      const issues = r.data.issues || [];
      return `${issues.length} issue(s) matched via JQL`;
    }
  });

  // ── ZEPHYR / TEST MANAGEMENT ──────────────────
  console.log("\n\x1b[1m[4] Zephyr Test Management\x1b[0m");

  await check("ALM facade connectivity (tracker + test management)", async () => {
    const alm = new AlmClient();
    const c = await alm.checkConnectivity();
    if (!c.connected) throw new Error("tracker not connected");
    const tm = c.testManagement || {};
    return `tracker ${c.status || "ok"}; test management ${tm.connected ? "connected" : "unavailable (optional)"}`;
  });

  // ── SUMMARY ──────────────────────────────────
  console.log("\n\x1b[1m══════════════════════════════════════════\x1b[0m");
  const color = failed === 0 ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}\x1b[1m  Result: ${passed} passed, ${failed} failed\x1b[0m`);
  console.log("\x1b[1m══════════════════════════════════════════\x1b[0m\n");

  process.exit(failed > 0 ? 1 : 0);
})();
