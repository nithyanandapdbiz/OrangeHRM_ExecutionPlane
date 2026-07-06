/**
 * Jira Webhook Controller
 *
 * Receives Jira Cloud webhook payloads and auto-triggers the QA pipeline.
 *
 * Supported events:
 *   - jira:issue_created   → triggers full pipeline for new Stories
 *   - jira:issue_updated   → triggers pipeline when story status changes to a configured status
 *   - comment_created      → triggers if comment body contains /qa-run command
 *
 * Jira webhook setup:
 *   Jira → System → WebHooks → Create a WebHook
 *   URL:  https://<your-host>/api/webhook/jira
 *   Events: Issue created, Issue updated, Comment created
 *   JQL filter: project = OHRM AND issuetype in (Story, Task)
 *
 * Security:
 *   - Validates a shared webhook secret (WEBHOOK_SECRET in .env) via X-Hub-Signature header
 *   - Filters by project key and issue type
 *   - Rate-limits to prevent duplicate pipeline runs
 */
'use strict';
const crypto  = require("crypto");
const path    = require("path");
const { spawnSync } = require("child_process"); // eslint-disable-line no-unused-vars
const logger  = require("../utils/logger");
const { getActiveLock } = require("../utils/pipelineLock");

const ROOT         = path.resolve(__dirname, "..", "..");
const PROJECT_KEY  = process.env.JIRA_PROJECT_KEY || process.env.PROJECT_KEY || "OHRM";
const TRIGGER_STATUSES = (process.env.WEBHOOK_TRIGGER_STATUSES || "In Progress,Selected for Development,To Do")
  .split(",").map(s => s.trim().toLowerCase());

// Simple in-memory rate limiter: one pipeline run per issue per 5 minutes
const _recentRuns = new Map();
const COOLDOWN_MS = 5 * 60 * 1000;

function isOnCooldown(issueKey) {
  const now = Date.now();
  // Purge stale entries to prevent memory leak
  for (const [key, ts] of _recentRuns) {
    if (now - ts > COOLDOWN_MS) _recentRuns.delete(key);
  }
  const last = _recentRuns.get(issueKey);
  if (last && now - last < COOLDOWN_MS) return true;
  _recentRuns.set(issueKey, now);
  return false;
}

/**
 * Validate the X-Hub-Signature header (HMAC-SHA256) against WEBHOOK_SECRET.
 * Operates on req.rawBody (raw bytes captured before JSON parsing) to ensure the
 * HMAC matches the exact bytes Jira sent, not a re-serialized version.
 * Returns true if no secret is configured (opt-in security).
 */
function verifySignature(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isRequired   = process.env.REQUIRE_WEBHOOK_SECRET === 'true';
    if (isProduction || isRequired) {
      logger.warn('[Webhook] WEBHOOK_SECRET not set — rejecting unsigned request (production/required mode).');
      return false;
    }
    return true; // dev/test mode — skip signature check
  }

  const sig = req.headers["x-hub-signature-256"] || req.headers["x-hub-signature"] || "";
  if (!sig) return false;

  // Use raw bytes from before JSON parsing — not JSON.stringify(req.body)
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Trigger the full pipeline for a given issue key.
 * Runs asynchronously in a child process so the webhook can respond immediately.
 */
function triggerPipeline(issueKey, reason) {
  logger.info(`[Webhook] Triggering pipeline for ${issueKey} — reason: ${reason}`);

  // Spawn detached so webhook response isn't blocked
  const script = path.join(ROOT, "scripts", "run-full-pipeline.js");
  const child = require("child_process").spawn(
    "node", [script, "--headless"],
    {
      cwd: ROOT,
      env: { ...process.env, ISSUE_KEY: issueKey },
      detached: true,
      stdio: "ignore"
    }
  );
  child.unref();

  logger.info(`[Webhook] Pipeline spawned (PID ${child.pid}) for ${issueKey}`);
  return child.pid;
}

// ── Express route handlers ───────────────────────────────────────────

/**
 * POST /api/webhook/jira
 * Jira webhook receiver — handles jira:issue_created, jira:issue_updated, comment_created.
 */
function handleJiraWebhook(req, res) {
  // 1. Verify signature
  if (!verifySignature(req)) {
    logger.warn("[Webhook] Invalid signature — rejecting");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const payload = req.body;
  if (!payload || (!payload.webhookEvent && !payload.eventType)) {
    return res.status(400).json({ error: "Missing webhookEvent in payload" });
  }

  const event = payload.webhookEvent || payload.eventType || '';

  // Jira webhook payload shape
  const issue        = payload.issue || {};
  const jiraFields   = issue.fields || {};
  const issueKey     = issue.key || '';
  const jiraStatus   = (jiraFields.status?.name || '').toLowerCase();
  const jiraType     = (jiraFields.issuetype?.name || '').toLowerCase();
  const jiraProject  = (jiraFields.project?.key || (issueKey.includes('-') ? issueKey.split('-')[0] : '')).toUpperCase();
  const jiraSummary  = jiraFields.summary || '';

  const project   = jiraProject || PROJECT_KEY || '';
  const issueType = jiraType;
  const status    = jiraStatus;
  const summary   = jiraSummary;

  logger.info(`[Webhook] Event: ${event} | Issue: ${issueKey} | Type: ${issueType} | Status: ${status}`);

  // 2. Filter: only process Stories from the configured project
  if (project.toUpperCase() !== PROJECT_KEY.toUpperCase()) {
    logger.info(`[Webhook] Ignoring — project ${project} ≠ ${PROJECT_KEY}`);
    return res.status(200).json({ action: "ignored", reason: "different project" });
  }
  if (issueType !== "story" && issueType !== "task") {
    logger.info(`[Webhook] Ignoring — issue type "${issueType}" not Story/Task`);
    return res.status(200).json({ action: "ignored", reason: "issue type not story/task" });
  }

  // 3. Determine if we should trigger the pipeline
  let shouldTrigger = false;
  let reason = "";

  switch (event) {
    case "jira:issue_created":
      shouldTrigger = true;
      reason = `New ${issueType} created: ${summary}`;
      break;

    case "jira:issue_updated": {
      // Trigger when the status transitions into a configured trigger status.
      // Jira sends the transition detail in payload.changelog.items.
      const items    = (payload.changelog && payload.changelog.items) || [];
      const statusChange = items.find(i => (i.field || '').toLowerCase() === 'status');
      const newState = (statusChange?.toString || statusChange?.to || status || "").toLowerCase();
      if (TRIGGER_STATUSES.includes(newState) || TRIGGER_STATUSES.includes(status)) {
        shouldTrigger = true;
        reason = `Status changed to "${newState || status}": ${summary}`;
      }
      break;
    }

    case "comment_created":
    case "jira:issue_commented": {
      // Trigger if comment contains /qa-run command
      const commentText = (payload.comment?.body || "").toLowerCase();
      if (commentText.includes("/qa-run")) {
        shouldTrigger = true;
        reason = `/qa-run command in comment`;
      }
      break;
    }

    default:
      logger.info(`[Webhook] Unhandled event: ${event}`);
      return res.status(200).json({ action: "ignored", reason: `unhandled event: ${event}` });
  }

  if (!shouldTrigger) {
    return res.status(200).json({ action: "ignored", reason: "no trigger condition met" });
  }

  // 4. Rate limit
  if (isOnCooldown(issueKey)) {
    logger.warn(`[Webhook] Cooldown active for ${issueKey} — skipping`);
    return res.status(200).json({ action: "throttled", reason: `${issueKey} ran < 5 min ago` });
  }

  // 4b. Concurrency guard — single pipeline at a time
  const active = getActiveLock();
  if (active) {
    logger.warn(`[Webhook] Pipeline busy (pid ${active.pid}, issue ${active.issueKey}) — rejecting ${issueKey}`);
    return res.status(409).json({
      action: "rejected",
      reason: "Pipeline already running",
      incumbent: { pid: active.pid, issueKey: active.issueKey, startedAt: new Date(active.startedAt).toISOString() }
    });
  }

  // 5. Trigger pipeline
  const pid = triggerPipeline(issueKey, reason);

  return res.status(202).json({
    action: "triggered",
    issueKey,
    reason,
    pipelinePid: pid,
    message: `Pipeline started for ${issueKey}`
  });
}

/**
 * POST /api/webhook/manual
 * Manual trigger endpoint (for ad-hoc pipeline runs without a webhook event).
 * Body: { "issueKey": "OHRM-1" }
 */
function handleManualTrigger(req, res) {
  const { issueKey } = req.body || {};
  if (!issueKey) {
    return res.status(400).json({ error: "issueKey is required" });
  }

  if (isOnCooldown(issueKey)) {
    return res.status(200).json({ action: "throttled", reason: `${issueKey} ran < 5 min ago` });
  }

  const active = getActiveLock();
  if (active) {
    return res.status(409).json({
      action: "rejected",
      reason: "Pipeline already running",
      incumbent: { pid: active.pid, issueKey: active.issueKey, startedAt: new Date(active.startedAt).toISOString() }
    });
  }

  const pid = triggerPipeline(issueKey, "Manual API trigger");
  return res.status(202).json({
    action: "triggered",
    issueKey,
    pipelinePid: pid,
    message: `Pipeline started for ${issueKey}`
  });
}

/**
 * GET /api/webhook/status
 * Returns webhook configuration and recent trigger history.
 */
function getWebhookStatus(req, res) {
  const recentEntries = [];
  for (const [key, ts] of _recentRuns) {
    recentEntries.push({ issueKey: key, triggeredAt: new Date(ts).toISOString() });
  }
  recentEntries.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));

  res.json({
    configured: true,
    projectKey: PROJECT_KEY,
    triggerStatuses: TRIGGER_STATUSES,
    cooldownMinutes: COOLDOWN_MS / 60000,
    webhookSecret: process.env.WEBHOOK_SECRET ? "configured" : "not set (no signature validation)",
    recentTriggers: recentEntries.slice(0, 20)
  });
}

module.exports = { handleJiraWebhook, handleManualTrigger, getWebhookStatus };
