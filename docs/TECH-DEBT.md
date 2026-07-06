# Technical Debt Register (live)

Status legend: ✅ done · 🟡 in progress · ⬜ open · 🔵 deferred (justified)

See also: [Engineering Progress Dashboard](PROGRESS.md) · [Decision Register](adr/README.md).
Items marked "awaiting decision" are documented as ADRs and intentionally **not** implemented
until the relevant ADR is ratified.

> **Platform migration (completed):** the plane was retargeted to the OrangeHRM tenant — issue tracking
> moved to **Jira**, test management to **Zephyr Essential**, the app under test to the **OrangeHRM React
> web app**, and CI to **GitHub Actions**. Clients now sit behind the `clients/alm.client.js` provider-
> isolation facade. No debt item below changed severity as a result; the migration only renamed the
> connectors and CI surface referenced in the entries.

| ID | Item | Root cause | Business impact | Technical impact | Severity | Effort | Sprint | Status |
|----|------|-----------|-----------------|------------------|----------|--------|--------|--------|
| TD-01 | No README / architecture docs / ADRs | docs deferred | Onboarding & DD friction | Knowledge loss | High | S | S1 | ✅ done |
| TD-02 | Secret baked into Docker image (`COPY . .`, no `.dockerignore`) | missing ignore | Secret leak in image layers | Credential exposure | Critical | S | S1 | ✅ done |
| TD-03 | `.gitignore` excluded only 3 paths (`.auth/`, artefacts trackable) | minimal ignore | Session token / app-screenshot leak on push | PII exposure | Critical | S | S1 | ✅ done |
| TD-04 | No automated tests of core code | no DI seams; deferred | Regressions ship silently | Unsafe to refactor | High | M | S1–2 | 🟡 in progress (22 unit tests) |
| TD-05 | Unauthenticated privileged `/run` | endpoint shipped open | Unauthorized Jira/Zephyr/app writes | Access-control gap | Critical | S | S1 | ✅ done (opt-in `API_SECRET`); ⬜ make default + OAuth/OIDC |
| TD-06 | No CI quality gate | pipelines were QA-only | Bad code merges to main | No enforcement | High | S | S2 | 🟡 in progress (GitHub Actions `.github/workflows/ci.yml` added; enable branch protection) |
| TD-07 | No lint/format enforcement | tooling absent | Inconsistent code | Latent bugs | Medium | S | S2 | ✅ done for maintained surface (eslint+prettier locked; `npm run lint` clean & **blocking** in CI; `lint:all` advisory for legacy scripts; `src/**` excluded per ADR-0002) |
| TD-08 | Secrets in plaintext `.env` (no vault) | local-dev shortcut | Procurement/security fail | Breach blast-radius | Critical | M | S1–2 | 🟡 in progress (`lib/secrets` seam **wired into boot** — hydrate→guard→listen, runtime-verified; env default + Key Vault adapter + 7 tests. Only KV deps/vault provisioning deploy-pending) |
| TD-09 | Inter-plane trust: static JWT → **OAuth2 client-credentials (short-lived tokens)**; mTLS still optional | code-trust boundary | Reduced token blast-radius | Stronger inter-service trust | High | M | S2–3 | ✅ JWT→OAuth2 done (ADR-0006); mTLS optional |
| TD-10 | Container runs as root, no HEALTHCHECK/SBOM/signing | Playwright cache in `/root/.cache` | Hardening/audit gaps | Supply-chain risk | High | M | S2 | 🟡 partial (HEALTHCHECK added; chart enforces non-root/drop-caps/seccomp; image cache relocation + SBOM/signing pending) |
| TD-11 | Dual architecture: `src/` unmounted (auth, circuit breaker, retry stranded) | platform copy not reconciled | Confusion; stranded capability | Erosion | High | L | S2–3 | ⬜ open (ADR-0002 — ratify option) |
| TD-12 | Single-instance: process-global `inFlight` + fixed artefact paths | prototype concurrency | No horizontal scale / SLA | Hard scale ceiling | High | L | S3–4 | ⬜ open (ADR-0005 — async + external state) |
| TD-13 | Synchronous ~16-min HTTP hold; non-idempotent writes | no job/queue | No SLA; duplicate Jira/Zephyr records | Resilience gap | High | M | S3 | ⬜ open (ADR-0005) |
| TD-14 | No OpenTelemetry / metrics / correlation across planes | observability not built | Unbounded MTTR | Operability gap | High | M | S2–3 | 🟡 step 1 done (runId propagated EP→IP as `X-Request-Id`, contract-tested); OTel + metrics await ADR-0007 |
| TD-15 | Unversioned EP↔IP API; no contract tests | API not governed | Silent breakage on IP change | Integration risk | Medium | M | S2 | 🟡 in progress (`/v1` canonical + legacy alias + `X-API-Version`; EP→IP contract test pins wire shape & PII scrub. Pact/IP-side pending) |
| TD-16 | No packaged deploy (Helm/Terraform/signed image) | services mindset | Cannot ship/operate at customers | Productization blocker | High | M | S2–4 | 🟡 scaffolded (Helm chart + `deploy/README.md`; `helm install`/Terraform deploy-pending) |
| TD-17 | Single-tenant hard-coded `config/customer.json` | bespoke build | Cannot parameterise per customer | Multi-deploy gap | Medium | S | S1–2 | 🟡 in progress (`lib/config.js` validated config + Helm ConfigMap externalisation) |
| TD-18 | Broken `generate-report.js` (missing `scripts/intelligence/`) | partial migration | Operator confusion | Dead feature | Medium | M | S3 | ⬜ open (restore or retire) |
| TD-19 | `spawn({shell:true})` in runners (DEP0190) | convenience | — | Injection smell + deprecation | Low | S | S2 | ✅ done (`cliInvoker` runs CLIs via `node <bin>`, no shell; npx fallback) |
| TD-20 | No CONTRIBUTING / CODEOWNERS / SECURITY / CHANGELOG | governance deferred | Contribution friction | Process gaps | Medium | S | S1 | ✅ done (CODEOWNERS, SECURITY, CHANGELOG) |
| TD-21 | ALM client accepts `priority` (createBug) & test-case keys (createTestRun) but never applied them | incomplete impl | Bug priority ignored; runs not linked to cases | Latent functional gap | Medium | S | S2 | ✅ done (priority applied on the Jira bug; test-case keys drive the Zephyr cycle + a coverage trace line; contract tests) |
| TD-22 | 6 lint errors in legacy scripts (no-undef/-unreachable/-inner-declarations) | leftover utilities | Possible runtime failures if invoked | Hidden defects | Low | S | S3 | 🟡 triaged — orphaned & already-broken, superseded by server pipeline; documented in `scripts/DEPRECATED.md`; scheduled for deletion pending external-reference check (not auto-fixed — would mask abandonment) |

## Burndown
- **Closed:** TD-01, TD-02, TD-03, TD-05 (interim), TD-07 (maintained surface), TD-19, TD-20, TD-21.
- **In progress / partial:** TD-04, TD-06, TD-08 (in progress), TD-10 (partial), TD-14 (step 1), TD-15 (in progress), TD-16 (scaffolded), TD-17 (in progress).
- **Next up (recommended):** ratify Proposed ADRs (TD-11/0002, TD-12·13/0005, TD-09/0006, TD-14/0007); TD-06 (enable GitHub branch protection — repo admin); delete deprecated scripts once external-reference check clears (TD-22).
- **Now gated on decision/infra/admin only:** the remaining open items all require a human-ratified ADR, external infrastructure (cluster/registry/vault/OTel backend), cross-repo work (IP-side Pact/mTLS), or GitHub repo-admin rights — see [PROGRESS.md](PROGRESS.md).
