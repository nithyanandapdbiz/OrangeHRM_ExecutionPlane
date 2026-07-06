# Engineering Progress Dashboard

Living record of autonomous remediation against the Technical Debt Register
([`TECH-DEBT.md`](TECH-DEBT.md)) and Decision Register ([`adr/README.md`](adr/README.md)).

_Last updated: 2026-06 (Batch 14). Autonomous remediation stream paused — all
remaining items require a human decision, external infrastructure, cross-repo
coordination, or admin rights (see "What blocks done" below)._

## Repository health

| Metric | Value |
|--------|-------|
| Unit tests | **48 / 48 passing** (`node:test`, zero deps) |
| Lint (maintained surface) | **clean, blocking** in CI (`npm run lint`) |
| Lint (full sweep) | advisory (`npm run lint:all`) — legacy-script debt: TD-22 |
| CI gate | `npm ci` → `npm test` (blocking) → `npm run lint` (blocking) |
| Lockfile integrity | manifest ↔ lock consistent (`npm ci` safe) |
| Runtime smoke | server boots; `/health`, `/v1/health` → 200; `/run`, `/v1/run` route |
| Sovereign boundary | enforced at boot; PII scrubbed pre-boundary (contract-tested) |

## Batch log (this remediation stream)

| Batch | Item | Category | Result |
|-------|------|----------|--------|
| 4 | TD-17 | Ready | `lib/config.js` validated config + `config:check` |
| 5 | TD-16, TD-10 | Infra-scaffold | Helm chart + container `HEALTHCHECK` |
| 6 | TD-19 | Ready | no-shell CLI spawning (`cliInvoker`) |
| 7 | TD-15 | Ready | `/v1` API versioning + EP→IP contract test |
| 8 | TD-08 | Infra-scaffold | secrets provider seam + Key Vault adapter |
| 9 | TD-07 | Ready | **fixed CI lockfile drift**; blocking lint gate |
| 10 | TD-21 | Ready | apply bug severity + test-case coverage |
| 11 | TD-09/12/13/14/16 | Decision | ADR-0004/0005/0006/0007 + Decision Register |
| 12 | TD-14 (step 1) | Ready | runId propagated EP→IP as `X-Request-Id` |
| 13 | TD-22 | Triage | orphaned scripts confirmed broken → `scripts/DEPRECATED.md` |
| 14 | TD-08 | Ready | secrets `hydrate()` wired into boot (env no-op; KV-ready) |

## Status by category

**Closed (8):** TD-01, TD-02, TD-03, TD-05 (interim), TD-07, TD-19, TD-20, TD-21.

**In progress / scaffolded (6):** TD-04 (tests growing), TD-08 (seam done; boot-wiring +
KV deps pending), TD-10 (HEALTHCHECK + chart hardening; image non-root + SBOM pending),
TD-15 (`/v1` + contract; Pact/IP-side pending), TD-16 (chart done; `helm install`/Terraform
pending), TD-17 (config module + Helm values; full externalisation pending).

**Awaiting decision — documented, not implemented (5):** TD-09 (ADR-0006), TD-11 (ADR-0002),
TD-12 (ADR-0005), TD-13 (ADR-0005), TD-14 (ADR-0007).

**Awaiting external action (2):** TD-06 (enable GitHub branch protection — admin), TD-22 (delete
deprecated orphaned scripts once external-reference check clears — triaged & documented).

## What blocks "done"

Remaining work is gated on one of:
1. **A human decision** — ratify the Proposed ADRs (0002, 0005, 0006, 0007) before building.
2. **External infrastructure** — AKS cluster, container registry, Key Vault, OTel backend,
   GitHub branch-protection admin rights.
3. **Cross-repo coordination** — IP-side contract (Pact), inter-plane mTLS/OIDC.

Everything implementable in this repository without those inputs has been delivered or
scaffolded with its pending step explicitly recorded.

### Per-item block reason (remaining open work)

| Item | Blocked on |
|------|-----------|
| TD-06 | GitHub admin — enable branch protection on `main` (require the CI check) |
| TD-08 (remainder) | External infra — install `@azure/*` deps + provision a Key Vault |
| TD-09 | Decision (ADR-0006) **and** cross-repo IP-side change |
| TD-10 (remainder) | Docker build verification (non-root cache relocation) + CI SBOM/signing |
| TD-11 | Decision (ADR-0002) — ratify a target architecture before building |
| TD-12, TD-13 | Decision (ADR-0005) — async/queue + external state |
| TD-14 (remainder) | Decision (ADR-0007) + OTel exporter backend (infra) |
| TD-15 (remainder) | Cross-repo — IP-side Pact/contract |
| TD-16 (remainder) | External infra — AKS cluster/registry for `helm install`; Terraform |
| TD-22 | Confirm no external automation invokes the scripts, then delete |

No remaining item is implementable-and-verifiable in this repository alone.
