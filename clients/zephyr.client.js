'use strict';
/**
 * Zephyr Essential REST Client (Cloud API v2) — OrangeHRM Execution Plane.
 *
 * Implements the TestManagement contract (clients/alm/testmanagement.contract.js).
 * Zephyr Essential is Jira-project-scoped: test cases, cycles and executions all
 * live under JIRA_PROJECT_KEY. ZEPHYR_API_TOKEN never leaves this process and is
 * never sent to the DBiz Intelligence Plane.
 *
 * Auth: Bearer  ZEPHYR_API_TOKEN.
 *
 * Operations:
 *   checkConnectivity()                         → GET /testcases probe
 *   createTestCase(parentKey, tc)               → test case (+ Jira issue link)
 *   batchCreateTestCases(parentKey, tcs[])      → capped batch
 *   createTestCycle(name, testCaseKeys[])       → test cycle
 *   updateTestResults(cycleKey, results[])      → test executions (Pass/Fail)
 *   completeTestCycle(cycleKey)                 → set cycle status Done
 *   ensureFolder(name, type)                    → resolve/create folder id
 */
const { createHttp } = require('./alm/http');
const { assertTestManagement } = require('./alm/testmanagement.contract');
const logger = require('../lib/logger');
const config = require('../config/customer.json');

function stepsToScriptText(tc) {
  const steps = tc.steps || [];
  if (!steps.length) return tc.objective || tc.description || 'Automated test case';
  return steps
    .map((st, i) => {
      const action = typeof st === 'string' ? st : (st.action || st.description || '');
      const expected = typeof st === 'object' ? (st.expected || st.expectedResult || '') : '';
      return `${i + 1}. ${action}${expected ? `  → Expected: ${expected}` : ''}`;
    })
    .join('\n');
}

class ZephyrClient {
  constructor(env = process.env) {
    const base = (env.ZEPHYR_API_URL || 'https://api.zephyrscale.smartbear.com/v2').replace(/\/$/, '');
    const token = env.ZEPHYR_API_TOKEN;
    this.projectKey = env.JIRA_PROJECT_KEY;
    this.enabled = Boolean(token);

    if (!this.projectKey) throw new Error('JIRA_PROJECT_KEY is required for Zephyr');

    this.http = token
      ? createHttp({
          provider: 'Zephyr',
          baseURL: base,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        })
      : null;

    this.folderName = config.zephyr?.folder || 'AgenticQA';
    this.statuses = config.zephyr?.statuses || { pass: 'Pass', fail: 'Fail' };
    // Folder ids are cached per (type, name) — a TEST_CASE folder and a TEST_CYCLE
    // folder can share a name but are distinct resources with distinct ids.
    this._folderIds = new Map();
    // Status ids cached per (statusType, name) for cycle/execution transitions.
    this._statusIds = new Map();
  }

  _assertEnabled() {
    if (!this.enabled) throw new Error('ZEPHYR_API_TOKEN is not set — Zephyr test management is disabled');
  }

  // ── Connectivity ───────────────────────────────────────────────────────────
  async checkConnectivity() {
    if (!this.enabled) return { connected: false, status: 0, error: 'ZEPHYR_API_TOKEN not set' };
    try {
      await this.http.get('/testcases', { projectKey: this.projectKey, maxResults: 1 });
      return { connected: true, status: 200 };
    } catch (e) {
      return { connected: false, status: e.status ?? 0, error: e.message };
    }
  }

  // ── Folder resolution (create-or-reuse) ─────────────────────────────────────
  async ensureFolder(name = this.folderName, folderType = 'TEST_CASE') {
    this._assertEnabled();
    // Cache per (type, name): a TEST_CYCLE folder must never reuse a TEST_CASE
    // folder id — Zephyr rejects a cycle created under a TEST_CASE folder (400).
    const cacheKey = `${folderType}:${name}`;
    if (this._folderIds.has(cacheKey)) return this._folderIds.get(cacheKey);
    try {
      const page = await this.http.get('/folders', { projectKey: this.projectKey, maxResults: 100 });
      const found = (page.values || []).find((f) => f.name === name && f.folderType === folderType);
      if (found) { this._folderIds.set(cacheKey, found.id); return found.id; }
      const created = await this.http.post('/folders', { projectKey: this.projectKey, name, folderType });
      this._folderIds.set(cacheKey, created.id);
      return created.id;
    } catch (e) {
      logger.warn(`[Zephyr] Folder resolve/create failed (${name}/${folderType}): ${e.message} — proceeding without folder`);
      return null;
    }
  }

  // ── Create test case (+ link to Jira issue) ─────────────────────────────────
  async createTestCase(parentKey, tc) {
    this._assertEnabled();
    const name = tc.title || tc.name || 'Generated Test Case';
    const folderId = await this.ensureFolder();
    const body = {
      projectKey: this.projectKey,
      name,
      objective: tc.objective || tc.description || '',
      priorityName: tc.priority === 'High' ? 'High' : tc.priority === 'Low' ? 'Low' : 'Normal',
      statusName: 'Approved',
      labels: ['AgenticQA', 'AutoGenerated', ...(tc.tags || [])],
      ...(folderId ? { folderId } : {}),
    };
    const created = await this.http.post('/testcases', body);
    const key = created.key || created.id;

    // Attach the step script (best effort — not fatal to case creation).
    await this.http
      .post(`/testcases/${encodeURIComponent(key)}/teststeps`, {
        mode: 'OVERWRITE',
        items: (tc.steps || [{ action: stepsToScriptText(tc) }]).map((st) => ({
          inline: {
            description: typeof st === 'string' ? st : (st.action || st.description || ''),
            expectedResult: typeof st === 'object' ? (st.expected || st.expectedResult || '') : '',
          },
        })),
      })
      .catch((e) => logger.warn(`[Zephyr] Could not set steps on ${key}: ${e.message}`));

    // Link the test case to the parent Jira story for traceability.
    const issueId = tc.parentIssueId;
    if (issueId) {
      await this.http
        .post(`/testcases/${encodeURIComponent(key)}/links/issues`, { issueId: Number(issueId) })
        .catch((e) => logger.warn(`[Zephyr] Could not link ${key} to Jira issue ${parentKey}: ${e.message}`));
    }

    logger.info(`[Zephyr] Test case created: ${key} — ${name}`);
    return { id: created.id, key, title: name };
  }

  async batchCreateTestCases(parentKey, testCases) {
    this._assertEnabled();
    const limit = config.pipeline?.testCaseCreateLimit ?? 20;
    const subset = testCases.slice(0, limit);
    const created = [];
    for (const tc of subset) {
      try {
        created.push(await this.createTestCase(parentKey, tc));
      } catch (e) {
        logger.warn(`[Zephyr] Could not create test case "${tc.title}": ${e.message}`);
      }
    }
    logger.info(`[Zephyr] ${created.length}/${subset.length} test cases created`);
    return created;
  }

  // ── Test cycle ──────────────────────────────────────────────────────────────
  async createTestCycle(name, testCaseKeys = []) {
    this._assertEnabled();
    const cycleName = `${config.testRunPrefix} ${name} — ${new Date().toISOString().slice(0, 10)}`;
    const folderId = await this.ensureFolder(this.folderName, 'TEST_CYCLE');
    const cycle = await this.http.post('/testcycles', {
      projectKey: this.projectKey,
      name: cycleName,
      statusName: 'In Progress',
      ...(folderId ? { folderId } : {}),
    });
    const covered = Array.isArray(testCaseKeys) ? testCaseKeys.length : 0;
    logger.info(`[Zephyr] Test cycle created: ${cycle.key || cycle.id} "${cycleName}" — covering ${covered} test case(s)`);
    return { id: cycle.id, key: cycle.key || cycle.id, name: cycleName };
  }

  // ── Executions ──────────────────────────────────────────────────────────────
  async updateTestResults(cycleKey, results) {
    this._assertEnabled();
    if (!results?.length) return { ok: true, synced: 0, passed: 0, failed: 0 };
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    let synced = 0;
    for (const r of results) {
      const body = {
        projectKey: this.projectKey,
        testCycleKey: cycleKey,
        statusName: r.passed ? this.statuses.pass : this.statuses.fail,
        executionTime: r.durationMs || 0,
        comment: r.passed ? '' : (r.error || '').slice(0, 2000),
        ...(r.testCaseKey ? { testCaseKey: r.testCaseKey } : {}),
      };
      try {
        await this.http.post('/testexecutions', body);
        synced++;
      } catch (e) {
        logger.warn(`[Zephyr] Could not record execution for "${r.title}": ${e.message}`);
      }
    }
    logger.info(`[Zephyr] Executions synced: ${synced}/${results.length} (${passed} Pass / ${failed} Fail) → cycle ${cycleKey}`);
    return { ok: synced > 0, synced, passed, failed };
  }

  /**
   * Resolve a status id by name for a given status type (create-or-reuse cache).
   * @param {string} name        e.g. 'Done'
   * @param {string} statusType  'TEST_CYCLE' | 'TEST_EXECUTION' | 'TEST_CASE'
   * @returns {Promise<number|null>}
   */
  async _resolveStatusId(name, statusType) {
    const cacheKey = `${statusType}:${name}`.toLowerCase();
    if (this._statusIds.has(cacheKey)) return this._statusIds.get(cacheKey);
    const page = await this.http.get('/statuses', { projectKey: this.projectKey, statusType, maxResults: 100 });
    const match = (page.values || []).find((s) => String(s.name).toLowerCase() === String(name).toLowerCase());
    const id = match ? match.id : null;
    if (id != null) this._statusIds.set(cacheKey, id);
    return id;
  }

  async completeTestCycle(cycleKey) {
    this._assertEnabled();
    // PUT /testcycles/{key} is a full-replace and rejects a partial body (400,
    // "key/name/project/id/status must not be null"). It also requires status as a
    // { id } object — statusName is ignored on update. Fetch the current cycle,
    // resolve the Done status id, and resubmit the whole object.
    try {
      const doneName = config.zephyr?.statuses?.cycleDone || 'Done';
      const [cur, doneId] = await Promise.all([
        this.http.get(`/testcycles/${encodeURIComponent(cycleKey)}`),
        this._resolveStatusId(doneName, 'TEST_CYCLE'),
      ]);
      const body = {
        id:      cur.id,
        key:     cur.key,
        name:    cur.name,
        project: cur.project?.id ? { id: cur.project.id } : cur.project,
        status:  doneId != null ? { id: doneId } : cur.status,
        ...(cur.folder?.id       != null ? { folderId: cur.folder.id }               : {}),
        ...(cur.description      != null ? { description: cur.description }          : {}),
        ...(cur.plannedStartDate != null ? { plannedStartDate: cur.plannedStartDate } : {}),
        ...(cur.plannedEndDate   != null ? { plannedEndDate: cur.plannedEndDate }     : {}),
      };
      await this.http.put(`/testcycles/${encodeURIComponent(cycleKey)}`, body);
      logger.info(`[Zephyr] Test cycle ${cycleKey} completed (status → ${doneName})`);
    } catch (e) {
      logger.warn(`[Zephyr] Could not complete cycle ${cycleKey}: ${e.message}`);
    }
  }
}

assertTestManagement(ZephyrClient.prototype, 'ZephyrClient');

module.exports = ZephyrClient;
