# OrangeHRM Execution Plane

> The **customer-tenant** half of a two-plane, sovereignty-preserving autonomous-QA platform.
> It orchestrates the full quality lifecycle against live customer systems (Jira + Zephyr Essential +
> the OrangeHRM React web app) while delegating **all AI reasoning** to a separate **Intelligence Plane** —
> so that **no customer credentials or PII ever cross the AI boundary.**

---

## 1. What this is

The Execution Plane (EP) is a Node.js/Express service that, given a **Jira issue** (e.g. `OHRM-1`),
drives an end-to-end QA pipeline:

1. Fetch the story from **Jira** (`JIRA_API_TOKEN` — stays local).
2. Call the **Intelligence Plane** (`/api/pipeline`) with a **PII-scrubbed** story → receive AI-generated
   test cases, compliance gate, security threats, and per-agent results.
3. Write the generated test cases to **Zephyr Essential** and open a Zephyr **test cycle**.
4. Execute **functional** tests (Cucumber/Playwright, against the **OrangeHRM React web app**).
5. Sync results to **Zephyr** and create defects (**Bugs**) in **Jira**.
6. Run **performance** (k6) and **security** (OWASP ZAP + HTTP checks) against sanctioned public targets.
7. Generate reports (functional / performance / security).

**The EP holds the secrets and the data; the Intelligence Plane holds the AI.** This is the
*Sovereign Split* — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/adr/ADR-0001-sovereign-split.md`](docs/adr/ADR-0001-sovereign-split.md).

## 2. Sovereign-split security contract

- ❌ **No AI provider credential may exist in this plane.** Enforced at boot by `middleware/startup-guard`
  and `docker-entrypoint.sh` (provider-agnostic hard ban on any raw AI key — `ANTHROPIC_*`, `OPENAI_*`,
  Azure/Vertex/Bedrock, and any credential-shaped AI variable) — the process **exits** if one is found.
- 🔒 **Jira API token, Zephyr token, and the OrangeHRM app credentials** never leave the customer tenant.
- 🧹 **PII is scrubbed** before any payload crosses to the Intelligence Plane (`middleware/pii-scrubber`),
  with an independent guard on the Intelligence side.
- 🪪 **Tenant-owned AI (Model B):** the EP owns AI **selection** (`config/ai-profile.json`) and ships it in an
  immutable `ExecutionContext` — but only as **references** (`kv://…`), never raw keys. See
  [`docs/adr/ADR-0011-tenant-owned-ai-execution-context.md`](docs/adr/ADR-0011-tenant-owned-ai-execution-context.md).

## 3. Architecture at a glance

```
Operator / CI ──POST /run──▶ Execution Plane (:3000)            DBiz tenant
   { issueKey: OHRM-1 }       ├─ Jira            (API token)     ┌────────────────────┐
                              ├─ Zephyr Essential (API token)    │ Intelligence Plane │
                              ├─ OrangeHRM React app             │  (:3001)  6+ agents│
                              │   (APP creds, Playwright)        │  Claude — AI only  │
                              └─ Intelligence Plane ─JWT + ─────▶│                    │
                                                    scrubbed     └────────────────────┘
```
The running service is `server.js` → `routes/run.js` → `clients/` + `runners/` + `lib/`.
Jira + Zephyr are reached through the provider-isolation facade `clients/alm.client.js`.
> ⚠️ **Known debt:** a second, **unmounted** code tree under `src/` (a copy of the QA platform) also exists.
> It is **not executed** by `server.js`. See [`ADR-0002`](docs/adr/ADR-0002-architecture-consolidation.md).

## 4. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js **≥ 20** | see `engines` in `package.json` |
| The **Intelligence Plane** running (default `http://localhost:3001`) | provides all AI agents |
| A **Jira Cloud** project (e.g. `OHRM`) + API token | issue/bug source of truth |
| **Zephyr Essential** (Zephyr Scale) enabled on that project + API token | test management |
| **k6** on PATH (or `PERF_K6_BINARY`) | performance pillar |
| **OWASP ZAP** (optional, `ZAP_PATH` + `ZAP_AUTO_LAUNCH=true`) | security active scan |
| Playwright Chromium | installed via the QA platform / Dockerfile |

## 5. Configuration

Copy `.env.example` → `.env` and populate. **Never commit `.env`** (git-ignored; excluded from images via `.dockerignore`).

| Variable | Purpose |
|---|---|
| `INTELLIGENCE_API_URL` | Intelligence Plane base URL (default `http://localhost:3001`) |
| `CUSTOMER_ID` | Tenant id sent to the IP (default `orangehrm`) |
| `CLIENT_ID` / `CLIENT_SECRET` | OAuth2 client credentials from DBiz — the EP exchanges them at `/oauth/token` for a short-lived JWT |
| `JIRA_BASE_URL`, `JIRA_PROJECT_KEY`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira Cloud connection (Basic `email:token`, stays local) |
| `ZEPHYR_API_URL`, `ZEPHYR_API_TOKEN` | Zephyr Essential test management (Bearer token, stays local) |
| `APP_BASE_URL`, `APP_USERNAME`, `APP_PASSWORD` | OrangeHRM React app under test (default `https://opensource-demo.orangehrmlive.com`, `Admin`/`admin123`) |
| `PLATFORM_DIR` | Directory containing the Playwright/Cucumber suite (`.` = self-contained) |
| `PW_HEADLESS` | `false` = headed browser (default), `true` = headless/CI |
| `RUN_PERF`, `RUN_SECURITY`, `PERF_BASE_URL`, `SEC_BASE_URL` | non-functional pillars + sanctioned public targets |
| `ZAP_AUTO_LAUNCH`, `ZAP_PATH`, `ZAP_API_URL`, `ZAP_API_KEY` | optional OWASP ZAP scanning |
| `ISSUE_KEY` | default Jira issue key for `npm run e2e` (e.g. `OHRM-1`) |
| `TRIGGER_TAIL`, `STREAM_CHILD_OUTPUT`, `INTELLIGENCE_LOG_FILE` | live-trace controls |

> ⚠️ **Security note (current state):** secrets are read from a plaintext `.env`. For production, source
> them from a secret manager (`SECRETS_PROVIDER=keyvault`) — see `docs/ARCHITECTURE.md` §Risks.
> The full, authoritative variable contract is in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

## 6. Running it

Two terminals (server + trigger):

```bash
# Terminal 1 — start the Execution Plane (leave running; shows the full trace)
npm start

# Terminal 2 — trigger a pipeline run for a Jira issue
npm run e2e                       # uses ISSUE_KEY from .env
# or
node scripts/trigger.js OHRM-1    # explicit Jira issue key
```

`npm run e2e` streams a **live trace** (Execution-Plane steps `│`, Intelligence-Plane agents `│⟦IP⟧`,
raw execution detail `┊`) and ends with a summary banner. `npm run logs` tails the structured log.

## 7. Project layout

| Path | Responsibility |
|---|---|
| `server.js` | HTTP bootstrap; mounts `health` + `run` at `/v1/*` (canonical) and `/*` (legacy) |
| `routes/run.js` | The `/run` pipeline orchestrator (`{ issueKey }`) |
| `clients/` | `alm.client.js` (facade), `jira.client.js`, `zephyr.client.js`, `intelligence.client.js` |
| `clients/alm/` | Provider contracts: `tracker.contract.js` (Jira), `testmanagement.contract.js` (Zephyr), `http.js` |
| `runners/` | `playwright.runner.js` (BDD), `nonfunctional.runner.js` (perf/security) |
| `middleware/` | `pii-scrubber`, `startup-guard`, `apiAuth` |
| `lib/` | `logger`, `childLog`, `config`, `config-allowlist`, `execution-context`, `secrets`, `retry` |
| `deploy/` | Helm chart + deploy guide (`deploy/README.md`) |
| `scripts/` | `trigger.js`, `tail-logs.js`, perf/security runners, report builders |
| `tests/` | Cucumber feature suite + Playwright page objects for the OrangeHRM React app |
| `config/` | `customer.json` (tenant identity), `ai-profile.json` (Model B), `platform.config.json` |
| `src/` | **Unmounted** platform copy — see ADR-0002 |

## 8. Scripts

| Command | Description |
|---|---|
| `npm start` / `npm run dev` | run the server (`dev` = watch mode) |
| `npm run e2e` / `npm run pipeline` | trigger a pipeline run (live trace) |
| `npm run discover` | **Enterprise Discovery CLI** — crawl → synthesise → download artefacts (see §8b) |
| `npm run logs` | tail the structured execution log |
| `npm run health` | print `/health` JSON (Jira/Zephyr/IP/Playwright readiness) |
| `npm run auth:validate` | validate the OrangeHRM app session |
| `npm test` | run the unit-test suite (`node:test`, incl. config/AI-boundary fitness) — the CI quality gate |
| `npm run config:check` | validate configuration (fail-fast) + print a secret-safe summary |
| `npm run test:bdd` | run the Cucumber suite directly |
| `npm run lint` / `npm run format` | static analysis / formatting (see ADR-0003) |

> **Configuration:** the authoritative variable contract is [`.env.example`](.env.example);
> every variable's owner/status is reconciled in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
> Config is **provider-agnostic** — an allowlist ([lib/config-allowlist.js](lib/config-allowlist.js))
> validated at boot and in CI; any AI provider/model/prompt/**raw** credential variable is rejected.

> **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci` + `npm test` + `npm run lint` on every
> push/PR to `main`. Require the check on `main` (branch protection) to enforce the gate before merge.

## 8b. Discovery CLI

A thin developer-experience wrapper (`scripts/discover.js`) over the existing Discovery
REST APIs — it orchestrates the Execution Plane (crawl + status + artefacts) and the
Intelligence Plane (delta + graph query). It adds **no** discovery logic. Both planes must
be running (IP `:3001`, EP `:3002`).

```bash
# Simplest — uses .discoveryrc.json / env vars
npm run discover

# Explicit options
npm run discover -- --url=https://opensource-demo.orangehrmlive.com \
  --username=Admin --password=admin123 --depth=5 --pages=200 --strategy=bfs

# Lifecycle
npm run discover -- --resume                 # re-check / re-download the last run
npm run discover -- --delta                  # compare the two most recent runs
npm run discover -- --query modules
npm run discover -- --query pagesWithComponent --type datepicker
npm run discover -- --query workflowsUsingField --field employeeId
npm run discover -- --report executive       # executive | architect | qa | developer
npm run discover -- --ci                     # machine-readable JSON, no colour, exit codes
npm run discover -- --help
```

**What it does:** pre-flight health checks (EP, IP, OAuth2, tenant, config) → `POST
/discovery/run` → polls with staged progress (`queued → crawling → scrubbing →
synthesising → downloading → completed`) → downloads and splits artefacts into
`artifacts/discovery/<runId>/` (application model, navigation + knowledge graphs, business
rules, coverage, risk, recommendations, POMs, contracts, contract tests, HTML report) →
prints a summary. Transient failures are retried; everything is logged to
`logs/discovery-cli.log`.

**Configuration precedence:** CLI args **>** env vars **>** `.discoveryrc.json` **>** defaults.

```jsonc
// .discoveryrc.json  (copy from .discoveryrc.example.json; git-ignored — may hold creds)
{ "baseUrl": "https://opensource-demo.orangehrmlive.com", "username": "Admin",
  "password": "admin123", "maxDepth": 5, "maxPages": 200, "strategy": "bfs", "domain": "hr" }
```

### 8c. Zephyr Essential governance & audit (opt-in)

With `--zephyr` (or `ZEPHYR_GOVERNANCE=true`, or a `zephyr` block in `.discoveryrc.json`),
each Discovery run is governed by **Zephyr Essential** — a Zephyr cycle + execution is
created, the lifecycle is mirrored as structured Jira story comments, and an immutable
**audit package** (`governance.json`, `evidence.json` with SHA-256, `audit-report.json`)
is written beside the artefacts so an auditor can replay the run without live Jira/Zephyr.
Jira + Zephyr remain the authoritative ALM systems; **governance is additive and, when
disabled, behaviour is identical.** See [`docs/GOVERNANCE-AUDIT.md`](docs/GOVERNANCE-AUDIT.md)
and [`docs/adr/ADR-0016-governance-audit-compliance.md`](docs/adr/ADR-0016-governance-audit-compliance.md).

Env vars: `DISCOVERY_URL`, `DISCOVERY_USERNAME`, `DISCOVERY_PASSWORD`, `DISCOVERY_DEPTH`,
`DISCOVERY_PAGES`, `DISCOVERY_STRATEGY` (OAuth2 uses `CLIENT_ID`/`CLIENT_SECRET` from `.env`).

**CI/CD** — machine-readable, proper exit codes (`0` success, non-zero on failure):

```yaml
- name: Application Discovery
  env:
    DISCOVERY_URL: ${{ vars.APP_URL }}
    DISCOVERY_USERNAME: ${{ secrets.APP_USER }}
    DISCOVERY_PASSWORD: ${{ secrets.APP_PASS }}
    CLIENT_ID: ${{ secrets.CLIENT_ID }}
    CLIENT_SECRET: ${{ secrets.CLIENT_SECRET }}
  run: npm run discover -- --ci --pages 200 > discovery.json
- uses: actions/upload-artifact@v4
  with: { name: discovery-artifacts, path: artifacts/discovery/ }
```

## 9. Containerisation

Multi-stage `Dockerfile` (exec deps → platform deps incl. Playwright → final). The
`docker-entrypoint.sh` guard enforces the sovereign-split contract before launch (hard-bans raw AI keys;
requires `JIRA_API_TOKEN` + `CLIENT_ID`/`CLIENT_SECRET`).
**`.dockerignore` excludes `.env`/secrets/artefacts** from image layers.

## 10. Status & roadmap

This repository is a **strong prototype with a differentiated architecture**, not yet production-grade.
The enterprise hardening roadmap (auth on `/run`, secret manager, horizontal scale, observability,
architecture consolidation, test coverage) is tracked in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
and the ADRs under [`docs/adr/`](docs/adr/).
