# ADR-0016 — Zephyr-Native Governance, Audit & Compliance for Discovery

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Enterprise QA / ALM / Platform architecture
- **Supersedes / extends:** builds on ADR-0012 (Sovereign Discovery Integration)

## Context

Discovery originally ran as a standalone platform workflow. Enterprise QA
governance requires that **every** Discovery execution be represented in the
authoritative ALM systems (Jira + Zephyr Essential) and produce a **complete,
immutable audit record** that a compliance auditor can replay **without** live
access to Jira or Zephyr.

Two hard constraints shaped the design:

1. **Sovereign Split is inviolable.** The Discovery Platform is the execution +
   intelligence engine; Jira + Zephyr Essential remain the single source of truth
   for execution history. Governance must never make Discovery the system of record.
2. **Zephyr Squad Cloud v2 API is limited.** Test-executions are *create-only*
   (no status PATCH, no attachment endpoint). Continuous status/evidence therefore
   cannot live purely in Zephyr.

## Decision

Add an **additive, config-gated** governance layer (`src/discovery/zephyrGovernance.js`)
that mirrors the Discovery lifecycle into Jira + Zephyr and emits a self-contained
audit package. It **reuses the existing ALM client** — no Jira/Zephyr client is
duplicated. When disabled (the default), behaviour is byte-identical to before.

### Lifecycle mirror
`Discovery Requested → Create Zephyr Cycle → stage syncs (Crawling → Knowledge
Graph → Report Generation → Artifact Upload) → terminal Execution (Pass/Fail/
Blocked) → Evidence`. Governance is finalised **before** the run flips terminal so
the polling CLI observes the completed cycle/execution atomically.

### Status mapping
`queued→Not Executed`, `running/crawling/synthesising→In Progress`,
`completed→Pass`, `failed→Fail`, `cancelled→Blocked`.

### Working with the API limits
- The **cycle** is created up-front (or reused via config).
- **Continuous** stage/status/metadata/evidence visibility is published as **Jira
  story comments** (the permitted fallback when Zephyr attachment APIs are limited).
- The **authoritative execution** (Pass/Fail/Blocked) is created **once at the
  terminal transition**, carrying the full stage timeline + metrics as its comment.
  Executions are therefore never left *In Progress*.

### Audit package (persisted with the artefacts)
Produced by the CLI after artefacts are written, so it travels with them:

| File | Purpose |
|---|---|
| `governance.json` | Permanent audit record — runId, ipRunId, tenant, jira, zephyr{cycle,execution,status}, timeline, comments, evidence, metrics, compliance. |
| `evidence.json` | Manifest of every artefact: filename, size, **SHA-256**, generation time, status, location. |
| `audit-report.json` | Immutable, self-contained audit — execution metadata, governance timeline, status history, evidence inventory, comments, metrics, failures, retries, configuration, environment, tenant, versions, hashes, correlation IDs, `packageHash`. |

### Compliance (never fails Discovery)
14 required artefacts are checked. If any is missing, a **warning** is recorded and
governance is marked **PARTIAL** (not PASS); Discovery itself still succeeds. A
failed run is governance **FAIL**. Compliance is a separate axis from the Zephyr
execution status.

### Best-effort
Every Zephyr/Jira op is guarded: a hiccup is logged and swallowed, never failing
the underlying Discovery run.

## Consequences

- **Positive:** every run yields a complete, hash-verified, offline-replayable
  governance package; Jira/Zephyr remain authoritative; zero change to Discovery or
  Intelligence-Plane logic; fully backward compatible; opt-in.
- **Trade-offs:** Zephyr execution status is written once (API is create-only) — the
  fine-grained continuous history lives in Jira comments + `governance.json`, not in
  per-transition Zephyr executions. Evidence is *linked* (Jira comment + local
  manifest with hashes) rather than binary-attached to Zephyr, pending a Jira
  multipart attachment client.
- **Config:** `--zephyr`, `ZEPHYR_GOVERNANCE`, `ZEPHYR_PROJECT/RELEASE/CYCLE/FOLDER/STORY`,
  `AUTO_CREATE_CYCLE/EXECUTION`, `AUTO_UPLOAD_ARTIFACTS`, `AUTO_SYNC_STATUS`,
  or a `zephyr` block in `.discoveryrc.json`.
