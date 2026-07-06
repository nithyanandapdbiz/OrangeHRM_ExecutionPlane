'use strict';
// CONSOLIDATED: the single retry implementation now lives in lib/retry.js.
// Re-export preserves the { retry } interface for the perf/security path.
// Removed when src/ is re-homed (ADR-0002). Do not add logic here.
module.exports = require('../../lib/retry');
