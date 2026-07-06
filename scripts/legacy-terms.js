'use strict';
/**
 * Legacy-term governance denylist — OrangeHRM Execution Plane.
 *
 * THE single, intentional place where pre-platform terms are enumerated: the
 * governance gates (domain-eradication-audit.js, run-bdd-and-sync.js Gate 4) import
 * this list to ENFORCE that these terms never reappear in platform code, config,
 * docs, or generated feature files. This file is itself excluded from the audit
 * (it is the denylist, not a violation) — analogous to a linter's rule config.
 */

// Lowercase substring terms (for text scans).
const TERMS = [
  'carlisle',
  'carlislehomes',
  'azure devops',
  'azuredevops',
  'dynamics',
  'd365',
  'dataverse',
  'microsoft crm',
  'specflow',
  'crm5.dynamics',
  'dbizdemo',
];

// Word-boundary / structured patterns (for stricter audits).
const PATTERNS = [
  /carlisle/i,
  /azure\s*devops/i,
  /\bado\b/i,
  /dynamics/i,
  /\bd365\b/i,
  /dataverse/i,
  /microsoft\s*crm/i,
  /\bcrm\b/i,
  /\bxrm\b/i,
  /specflow/i,
  /crm5\.dynamics/i,
  /dbizdemo/i,
];

module.exports = { TERMS, PATTERNS };
