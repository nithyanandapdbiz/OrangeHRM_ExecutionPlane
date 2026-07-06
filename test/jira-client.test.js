'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Unit tests for the NEW Jira REST client (clients/jira.client.js). No real
// network calls are made — the shared ALM HTTP transport (this.http) is replaced
// with a recording stub, so we exercise pure request/field-mapping logic.

const JiraClient = require('../clients/jira.client');
const { assertIssueTracker } = require('../clients/alm/tracker.contract');

const ENV = {
  JIRA_BASE_URL: 'https://orangehrm.atlassian.net',
  JIRA_EMAIL: 'qa@orangehrm.example',
  JIRA_API_TOKEN: 'jira-token',
  JIRA_PROJECT_KEY: 'OHRM',
};

// A stub that records every call and returns canned data.
function stubHttp(responder = {}) {
  const calls = [];
  const wrap = (method) => async (url, dataOrParams, params) => {
    calls.push({ method, url, data: dataOrParams, params });
    const fn = responder[method];
    return fn ? fn(url, dataOrParams, params) : {};
  };
  return {
    calls,
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    del: wrap('del'),
    paginate: async (fetchPage) => {
      const page = await fetchPage(0);
      return page.values || [];
    },
  };
}

test('construction requires JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN', () => {
  assert.throws(() => new JiraClient({ JIRA_PROJECT_KEY: 'OHRM' }),
    /JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are required/);
});

test('construction requires JIRA_PROJECT_KEY', () => {
  const env = { ...ENV }; delete env.JIRA_PROJECT_KEY;
  assert.throws(() => new JiraClient(env), /JIRA_PROJECT_KEY is required/);
});

test('constructs with JIRA_* env and exposes the tracker method surface', () => {
  const client = new JiraClient(ENV);
  assert.strictEqual(client.projectKey, 'OHRM');
  assert.strictEqual(client.baseUrl, 'https://orangehrm.atlassian.net');
  for (const m of ['checkConnectivity', 'fetchWorkItem', 'createBug', 'createIssue',
    'searchJql', 'addIssueLink', 'addComment', 'listVersions']) {
    assert.strictEqual(typeof client[m], 'function', `missing method ${m}`);
  }
});

test('satisfies the IssueTracker contract (assertIssueTracker)', () => {
  assert.doesNotThrow(() => assertIssueTracker(JiraClient.prototype, 'JiraClient'));
});

test('toADF wraps plain text into a valid ADF document', () => {
  const doc = JiraClient.toADF('hello world');
  assert.strictEqual(doc.type, 'doc');
  assert.strictEqual(doc.version, 1);
  assert.strictEqual(doc.content[0].type, 'paragraph');
  assert.strictEqual(doc.content[0].content[0].text, 'hello world');
});

test('toADF splits multiple paragraphs and never yields empty content', () => {
  const doc = JiraClient.toADF('para one\n\npara two');
  assert.strictEqual(doc.content.length, 2);
  const empty = JiraClient.toADF('');
  assert.strictEqual(empty.content.length, 1); // single empty paragraph, still valid ADF
});

test('fromADF flattens an ADF document back to plain text', () => {
  const doc = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'line one' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'line two' }] },
  ] };
  assert.match(JiraClient.fromADF(doc), /line one/);
  assert.match(JiraClient.fromADF(doc), /line two/);
});

test('fromADF strips HTML/tags from string input', () => {
  assert.strictEqual(JiraClient.fromADF('<b>bold</b> text'), 'bold text');
  assert.strictEqual(JiraClient.fromADF(null), '');
});

test('fetchWorkItem preserves alphanumeric keys (OHRM-1 not stripped to digits)', async () => {
  const client = new JiraClient(ENV);
  client.http = stubHttp({
    get: async () => ({
      id: '10001', key: 'OHRM-1',
      fields: {
        summary: 'Employee Login & PIM Add-Employee',
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'As a user I log in' }] }] },
        issuetype: { name: 'Story' },
        status: { name: 'To Do' },
        labels: ['ui'],
        components: [{ name: 'PIM' }],
      },
    }),
  });

  const story = await client.fetchWorkItem('OHRM-1');
  assert.strictEqual(client.http.calls[0].url, '/issue/OHRM-1', 'alphanumeric key must not be stripped');
  assert.strictEqual(story.key, 'OHRM-1');
  assert.strictEqual(story.title, 'Employee Login & PIM Add-Employee');
  assert.match(story.description, /As a user I log in/); // ADF flattened to text
  assert.strictEqual(story.type, 'Story');
  assert.deepStrictEqual(story.components, ['PIM']);
});

test('createBug builds a Jira Bug with ADF description and links to the parent story', async () => {
  const client = new JiraClient(ENV);
  const links = [];
  client.http = stubHttp({
    post: async (url, body) => {
      if (url === '/issue') return { id: '20002', key: 'OHRM-99' };
      if (url === '/issueLink') { links.push(body); return {}; }
      return {};
    },
  });

  const res = await client.createBug('Login fails', 'Step 1\n\nStep 2', 'OHRM-1', 'High');
  assert.strictEqual(res.key, 'OHRM-99');

  const create = client.http.calls.find((c) => c.url === '/issue');
  assert.ok(create, 'a create issue POST must be sent');
  const f = create.data.fields;
  assert.match(f.summary, /^\[AgenticQA\] Login fails$/);
  assert.strictEqual(f.issuetype.name, 'Bug');
  assert.strictEqual(f.description.type, 'doc'); // ADF, not raw string
  assert.strictEqual(f.priority.name, 'High');
  assert.ok(f.labels.includes('AgenticQA'));

  assert.strictEqual(links.length, 1, 'bug must be linked to the parent story');
  assert.strictEqual(links[0].inwardIssue.key, 'OHRM-99');
  assert.strictEqual(links[0].outwardIssue.key, 'OHRM-1');
});

test('checkConnectivity reports connected on a successful /myself probe', async () => {
  const client = new JiraClient(ENV);
  client.http = stubHttp({ get: async () => ({ emailAddress: 'qa@orangehrm.example' }) });
  const r = await client.checkConnectivity();
  assert.strictEqual(r.connected, true);
  assert.strictEqual(client.http.calls[0].url, '/myself');
});
