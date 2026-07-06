#!/usr/bin/env node
'use strict';
/**
 * run-story.js — thin alias to scripts/trigger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes a single Jira story into Zephyr test cases (and runs the full
 * pipeline) by delegating to the canonical CLI trigger. Kept as a named entry
 * point so `node scripts/run-story.js OHRM-1` reads intuitively and matches the
 * scripts/README.md table.
 *
 * Usage:
 *   node scripts/run-story.js [ISSUE_KEY]
 *   node scripts/run-story.js OHRM-1
 *   (falls back to ISSUE_KEY from .env when no key is passed)
 *
 * Requires the Execution-Plane server to be running: npm start
 */

require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');

const TRIGGER = path.join(__dirname, 'trigger.js');
const issueKey = process.argv[2] || process.env.ISSUE_KEY;

const args = [TRIGGER];
if (issueKey) args.push(issueKey);

const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (err) => {
  console.error('  ❌  Failed to launch trigger.js:', err.message);
  process.exit(1);
});
