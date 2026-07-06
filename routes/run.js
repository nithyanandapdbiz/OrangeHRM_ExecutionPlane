'use strict';
/**
 * POST /run — Full QA pipeline
 *
 * Body: { issueKey }   e.g. { "issueKey": "OHRM-1" }
 *
 * Steps:
 *   1. Fetch story from Jira (OrangeHRM tenant)
 *   2. PII-scrub the story (inline in IntelligenceClient._call)
 *   3. Call DBiz Intelligence API pipeline (scrubbed payload + JWT)
 *   4. Write generated test cases back to Zephyr Essential (OrangeHRM tenant)
 *   5. Run Playwright/Cucumber tests against the OrangeHRM React web app (creds stay local)
 *   6. Sync results to Zephyr + create defects in Jira (OrangeHRM tenant)
 *
 * DBiz sees at step 3: { storyId, storyTitle (scrubbed), storyDescription (scrubbed) }
 * DBiz NEVER sees: Jira API token, Zephyr token, app credentials, Playwright results, screenshots.
 *
 * Provider isolation: this orchestrator depends only on the AlmClient facade
 * (clients/alm.client.js), never on Jira/Zephyr directly.
 */
const AlmClient          = require('../clients/alm.client');
const IntelligenceClient = require('../clients/intelligence.client');
const playwrightRunner   = require('../runners/playwright.runner');
const nonFunctional      = require('../runners/nonfunctional.runner');
const { apiAuth }        = require('../middleware/apiAuth');
const logger             = require('../lib/logger');
const config             = require('../config/customer.json');

// Plain-text formatter for AI/user-generated text embedded in a Jira bug (ADF is
// built by the Jira client from newline-delimited paragraphs).
const asText = (s) => String(s ?? '');

module.exports = (app) => {
  // The pipeline writes shared, single-instance artefacts (reports/cucumber-report.json,
  // custom-report/*, .auth/storage-state.json). Concurrent runs corrupt them, so only
  // one /run may execute at a time — overlapping requests are rejected with 409.
  let inFlight = false;
  let inFlightRunId = null;

  app.post('/run', apiAuth, async (req, res) => {
    const { issueKey } = req.body;
    if (!issueKey) return res.status(400).json({ error: 'issueKey is required' });

    if (inFlight) {
      logger.warn(`[Pipeline] Rejected concurrent /run (busy with ${inFlightRunId})`);
      return res.status(409).json({
        error: 'A pipeline run is already in progress — wait for it to finish before starting another',
        busyRunId: inFlightRunId,
      });
    }

    const start  = Date.now();
    const runId  = `run-${issueKey}-${Date.now()}`;
    const timeline = [];
    const ts = () => new Date().toISOString();

    inFlight = true;
    inFlightRunId = runId;
    require('../lib/childLog').reset(); // fresh child-output log for this run's trace

    logger.info('═'.repeat(65));
    logger.info(`[Pipeline] START  issueKey=${issueKey}  runId=${runId}`);
    logger.info(`[Pipeline] Customer: ${config.customerName}  |  AI credential: NOT PRESENT (provider-agnostic)`);
    logger.info('═'.repeat(65));

    let alm, intel;
    try {
      alm   = new AlmClient();
      intel = new IntelligenceClient({ correlationId: runId }); // propagate runId to the IP (ADR-0007)
    } catch (e) {
      inFlight = false; inFlightRunId = null;
      return res.status(503).json({ error: `Initialisation failed: ${e.message}` });
    }

    try {
      // ── Step 1: Fetch story from Jira (Customer tenant) ────────────────────
      timeline.push({ step: 1, label: 'fetch-story', start: ts() });
      logger.info(`[Pipeline] Step 1/6 — Fetching story from Jira`);
      const story = await alm.fetchWorkItem(issueKey);
      timeline[0].end = ts();
      logger.info(`[Pipeline] Step 1 done — "${story.title}" (${story.key})`);

      // ── Step 2+3: Intelligence API pipeline (PII-scrubbed) ─────────────────
      // PII scrub runs inside intelligence.client._call() before transmission
      timeline.push({ step: 2, label: 'intelligence-pipeline', start: ts() });
      logger.info(`[Pipeline] Step 2/6 — Calling DBiz Intelligence API (PII-scrubbed payload)`);
      const intelResult = await intel.pipeline(story.key, story.title, story.description, config.domain);

      if (!intelResult.success) {
        const code = intelResult.status === 401 ? 401 : intelResult.status === 403 ? 403 : 502;
        return res.status(code).json({
          error:   intelResult.reason,
          blocked: intelResult.blocked ?? false,
          step:    'intelligence-pipeline',
          runId,
        });
      }
      timeline[1].end = ts();
      const { plan, testCases, compliance, security, review, agents } = intelResult.data;
      const tcArray = Array.isArray(testCases?.testCases) ? testCases.testCases
                    : Array.isArray(testCases)             ? testCases : [];
      // DBiz returns releaseGate as an object { verdict, reason } where verdict ∈ PASS|CONDITIONAL|BLOCKED
      const gateVerdict = compliance?.releaseGate?.verdict ?? compliance?.releaseGate ?? 'UNKNOWN';
      const gateReason  = compliance?.releaseGate?.reason ?? '';

      // Surface each Intelligence-Plane agent's contribution in the trace.
      if (agents) {
        logger.info(`[IntelAgents] planner          → ${agents.planner?.testTypes ?? '?'} test types`);
        logger.info(`[IntelAgents] qa.generate      → ${agents.qa?.generated ?? '?'} raw test cases`);
        logger.info(`[IntelAgents] reviewer (dedup) → ${agents.reviewer?.kept ?? '?'} kept, ${agents.reviewer?.removedDuplicates ?? 0} duplicates removed`);
        const d = agents.riskPrioritizer?.distribution || {};
        logger.info(`[IntelAgents] riskPrioritizer  → ${agents.riskPrioritizer?.prioritized ?? '?'} prioritized (High=${d.High || 0} Normal=${d.Normal || 0} Low=${d.Low || 0})`);
        logger.info(`[IntelAgents] compliance       → gate ${agents.compliance?.gate ?? gateVerdict}`);
        logger.info(`[IntelAgents] security         → ${agents.security?.threats ?? 0} threats`);
      } else {
        logger.info(`[IntelAgents] (legacy response — per-agent summary not provided by Intelligence Plane)`);
      }
      logger.info(`[Pipeline] Step 2 done — ${tcArray.length} test cases, compliance gate=${gateVerdict}`);

      // Compliance hard block — stop before creating work items or running Playwright
      if (gateVerdict === 'BLOCKED') {
        logger.warn(`[Pipeline] COMPLIANCE BLOCK — release gate verdict=BLOCKED, halting pipeline — ${gateReason}`);
        return res.status(200).json({
          success:        false,
          halted:         true,
          haltReason:     'COMPLIANCE_BLOCK',
          issueKey,
          runId,
          storyTitle:     story.title,
          complianceGate: { verdict: gateVerdict, reason: gateReason },
          complianceReason: gateReason,
          compliance,
          message:        `Release gate = BLOCKED — fix compliance issues before re-running${gateReason ? ` (${gateReason})` : ''}`,
          timeline,
        });
      }

      // ── Step 2b: Non-functional intelligence (performance + pentest agents) ──
      // Runs the IP's performance.agent + pentest.agent on the (PII-scrubbed) story.
      // Advisory plans surfaced in the trace; actual execution stays Customer-side.
      let perfPlan = null, pentestPlan = null;
      try {
        const [pf, pt] = await Promise.all([
          intel.performance(story.key, story.title, story.description, config.domain),
          intel.pentest(story.key, story.title, story.description, config.domain),
        ]);
        perfPlan    = pf?.success ? (pf.data?.performance ?? null) : null;
        pentestPlan = pt?.success ? (pt.data?.pentest ?? null) : null;
        if (perfPlan)    logger.info(`[IntelAgents] performance     → perfRequired=${perfPlan.perfRequired} types=${(perfPlan.testTypes || []).join('/') || 'none'} p95<=${perfPlan.thresholds?.p95 ?? '?'}ms`);
        if (pentestPlan) logger.info(`[IntelAgents] pentest         → tools=${(pentestPlan.toolsRequired || []).join(',') || 'none'} risk=${pentestPlan.riskLevel ?? '?'}`);
      } catch (e) {
        logger.warn(`[Pipeline] Non-functional intelligence non-fatal: ${e.message}`);
      }

      // ── Step 3: Write test cases to Zephyr Essential (Customer tenant) ─────
      timeline.push({ step: 3, label: 'create-test-cases', start: ts() });
      logger.info(`[Pipeline] Step 3/6 — Writing ${tcArray.length} test cases to Zephyr Essential`);
      const zephyrTestCases = await alm.batchCreateTestCases(story.key, tcArray);
      timeline[2].end = ts();
      logger.info(`[Pipeline] Step 3 done — ${zephyrTestCases.length} test cases created in Zephyr`);

      // ── Step 4: Create Zephyr test cycle ───────────────────────────────────
      timeline.push({ step: 4, label: 'create-test-cycle', start: ts() });
      logger.info(`[Pipeline] Step 4/6 — Creating Zephyr test cycle`);
      const testCycle = await alm.createTestRun(story.title, zephyrTestCases.map(t => t.key))
        .catch(e => { logger.warn(`[Pipeline] Could not create test cycle: ${e.message}`); return { id: null, key: null }; });
      timeline[3].end = ts();

      // ── Step 5: Run Playwright (Customer tenant only) ──────────────────────
      timeline.push({ step: 5, label: 'playwright', start: ts() });
      logger.info(`[Pipeline] Step 5/6 — Running Playwright against the OrangeHRM app (Customer tenant — DBiz not involved)`);
      const pwResult = await playwrightRunner.run();
      timeline[4].end = ts();
      for (const r of (pwResult.results || [])) {
        const firstLine = (r.error || '').split('\n')[0].slice(0, 140);
        logger.info(`[BDD]   ${r.passed ? '✓ PASS' : '✗ FAIL'}  ${r.title}${r.passed ? '' : ` — ${firstLine}`}`);
      }
      logger.info(`[Pipeline] Step 5 done — ${pwResult.passed}/${pwResult.total} passed`);

      // ── Step 6: Sync results + create bugs ────────────────────────────────
      timeline.push({ step: 6, label: 'sync-results', start: ts() });
      logger.info(`[Pipeline] Step 6/6 — Syncing results to Zephyr + Jira`);

      let syncSummary = { ok: false, synced: 0 };
      if (testCycle.key) {
        // Map each Playwright result to its Zephyr test case by TITLE (stable), not array
        // position — scenario execution order does not match creation order.
        const byTitle = new Map(zephyrTestCases.map(tc => [String(tc.title).trim(), tc.key]));
        let unmatched = 0;
        const mappedResults = pwResult.results.map((r, i) => {
          const key = byTitle.get(String(r.title).trim()) ?? zephyrTestCases[i]?.key ?? null;
          if (key == null) unmatched++;
          return { ...r, testCaseKey: key };
        });
        if (unmatched) logger.warn(`[Pipeline] ${unmatched} Playwright result(s) could not be matched to a Zephyr test case`);
        syncSummary = await alm.updateTestResults(testCycle.key, mappedResults);
        await alm.completeTestRun(testCycle.key);
      } else {
        logger.warn(`[Pipeline] No Zephyr test cycle — result sync skipped`);
      }

      const failures = pwResult.results.filter(r => !r.passed);
      const bugLimit = config.pipeline?.bugCreateLimit ?? 10;
      const bugs     = [];
      for (const f of failures.slice(0, bugLimit)) {
        const bug = await alm.createBug(
          f.title,
          `Error: ${asText(f.error || 'Unknown')}\n\nDuration: ${asText(f.durationMs)}ms\n\nFile: ${asText(f.file || 'N/A')}`,
          story.key,
        );
        if (bug) bugs.push(bug);
      }
      timeline[5].end = ts();
      logger.info(`[Pipeline] Step 6 done — ` +
        `${syncSummary.ok ? `${syncSummary.synced} results synced (${syncSummary.passed} Pass / ${syncSummary.failed} Fail) → cycle ${testCycle.key}` : 'result sync failed/skipped'}` +
        `, ${bugs.length} bug(s) created`);

      // ── Step 7: Performance (k6 — sanctioned public target, never the live app/DBiz) ─
      let performance = { ran: false };
      try {
        timeline.push({ step: 7, label: 'performance', start: ts() });
        logger.info(`[Pipeline] Step 7/9 — Performance (k6, sanctioned target)`);
        performance = await nonFunctional.runPerformance({ story: issueKey });
        timeline[timeline.length - 1].end = ts();
        logger.info(`[Pipeline] Step 7 done — ${performance.ran ? `${performance.passed}/${performance.scriptsRun} passed` : 'skipped (' + performance.skipped + ')'}`);
      } catch (e) {
        logger.warn(`[Pipeline] Step 7 performance non-fatal error: ${e.message}`);
        timeline[timeline.length - 1].end = ts();
        performance = { ran: false, error: e.message };
      }

      // ── Step 8: Security (custom HTTP checks — sanctioned vulnerable target) ─
      let securityScan = { ran: false };
      try {
        timeline.push({ step: 8, label: 'security', start: ts() });
        logger.info(`[Pipeline] Step 8/9 — Security (custom checks, sanctioned target)`);
        securityScan = await nonFunctional.runSecurity({ story: issueKey });
        timeline[timeline.length - 1].end = ts();
        logger.info(`[Pipeline] Step 8 done — ${securityScan.ran ? `${securityScan.totalFindings} findings, verdict ${securityScan.verdict}` : 'skipped (' + securityScan.skipped + ')'}`);
      } catch (e) {
        logger.warn(`[Pipeline] Step 8 security non-fatal error: ${e.message}`);
        timeline[timeline.length - 1].end = ts();
        securityScan = { ran: false, error: e.message };
      }

      // ── Step 9: Collect report artefacts (functional/perf/security HTML) ─────
      timeline.push({ step: 9, label: 'reports', start: ts() });
      const reports = nonFunctional.collectReports();
      timeline[timeline.length - 1].end = ts();
      logger.info(`[Pipeline] Step 9 done — reports: ` +
        `functional=${reports.functional.generated} perf=${reports.performance.generated} security=${reports.security.generated}`);

      const totalDuration = ((Date.now() - start) / 1000).toFixed(1);

      logger.info('═'.repeat(65));
      logger.info(`[Pipeline] COMPLETE  runId=${runId}  duration=${totalDuration}s`);
      logger.info(`[Pipeline]   Test cases generated : ${zephyrTestCases.length}`);
      logger.info(`[Pipeline]   Tests passed         : ${pwResult.passed}/${pwResult.total}`);
      logger.info(`[Pipeline]   Bugs created         : ${bugs.length}`);
      logger.info(`[Pipeline]   Compliance gate      : ${gateVerdict}`);
      logger.info(`[Pipeline]   PII sent to DBiz     : ZERO`);
      logger.info('═'.repeat(65));

      return res.json({
        success:    true,
        runId,
        issueKey,
        storyKey:   story.key,
        storyTitle: story.title,
        duration:   `${totalDuration}s`,
        intelligence: {
          planTestTypes:      plan?.testTypes?.length ?? 0,
          testCasesGenerated: tcArray.length,
          complianceGate:     { verdict: gateVerdict, reason: gateReason },
          complianceReason:   gateReason,
          reviewApproved:     review?.approved ?? null,
          duplicatesRemoved:  review?.removedDuplicates ?? agents?.reviewer?.removedDuplicates ?? null,
          threatsFound:       security?.threats?.length ?? 0,
          agents:             agents ?? null,
          nonFunctionalPlans: { performance: perfPlan, pentest: pentestPlan },
        },
        jira: {
          storyKey:    story.key,
          bugsCreated: bugs.length,
          bugs,
        },
        zephyr: {
          testCasesCreated: zephyrTestCases.length,
          testCycleKey:     testCycle.key,
          resultsSynced:    syncSummary.synced ?? 0,
        },
        playwright: {
          total:    pwResult.total,
          passed:   pwResult.passed,
          failed:   pwResult.failed,
          duration: pwResult.duration,
          results:  pwResult.results,
          reportPath: pwResult.reportPath,
        },
        performance,
        securityScan,
        reports,
        sovereign: {
          piiSentToDBiz:            false,
          customerCredsSentToDBiz:  false,
          fieldsRedactedBeforeSend: intelResult.fieldsRedacted ?? [],
        },
        timeline,
      });

    } catch (e) {
      // Intelligence API auth/tier/rate errors are already handled above via
      // intelResult.success (the client never throws on them). A thrown error here
      // is an unexpected local failure (Jira, Zephyr, Playwright, etc.) — surface as
      // 500 with the upstream status for context rather than mislabelling it.
      const upstream = e.response?.status ?? e.status;
      logger.error(`[Pipeline] ERROR  runId=${runId}  ${e.message}${upstream ? ` (upstream ${upstream})` : ''}`);
      return res.status(500).json({ error: e.message, upstreamStatus: upstream ?? null, runId, timeline });
    } finally {
      inFlight = false;
      inFlightRunId = null;
    }
  });
};
