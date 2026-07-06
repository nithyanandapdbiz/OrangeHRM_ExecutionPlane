# ADR-0002 — Consolidate the Dual Code Tree

- **Status:** Proposed (decision required)

## Context

The repository contains **two divergent architectures**:

1. **The running pipeline** — `server.js` → `routes/run.js` → `clients/`, `runners/`, `lib/`, `middleware/`.
   This is what `npm run e2e` exercises.
2. **An unmounted platform copy** — `src/api/` (controllers, `routes.js` with `authGuard`, `rateLimiter`,
   `securityHeaders`), `src/orchestrator/`, `src/services/`, `src/agents/`, `src/core/` (incl. an unused
   `circuitBreaker`), `src/utils/` (incl. unused `ai.js`/`claude.js`/`openai.js`), plus
   `scripts/generate-report.js` and its missing `scripts/intelligence/` dependency tree.

`server.js` contains **zero references to `src/`**. The security middleware that *exists* (auth, rate-limit,
security-headers) is therefore **inert** — a governance trap: the platform looks more secure than it behaves.

## Problem

- Two sources of truth → erosion, confusion ("which `executor.agent.js` is real?"), doubled maintenance.
- Genuine capabilities are stranded in dead code (auth middleware, circuit breaker, retry, the 20-phase
  `generate-report.js`).
- New engineers cannot determine the live code path without runtime archaeology.

## Decision (to be ratified)

Pick **one** architecture and remove or absorb the other, recorded here once chosen:

- **Option A — Adopt `src/api`:** mount the secured router, migrate the `/run` orchestration into
  `src/application`, retire `routes/run.js`. *Pro:* inherits auth/rate-limit/security-headers. *Con:* larger.
- **Option B — Keep the thin runtime, delete `src/`:** treat `clients/`+`runners/`+`lib/` as canonical;
  re-implement only the needed cross-cutting concerns (auth, retry, circuit breaker) as small modules.
  *Pro:* minimal surface. *Con:* re-creates what `src/` already has.

**Recommendation:** Option A for the security/observability inheritance, executed via a strangler migration
(wrap `/run` with the `src/api` middleware chain first, then move logic).

## Consequences

Until ratified, **do not delete `src/`** blindly — `scripts/*` may reference parts of it. Audit references
first, then remove in one reviewed change.
