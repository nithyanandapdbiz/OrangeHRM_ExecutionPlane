'use strict';
require('dotenv').config();

const express    = require('express');
const { v4: uuid } = require('uuid');
const logger     = require('./lib/logger');
const startupGuard = require('./middleware/startup-guard');
const secrets    = require('./lib/secrets');
const customer   = require('./config/customer.json'); // tenant identity — no hardcoding

const app  = express();
// Default 3000 to match scripts/trigger.js, .env.example, the health npm script,
// and the Dockerfile — a divergent default here caused ECONNREFUSED on `npm run pipeline`.
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

// Attach a requestId to every request for tracing
app.use((req, _res, next) => {
  req.requestId = uuid();
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// API version (TD-15). Routes register on a single shared router that is mounted
// at BOTH /v1 (canonical, versioned) and / (legacy, back-compatible). Because the
// same router instance is mounted twice, handler closures (e.g. the /run inFlight
// guard) are shared — there is one pipeline lock, not two.
const API_VERSION = 'v1';
app.use((_req, res, next) => { res.setHeader('X-API-Version', API_VERSION); next(); });

const apiRouter = express.Router();
require('./routes/health')(apiRouter);
require('./routes/run')(apiRouter);

app.use(`/${API_VERSION}`, apiRouter); // canonical: /v1/health, /v1/run
app.use('/', apiRouter);               // legacy:    /health,    /run

// Catch-all 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Unhandled error handler
app.use((err, _req, res, _next) => {
  logger.error(`[Server] Unhandled error: ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
// Order matters: hydrate secrets first (the `env` provider is a no-op; the
// `keyvault` provider injects secrets into process.env), THEN run the startup
// guard so it validates against the fully-populated environment, THEN listen.
async function boot() {
  await secrets.hydrate();
  startupGuard.validate(); // exits on ANTHROPIC_API_KEY or missing required creds

  app.listen(PORT, () => {
    logger.info('═'.repeat(65));
    logger.info('  OrangeHRM Execution Plane  — STARTED');
    logger.info(`  Port             : ${PORT}`);
    logger.info(`  Secrets provider : ${secrets.providerName()}`);
    logger.info(`  Intelligence API : ${process.env.INTELLIGENCE_API_URL || 'http://localhost:3001'}`);
    logger.info(`  Customer         : ${process.env.CUSTOMER_ID || customer.customerId} (${customer.customerName})`);
    logger.info(`  AI credential    : NOT PRESENT (provider-agnostic sovereign boundary enforced)`);
    logger.info(`  Jira             : ${process.env.JIRA_BASE_URL} (${process.env.JIRA_PROJECT_KEY})`);
    logger.info(`  Zephyr Essential : ${process.env.ZEPHYR_API_URL || 'https://api.zephyrscale.smartbear.com/v2'}`);
    logger.info('');
    logger.info(`  API version      : ${API_VERSION} (canonical /${API_VERSION}/*; legacy /* retained)`);
    logger.info('  Endpoints:');
    logger.info(`    GET  /health  (= /${API_VERSION}/health)  — connectivity + readiness probe`);
    logger.info(`    POST /run     (= /${API_VERSION}/run)     — { issueKey } — full 6-step QA pipeline`);
    logger.info('═'.repeat(65));
  });
}

boot().catch((err) => {
  logger.error(`[Server] Boot failed: ${err.message}`);
  process.exit(1);
});

module.exports = app;
