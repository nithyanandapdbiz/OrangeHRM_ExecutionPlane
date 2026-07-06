# ADR-0005 — Asynchronous Execution & Horizontal Scale

- **Status:** Proposed (decision required — NOT implemented)
- **Debt:** TD-12, TD-13

## Context

`POST /run` executes the full pipeline **synchronously**, holding one HTTP connection
for the entire ~16-minute run. Two structural constraints follow:

1. **Single instance (TD-12).** Run state lives in a process-global `inFlight` lock and
   fixed artefact paths (`reports/cucumber-report.json`, `.auth/storage-state.json`).
   A second replica would race and corrupt these — hence `replicaCount: 1` and the
   `Recreate` strategy in the Helm chart.
2. **No resilience (TD-13).** A dropped connection, restart, or timeout loses the run.
   Writes to Jira/Zephyr (test cases, cycles, bugs) are non-idempotent, so a naive retry can
   create duplicates.

## Decisions to ratify

1. **Job model.** Replace the synchronous hold with an accepted-then-polled job:
   `POST /run` → `202 { jobId }`; `GET /run/:jobId` → status/results. Execution moves
   to a worker (in-process queue first, external queue — Azure Storage Queue / Service
   Bus — when multi-instance is needed).
2. **External state.** Move the in-flight lock and artefact storage off the process:
   - Lock → a lease (blob lease / Redis) so any worker can claim a run.
   - Artefacts → per-run directories keyed by `jobId` (then blob storage).
3. **Idempotency.** Derive a deterministic key per Jira/Zephyr write (e.g. `storyKey`+case title)
   and check-before-create so retries are safe.

## Consequences

- Unblocks horizontal scale (removes the `replicaCount: 1` constraint) and gives the
  pipeline an SLA-able, restart-safe execution model.
- Larger change touching `routes/run.js`, the runners' artefact paths, and `clients/alm.client.js`.
  Sequence it after ADR-0002 (consolidation) so it is done once, on the canonical tree.
