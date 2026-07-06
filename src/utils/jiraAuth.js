'use strict';
/**
 * jiraAuth.js — HTTP Basic auth headers for Jira Cloud REST (API v3).
 *
 * Atlassian Cloud uses HTTP Basic with  base64("<email>:<apiToken>").
 * JIRA_EMAIL + JIRA_API_TOKEN are read from core/config (never logged, never
 * forwarded to the DBiz Intelligence Plane).
 */

function jiraHeaders() {
  const config = require('../core/config');
  const token = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

module.exports = { jiraHeaders };
