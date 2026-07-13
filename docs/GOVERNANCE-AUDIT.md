# Discovery Governance, Audit & Compliance

Zephyr Essential is the **native execution workflow** for every governed Discovery
run, and each run produces a complete, immutable **audit package**. This layer is
**additive and opt-in** — with governance disabled, Discovery behaves exactly as it
did before.

> **Sovereign role.** Jira + Zephyr Essential remain the single source of truth for
> execution history. The Discovery Platform is the execution + intelligence engine,
> never the authoritative test-management system.

## Enable

```bash
# CLI flag
npm run discovery -- --zephyr --zephyr-story ORHRM-42

# or .discoveryrc.json
{ "zephyr": { "enabled": true, "story": "ORHRM-42", "project": "ORHRM" } }

# or environment
ZEPHYR_GOVERNANCE=true ZEPHYR_STORY=ORHRM-42 npm run discovery
```

| Config | Meaning | Default |
|---|---|---|
| `enabled` / `--zephyr` / `ZEPHYR_GOVERNANCE` | Turn governance on | `false` |
| `story` / `--zephyr-story` / `ZEPHYR_STORY` / `ISSUE_KEY` | Jira issue for comments + linkage | — |
| `project` / `ZEPHYR_PROJECT` | Jira/Zephyr project key | `JIRA_PROJECT_KEY` |
| `cycle` / `ZEPHYR_CYCLE` | Reuse an existing cycle (skip create) | — |
| `release` / `folder` | Zephyr release / folder | — |
| `AUTO_CREATE_CYCLE` / `AUTO_CREATE_EXECUTION` | Auto-create cycle / execution | `true` |
| `AUTO_UPLOAD_ARTIFACTS` / `AUTO_SYNC_STATUS` | Evidence comment / stage comments | `true` |

The **EP owns the Jira/Zephyr credentials** (`.env`); the CLI only forwards flags.

## Lifecycle

```
Discovery Requested → Create Zephyr Cycle → (crawl) → stage syncs
   → Knowledge Graph → Report Generation → Artifact Upload
   → Terminal Zephyr Execution (Pass/Fail/Blocked) → Evidence → Final Result
```

Governance is finalised **before** the run flips terminal, so the polling CLI sees
the completed cycle/execution atomically. **Status mapping:** `queued→Not Executed`,
`running→In Progress`, `completed→Pass`, `failed→Fail`, `cancelled→Blocked`.

## Working within the Zephyr API

Zephyr Squad Cloud v2 executions are **create-only** (no status PATCH, no attachment
API). Therefore:

- the **cycle** is created up-front (or reused via config),
- **continuous** stage/status/metadata/evidence is published as **Jira story
  comments** (structured Markdown — stage table + Discovery summary),
- the **authoritative execution** is created **once at the terminal transition**,
  carrying the full stage timeline + metrics as its comment — never left *In Progress*.

## Audit package (persisted with the artefacts)

Written into `artifacts/discovery/<runId>/`:

- **`governance.json`** — runId, ipRunId, tenant, jira, `zephyr{cycle,execution,status}`,
  `governanceResult`, timeline, comments, evidence, metrics, compliance.
- **`evidence.json`** — every artefact: `filename, size, sha256, generatedAt, status, location`.
- **`audit-report.json`** — execution metadata, governance timeline, status history,
  evidence inventory, comments, metrics, failures, retries, configuration, environment,
  tenant, versions, per-file hashes, `packageHash`, correlation IDs.

A compliance auditor can reconstruct the entire run from these three files **without
touching live Jira or Zephyr**.

## Timeline

Every lifecycle event is recorded with `ts` (ISO), `elapsedMs`, `actor`, `stage`,
`event`, `result` — e.g. *Discovery Requested → Zephyr Cycle Created → Crawling →
Knowledge Graph → Report Generation → Evidence Uploaded → PASS*. Surfaced in the CLI
dashboard, `governance.json`, `audit-report.json`, and the Jira comment.

## Compliance (Phase 8)

14 required artefacts are verified (4 reports, Discovery HTML, Knowledge Graph,
Navigation Graph, Coverage, Risk, Business Rules, Recommendations, POMs, Contracts,
Contract Tests). **Missing artefacts never fail Discovery** — a warning is recorded
and governance is marked **PARTIAL** instead of **PASS**. A failed run is **FAIL**.

## CLI dashboard

```
══════════════════════════════════════
  Governance
    Jira            Linked (ORHRM-42)
    Zephyr Cycle    Created (ORHRM-R47)
    Execution       Pass (ORHRM-E12)
    Evidence        Uploaded (17 files)
    Comments        Updated (12)
    Timeline        Stored (16 events)
    Compliance      PASS
    Governance      PASS
    Duration        3.2s
    Audit package   governance.json · evidence.json · audit-report.json
══════════════════════════════════════
```

`--ci` adds a `governance` block to the JSON output (`result`, `evidenceFiles`, `files`).

## Failure & recovery behaviour

- **Governance is best-effort.** A Zephyr/Jira error is logged and swallowed — it
  never fails the Discovery run.
- **On Discovery failure**, the Zephyr execution is written as **Fail** with the error
  in its comment (never left *In Progress*), and a failure comment is posted.
- **Retries** are recorded (count, reason, previous execution) per `retryPolicy`
  (`same-execution` | `new-execution`) for a full audit history.
- **Governance disabled** → none of the above runs; behaviour is identical to before.
