'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const childLog = require('../lib/childLog');

test('reset() truncates the child-output log', () => {
  childLog.write('stale');
  childLog.reset();
  assert.equal(fs.readFileSync(childLog.FILE, 'utf8'), '');
});

test('write() appends raw chunks in order', () => {
  childLog.reset();
  childLog.write('hello ');
  childLog.write('world');
  assert.equal(fs.readFileSync(childLog.FILE, 'utf8'), 'hello world');
  childLog.reset(); // leave the workspace clean
});
