'use strict';
/**
 * zephyrTestRun.client.js — Zephyr Essential test cycles + executions (REST API v2).
 *
 * A legacy "test run" maps to a Zephyr *test cycle*; a "test result" maps to a
 * Zephyr *test execution*. Method names are kept stable so callers only change
 * the require path.
 */
const axios = require('../utils/almRetry');
const config = require('../core/config');

// Canonical status names → Zephyr statusName.
const STATUS_MAP = {
  Pass:           'Pass',
  Fail:           'Fail',
  Blocked:        'Blocked',
  'Not Executed': 'Not Executed',
  'In Progress':  'In Progress'
};

function base() {
  return config.zephyr.apiUrl;
}

function zHeaders() {
  return {
    Authorization: `Bearer ${config.zephyr.apiToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

/**
 * Create a Zephyr test cycle (the execution container).
 * @param {number|string} planId  — optional folder id to nest the cycle under
 * @returns {{ id: number, key: string }}
 */
async function createTestRun(planId, name, opts = {}) {
  const body = {
    projectKey: config.jira.projectKey,
    name,
    statusName: 'In Progress',
  };
  if (planId)          body.folderId = planId;
  if (opts.comment)    body.description = opts.comment;
  const res = await axios.post(`${base()}/testcycles`, body, { headers: zHeaders() });
  return { id: res.data.id, key: res.data.key || res.data.id };
}

async function getTestRun(runId) {
  const res = await axios.get(`${base()}/testcycles/${encodeURIComponent(runId)}`, { headers: zHeaders() });
  return res.data;
}

async function updateTestRun(runId, fields) {
  const body = {};
  if (fields.state || fields.statusName) body.statusName = fields.statusName || fields.state;
  if (Object.keys(body).length === 0) return;
  await axios.put(`${base()}/testcycles/${encodeURIComponent(runId)}`, body, { headers: zHeaders() })
    .catch(() => { /* best-effort */ });
}

async function deleteTestRun(runId) {
  await axios.delete(`${base()}/testcycles/${encodeURIComponent(runId)}`, { headers: zHeaders() })
    .catch(() => { /* delete not always supported — best-effort */ });
}

/**
 * Record a test execution against a cycle.
 * @param {number|string} runId       — Zephyr test cycle key/id
 * @param {string}        testCaseKey — e.g. "OHRM-T1"
 * @param {string}        statusName  — "Pass" | "Fail" | "Blocked" | ...
 * @returns {{ id: number, key: string }}
 */
async function createExecution(runId, testCaseKey, statusName = 'In Progress', opts = {}) {
  const body = {
    projectKey:   config.jira.projectKey,
    testCycleKey: runId,
    testCaseKey,
    statusName:   STATUS_MAP[statusName] || 'Not Executed',
  };
  if (opts.executionTime) body.executionTime = opts.executionTime;
  if (opts.comment)       body.comment       = opts.comment;
  if (opts.environmentName) body.environmentName = opts.environmentName;

  const res = await axios.post(`${base()}/testexecutions`, body, { headers: zHeaders() });
  return { id: res.data.id || 0, key: res.data.key || testCaseKey };
}

/**
 * Update an execution outcome/comment.
 */
async function updateExecution(runId, resultId, statusName, comment = '', opts = {}) {
  const body = { statusName: STATUS_MAP[statusName] || 'Not Executed' };
  if (comment)            body.comment       = comment;
  if (opts.executionTime) body.executionTime = opts.executionTime;
  await axios.put(`${base()}/testexecutions/${encodeURIComponent(resultId)}`, body, { headers: zHeaders() })
    .catch(() => { /* update not always supported — best-effort */ });
}

async function searchExecutions({ runId, maxResults = 50 } = {}) {
  if (!runId) return { values: [] };
  const res = await axios.get(
    `${base()}/testexecutions?projectKey=${encodeURIComponent(config.jira.projectKey)}&testCycle=${encodeURIComponent(runId)}&maxResults=${maxResults}`,
    { headers: zHeaders() }
  );
  return res.data;
}

/**
 * Traceability stub — Zephyr links executions to Jira issues via the test case.
 */
async function linkExecutionToIssue(runId, issueKey) {
  const logger = require('../utils/logger');
  logger.info(`[zephyrTestRun] linkExecutionToIssue(cycle=${runId}, issue=${issueKey}) — traceability tracked per test case`);
}

module.exports = {
  createTestRun,
  getTestRun,
  updateTestRun,
  deleteTestRun,
  createExecution,
  updateExecution,
  searchExecutions,
  linkExecutionToIssue
};
