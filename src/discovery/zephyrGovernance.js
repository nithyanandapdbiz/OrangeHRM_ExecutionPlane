'use strict';
/**
 * zephyrGovernance.js — Execution-Plane governance wrapper that makes Zephyr
 * Essential the native execution workflow for a Discovery run.
 *
 * SOVEREIGN ROLE. Jira + Zephyr Essential remain the single source of truth for
 * execution history. The Discovery Platform is the execution engine + intelligence
 * provider, never the system of record. This module only MIRRORS the Discovery
 * lifecycle into Zephyr (cycle + execution) and Jira (stage / status / metadata /
 * evidence comments), reusing the existing ALM client — it never duplicates an API
 * client and never persists authoritative execution state locally.
 *
 * ADDITIVE + CONFIG-GATED. When governance is disabled (default) the caller runs
 * the unchanged standalone Discovery lifecycle — see governanceFor().
 *
 * API REALITY. Zephyr Squad Cloud v2 test-executions are create-only (no status
 * PATCH, no attachment endpoint). So:
 *   • the Zephyr CYCLE is created up-front (or reused via config),
 *   • continuous stage / status / metadata / evidence visibility is published as
 *     Jira story COMMENTS (explicitly permitted when Zephyr attachment APIs are
 *     limited), and
 *   • the authoritative Zephyr EXECUTION (Pass / Fail / Blocked) is created at
 *     completion, carrying the full stage timeline + metrics as its comment.
 * Executions are therefore never left "IN PROGRESS" — the terminal execution is
 * written exactly once, at the terminal transition.
 */

const AlmClient = require('../../clients/alm.client');
const logger = require('../utils/logger');

// ── Discovery stage → Zephyr status (per the enterprise workflow spec) ─────────
const STATUS_MAP = {
  queued: 'Not Executed',
  running: 'In Progress',
  crawling: 'In Progress',
  scrubbing: 'In Progress',
  synthesising: 'In Progress',
  downloading: 'In Progress',
  completed: 'Pass',
  failed: 'Fail',
  cancelled: 'Blocked',
};
function mapStatus(discoveryStatus) {
  return STATUS_MAP[discoveryStatus] || 'Not Executed';
}

// ── Human-readable stage labels (EP stages + IP synthesis sub-stages) ──────────
const STAGE_LABELS = {
  queued: 'Queued',
  crawling: 'Crawling',
  scrubbing: 'PII Scrub',
  synthesising: 'Intelligence Synthesis',
  downloading: 'Artifact Upload',
  completed: 'Execution Completed',
  failed: 'Execution Failed',
  cancelled: 'Execution Cancelled',
};
const IP_SUBSTAGE_LABELS = {
  'contract-extract': 'Contract Extraction',
  'app-model-synthesise': 'Knowledge Graph',
  'app-model': 'Knowledge Graph',
  'generate-artefacts': 'POM + Contract Generation',
  'report': 'Report Generation',
  'intelligence': 'Risk + Coverage Intelligence',
};
function stageLabel(stage, detail) {
  if (stage === 'crawling' && detail) return `Crawling — ${detail}`;
  if (stage === 'synthesising' && detail && IP_SUBSTAGE_LABELS[detail]) return IP_SUBSTAGE_LABELS[detail];
  return STAGE_LABELS[stage] || String(stage || '');
}

// ── Config resolution (run-body override > env > default) ──────────────────────
const first = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== '');
function toBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

/**
 * Resolve the governance configuration for a run. `z` is the (untrusted) `zephyr`
 * block from the discovery run body; env fills unset fields. Governance is OFF
 * unless explicitly enabled — preserving current standalone behaviour.
 */
function resolveGovernanceConfig(z = {}, env = process.env) {
  z = z || {};
  return {
    enabled: toBool(z.enabled, false),
    autoCreateCycle: toBool(first(z.autoCreateCycle, env.AUTO_CREATE_CYCLE), true),
    autoCreateExecution: toBool(first(z.autoCreateExecution, env.AUTO_CREATE_EXECUTION), true),
    autoUploadArtifacts: toBool(first(z.autoUploadArtifacts, env.AUTO_UPLOAD_ARTIFACTS), true),
    autoSyncStatus: toBool(first(z.autoSyncStatus, env.AUTO_SYNC_STATUS), true),
    project: first(z.project, env.ZEPHYR_PROJECT, env.JIRA_PROJECT_KEY) || null,
    release: first(z.release, env.ZEPHYR_RELEASE) || null,
    cycle: first(z.cycle, env.ZEPHYR_CYCLE) || null, // existing cycle key → skip create
    folder: first(z.folder, env.ZEPHYR_FOLDER) || null,
    story: first(z.story, env.ZEPHYR_STORY, env.ISSUE_KEY) || null, // Jira issue for comments/links
    environment: first(z.environment, env.DISCOVERY_ENV) || null,
    build: first(z.build, env.DISCOVERY_BUILD) || null,
    browser: first(z.browser, 'chromium'),
    tenant: first(z.tenant, env.TENANT_ID, 'orangehrm'),
    retryPolicy: first(z.retryPolicy, env.ZEPHYR_RETRY_POLICY, 'same-execution'),
  };
}

function shortHost(url) {
  try { return new URL(url).host; } catch { return String(url || 'app'); }
}
function kvBlock(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `• ${k}: ${v}`).join('\n');
}

/**
 * ZephyrGovernance — one instance per Discovery run. Every network op is guarded;
 * a governance failure is logged and swallowed so it can never fail the run.
 */
class ZephyrGovernance {
  constructor(cfg, { alm } = {}) {
    this.cfg = cfg;
    this.alm = alm || new AlmClient();
    this.stages = [];
    this.comments = 0;
    this.cycleKey = cfg.cycle || null;
    this.cycleName = null;
    this.executionKey = null;
    this.executionCaseKey = null;
    this.story = cfg.story || null;
    this.storyOk = false;
    this.zephyrStatus = mapStatus('queued');
    this.evidence = { mode: 'jira-comment', uploaded: false, count: 0 };
    this.retryCount = 0;
    this.startedAt = null;
  }

  /** Serialisable view surfaced to the execution store / CLI dashboard. */
  snapshot() {
    return {
      enabled: true,
      project: this.cfg.project || null,
      story: this.storyOk ? this.story : null,
      cycleKey: this.cycleKey || null,
      cycleName: this.cycleName || null,
      executionKey: this.executionKey || null,
      zephyrStatus: this.zephyrStatus,
      comments: this.comments,
      evidence: { ...this.evidence },
      retryCount: this.retryCount,
      retryPolicy: this.cfg.retryPolicy,
    };
  }

  // ── Lifecycle: Discovery Requested → Create Cycle → Create Execution ─────────
  async begin({ discoveryRunId, baseUrl, browser } = {}) {
    this.discoveryRunId = discoveryRunId;
    this.baseUrl = baseUrl;
    this.startedAt = this._now();
    const browserLabel = browser || this.cfg.browser;

    // Resolve the linked Jira story (also caches its numeric id for Zephyr links).
    if (this.story) {
      try {
        const s = await this.alm.fetchWorkItem(this.story);
        if (s && s.key) { this.story = s.key; this.storyOk = true; }
      } catch (e) { logger.warn(`[zephyr-gov] story ${this.story} unresolved: ${e.message}`); }
    }

    // Create (or reuse) the Zephyr cycle.
    if (this.cfg.autoCreateCycle && !this.cycleKey && this.alm.zephyrEnabled) {
      try {
        const cyc = await this.alm.createTestRun(`Discovery ${shortHost(baseUrl)}`, []);
        this.cycleKey = (cyc && (cyc.key || cyc.id)) || null;
        this.cycleName = (cyc && cyc.name) || null;
      } catch (e) { logger.warn(`[zephyr-gov] cycle create failed: ${e.message}`); }
    }

    this.zephyrStatus = mapStatus('running');
    await this._comment(`🔍 *Discovery execution started*\n${kvBlock([
      ['Discovery Run', discoveryRunId],
      ['Application', baseUrl],
      ['Environment', this.cfg.environment],
      ['Build', this.cfg.build],
      ['Browser', browserLabel],
      ['Tenant', this.cfg.tenant],
      ['Release', this.cfg.release],
      ['Zephyr Cycle', this.cycleKey || '(none)'],
      ['Zephyr Status', this.zephyrStatus],
    ])}`);
    return this.snapshot();
  }

  // ── Stage synchronisation (published as an execution comment on the story) ───
  async syncStage(discoveryStatus, stage, detail) {
    const label = stageLabel(stage, detail);
    const t = this.startedAt ? Math.round((this._now() - this.startedAt) / 1000) : 0;
    this.stages.push({ t, stage, detail: detail || null, label });
    this.zephyrStatus = mapStatus(discoveryStatus);
    if (this.cfg.autoSyncStatus) await this._comment(`▸ ${label}  ·  Zephyr: ${this.zephyrStatus}`);
    return this.snapshot();
  }

  // ── Terminal transitions ─────────────────────────────────────────────────────
  async complete({ metadata, artifactFiles, ipRunId } = {}) {
    return this._finish('completed', { metadata, artifactFiles, ipRunId });
  }
  async fail({ error, artifactFiles, ipRunId } = {}) {
    return this._finish('failed', { error, artifactFiles, ipRunId });
  }
  async cancel({ ipRunId } = {}) {
    return this._finish('cancelled', { ipRunId });
  }

  /** Record a retry per the configured policy (audit history via comment). */
  async retry({ reason, previousExecution } = {}) {
    this.retryCount += 1;
    if (this.cfg.retryPolicy === 'new-execution') this.executionKey = null;
    await this._comment(`🔁 *Retry #${this.retryCount}* (${this.cfg.retryPolicy})\n${kvBlock([
      ['Reason', reason || 'unspecified'],
      ['Previous execution', previousExecution || this.executionKey || '(none)'],
    ])}`);
    return this.snapshot();
  }

  async _finish(discoveryStatus, { metadata = {}, artifactFiles = [], error, ipRunId } = {}) {
    this.zephyrStatus = mapStatus(discoveryStatus);
    const durationMs = this.startedAt ? this._now() - this.startedAt : 0;

    // 1 — Authoritative Zephyr execution: final status + full timeline/metrics comment.
    if (this.cfg.autoCreateExecution && this.cycleKey && this.alm.zephyrEnabled) {
      try {
        const caseKey = await this._ensureExecutionCase();
        if (caseKey) {
          const res = await this.alm.updateTestResults(this.cycleKey, [{
            title: `Discovery ${this.discoveryRunId}`,
            passed: discoveryStatus === 'completed',
            statusName: this.zephyrStatus,
            error: error || '',
            durationMs,
            testCaseKey: caseKey,
            comment: this._executionComment(discoveryStatus, metadata, error, durationMs, ipRunId),
          }]);
          this.executionKey = (res && res.executions && res.executions[0]) || caseKey;
          await this.alm.completeTestRun(this.cycleKey).catch(() => {});
        }
      } catch (e) { logger.warn(`[zephyr-gov] execution sync failed: ${e.message}`); }
    }

    // 2 — Evidence + metadata + final result as a Jira comment (attachment fallback).
    if (this.cfg.autoUploadArtifacts) {
      const posted = await this._comment(this._evidenceComment(discoveryStatus, metadata, artifactFiles, error, durationMs));
      this.evidence = { mode: 'jira-comment', uploaded: posted, count: (artifactFiles || []).length };
    }
    return this.snapshot();
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  _now() { return Date.now(); }

  async _ensureExecutionCase() {
    if (!this.alm.zephyrEnabled) return null;
    if (this.executionCaseKey) return this.executionCaseKey;
    const parentKey = (this.storyOk && this.story) || this.cfg.project;
    try {
      const tc = await this.alm.createTestCase(parentKey, {
        title: `Discovery: ${shortHost(this.baseUrl)} — ${this.discoveryRunId}`,
        objective: 'Automated application discovery run (crawl → knowledge graph → intelligence).',
        tags: ['Discovery', 'Governed'],
      });
      this.executionCaseKey = (tc && (tc.key || tc.id)) || null;
      return this.executionCaseKey;
    } catch (e) {
      logger.warn(`[zephyr-gov] execution test-case create failed: ${e.message}`);
      return null;
    }
  }

  async _comment(text) {
    if (!this.storyOk || !this.story || !text) return false;
    const r = await this.alm.addComment(this.story, text);
    if (r && r.ok) { this.comments += 1; return true; }
    return false;
  }

  _metricsLines(metadata = {}) {
    const m = metadata || {};
    return kvBlock([
      ['Pages', m.routes],
      ['Components', m.components],
      ['APIs / contracts', m.contracts],
      ['Workflows', m.workflows],
      ['Knowledge graph nodes', m.knowledgeGraphNodes],
      ['Knowledge graph edges', m.knowledgeGraphEdges],
      ['Business rules', m.businessRules],
      ['Page objects', m.pageObjects],
      ['Contract tests', m.contractTests],
      ['Coverage', m.coverage != null ? `${m.coverage}%` : undefined],
      ['Risk', m.riskSeverity],
      ['Recommendations', m.recommendations],
    ]);
  }

  _timelineLines() {
    if (!this.stages.length) return '';
    return this.stages.map((s) => `  ${String(s.t).padStart(4)}s  ${s.label}`).join('\n');
  }

  _executionComment(discoveryStatus, metadata, error, durationMs, ipRunId) {
    const head = kvBlock([
      ['Result', this.zephyrStatus],
      ['Discovery Run', this.discoveryRunId],
      ['Intelligence Run', ipRunId],
      ['Duration', `${(durationMs / 1000).toFixed(1)}s`],
    ]);
    const body = [
      `Discovery Execution — ${this.zephyrStatus}`,
      head,
      this._metricsLines(metadata) && `Metrics:\n${this._metricsLines(metadata)}`,
      this._timelineLines() && `Timeline:\n${this._timelineLines()}`,
      error && `Error: ${error}`,
    ].filter(Boolean).join('\n\n');
    return body.slice(0, 2000);
  }

  _evidenceComment(discoveryStatus, metadata, artifactFiles, error, durationMs) {
    const files = (artifactFiles || []).slice(0, 40);
    const evidence = files.length ? files.map((f) => `• ${f}`).join('\n') : '• (none)';
    return [
      discoveryStatus === 'completed'
        ? '✅ *Discovery execution completed*'
        : `❌ *Discovery execution ${discoveryStatus}*`,
      kvBlock([
        ['Zephyr Status', this.zephyrStatus],
        ['Zephyr Cycle', this.cycleKey || '(none)'],
        ['Zephyr Execution', this.executionKey || '(none)'],
        ['Duration', `${(durationMs / 1000).toFixed(1)}s`],
      ]),
      this._metricsLines(metadata) && `*Metrics*\n${this._metricsLines(metadata)}`,
      `*Evidence / Artifacts* (linked — Zephyr attachment API limited)\n${evidence}`,
      error && `*Error*\n${error}`,
    ].filter(Boolean).join('\n\n');
  }
}

/**
 * Factory used by the worker. Returns null when governance is disabled — the
 * caller then runs the unchanged standalone Discovery lifecycle (backward compat).
 * `deps.alm` may be injected for testing.
 */
function governanceFor(body = {}, deps = {}, env = process.env) {
  const cfg = resolveGovernanceConfig(body && body.zephyr, env);
  if (!cfg.enabled) return null;
  return new ZephyrGovernance(cfg, deps);
}

module.exports = {
  ZephyrGovernance,
  governanceFor,
  resolveGovernanceConfig,
  mapStatus,
  stageLabel,
  STATUS_MAP,
};
