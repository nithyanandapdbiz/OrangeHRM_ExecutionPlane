'use strict';
/**
 * routes/discovery.js — Execution-Plane Discovery API (transport).
 *
 * Wires the discovery controller (src/api/discovery.controller.js) into the
 * shared apiRouter under the same apiAuth guard as /run. The controller runs a
 * local Playwright crawl, scrubs PII, and delegates AI synthesis to the
 * Intelligence Plane — no AI logic executes in the Execution Plane.
 *
 *   POST /discovery/run                     → 202 { runId, status }
 *   GET  /discovery/summary                 → latest-runs overview
 *   GET  /discovery/runs                    → paginated history
 *   GET  /discovery/runs/:runId             → live run status
 *   GET  /discovery/runs/:runId/artifacts   → generated artefacts (when ready)
 *   POST /discovery/cancel/:runId           → cooperative cancel
 */

const { apiAuth } = require('../middleware/apiAuth');
const ctrl = require('../src/api/discovery.controller');

module.exports = (app) => {
  app.post('/discovery/run',                 apiAuth, ctrl.runDiscovery);
  app.get('/discovery/summary',              apiAuth, ctrl.getSummary);
  app.get('/discovery/runs',                 apiAuth, ctrl.listRuns);
  app.get('/discovery/runs/:runId',          apiAuth, ctrl.getRunStatus);
  app.get('/discovery/runs/:runId/artifacts', apiAuth, ctrl.getArtifacts);
  app.post('/discovery/cancel/:runId',       apiAuth, ctrl.cancelRun);
};
