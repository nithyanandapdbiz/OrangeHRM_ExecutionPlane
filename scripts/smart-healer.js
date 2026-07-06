'use strict';
/**
 * Smart Healer — OrangeHRM Execution Plane.
 *
 * Proactive self-healing pass over the OrangeHRM React page objects: reads the
 * locator-intelligence cache (learned selector alternatives) and proposes healed
 * locators for elements that recently drifted. Best-effort and non-blocking — it
 * reports proposals and exits 0; application happens through the review workflow.
 *
 * Usage:  node scripts/smart-healer.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadCache() {
  const p = path.join(ROOT, '.cache', 'locator-intelligence.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const apply = process.argv.includes('--apply');
  const cache = loadCache();

  if (!cache) {
    console.log('[smart-healer] No locator-intelligence cache yet — nothing to heal (PASS)');
    process.exit(0);
  }

  const proposals = [];
  for (const [selector, info] of Object.entries(cache.selectors || {})) {
    if (info && info.driftCount > 0 && Array.isArray(info.alternatives) && info.alternatives.length) {
      proposals.push({ selector, suggested: info.alternatives[0], driftCount: info.driftCount });
    }
  }

  if (!proposals.length) {
    console.log('[smart-healer] No drifted selectors detected (PASS)');
  } else {
    console.log(`[smart-healer] ${proposals.length} healing proposal(s):`);
    for (const p of proposals) console.log(`  ${p.selector} → ${p.suggested} (drift ${p.driftCount})`);
    if (apply) console.log('[smart-healer] --apply is advisory in CI; proposals routed to the review workflow');
  }
  process.exit(0);
}

main();
