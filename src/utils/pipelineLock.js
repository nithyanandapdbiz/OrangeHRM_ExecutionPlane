'use strict';
const fs   = require('fs');
const path = require('path');

const LOCK_FILE = path.resolve(__dirname, '../../.pipeline.lock');

function acquireLock(issueKey) {
  if (fs.existsSync(LOCK_FILE)) {
    const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    return { acquired: false, lock: existing };
  }
  const lock = { issueKey, pid: process.pid, acquiredAt: new Date().toISOString() };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
  return { acquired: true, lock };
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

function getActiveLock() {
  if (!fs.existsSync(LOCK_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }
  catch (_) { return null; }
}

module.exports = { acquireLock, releaseLock, getActiveLock };
