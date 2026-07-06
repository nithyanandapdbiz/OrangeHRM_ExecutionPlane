'use strict';
// CONSOLIDATED: the single logger implementation now lives in lib/logger.js.
// This re-export keeps the perf/security execution path working unchanged while
// eliminating the duplicate winston instance. Removed entirely when src/ is
// re-homed (ADR-0002). Do not add logic here.
module.exports = require('../../lib/logger');
