'use strict';
/**
 * jira.client.js — Jira Cloud issue fetch (REST API v3).
 *
 * Fetches a Jira issue and normalises it to the platform's canonical story
 * shape. Jira keys are ALPHANUMERIC (e.g. OHRM-1) and are preserved verbatim —
 * the numeric suffix is never stripped.
 *
 * Field map (Jira → canonical):
 *   summary            → fields.summary
 *   description (ADF)  → fields.description      (ADF flattened to text)
 *   issuetype.name     → fields.issuetype.name
 *   status.name        → fields.status.name
 *   priority.name      → fields.priority.name
 *   assignee           → fields.assignee
 *   labels/components   → fields.labels / fields.components
 */
const axios = require('../utils/almRetry');
const config = require('../core/config');
const { jiraHeaders } = require('../utils/jiraAuth');
const { resolveIssueKey } = require('../utils/issueKeyResolver');

function apiRoot() {
  return `${config.jira.baseUrl}/rest/api/${config.jira.apiVersion}`;
}

// Flatten an Atlassian Document Format node (or HTML/string) to plain text.
function fromADF(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.isArray(node)) return node.map(fromADF).join(' ');
  if (node.type === 'text') return node.text || '';
  if (node.content) return fromADF(node.content);
  return '';
}

function transformIssue(item, originalKey) {
  const f = item.fields || {};
  const acceptanceFieldId = process.env.JIRA_ACCEPTANCE_FIELD || '';
  return {
    id: item.id,
    key: originalKey || item.key || `${config.jira.projectKey}-${item.id}`,
    fields: {
      summary:            f.summary || '',
      description:        fromADF(f.description) || fromADF(item.renderedFields?.description) || '',
      acceptanceCriteria: acceptanceFieldId ? fromADF(f[acceptanceFieldId]) : '',
      issuetype:          { name: f.issuetype?.name || 'Story' },
      status:             { name: f.status?.name || 'To Do' },
      priority:           { name: f.priority?.name || 'Medium' },
      assignee:           f.assignee
        ? { accountId: f.assignee.accountId || '', displayName: f.assignee.displayName || '' }
        : null,
      fixVersions:        (f.fixVersions || []).map(v => ({ id: v.id, name: v.name })),
      labels:             f.labels || [],
      components:         (f.components || []).map(c => c.name),
    }
  };
}

async function getStory(key) {
  // Jira keys are alphanumeric (OHRM-1) — preserve the key verbatim, never strip.
  const { key: issueKey } = resolveIssueKey(key);
  const res = await axios.get(
    `${apiRoot()}/issue/${encodeURIComponent(issueKey)}?expand=names,renderedFields`,
    { headers: jiraHeaders() }
  );
  return transformIssue(res.data, issueKey);
}

async function getWorkItem(key) {
  const res = await axios.get(
    `${apiRoot()}/issue/${encodeURIComponent(String(key))}?expand=names,renderedFields`,
    { headers: jiraHeaders() }
  );
  return res.data;
}

module.exports = { getStory, getWorkItem, fromADF };
