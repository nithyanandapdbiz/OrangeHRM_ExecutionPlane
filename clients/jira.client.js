'use strict';
/**
 * Jira REST Client (Cloud, API v3) — OrangeHRM Execution Plane.
 *
 * Implements the IssueTracker contract (clients/alm/tracker.contract.js). All
 * operations run inside the OrangeHRM tenant; JIRA_API_TOKEN never leaves this
 * process and is never sent to the DBiz Intelligence Plane.
 *
 * Auth: HTTP Basic  base64("<email>:<apiToken>")  (Atlassian Cloud API tokens).
 *
 * Operations:
 *   checkConnectivity()                       → GET /myself probe
 *   fetchWorkItem(issueKey)                   → normalised Story object
 *   searchJql(jql, {maxResults})              → Story[] (paginated)
 *   createBug(title, steps, parentKey, prio)  → Jira Bug issue (+ story link)
 *   createIssue(fields)                       → raw create result
 *   addIssueLink(inwardKey, outwardKey, type) → issue link
 *   addComment(issueKey, text)                → comment
 *   listVersions()                            → project versions/releases
 */
const { createHttp, AlmError } = require('./alm/http');
const { assertIssueTracker } = require('./alm/tracker.contract');
const logger = require('../lib/logger');
const config = require('../config/customer.json');

// Atlassian Document Format: minimal doc wrapping plain text into a single paragraph.
function toADF(text) {
  const content = String(text ?? '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((para) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para }],
    }));
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

// Flatten an ADF document (or HTML/string) back to plain text for the pipeline.
function fromADF(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.isArray(node)) return node.map(fromADF).join(' ');
  if (node.type === 'text') return node.text || '';
  if (node.content) return fromADF(node.content);
  return '';
}

// Story priority → Jira priority name.
function priorityName(p) {
  const v = String(p || '').toLowerCase();
  if (v.includes('high') || v === '1') return 'High';
  if (v.includes('low') || v === '3') return 'Low';
  return 'Medium';
}

class JiraClient {
  constructor(env = process.env) {
    const base = (env.JIRA_BASE_URL || '').replace(/\/$/, '');
    const email = env.JIRA_EMAIL;
    const token = env.JIRA_API_TOKEN;
    this.projectKey = env.JIRA_PROJECT_KEY;
    this.apiVersion = env.JIRA_API_VERSION || '3';

    if (!base || !email || !token) {
      throw new Error('JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are required');
    }
    if (!this.projectKey) throw new Error('JIRA_PROJECT_KEY is required');

    this.baseUrl = base;
    this.http = createHttp({
      provider: 'Jira',
      baseURL: `${base}/rest/api/${this.apiVersion}`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: Number.parseInt(env.JIRA_TIMEOUT_MS, 10) || 15000,
    });
    this.issueTypes = config.jira?.issueTypes || {};
  }

  // ── Connectivity ───────────────────────────────────────────────────────────
  async checkConnectivity() {
    try {
      const me = await this.http.get('/myself');
      return { connected: true, status: 200, account: me.emailAddress || me.accountId };
    } catch (e) {
      return { connected: false, status: e.status ?? 0, error: e.message };
    }
  }

  // ── Fetch issue → normalised Story ──────────────────────────────────────────
  async fetchWorkItem(issueKey) {
    // Jira keys are alphanumeric (e.g. OHRM-1) — DO NOT strip non-digits.
    const key = String(issueKey).trim();
    logger.info(`[Jira] Fetching issue ${key}`);
    const wi = await this.http.get(`/issue/${encodeURIComponent(key)}`, { expand: 'names,renderedFields' });
    const f = wi.fields || {};
    const title = f.summary || '';
    const description = fromADF(f.description) || fromADF(wi.renderedFields?.description) || '';
    logger.info(`[Jira] Fetched: "${title}" (${f.issuetype?.name || 'Issue'})`);
    return {
      id: wi.id,
      key: wi.key,
      title,
      description,
      type: f.issuetype?.name || 'Story',
      state: f.status?.name || '',
      labels: f.labels || [],
      components: (f.components || []).map((c) => c.name),
      raw: wi,
    };
  }

  // ── JQL search (paginated) ──────────────────────────────────────────────────
  async searchJql(jql, { maxResults = 50, fields = ['summary', 'issuetype', 'status', 'labels'], hardCap = 5000 } = {}) {
    // Atlassian removed the legacy POST /search (CHANGE-2046); the enhanced
    // /search/jql endpoint uses opaque cursor pagination (nextPageToken), not startAt/total.
    const values = [];
    let nextPageToken;
    do {
      const body = { jql, maxResults, fields };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const page = await this.http.post('/search/jql', body);
      values.push(...(page.issues || []));
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken && values.length < hardCap);
    return values.map((wi) => ({
      id: wi.id,
      key: wi.key,
      title: wi.fields?.summary || '',
      type: wi.fields?.issuetype?.name || '',
      state: wi.fields?.status?.name || '',
      labels: wi.fields?.labels || [],
      raw: wi,
    }));
  }

  // ── Create issue ────────────────────────────────────────────────────────────
  async createIssue(fields) {
    return this.http.post('/issue', { fields });
  }

  // ── Create bug (+ link to parent story) ─────────────────────────────────────
  async createBug(title, stepsToRepro, parentKey, priority = 'High') {
    const fields = {
      project: { key: this.projectKey },
      summary: `[AgenticQA] ${title}`,
      issuetype: { name: this.issueTypes.bug || 'Bug' },
      description: toADF(stepsToRepro),
      labels: ['AgenticQA', 'AutoGenerated', 'TestFailure'],
      priority: { name: priorityName(priority) },
    };
    try {
      const created = await this.createIssue(fields);
      if (parentKey) {
        await this.addIssueLink(created.key, parentKey, 'Relates').catch((e) =>
          logger.warn(`[Jira] Could not link bug ${created.key} to ${parentKey}: ${e.message}`));
      }
      logger.info(`[Jira] Bug created: ${created.key} — ${title}`);
      return { id: created.id, key: created.key, title };
    } catch (e) {
      // Priority is not enabled on every project — retry once without it.
      if (e instanceof AlmError && e.status === 400 && fields.priority) {
        delete fields.priority;
        try {
          const created = await this.createIssue(fields);
          if (parentKey) await this.addIssueLink(created.key, parentKey, 'Relates').catch(() => {});
          logger.info(`[Jira] Bug created (no priority field): ${created.key} — ${title}`);
          return { id: created.id, key: created.key, title };
        } catch (e2) {
          logger.warn(`[Jira] Could not create bug "${title}": ${e2.message}`);
          return null;
        }
      }
      logger.warn(`[Jira] Could not create bug "${title}": ${e.message}`);
      return null;
    }
  }

  // ── Issue links / comments / versions ───────────────────────────────────────
  async addIssueLink(inwardKey, outwardKey, type = 'Relates') {
    await this.http.post('/issueLink', {
      type: { name: type },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    });
  }

  async addComment(issueKey, text) {
    await this.http.post(`/issue/${encodeURIComponent(issueKey)}/comment`, { body: toADF(text) });
  }

  async listVersions() {
    return this.http.get(`/project/${encodeURIComponent(this.projectKey)}/versions`);
  }
}

// Fail fast at load time if the contract drifts.
assertIssueTracker(JiraClient.prototype, 'JiraClient');

module.exports = JiraClient;
module.exports.toADF = toADF;
module.exports.fromADF = fromADF;
