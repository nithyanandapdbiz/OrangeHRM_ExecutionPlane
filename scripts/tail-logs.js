'use strict';
/**
 * Live-follow the server's execution-plane log with readable formatting.
 *
 *   npm run logs
 *
 * Shows the full pipeline trace (steps, "test case created", sync, bugs, etc.)
 * as it happens — useful when the server runs in the background and you trigger
 * the pipeline from another terminal via `npm run e2e`.
 */
const fs   = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'logs', 'execution-plane.log');
let size = fs.existsSync(file) ? fs.statSync(file).size : 0;

console.log(`Tailing ${file}\n(Ctrl+C to stop)\n`);

function emit(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      console.log(`${(o.timestamp || '').replace('T', ' ').replace('Z', '')}  ${o.message}`);
    } catch {
      console.log(line);
    }
  }
}

fs.watchFile(file, { interval: 400 }, () => {
  try {
    const n = fs.statSync(file).size;
    if (n > size) {
      const fd = fs.openSync(file, 'r');
      const b  = Buffer.alloc(n - size);
      fs.readSync(fd, b, 0, n - size, size);
      fs.closeSync(fd);
      emit(b.toString('utf8'));
      size = n;
    } else if (n < size) {
      size = n; // log rotated/truncated — reset
    }
  } catch { /* transient fs race — ignore */ }
});
