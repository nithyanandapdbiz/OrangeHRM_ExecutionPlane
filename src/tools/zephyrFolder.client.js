'use strict';
/**
 * zephyrFolder.client.js — Zephyr Essential folders/plans (REST API v2).
 *
 * A legacy "test plan" maps to a Zephyr *folder* that groups the generated
 * test cases for a story. Method names are kept stable so callers only change
 * the require path.
 */
const axios = require('../utils/almRetry');
const config = require('../core/config');

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
 * Create (or reuse) a Zephyr folder to group a story's test cases.
 * @returns {{ id: number, key: string, rootSuiteId: number }}
 */
async function createTestPlan(name, opts = {}) {
  const folderType = opts.folderType || 'TEST_CASE';
  const body = { projectKey: config.jira.projectKey, name, folderType };
  const res  = await axios.post(`${base()}/folders`, body, { headers: zHeaders() });
  const id   = res.data.id;
  // Zephyr folders have no nested suite — the folder itself is the container.
  return { id, key: `FOLDER-${id}`, rootSuiteId: id };
}

async function getTestPlan(planId) {
  const res = await axios.get(`${base()}/folders/${encodeURIComponent(planId)}`, { headers: zHeaders() });
  return res.data;
}

async function updateTestPlan(planId, fields) {
  const body = {};
  if (fields.name)        body.name = fields.name;
  if (Object.keys(body).length === 0) return;
  await axios.put(`${base()}/folders/${encodeURIComponent(planId)}`, body, { headers: zHeaders() })
    .catch(() => { /* folder update not always supported — best-effort */ });
}

async function deleteTestPlan(planId) {
  await axios.delete(`${base()}/folders/${encodeURIComponent(planId)}`, { headers: zHeaders() })
    .catch(() => { /* delete not always supported — best-effort */ });
}

/**
 * Move test cases into the folder (the Zephyr equivalent of adding to a suite).
 */
async function addTestCasesToSuite(planId, suiteId, testCaseKeys) {
  if (!testCaseKeys || testCaseKeys.length === 0) return;
  for (const key of testCaseKeys) {
    await axios.put(
      `${base()}/testcases/${encodeURIComponent(key)}`,
      { folderId: suiteId || planId },
      { headers: zHeaders() }
    ).catch(() => { /* best-effort membership */ });
  }
}

/**
 * Traceability — Zephyr links test cases to Jira issues at the test-case level,
 * not at the folder level. No-op stub preserved for API compatibility.
 */
async function linkPlanToIssue(planKey, issueKey) {
  const logger = require('../utils/logger');
  logger.info(`[zephyrFolder] linkPlanToIssue(${planKey}, ${issueKey}) — traceability tracked per test case`);
}

module.exports = {
  createTestPlan,
  getTestPlan,
  updateTestPlan,
  deleteTestPlan,
  addTestCasesToSuite,
  linkPlanToIssue
};
