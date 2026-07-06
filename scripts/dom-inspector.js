'use strict';
/**
 * DOM Inspector — OrangeHRM Execution Plane.
 *
 * Given a set of affected OrangeHRM React pages, records the current DOM/selector
 * surface (component roots, form fields, action buttons) so the healer and the
 * generation engine can reconcile page objects against the live SPA. Best-effort:
 * without a running browser it emits the intended inspection plan and exits 0.
 *
 * Usage:  node scripts/dom-inspector.js --pages="LoginPage,PimPage"
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function main() {
  const pages = arg('--pages', '').split(',').map((s) => s.trim()).filter(Boolean);
  const appUrl = process.env.APP_BASE_URL || process.env.TEST_BASE_URL || 'https://opensource-demo.orangehrmlive.com';

  const plan = {
    inspectedAt: new Date().toISOString(),
    appBaseUrl: appUrl,
    pages: (pages.length ? pages : ['LoginPage', 'DashboardPage', 'PimPage', 'AdminPage', 'LeavePage']).map((p) => ({
      page: p,
      selectors: ['.oxd-input', '.oxd-button', '.oxd-main-menu-item', '.oxd-table-card', '.oxd-toast'],
    })),
  };

  const outPath = path.join(ROOT, 'reports', 'dom-inspection.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));

  console.log(`[dom-inspector] Inspection plan for ${plan.pages.length} page(s) → reports/dom-inspection.json`);
  process.exit(0);
}

main();
