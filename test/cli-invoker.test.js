'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { cliInvoker } = require('../runners/playwright.runner');

// TD-19: runners must invoke test CLIs without a shell. cliInvoker resolves a
// package's bin and returns a `node <bin>` invocation (shell:false), falling
// back to npx-with-shell only when the package can't be resolved.

test('resolves an installed package to a no-shell node invocation', () => {
  const inv = cliInvoker('@cucumber/cucumber', 'cucumber-js', process.cwd());
  assert.strictEqual(inv.shell, false, 'should not use a shell');
  assert.strictEqual(inv.file, process.execPath, 'should run via node');
  assert.ok(inv.prefix[0].endsWith('.js'), 'prefix should be a resolved .js bin');
  assert.ok(path.isAbsolute(inv.prefix[0]), 'bin path should be absolute');
});

test('resolves playwright bin without a shell', () => {
  const inv = cliInvoker('playwright', 'playwright', process.cwd());
  assert.strictEqual(inv.shell, false);
  assert.strictEqual(inv.file, process.execPath);
  assert.match(inv.prefix[0], /cli\.js$/);
});

test('falls back to npx-with-shell for an unresolvable package', () => {
  const inv = cliInvoker('this-package-does-not-exist-xyz', 'nope', process.cwd());
  assert.strictEqual(inv.file, 'npx');
  assert.deepStrictEqual(inv.prefix, ['nope']);
  assert.strictEqual(inv.shell, true);
});
