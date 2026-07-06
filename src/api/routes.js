'use strict';
const express = require("express");
const { getDashboard } = require("./dashboard.controller");
const { handleJiraWebhook, handleManualTrigger, getWebhookStatus } = require("./webhook.controller");
const { listAll, getSummary, listByTest, serveScreenshot } = require("./screenshot.controller");
const { getSecuritySummary } = require("./security.controller");
const { getPerfSummary } = require("./perf.controller");
const devChangeCtrl         = require("./devChange.controller");
const { authGuard }        = require("./middleware/authGuard");
const { rateLimiter }      = require("./middleware/rateLimiter");
const { securityHeaders }  = require("./middleware/securityHeaders");

const router = express.Router();

// Global middleware: applies to ALL routes in this router.
router.use(securityHeaders);
router.use(rateLimiter);

// ── Dashboard (auth-gated when API_SECRET set) ─────────────────────
router.get("/dashboard", authGuard, getDashboard);

// ── Webhooks ──────────────────────────────────────────────────────
// POST /webhook/jira is protected by HMAC (verifySignature) — NOT by authGuard.
router.post("/webhook/jira",   handleJiraWebhook);
router.post("/webhook/manual", authGuard, handleManualTrigger);
router.get("/webhook/status",  authGuard, getWebhookStatus);

// ── Screenshots ───────────────────────────────────────────────────
router.get("/screenshots/summary",     authGuard, getSummary);
router.get("/screenshots",             authGuard, listAll);
router.get("/screenshots/:test",       authGuard, listByTest);
router.get("/screenshots/:test/:file", authGuard, serveScreenshot);

// ── Security ──────────────────────────────────────────────────────
router.get("/security/summary",        authGuard, getSecuritySummary);

// ── Performance ───────────────────────────────────────────────────
router.get("/perf/summary",            authGuard, getPerfSummary);

// ── Dev-Change Reconciliation (Section 23) ────────────────────────
router.post("/dev-change/analyse",                              authGuard, devChangeCtrl.postAnalyse);
router.get ("/dev-change/jobs/:id",                             authGuard, devChangeCtrl.getJob);
router.get ("/dev-change/decisions",                            authGuard, devChangeCtrl.getDecisions);
router.get ("/dev-change/quarantine",                           authGuard, devChangeCtrl.getQuarantine);
router.post("/dev-change/quarantine/:id/approve",               authGuard, devChangeCtrl.postQuarantineApprove);
router.get ("/dev-change/cycles",                               authGuard, devChangeCtrl.listCycles);
router.get ("/dev-change/cycles/:headSha",                      authGuard, devChangeCtrl.getCycle);
router.post("/dev-change/cycles/:headSha/execute",              authGuard, devChangeCtrl.postExecute);
router.post("/dev-change/cycles/:headSha/companion/promote",    authGuard, devChangeCtrl.postPromoteCompanion);
router.get ("/dev-change/patterns",                             authGuard, devChangeCtrl.getPatterns);

module.exports = router;
