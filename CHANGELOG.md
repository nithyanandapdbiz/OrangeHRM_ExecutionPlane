# Changelog

All notable changes to this repository are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project uses
date-based entries until a formal semantic-version release cadence is adopted.

## [Unreleased]

### Discovery Phase 4.1 — production hardening (certification findings F1–F4) — 2026-07-13
- **F1** browser resource leak → `appCrawler.crawl` wrapped in `try/finally`; Chromium closes
  on every exit path (original exception preserved).
- **F2** run-store memory growth → bounded retention (TTL 24 h + max 100 completed / 50 failed)
  with eviction + `metrics()` in both run stores; active runs never evicted (env-tunable).
- **F3** checkpoint race → unique temp filename per write + rename retry/fallback in
  `discovery.state` (both planes); **0 ENOENT** live; content unchanged (determinism preserved).
- **F4** artifact filename validation → CLI `isSafeArtifactPath` rejects traversal/absolute/
  drive-letter/control-char names and keeps writes inside the run dir.
- Additive only — no API/contract/artefact changes. Tests: EP 138/138, IP 979/0-fail (12 new).
  Certification: **CERTIFIED FOR ENTERPRISE PRODUCTION DEPLOYMENT** — see docs/PRODUCTION-HARDENING-REPORT.md.

### Discovery Phase 3 — autonomous application intelligence — 2026-07-12
- **Added** (Intelligence Plane, additive — no EP changes): business-rule discovery,
  test-coverage intelligence (+ heat map + confidence), a scored risk engine, autonomous
  test recommendations, a knowledge-graph query engine, enterprise reports
  (executive/architect/QA/developer), and a versioned AI-readiness contract for 8
  downstream agents (`src/orchestrators/discoveryIntelligence.js`).
- **Added** incremental/differential discovery: `discoveryDelta`, `graphDiff`,
  `changeImpact` (`src/orchestrators/discoveryDelta.js`), exposed via
  `POST /api/discovery/delta` and `POST /api/discovery/:id/query`.
- Synthesis now returns `artifacts.intelligence` and aggregates accessibility into the app model.
- **Verified live** on OrangeHRM: 90% coverage, risk medium(68), 42 recommendations,
  delta pagesAdded 4 / graph nodesAdded 55, graph queries. Tests: IP 974/0-fail, discovery 26/26. ADR-0015.

### Discovery Phase 2 — deep DOM + modelling + analytics — 2026-07-12
- **Added** (EP crawler, additive): Shadow-DOM piercing (nested open roots), same-origin
  iFrame traversal, dynamic-content auto-scroll (lazy/infinite/virtualised), accessibility
  discovery (landmarks + missing-label audit), and discovery analytics with an FNV-1a
  content fingerprint for incremental/differential discovery.
- **Added** (IP, additive): business workflow-journey inference + a typed application
  knowledge graph (`src/orchestrators/discoveryModeler.js`), returned as new artefacts.
- **Verified live** on OrangeHRM: components 549→**756** (scroll), **38 a11y landmarks /
  303 missing labels**, **9 workflows**, knowledge graph **153 nodes / 171 edges**.
- Additive only — `crawl()` API + all existing artefacts unchanged. Tests: EP 122/122,
  IP discovery 16/16. See ADR-0014.

### Discovery crawl enhancement (SPA-aware, enterprise) — 2026-07-12
- **Fixed** a silent auth skip (login used non-waiting `isVisible()`); the crawler now
  waits for + verifies authentication, so it crawls the authenticated app.
- **Added** SPA menu harvesting, multi-level BFS/DFS traversal, URL normalisation +
  cycle detection, advanced component discovery (14 classifiers + ARIA/stability), and a
  navigation graph. IP synthesis carries components + nav graph (additive).
- **Verified live** on OrangeHRM (`maxDepth:1`): routes 1→**12**, components 0→**549**,
  endpoints 2→**56**; IP produced 21 POMs / 31 contracts / 4 contract tests.
- Additive only — `crawl()` API unchanged. Tests: EP 122/122; see ADR-0013.

### Discovery (Sovereign-Split integration) — 2026-07-12
- **Added** an end-to-end Discovery capability that preserves the Sovereign Split.
  The Execution Plane performs the deterministic browser crawl + DOM/network/form
  capture + PII scrubbing (`src/discovery/appCrawler.js`), then delegates all AI
  synthesis to the Intelligence Plane over OAuth2.
- **Added** intelligence-client methods: `discover`, `getDiscoveryStatus`,
  `downloadArtifacts`, `cancelDiscovery`, `retryDiscovery` (+ `_get`).
- **Added** async execution store (`src/discovery/discoveryExecutionStore.js`) and
  EP routes `POST /discovery/run`, `GET /discovery/runs/:id[/artifacts]`,
  `POST /discovery/cancel/:id`.
- **Changed** `discovery.controller.js` to run the crawl→scrub→delegate→poll→download
  worker instead of spawning a non-existent local CLI.
- **Docs:** ADR-0012, OpenAPI (`docs/discovery-openapi.yaml`), validation report.
- No AI logic runs in the Execution Plane. Tests: 115/115 (node:test).

### Platform
- **OrangeHRM tenant.** Package identity, configuration, and docs are OrangeHRM-native
  (`customerId: orangehrm`, `domain: human-resources`, `PLATFORM_DIR=../OrangeHRM_AgenticQAPlatform`).
  "DBiz" is the Intelligence-Plane (AI) vendor.
- **Jira + Zephyr Essential ALM integration.** Issue/bug tracking is **Jira Cloud**
  (`clients/jira.client.js`, REST v3, Basic `email:token`); test management is **Zephyr Essential**
  (`clients/zephyr.client.js`, REST v2, Bearer token). Both sit behind a provider-isolation facade
  `clients/alm.client.js` implementing the contracts in `clients/alm/*.contract.js`, so `routes/run.js`,
  `routes/health.js`, and scripts stay provider-agnostic. Pipeline keys are alphanumeric Jira keys (e.g. `OHRM-1`).
  Env contract: `JIRA_BASE_URL`/`JIRA_PROJECT_KEY`/`JIRA_EMAIL`/`JIRA_API_TOKEN` + `ZEPHYR_API_URL`/`ZEPHYR_API_TOKEN`.
- **OrangeHRM React web app under test.** Playwright/Cucumber drive the OrangeHRM SPA
  (`APP_BASE_URL` default `https://opensource-demo.orangehrmlive.com`, login `Admin`/`admin123`);
  env `APP_BASE_URL`/`APP_USERNAME`/`APP_PASSWORD`.
- **CI on GitHub Actions** (`.github/workflows/ci.yml`, `npm ci` + `npm test` + `npm run lint`).
- Config governance allowlist covers `JIRA_*`/`ZEPHYR_*`/`APP_*`; BDD scenario prefixes are
  React/OrangeHRM (`PIM_`/`ADMIN_`/`LEAVE_`/`FORM_`/`GRID_`).

### Added
- **Tenant-owned AI via ExecutionContext (Model B, ADR-0011)** — architectural
  reversal of the AI-ownership stance: the EP is now the authoritative owner of AI
  **selection** (`config/ai-profile.json`) and ships an immutable, versioned
  `ExecutionContext V1` (`lib/execution-context.js`) to the shared DBiz runtime on
  every call. Credentials are **references** (`kv://…`), never raw keys; the EP still
  performs **no inference** (FF-01) and still rejects raw AI keys at boot. Allowlist
  now permits AI selection vars (`AI_PROVIDER`/`AI_MODEL`/`PROMPT_PACK`/…). 6 new tests
  (63 total). **IP-side follow-up required:** DBiz must resolve provider/model/credential
  from the ExecutionContext per request (currently ignores it — migration seam).

- **Provider-agnostic configuration governance** (`lib/config-allowlist.js`): the EP
  now declares an allowlist of execution-only variables and detects AI config by
  **pattern** (model/tokens/temperature/prompt/credential-shaped), replacing the
  provider **denylist** in `startup-guard`. An unknown future provider's
  `FOO_API_KEY`/`FOO_MODEL` is rejected with no code change; ambient host vars
  (`AI_AGENT`, Windows `PROMPT`, `GITHUB_TOKEN`) are correctly allowed.
- Config governance fitness functions (`test/config-governance.test.js`, FF-15/21/22/
  23/24/25/26): fail CI if EP code reads an undeclared var, reads any AI var, if
  `.env.example` contains AI config, or if the guard/allowlist enumerates a provider.
- Enterprise `.env.example` — grouped, execution-only, with `INTELLIGENCE_API_VERSION/
  TIMEOUT/RETRY`, mTLS paths, and OTEL/health placeholders; all AI variables removed.
- Health field `sovereign.aiCredentialPresent` (provider-agnostic); `anthropicKeyPresent`
  kept as a deprecated backward-compatible alias. Boot/pipeline logs genericised.

- Enterprise documentation baseline: `README.md`, `docs/ARCHITECTURE.md`,
  ADR-0001 (sovereign split), ADR-0002 (architecture consolidation),
  ADR-0003 (quality gates).
- Unit-test safety net via Node's built-in `node:test` (22 tests): `pii-scrubber`,
  `playwright.runner` report parsing, `apiAuth`, `intelligence.client`, `childLog`.
- `npm test` script and a GitHub Actions CI quality gate (`.github/workflows/ci.yml`).
- Opt-in API authentication on the privileged `POST /run` endpoint
  (`middleware/apiAuth`) — enforced only when `API_SECRET` is set (backward compatible).
- Governance: `SECURITY.md`, `CODEOWNERS`, `CHANGELOG.md`, `docs/TECH-DEBT.md`.
- Detailed result-sync logging (`[ALM] Results synced: …`) and a Step-6 summary line.
- Live multi-plane trace + child-output streaming in the pipeline trigger.
- ESLint/Prettier configuration and `lint`/`format` scripts; Node `engines` floor.
- Centralised validated configuration module (`lib/config.js`) with fail-fast
  validation and a secret-safe `describe()`; `npm run config:check` (TD-17).
- Helm chart (`deploy/helm/execution-plane`) + `deploy/README.md` packaging the
  Execution Plane: Deployment/Service/ConfigMap, health probes, and pod hardening
  (non-root, drop-all-caps, seccomp). `replicaCount` pinned to 1 per TD-12 (TD-16).
- Container `HEALTHCHECK` (Node http probe on `/health`) in the Dockerfile (TD-10).
- API versioning (TD-15): routes are served at canonical `/v1/*` and legacy `/*`
  (one shared router → one pipeline lock); every response carries `X-API-Version`.
- EP→IP contract test (`test/intelligence-contract.test.js`) pinning the request
  method/path/headers/body shape and asserting PII is scrubbed before the boundary.
- Secrets provider seam (`lib/secrets.js`, TD-08): `env` default (no behaviour change)
  plus an Azure Key Vault hydrate adapter selected via `SECRETS_PROVIDER=keyvault`;
  7 unit tests. **Now wired into boot** (`server.js`): `secrets.hydrate()` runs before
  the startup guard and listen (runtime-verified; `env` provider is a no-op). Only the
  Key Vault dependencies + vault provisioning remain deploy-pending.
- The ALM client now applies bug **priority** on the Jira bug and emits a test-case
  **coverage** trace line (Zephyr cycle ↔ cases); contract tests (TD-21).
- `scripts/DEPRECATED.md` (TD-22): triaged the 6 orphaned legacy scripts — confirmed
  unreferenced and in two cases already broken (dead `return`, out-of-scope variable);
  documented as superseded by `npm run e2e` and scheduled for deletion. Not auto-fixed
  (lint-passing dead code would imply it works).
- Cross-plane correlation (TD-14, ADR-0007 step 1): the pipeline `runId` is propagated
  to the Intelligence Plane as `X-Request-Id` on every call, so one run is traceable
  end-to-end; contract-tested (present when set, omitted otherwise). Backward-compatible.
- Decision Register (`docs/adr/README.md`) + ADR-0004 (deployment/packaging),
  ADR-0005 (async execution & scale), ADR-0006 (inter-plane trust), ADR-0007
  (observability) — architectural-decision debt documented, not implemented, pending
  ratification (TD-09/11/12/13/14/16). Engineering Progress Dashboard (`docs/PROGRESS.md`).

### Fixed / Security
- **CI-breaking lockfile drift**: `eslint`/`prettier` were in `package.json` but
  absent from `package-lock.json`, so `npm ci` (the CI gate) would fail. Lockfile
  re-synced (eslint 8.57.1, prettier 3.8.4) — `npm ci` is consistent again.
- **Lint adoption** (TD-07): `npm run lint` is scoped to the maintained surface,
  is clean, and is now a **blocking** CI gate; `npm run lint:all` is the advisory
  full sweep. `src/**` is excluded pending ADR-0002. Removed dead `fs`/`path`
  imports from `routes/run.js`; surfaced two latent ALM-client gaps (TD-21).
- **No-shell process spawning** (TD-19): runners now invoke Playwright/Cucumber via
  `node <resolved-bin>` instead of `npx` with `shell:true`, removing the DEP0190
  deprecation, the command-injection class, and the Windows `.cmd`+shell requirement
  (CVE-2024-27980 class). Falls back to npx only if a bin can't be resolved.
- **Secret-in-image leak**: added `.dockerignore` so `.env` is no longer baked into
  image layers.
- **Secret/PII-in-repo leak**: hardened `.gitignore` to exclude `.auth/` (OrangeHRM app
  session token) and screenshot/video artefacts before the initial Git import.

### Notes
- No breaking changes. Authentication on `/run` is opt-in (set `API_SECRET` to enforce).
