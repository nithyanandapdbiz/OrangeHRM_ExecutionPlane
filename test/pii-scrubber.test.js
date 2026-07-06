'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { scrub, MASK } = require('../middleware/pii-scrubber');

test('redacts sensitive fields by key name', () => {
  const { scrubbed, fieldsRedacted } = scrub({ app_password: 'hunter2', keep: 'ok' });
  assert.equal(scrubbed.app_password, MASK);
  assert.equal(scrubbed.keep, 'ok');
  assert.ok(fieldsRedacted.includes('app_password'));
});

test('redacts email and phone embedded in free text by value', () => {
  const { scrubbed, fieldsRedacted } = scrub({
    storyDescription: 'contact john@example.com or 555-123-4567 for details',
  });
  assert.ok(!/john@example\.com/.test(scrubbed.storyDescription), 'email must be removed');
  assert.ok(!/555-123-4567/.test(scrubbed.storyDescription), 'phone must be removed');
  assert.ok(fieldsRedacted.includes('storyDescription<email>'));
  assert.ok(fieldsRedacted.includes('storyDescription<phone>'));
});

test('leaves clean payloads untouched with no redactions', () => {
  const input = { storyTitle: 'Employee Login and PIM Add-Employee', count: 3, ok: true };
  const { scrubbed, fieldsRedacted } = scrub(input);
  assert.deepEqual(scrubbed, input);
  assert.equal(fieldsRedacted.length, 0);
});

test('redacts SSN value pattern', () => {
  const { scrubbed } = scrub({ note: 'ssn is 123-45-6789' });
  assert.ok(scrubbed.note.includes(MASK));
  assert.ok(!/123-45-6789/.test(scrubbed.note));
});

test('Luhn guard: valid card redacted, invalid left intact', () => {
  const valid   = scrub({ p: 'pay 4242 4242 4242 4242 now' });   // valid Luhn
  const invalid = scrub({ p: 'order 1234 5678 9012 3456 today' }); // invalid Luhn
  assert.ok(valid.scrubbed.p.includes(MASK), 'valid card should be redacted');
  assert.ok(/1234 5678 9012 3456/.test(invalid.scrubbed.p), 'invalid card should NOT be redacted');
});

test('string input redacts JSON-keyed secrets', () => {
  const { scrubbed } = scrub('{"app_password":"secret","title":"hello"}');
  assert.ok(scrubbed.includes(MASK));
  assert.ok(!scrubbed.includes('secret'));
  assert.ok(scrubbed.includes('hello'));
});

test('recurses into nested objects and arrays', () => {
  const { scrubbed, fieldsRedacted } = scrub({ a: { b: { ssn: '111-22-3333' } }, list: ['x@y.com'] });
  assert.equal(scrubbed.a.b.ssn, MASK);
  assert.ok(!scrubbed.list[0].includes('x@y.com'));
  assert.ok(fieldsRedacted.includes('a.b.ssn'));
});
