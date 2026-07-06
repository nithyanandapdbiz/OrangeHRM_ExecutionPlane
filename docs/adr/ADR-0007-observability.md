# ADR-0007 — Observability (Tracing, Metrics, Correlation)

- **Status:** Proposed (decision required — NOT implemented)
- **Debt:** TD-14

## Context

Today's observability is structured `winston` logs plus a per-request `requestId`
(`server.js`) and a live multi-log trace in `scripts/trigger.js`. There is **no**
distributed tracing, no metrics, and the `requestId` is **not propagated to the
Intelligence Plane**, so a single logical run cannot be followed end-to-end across the
two planes. Mean-time-to-resolution is therefore unbounded.

## Decisions to ratify

1. **Correlation across planes (smallest first step).** ✅ *Implemented* — the pipeline
   `runId` is propagated as `X-Request-Id` from `intelligence.client.js` on every IP call
   (`new IntelligenceClient({ correlationId: runId })`), contract-tested. **Still to do:**
   have the IP echo/adopt the header and align on `traceparent` once OTel lands.
2. **OpenTelemetry.** Adopt OTel SDK for traces + metrics, exporting to the customer's
   backend (Azure Monitor / OTLP collector). Instrument the pipeline steps as spans.
3. **Metrics + SLOs.** Emit run duration, step durations, pass/fail counts, Jira/Zephyr sync
   outcomes, and PII-redaction counts; define SLOs (run success rate, p95 duration).

## Consequences

- End-to-end traceability across EP↔IP; actionable MTTR.
- Step 1 (header propagation) is a *Ready* slice; steps 2–3 add a dependency and an
  exporter endpoint (external infrastructure) and should follow ADR-0002.
- Must preserve the sovereign boundary: traces/metrics emitted from the EP must carry
  **no PII** — reuse the existing scrubber discipline for any span attributes.
