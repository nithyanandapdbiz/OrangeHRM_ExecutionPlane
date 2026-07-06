'use strict';
/**
 * zephyrTestCase.client.js — Zephyr Essential (Scale) test case CRUD (REST API v2).
 *
 * Zephyr Essential is Jira-project-scoped: every test case lives under
 * config.jira.projectKey. Auth is Bearer ZEPHYR_API_TOKEN.
 *
 * Test case keys are alphanumeric Zephyr keys (e.g. OHRM-T1) — preserved verbatim.
 */
const axios = require('../utils/almRetry');
const config = require('../core/config');

const PRIORITY_MAP = { High: 'High', Normal: 'Normal', Low: 'Low' };

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

function toStepItems(tc) {
  const steps = tc.steps || [];
  const gwt   = (tc.gwt && tc.gwt.length === steps.length) ? tc.gwt : null;
  return steps.map((s, i) => {
    const prefix   = gwt ? `[${gwt[i].keyword}] ` : '';
    const text     = gwt ? gwt[i].text : (typeof s === 'string' ? s : (s.description || String(s)));
    const isCheck  = gwt && gwt[i] && gwt[i].keyword === 'Then';
    const expected = isCheck ? text : (typeof s === 'object' ? (s.expected || s.expectedResult || '') : (tc.expected || ''));
    const data     = tc.testData && tc.testData[i] ? JSON.stringify(tc.testData[i]) : '';
    return {
      inline: {
        description:    `${prefix}${text}${data ? ' | Data: ' + data : ''}`,
        expectedResult: expected || ''
      }
    };
  });
}

async function setSteps(testCaseKey, items) {
  if (!items || items.length === 0) return;
  await axios.post(
    `${base()}/testcases/${encodeURIComponent(testCaseKey)}/teststeps`,
    { mode: 'OVERWRITE', items },
    { headers: zHeaders() }
  );
}

async function createTestCase(tc) {
  const body = {
    projectKey:   config.jira.projectKey,
    name:         tc.title,
    objective:    tc.description || tc.title,
    priorityName: PRIORITY_MAP[tc.priority] || 'Normal',
    statusName:   'Approved',
    labels:       (tc.tags || []).map(t => String(t).trim()).filter(Boolean),
  };

  const res = await axios.post(`${base()}/testcases`, body, { headers: zHeaders() });
  const id  = res.data.id;
  const key = res.data.key || id;

  if (tc.steps && tc.steps.length > 0) {
    await setSteps(key, toStepItems(tc)).catch(() => { /* steps best-effort */ });
  }
  return { id, key };
}

async function getTestCase(testCaseKey) {
  const res = await axios.get(
    `${base()}/testcases/${encodeURIComponent(testCaseKey)}`,
    { headers: zHeaders() }
  );
  return res.data;
}

async function updateTestCase(testCaseKey, fields) {
  const body = {};
  if (fields.name)         body.name         = fields.name;
  if (fields.objective)    body.objective    = fields.objective;
  if (fields.priorityName) body.priorityName = PRIORITY_MAP[fields.priorityName] || 'Normal';
  if (fields.labels)       body.labels       = fields.labels;
  if (fields.statusName)   body.statusName   = fields.statusName;
  if (Object.keys(body).length === 0) return;
  await axios.put(
    `${base()}/testcases/${encodeURIComponent(testCaseKey)}`,
    body,
    { headers: zHeaders() }
  );
}

async function updateTestCaseSteps(testCaseKey, steps, opts = {}) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  const fake = { steps, gwt: opts.gwt || null, testData: opts.testData || null, expected: opts.expected || '' };
  await setSteps(testCaseKey, toStepItems(fake));
}

async function deleteTestCase(testCaseKey) {
  // Zephyr Essential exposes DELETE on some plans; treat failure as non-fatal.
  await axios.delete(
    `${base()}/testcases/${encodeURIComponent(testCaseKey)}`,
    { headers: zHeaders() }
  ).catch(() => { /* delete not always supported — best-effort */ });
}

async function getTestCaseSteps(testCaseKey) {
  try {
    const res   = await axios.get(
      `${base()}/testcases/${encodeURIComponent(testCaseKey)}/teststeps?maxResults=100`,
      { headers: zHeaders() }
    );
    const values = res.data?.values || [];
    return values.map(v => ({
      inline: {
        description:    v.inline?.description    || v.description    || '',
        expectedResult: v.inline?.expectedResult || v.expectedResult || ''
      }
    }));
  } catch {
    return [];
  }
}

async function searchTestCases(maxResults = 50, startAt = 0) {
  const res = await axios.get(
    `${base()}/testcases?projectKey=${encodeURIComponent(config.jira.projectKey)}&maxResults=${maxResults}&startAt=${startAt}`,
    { headers: zHeaders() }
  );
  const values = (res.data?.values || []).map(item => ({
    id:     item.id,
    key:    item.key,
    name:   item.name || '',
    labels: item.labels || []
  }));
  return { values, total: res.data?.total ?? values.length };
}

async function searchTestCasesByLabel(label, maxScan = 500) {
  const lc  = String(label || '').toLowerCase();
  const all = [];
  let startAt = 0;
  const page = 100;
  while (startAt < maxScan) {
    const { values } = await searchTestCases(page, startAt);
    if (values.length === 0) break;
    for (const item of values) {
      const labels = (item.labels || []).map(l => String(l).toLowerCase());
      if (labels.includes(lc) || labels.includes(lc.replace(/-/g, ' '))) all.push(item);
    }
    if (values.length < page) break;
    startAt += page;
  }
  return all;
}

module.exports = {
  createTestCase,
  getTestCase,
  updateTestCase,
  deleteTestCase,
  searchTestCases,
  searchTestCasesByLabel,
  getTestCaseSteps,
  updateTestCaseSteps
};
