'use strict';
/**
 * IssueTracker contract — the interface the Execution Plane depends on for
 * requirement/defect tracking. The business logic (routes/run.js, scripts) MUST
 * depend on THIS shape, never on a concrete provider (Jira). Swapping trackers =
 * providing another implementation with the same surface. This is the provider-
 * isolation seam for the ALM tracker.
 *
 * Implemented by: clients/jira.client.js (JiraClient).
 *
 * @typedef {Object} Story
 * @property {string} id           provider-internal id
 * @property {string} key          human key (e.g. "OHRM-1")
 * @property {string} title        summary
 * @property {string} description  plain-text (ADF/HTML stripped)
 * @property {string} type         issue type (Story/Task/Epic/…)
 * @property {string} state        workflow status name
 * @property {string[]} labels
 * @property {string[]} components
 * @property {object} raw          untouched provider payload
 *
 * @typedef {Object} CreatedIssue
 * @property {string} id
 * @property {string} key
 * @property {string} [title]
 *
 * Interface (methods every tracker implementation provides):
 *   checkConnectivity()                              → { connected:boolean, status:number }
 *   fetchWorkItem(issueKey)                          → Promise<Story>
 *   createBug(title, stepsToRepro, parentKey, prio)  → Promise<CreatedIssue|null>
 *   searchJql(query, opts)                           → Promise<Story[]>   (optional/provider-native)
 *   addIssueLink(inwardKey, outwardKey, type)        → Promise<void>
 *   addComment(issueKey, text)                       → Promise<void>
 */
const REQUIRED_METHODS = [
  'checkConnectivity',
  'fetchWorkItem',
  'createBug',
];

/** Assert an object satisfies the IssueTracker contract. Throws if not. */
function assertIssueTracker(impl, name = 'IssueTracker') {
  for (const m of REQUIRED_METHODS) {
    if (typeof impl?.[m] !== 'function') {
      throw new Error(`${name} does not implement required IssueTracker method: ${m}()`);
    }
  }
  return impl;
}

module.exports = { REQUIRED_METHODS, assertIssueTracker };
