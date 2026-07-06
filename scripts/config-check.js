#!/usr/bin/env node
'use strict';
/**
 * Validate the Execution Plane configuration and print a secret-safe summary.
 * Exit non-zero on any validation error — suitable for boot/CI fail-fast.
 *
 *   npm run config:check
 */
const config = require('../lib/config');

const { ok, errors } = config.validate();
console.log('── Execution Plane configuration ──────────────────────────────');
console.log(JSON.stringify(config.describe(), null, 2));
if (!ok) {
  console.error('\n❌ Configuration invalid:');
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log('\n✅ Configuration valid');
