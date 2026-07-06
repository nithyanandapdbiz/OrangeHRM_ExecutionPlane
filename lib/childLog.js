'use strict';
/**
 * childLog — captures raw child-process output (cucumber/k6/ZAP) to a file so the
 * live trace (scripts/trigger.js) can show the detailed test-execution steps and
 * failure/error stack traces, which otherwise go only to the server's own console.
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'logs', 'child-output.log');

function write(chunk) {
  try { fs.appendFileSync(FILE, chunk); } catch { /* non-fatal */ }
}
// Truncate at the start of each pipeline run so the file holds just this run.
function reset() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, '');
  } catch { /* non-fatal */ }
}

module.exports = { FILE, write, reset };
