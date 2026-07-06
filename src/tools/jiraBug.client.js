'use strict';
/**
 * jiraBug.client.js — Jira Cloud Bug creation (REST API v3).
 *
 * createBug(test, parentKey)             → auto-filed Bug for a failed test
 * createPentestBug(finding, parentKey?)  → auto-filed Bug for a security finding
 *
 * Bugs are created via POST /rest/api/3/issue and linked ("Relates") to the
 * parent Jira story. Descriptions use Atlassian Document Format (ADF).
 */
const axios = require('../utils/almRetry');
const config = require('../core/config');
const { jiraHeaders } = require('../utils/jiraAuth');

// severity → Jira priority name
const PRIORITY_MAP = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low', info: 'Lowest' };

function apiRoot(baseUrl) {
  const base = (baseUrl || config.jira.baseUrl).replace(/\/$/, '');
  return `${base}/rest/api/${config.jira.apiVersion}`;
}

function browseUrl(baseUrl, key) {
  const base = (baseUrl || config.jira.baseUrl).replace(/\/$/, '');
  return `${base}/browse/${key}`;
}

// Wrap plain/simple-HTML text into a minimal ADF document.
function toADF(text) {
  const plain = String(text ?? '').replace(/<[^>]+>/g, '').replace(/\r/g, '');
  const paras = plain.split(/\n{2,}/).filter(p => p.trim().length);
  const content = (paras.length ? paras : ['']).map(p => ({
    type: 'paragraph',
    content: p ? [{ type: 'text', text: p }] : [],
  }));
  return { type: 'doc', version: 1, content };
}

function buildBugDescription(test, parentStory) {
  return [
    'Auto-created by Agentic QA Platform',
    `Parent Story: ${parentStory || 'N/A'}`,
    `Failed Test: ${test.title}`,
    `Error Details:\n${test.error || 'No error message captured'}`
  ].join('\n\n');
}

async function addIssueLink(inwardKey, outwardKey, type = 'Relates') {
  await axios.post(
    `${apiRoot()}/issueLink`,
    { type: { name: type }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } },
    { headers: jiraHeaders() }
  );
}

async function createBug(test, parentKey) {
  const parentStory = parentKey || process.env.ISSUE_KEY || '';

  const fields = {
    project:   { key: config.jira.projectKey },
    summary:   `[Auto Bug] ${test.title}`,
    issuetype: { name: config.jira.issueTypes.bug || 'Bug' },
    description: toADF(buildBugDescription(test, parentStory)),
    labels:    ['auto-bug', 'playwright', 'qa-platform'],
    priority:  { name: 'High' },
  };

  let created;
  try {
    const res = await axios.post(`${apiRoot()}/issue`, { fields }, { headers: jiraHeaders() });
    created = res.data;
  } catch (e) {
    // Priority may not be enabled on the project — retry once without it.
    if (e.response?.status === 400 && fields.priority) {
      delete fields.priority;
      const res = await axios.post(`${apiRoot()}/issue`, { fields }, { headers: jiraHeaders() });
      created = res.data;
    } else {
      throw e;
    }
  }

  if (parentStory) {
    try { await addIssueLink(created.key, parentStory, 'Relates'); } catch (_) { /* link is best-effort */ }
  }

  return {
    data: {
      key: created.key,
      id:  created.id,
      url: browseUrl(config.jira.baseUrl, created.key)
    }
  };
}

async function createPentestBug(finding, parentKey, jiraConfig) {
  const cfg     = jiraConfig || {};
  const baseUrl = (cfg.baseUrl || config.jira.baseUrl).replace(/\/$/, '');
  const project = cfg.projectKey || config.jira.projectKey;

  const priority  = PRIORITY_MAP[finding.severity] || 'Medium';
  const cveText   = finding.cve   ? `\n\nCVE: ${finding.cve}`     : '';
  const owaspText = finding.owasp ? `\n\nOWASP: ${finding.owasp}` : '';

  const descText = [
    'Penetration Test Finding',
    finding.description || finding.name || '',
    `Affected URL: ${finding.url || 'N/A'}`,
    `CVSS Score: ${(finding.cvss || 0).toFixed(1)}${cveText}${owaspText}`,
    `Evidence:\n${finding.evidence || 'No evidence captured.'}`,
    `Remediation: ${finding.remediation || 'See OWASP guidance.'}`,
    `Found by: ${finding.tool}`
  ].join('\n\n');

  const fields = {
    project:    { key: project },
    summary:    `[PENTEST][${(finding.severity || '').toUpperCase()}][${finding.tool}] ${finding.name}`,
    issuetype:  { name: config.jira.issueTypes.bug || 'Bug' },
    description: toADF(descText),
    labels:     ['pentest', finding.severity, finding.tool, 'security'].filter(Boolean).map(l => String(l).replace(/\s+/g, '-')),
    priority:   { name: priority },
  };

  const headers = {
    Authorization: `Basic ${Buffer.from(`${cfg.email || config.jira.email}:${cfg.apiToken || config.jira.apiToken}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  let created;
  try {
    const res = await axios.post(`${baseUrl}/rest/api/${config.jira.apiVersion}/issue`, { fields }, { headers });
    created = res.data;
  } catch (e) {
    if (e.response?.status === 400 && fields.priority) {
      delete fields.priority;
      const res = await axios.post(`${baseUrl}/rest/api/${config.jira.apiVersion}/issue`, { fields }, { headers });
      created = res.data;
    } else {
      throw e;
    }
  }

  if (parentKey) {
    try {
      await axios.post(
        `${baseUrl}/rest/api/${config.jira.apiVersion}/issueLink`,
        { type: { name: 'Relates' }, inwardIssue: { key: created.key }, outwardIssue: { key: parentKey } },
        { headers }
      );
    } catch (_) { /* link is best-effort */ }
  }

  return { key: created.key, url: browseUrl(baseUrl, created.key) };
}

module.exports = { createBug, createPentestBug };
