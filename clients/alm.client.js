'use strict';
/**
 * ALM Client (facade) — OrangeHRM Execution Plane.
 *
 * Provider-isolation seam. Business logic (routes/run.js, scripts) depends on THIS
 * stable surface, never on Jira or Zephyr directly. Internally it composes:
 *   • JiraClient   — issue tracking (stories, bugs)         [IssueTracker contract]
 *   • ZephyrClient — test management (cases, cycles, runs)  [TestManagement contract]
 *
 * The method names mirror the historical tracker/test-management surface so callers
 * remain agnostic to the underlying ALM provider. Swapping Jira→other tracker or
 * Zephyr→other TM means providing a different implementation of the two contracts;
 * this facade and all callers stay unchanged.
 *
 * Test-case ↔ story traceability: createTestCase receives the Jira numeric issue id
 * (resolved here from the fetched story) so Zephyr can link the case to the story.
 */
const JiraClient = require('./jira.client');
const ZephyrClient = require('./zephyr.client');
const logger = require('../lib/logger');

class AlmClient {
  constructor(env = process.env) {
    this.jira = new JiraClient(env);
    this.zephyr = new ZephyrClient(env);
    this._issueIdByKey = new Map(); // key → numeric id, for Zephyr issue links
  }

  // ── Connectivity (tracker + test management) ────────────────────────────────
  async checkConnectivity() {
    const [tracker, tm] = await Promise.all([
      this.jira.checkConnectivity(),
      this.zephyr.checkConnectivity(),
    ]);
    return {
      connected: tracker.connected,           // tracker is mandatory; TM is optional
      status: tracker.status,
      tracker,
      testManagement: tm,
    };
  }

  // ── Story (issue tracker) ───────────────────────────────────────────────────
  async fetchWorkItem(issueKey) {
    const story = await this.jira.fetchWorkItem(issueKey);
    if (story?.key && story?.id) this._issueIdByKey.set(story.key, story.id);
    return story;
  }

  // ── Test cases (test management) ────────────────────────────────────────────
  async createTestCase(parentKey, tc) {
    const parentIssueId = this._issueIdByKey.get(parentKey);
    return this.zephyr.createTestCase(parentKey, { ...tc, parentIssueId });
  }

  async batchCreateTestCases(parentKey, testCases) {
    if (!this.zephyr.enabled) {
      logger.warn('[ALM] Zephyr disabled (no ZEPHYR_API_TOKEN) — skipping test-case creation');
      return [];
    }
    const parentIssueId = this._issueIdByKey.get(parentKey);
    const withParent = testCases.map((tc) => ({ ...tc, parentIssueId }));
    return this.zephyr.batchCreateTestCases(parentKey, withParent);
  }

  // ── Test cycle / results (test management) ──────────────────────────────────
  async createTestRun(name, testCaseKeys = []) {
    if (!this.zephyr.enabled) return { id: null, key: null, name };
    return this.zephyr.createTestCycle(name, testCaseKeys);
  }

  async updateTestResults(cycleKey, results) {
    if (!this.zephyr.enabled || !cycleKey) return { ok: false, synced: 0, passed: 0, failed: 0 };
    return this.zephyr.updateTestResults(cycleKey, results);
  }

  async completeTestRun(cycleKey) {
    if (!this.zephyr.enabled || !cycleKey) return;
    return this.zephyr.completeTestCycle(cycleKey);
  }

  // ── Bugs (issue tracker) ────────────────────────────────────────────────────
  async createBug(title, stepsToRepro, parentKey, priority = 'High') {
    return this.jira.createBug(title, stepsToRepro, parentKey, priority);
  }

  // ── Comments (issue tracker) ────────────────────────────────────────────────
  // Governance publishes Discovery stage/status/evidence as Jira story comments
  // (the reliable channel when Zephyr attachment/execution-update APIs are limited).
  // Never throws — governance must not break the underlying Discovery run.
  async addComment(issueKey, text) {
    if (!issueKey || !text) return { ok: false };
    try {
      await this.jira.addComment(issueKey, text);
      return { ok: true };
    } catch (e) {
      logger.warn(`[ALM] addComment failed for ${issueKey}: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  // Whether the underlying test-management provider is configured (has a token).
  get zephyrEnabled() { return !!this.zephyr.enabled; }
}

module.exports = AlmClient;
