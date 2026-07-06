# ADR-0001 — Sovereign-Split Two-Plane Architecture

- **Status:** Accepted
- **Context date:** captured retroactively from the implemented system

## Context

Enterprises in regulated domains (human-resources, healthcare, banking) cannot allow customer PII or
production credentials to reach an external AI provider. Yet AI-driven test generation, compliance analysis,
and risk prioritisation require a capable LLM. These two facts are in direct tension.

## Decision

Split the platform into two independently deployed planes:

- **Execution Plane (this repo)** — runs **inside the customer tenant**. Holds all secrets (Jira API token,
  Zephyr token, OrangeHRM app credentials, tenant JWT) and all customer data. Performs orchestration and
  test execution. **May not hold any raw AI-provider credential** — enforced at boot by
  `middleware/startup-guard` and
  `docker-entrypoint.sh`, which exit the process if any such credential is present.
- **Intelligence Plane (separate repo/tenant)** — holds the LLM key and runs all AI agents. Receives
  **only PII-scrubbed** story text over JWT-authenticated HTTPS and re-guards its responses.

PII is scrubbed by `middleware/pii-scrubber` before any byte crosses the boundary.

## Consequences

**Positive**
- Customer data and credentials never reach the AI provider — a verifiable, audit-legible control.
- The boundary is the product's principal differentiator and the basis of its compliance story.

**Negative / debt**
- The boundary is currently enforced in **application code**, not in **identity/network** (no mTLS,
  no short-lived audience-scoped tokens). Hardening to identity-trust is required for production.
- Adds a network hop and a synchronous long call (~minutes) to every run.

## Status of enforcement (honest)

✅ Boot-time credential ban (all major providers + proxies). ✅ PII scrub + independent guard.
⚠️ Transport is bearer-over-HTTPS, not mTLS. `CUSTOMER_JWT` was long-lived/static — SUPERSEDED by OAuth2 client-credentials (short-lived JWTs, ADR-0006).
