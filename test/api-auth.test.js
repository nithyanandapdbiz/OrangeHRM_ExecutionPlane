'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { apiAuth } = require('../middleware/apiAuth');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
function run(headers, secret) {
  const prev = process.env.API_SECRET;
  if (secret === undefined) delete process.env.API_SECRET; else process.env.API_SECRET = secret;
  const res = mockRes();
  let nexted = false;
  apiAuth({ headers }, res, () => { nexted = true; });
  if (prev === undefined) delete process.env.API_SECRET; else process.env.API_SECRET = prev;
  return { res, nexted };
}

test('no API_SECRET configured → passes through (backward compatible)', () => {
  const { nexted, res } = run({}, undefined);
  assert.equal(nexted, true);
  assert.equal(res.statusCode, 200);
});

test('configured + no credentials → 401', () => {
  const { nexted, res } = run({}, 's3cret');
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('configured + correct X-API-Key → passes', () => {
  const { nexted } = run({ 'x-api-key': 's3cret' }, 's3cret');
  assert.equal(nexted, true);
});

test('configured + correct Bearer token → passes', () => {
  const { nexted } = run({ authorization: 'Bearer s3cret' }, 's3cret');
  assert.equal(nexted, true);
});

test('configured + wrong key → 401', () => {
  const { nexted, res } = run({ 'x-api-key': 'wrong' }, 's3cret');
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});
