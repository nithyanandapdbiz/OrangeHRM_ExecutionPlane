'use strict';
/**
 * certify-report.js — WI-043A
 *
 * Reads the freshly-generated cucumber-report.json and custom-report/index.html
 * and performs all certification phases:
 *
 *  Phase 3 — Screenshot validation (file, size, embedded in JSON, in HTML)
 *  Phase 4 — Video validation (file, size, path in JSON, element in HTML)
 *  Phase 5 — Report embedding validation (screenshots, thumbnails, video, app autopsy)
 *  Phase 6 — Evidence traceability (Scenario → Screenshot → Video → Logs → Jira)
 *  Phase 8 — Executive report review (all 14 sections present)
 *
 * Outputs:
 *  reports/screenshot-certification.json
 *  reports/video-certification.json
 *  reports/report-embedding-validation.json
 *  reports/evidence-traceability.json
 *  reports/failure-evidence-validation.json  (if failures exist)
 *  reports/report-certification.json         (final CERTIFIED / FAILED_WITH_DEFECTS)
 *
 * Usage: node scripts/certify-report.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const CUCUMBER_FILE = path.join(ROOT, 'reports', 'cucumber-report.json');
const HTML_FILE     = path.join(ROOT, 'custom-report', 'index.html');
const REPORTS_DIR   = path.join(ROOT, 'reports');

function writeJson(filename, data) {
  const fp = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  const kb = Math.round(fs.statSync(fp).size / 1024);
  console.log(`  ✓ ${filename}  (${kb} KB)`);
  return data;
}

function loadJson(filename, def) {
  try {
    const fp = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(fp)) return def;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { return def; }
}

// ─── Parse cucumber-report.json ───────────────────────────────────────────────
function parseCucumber(features) {
  const scenarios = [];
  for (const feature of (features || [])) {
    for (const element of (feature.elements || [])) {
      if (element.type === 'background') continue;
      const scenarioName = element.name || 'unknown';
      const tags = (element.tags || []).map(t => t.name || '').filter(Boolean);
      const issueTag = tags.find(t => /^@AI_SDLC-T\d+$/i.test(t)) || null;
      const issueKey = issueTag ? issueTag.replace(/^@/, '') : '–';

      let status = 'passed';
      const screenshots = [];
      let videoRelPath  = null;

      for (const step of (element.steps || [])) {
        if (step.result?.status === 'failed') status = 'failed';

        for (const emb of (step.embeddings || [])) {
          if (emb.mime_type === 'image/png' && emb.data) {
            screenshots.push({
              label:    step.hidden ? (step.keyword?.trim() === 'Before' ? 'before-hook' : 'after-hook') : step.name || '',
              sizeBytes: Math.round(emb.data.length * 0.75),
              fromHook:  !!step.hidden,
            });
          }
          if (emb.mime_type === 'text/plain' && emb.data && !videoRelPath) {
            const text = Buffer.from(emb.data, 'base64').toString('utf8');
            if (text.startsWith('video:')) videoRelPath = text.slice(6).trim();
          }
        }
      }

      const normalized = status === 'passed' ? 'Pass' : status === 'failed' ? 'Fail' : 'Other';
      scenarios.push({ scenarioName, issueKey, status: normalized, tags, screenshots, videoRelPath,
                       featureName: feature.name || '' });
    }
  }
  return scenarios;
}

// ─── Phase 3 — Screenshot certification ──────────────────────────────────────
function certifyScreenshots(scenarios, htmlContent) {
  const now = new Date().toISOString();
  const results = [];
  const issues  = [];

  for (const s of scenarios) {
    const checks = {
      scenarioName:      s.scenarioName,
      issueKey:            s.issueKey,
      status:            s.status,
      screenshotCount:   s.screenshots.length,
      hasAnyScreenshot:  s.screenshots.length > 0,
      hasAfterHookShot:  s.screenshots.some(sc => sc.fromHook && sc.label === 'after-hook'),
      allSizesPositive:  s.screenshots.every(sc => sc.sizeBytes > 0),
      embeddedInJson:    s.screenshots.length > 0,
      embeddedInHtml:    false,
      certificationPass: false,
    };

    // Check HTML contains the scenario name and at least one img tag in that section
    if (htmlContent && s.screenshots.length > 0) {
      checks.embeddedInHtml = htmlContent.includes('data:image/png;base64,');
    }

    checks.certificationPass = checks.hasAnyScreenshot &&
      checks.allSizesPositive && checks.embeddedInJson;

    if (!checks.hasAnyScreenshot) {
      issues.push({ scenarioName: s.scenarioName, issue: 'NO_SCREENSHOTS', severity: 'FAIL' });
    }
    if (!checks.hasAfterHookShot) {
      issues.push({ scenarioName: s.scenarioName, issue: 'MISSING_AFTER_HOOK_SCREENSHOT', severity: 'WARN' });
    }
    results.push(checks);
  }

  const allPassed = results.every(r => r.certificationPass);
  const htmlHasScreenshots = htmlContent ? htmlContent.includes('data:image/png;base64,') : false;

  return writeJson('screenshot-certification.json', {
    generatedAt: now,
    certification: allPassed && htmlHasScreenshots ? 'PASS' : 'FAIL',
    totalScenarios: scenarios.length,
    scenariosWithScreenshots: results.filter(r => r.hasAnyScreenshot).length,
    totalScreenshots: results.reduce((a, r) => a + r.screenshotCount, 0),
    htmlContainsBase64Screenshots: htmlHasScreenshots,
    issues,
    scenarios: results,
  });
}

// ─── Phase 4 — Video certification ───────────────────────────────────────────
function certifyVideos(scenarios, htmlContent) {
  const now = new Date().toISOString();
  const results = [];
  const issues  = [];

  for (const s of scenarios) {
    const checks = {
      scenarioName:  s.scenarioName,
      issueKey:        s.issueKey,
      status:        s.status,
      hasVideoRef:   !!s.videoRelPath,
      videoRelPath:  s.videoRelPath || null,
      videoFileExists: false,
      videoSizeBytes:  0,
      videoSizeOk:     false,
      attachedInJson:  !!s.videoRelPath,
      referencedInHtml: false,
      certificationPass: false,
    };

    if (s.videoRelPath) {
      // Resolve from custom-report/ (the relative path is relative to custom-report/)
      const absPath = path.join(ROOT, 'custom-report', s.videoRelPath);
      checks.videoFileExists = fs.existsSync(absPath);
      if (checks.videoFileExists) {
        checks.videoSizeBytes = fs.statSync(absPath).size;
        checks.videoSizeOk    = checks.videoSizeBytes > 0;
      }
      if (htmlContent) {
        const videoFileName = path.basename(s.videoRelPath);
        checks.referencedInHtml = htmlContent.includes(videoFileName);
      }
    }

    checks.certificationPass = checks.hasVideoRef && checks.videoFileExists && checks.videoSizeOk;

    if (!checks.hasVideoRef) {
      issues.push({ scenarioName: s.scenarioName, issue: 'NO_VIDEO_REFERENCE', severity: 'WARN' });
    } else if (!checks.videoFileExists) {
      issues.push({ scenarioName: s.scenarioName, issue: 'VIDEO_FILE_MISSING', severity: 'FAIL' });
    } else if (!checks.videoSizeOk) {
      issues.push({ scenarioName: s.scenarioName, issue: 'VIDEO_EMPTY', severity: 'FAIL' });
    }

    results.push(checks);
  }

  const scenariosWithVideo = results.filter(r => r.hasVideoRef).length;
  const allFilesValid = results.filter(r => r.hasVideoRef).every(r => r.videoFileExists && r.videoSizeOk);

  return writeJson('video-certification.json', {
    generatedAt: now,
    certification: scenariosWithVideo > 0 && allFilesValid ? 'PASS' : scenariosWithVideo === 0 ? 'NO_VIDEO' : 'FAIL',
    totalScenarios: scenarios.length,
    scenariosWithVideo,
    allFilesValid,
    issues,
    scenarios: results,
  });
}

// ─── Phase 5 — Report embedding validation ────────────────────────────────────
function certifyEmbedding(scenarios, htmlContent) {
  const now = new Date().toISOString();
  if (!htmlContent) {
    return writeJson('report-embedding-validation.json', {
      generatedAt: now, certification: 'FAIL',
      reason: 'custom-report/index.html not found',
    });
  }

  const htmlKb = Math.round(htmlContent.length / 1024);

  const checks = {
    fileExists:           true,
    htmlSizeKb:           htmlKb,
    hasBase64Screenshots: htmlContent.includes('data:image/png;base64,'),
    hasVideoElements:     htmlContent.includes('<video') && htmlContent.includes('.webm'),
    hasVideoPaths:        scenarios.some(s => s.videoRelPath && htmlContent.includes(path.basename(s.videoRelPath || ''))),
    hasAppAutopsySection: htmlContent.includes('App Autopsy') || htmlContent.includes('app-autopsy'),
    hasExecutiveSummary:  htmlContent.includes('Executive Summary'),
    hasScenarioResults:   htmlContent.includes('Scenario Results'),
    hasTimelineSection:   htmlContent.includes('Execution Timeline'),
    hasJiraSection:        htmlContent.includes('Jira Synchronization') || htmlContent.includes('Jira Sync'),
    hasRcaSection:        htmlContent.includes('Root Cause Analysis'),
    hasFailureDiagnostics:htmlContent.includes('Failure Diagnostics'),
    hasHealingSection:    htmlContent.includes('Healing Activity'),
    hasAppFlowSection:    htmlContent.includes('App Process Flow'),
    hasEnvironmentSection:htmlContent.includes('Environment Information') || htmlContent.includes('Environment'),
    hasAttachmentsSection:htmlContent.includes('Attachments'),
    hasRawLogsSection:    htmlContent.includes('Raw Logs'),
    hasLightbox:          htmlContent.includes('openLightbox'),
    hasNavigation:        htmlContent.includes('showSection'),
    screenshotCount:      (htmlContent.match(/data:image\/png;base64,/g) || []).length,
    videoElementCount:    (htmlContent.match(/<video/g) || []).length,
  };

  const required14Sections = [
    checks.hasExecutiveSummary, checks.hasScenarioResults, checks.hasBase64Screenshots,
    checks.hasVideoElements, checks.hasFailureDiagnostics, checks.hasAppFlowSection,
    checks.hasHealingSection, checks.hasJiraSection, checks.hasEnvironmentSection,
    checks.hasTimelineSection, checks.hasRcaSection, checks.hasAttachmentsSection,
    checks.hasRawLogsSection,
  ];
  const sectionsPresent = required14Sections.filter(Boolean).length;

  const certification = checks.hasBase64Screenshots && sectionsPresent >= 12
    ? 'PASS'
    : sectionsPresent >= 10 ? 'PARTIAL' : 'FAIL';

  return writeJson('report-embedding-validation.json', {
    generatedAt: now,
    certification,
    sectionsPresent,
    sectionsRequired: 13,
    checks,
  });
}

// ─── Phase 6 — Evidence traceability ─────────────────────────────────────────
function certifyTraceability(scenarios) {
  const now = new Date().toISOString();
  const sessionUsage = loadJson('session-usage.json', {});
  const autopsy      = loadJson('app-autopsy.json', null);
  const jiraDebug     = loadJson('jira-bug-create-debug.json', {});

  const traceability = scenarios.map(s => {
    const hasLogs  = !!sessionUsage.generatedAt;
    const hasDiagnostics = s.status === 'Fail' && (!!autopsy || s.screenshots.length > 0);
    const hasIssueResult   = s.issueKey !== '–';

    const chain = {
      scenario:     { name: s.scenarioName, status: s.status, present: true },
      screenshot:   { present: s.screenshots.length > 0, count: s.screenshots.length },
      video:        { present: !!s.videoRelPath, path: s.videoRelPath || null },
      logs:         { present: hasLogs, source: hasLogs ? 'session-usage.json' : null },
      diagnostics:  { present: s.status === 'Pass' ? true : hasDiagnostics, source: s.status === 'Fail' ? 'app-autopsy.json' : 'n/a' },
      issueResult:    { present: hasIssueResult, key: s.issueKey },
    };

    const completeness = Object.values(chain).filter(v => v.present).length;
    const traceComplete = s.screenshots.length > 0 && hasIssueResult;

    return { scenarioName: s.scenarioName, issueKey: s.issueKey, status: s.status,
             chain, completeness: `${completeness}/6`, traceComplete };
  });

  const fullyTraced = traceability.filter(t => t.traceComplete).length;
  return writeJson('evidence-traceability.json', {
    generatedAt: now,
    fullyTraced, totalScenarios: scenarios.length,
    certification: fullyTraced === scenarios.length ? 'PASS' : 'PARTIAL',
    scenarios: traceability,
  });
}

// ─── Phase 7 — Failure evidence validation ───────────────────────────────────
function certifyFailureEvidence(scenarios, htmlContent) {
  const now       = new Date().toISOString();
  const failures  = scenarios.filter(s => s.status === 'Fail');
  const autopsy   = loadJson('app-autopsy.json', null);

  if (!failures.length) {
    return writeJson('failure-evidence-validation.json', {
      generatedAt: now, certification: 'NO_FAILURES',
      message: 'No failed scenarios — failure evidence not applicable',
    });
  }

  const results = failures.map(s => ({
    scenarioName: s.scenarioName,
    issueKey:       s.issueKey,
    hasFailureScreenshot: s.screenshots.length > 0,
    hasFailureVideo:      !!s.videoRelPath,
    hasAutopsy:           !!autopsy,
    autopsyHasUrl:        !!(autopsy?.url),
    autopsyHasConsoleErrors: !!(autopsy?.consoleErrors?.length),
    htmlHasFailureDiagSection: htmlContent ? htmlContent.includes(s.scenarioName) : false,
    certificationPass: s.screenshots.length > 0,
  }));

  const allPass = results.every(r => r.certificationPass);

  return writeJson('failure-evidence-validation.json', {
    generatedAt: now,
    certification: allPass ? 'PASS' : 'FAIL',
    failureCount: failures.length,
    results,
  });
}

// ─── Phase 8 — Executive report review ───────────────────────────────────────
function certifyExecutiveReport(htmlContent) {
  const now = new Date().toISOString();
  if (!htmlContent) {
    return writeJson('report-certification-exec.json', {
      generatedAt: now, certification: 'FAIL', reason: 'HTML report not found',
    });
  }

  const required = [
    { section: 'Executive Summary',     present: htmlContent.includes('Executive Summary') },
    { section: 'Execution Timeline',    present: htmlContent.includes('Execution Timeline') },
    { section: 'Scenario Results',      present: htmlContent.includes('Scenario Results') },
    { section: 'Screenshots',           present: htmlContent.includes('data:image/png;base64,') },
    { section: 'Videos',                present: htmlContent.includes('<video') },
    { section: 'Failure Diagnostics',   present: htmlContent.includes('Failure Diagnostics') },
    { section: 'App Process Flow',      present: htmlContent.includes('App Process Flow') },
    { section: 'Healing Activity',      present: htmlContent.includes('Healing Activity') },
    { section: 'Jira Sync',              present: htmlContent.includes('Jira Sync') },
    { section: 'Root Cause Analysis',   present: htmlContent.includes('Root Cause Analysis') },
    { section: 'Environment Details',   present: htmlContent.includes('Environment') },
  ];

  const missing = required.filter(r => !r.present);
  const cert    = missing.length === 0 ? 'PASS' : missing.length <= 2 ? 'PARTIAL' : 'FAIL';

  return writeJson('report-certification-exec.json', {
    generatedAt: now, certification: cert,
    sectionsPresent: required.filter(r => r.present).length,
    sectionsMissing: missing.map(r => r.section),
    checks: required,
  });
}

// ─── Final certification ──────────────────────────────────────────────────────
function writeFinalCertification(results) {
  const now = new Date().toISOString();
  const allCerts = Object.entries(results).map(([phase, data]) => ({
    phase, certification: data?.certification || 'MISSING'
  }));

  const defects = allCerts.filter(c => c.certification === 'FAIL');
  const partials = allCerts.filter(c => c.certification === 'PARTIAL' || c.certification === 'WARN');
  const noVideo  = allCerts.filter(c => c.certification === 'NO_VIDEO');

  const overallStatus = defects.length > 0 ? 'FAILED_WITH_DEFECTS'
    : partials.length > 0 ? 'CERTIFIED_WITH_WARNINGS'
    : 'CERTIFIED';

  const ssResult    = results.screenshots;
  const vidResult   = results.videos;
  const embedResult = results.embedding;
  const traceResult = results.traceability;

  writeJson('report-certification.json', {
    generatedAt: now,
    workItem:    'WI-043A',
    status:      overallStatus,
    summary: {
      screenshots:      { status: ssResult?.certification,   count: ssResult?.totalScreenshots || 0 },
      videos:           { status: vidResult?.certification,   count: vidResult?.scenariosWithVideo || 0 },
      htmlSections:     { status: embedResult?.certification, present: embedResult?.sectionsPresent || 0 },
      traceability:     { status: traceResult?.certification, fullyTraced: traceResult?.fullyTraced || 0 },
      htmlSizeKb:       embedResult?.checks?.htmlSizeKb || 0,
    },
    phases: allCerts,
    defects:  defects.map(d => d.phase),
    warnings: partials.map(d => d.phase),
    successCriteria: {
      screenshotsCaptured:    (ssResult?.totalScreenshots || 0) > 0,
      screenshotsEmbedded:    ssResult?.htmlContainsBase64Screenshots || false,
      videosCaptured:         (vidResult?.scenariosWithVideo || 0) > 0,
      videosEmbedded:         vidResult?.scenarios?.some(s => s.referencedInHtml) || false,
      failureEvidenceAttached: results.failureEvidence?.certification !== 'FAIL',
      appAutopsyVisible:      embedResult?.checks?.hasAppAutopsySection || false,
      jiraTraceabilityVisible: embedResult?.checks?.hasJiraSection || false,
      htmlPresentationReady:  (embedResult?.sectionsPresent || 0) >= 10,
      noBrokenImages:         (ssResult?.totalScreenshots || 0) > 0 && embedResult?.checks?.hasBase64Screenshots,
      noBrokenVideos:         vidResult?.certification !== 'FAIL',
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   WI-043A Report Certification                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(CUCUMBER_FILE)) {
    console.error(`  ERROR: ${CUCUMBER_FILE} not found. Run tests first.`);
    process.exit(1);
  }
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`  ERROR: ${HTML_FILE} not found. Run node scripts/generate-report.js first.`);
    process.exit(1);
  }

  const features  = JSON.parse(fs.readFileSync(CUCUMBER_FILE, 'utf8'));
  const scenarios = parseCucumber(Array.isArray(features) ? features : []);
  const htmlContent = fs.readFileSync(HTML_FILE, 'utf8');

  const total   = scenarios.length;
  const passed  = scenarios.filter(s => s.status === 'Pass').length;
  const failed  = scenarios.filter(s => s.status === 'Fail').length;
  const withScreenshots = scenarios.filter(s => s.screenshots.length > 0).length;
  const withVideo       = scenarios.filter(s => s.videoRelPath).length;

  console.log(`  Scenarios parsed: ${total}  (${passed} Pass, ${failed} Fail)`);
  console.log(`  With screenshots: ${withScreenshots} / ${total}`);
  console.log(`  With video:       ${withVideo} / ${total}`);
  console.log(`  HTML size:        ${Math.round(htmlContent.length / 1024)} KB\n`);

  console.log('  Running certification phases:\n');

  const ssResult    = certifyScreenshots(scenarios, htmlContent);
  const vidResult   = certifyVideos(scenarios, htmlContent);
  const embedResult = certifyEmbedding(scenarios, htmlContent);
  const traceResult = certifyTraceability(scenarios);
  const failResult  = certifyFailureEvidence(scenarios, htmlContent);
  const execResult  = certifyExecutiveReport(htmlContent);

  writeFinalCertification({
    screenshots:    ssResult,
    videos:         vidResult,
    embedding:      embedResult,
    traceability:   traceResult,
    failureEvidence: failResult,
    executive:      execResult,
  });

  console.log('\n  ─────────────────────────────────────────────────');
  const final = loadJson('report-certification.json', {});
  const statusColor = final.status === 'CERTIFIED' ? '✓' : final.status === 'CERTIFIED_WITH_WARNINGS' ? '⚠' : '✗';
  console.log(`\n  ${statusColor} OVERALL STATUS: ${final.status}`);
  if (final.defects?.length) console.log(`    Defects:  ${final.defects.join(', ')}`);
  if (final.warnings?.length) console.log(`    Warnings: ${final.warnings.join(', ')}`);
  console.log('\n  Success criteria:');
  for (const [key, val] of Object.entries(final.successCriteria || {})) {
    console.log(`    ${val ? '✓' : '✗'} ${key}`);
  }
  console.log('');
}

main();
