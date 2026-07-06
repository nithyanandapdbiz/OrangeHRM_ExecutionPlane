# Decision Register

Architecture Decision Records for the Execution Plane. Each ADR captures one
significant, hard-to-reverse decision: its context, the options, and the choice.
Items that require a human/architectural decision are **documented here, not
silently implemented** — they are ratified before the corresponding work begins.

| ADR | Decision | Status | Related debt |
|-----|----------|--------|--------------|
| [0001](ADR-0001-sovereign-split.md) | Sovereign split (Execution vs Intelligence plane) | Accepted | — |
| [0002](ADR-0002-architecture-consolidation.md) | Consolidate the dual code tree (`src/` vs runtime) | **Proposed** | TD-11 |
| [0003](ADR-0003-quality-gates.md) | CI quality gates (tests + lint) | Accepted | TD-04, TD-07 |
| [0004](ADR-0004-deployment-packaging.md) | Deployment & packaging (Helm/Terraform/supply chain) | Proposed (partial) | TD-16, TD-10 |
| [0005](ADR-0005-async-execution-scale.md) | Async execution & horizontal scale | **Proposed** | TD-12, TD-13 |
| [0006](ADR-0006-inter-plane-trust.md) | Inter-plane trust (mTLS + short-lived tokens) | **Proposed** | TD-09 |
| [0007](ADR-0007-observability.md) | Observability (tracing, metrics, correlation) | **Proposed** | TD-14 |
| [0011](ADR-0011-tenant-owned-ai-execution-context.md) | Tenant-owned AI via ExecutionContext (Model B) | Accepted | — |

## How to ratify

A **Proposed** ADR needs a named owner to choose among its options, update the
**Status** to `Accepted` (recording the chosen option and date), and only then may the
implementation begin. The live status of the underlying work is tracked in
[`../TECH-DEBT.md`](../TECH-DEBT.md); progress is summarised in
[`../PROGRESS.md`](../PROGRESS.md).
