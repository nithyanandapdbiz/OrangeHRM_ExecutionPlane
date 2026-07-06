# Configuration Reconciliation (authoritative)

Every environment variable referenced anywhere in the repository, with its owner
and status. The **live** contract is `.env.example`; the **allowlist** is
`lib/config-allowlist.js`; validation is `lib/config.js` + `middleware/startup-guard.js`;
CI enforces this via `test/config-governance.test.js` (FF-15/21/22/23/24/25/26).

Status: **live** (consumed by the running runtime) · **tuning** (BDD knob, defaulted)
· **reserved** (declared, not yet consumed) · **legacy** (dormant `src/` monolith,
pending removal per ADR-0002) · **external** (supplied by CI/host) · **forbidden** (raw AI).

## 1. Live Execution Plane configuration

| Variable | Sec­tion | Req | Default | Secret | Consumer |
|---|---|---|---|---|---|
| `NODE_ENV` | Runtime | opt | production | no | server |
| `PORT` | Runtime | opt | 3000 | no | server |
| `HOST` | Runtime | opt | 0.0.0.0 | no | server |
| `PLATFORM_DIR` | Runtime | opt | `.` | no | runners |
| `INTELLIGENCE_API_URL` | IP link | **req** | http://localhost:3001 | no | intelligence.client |
| `INTELLIGENCE_API_VERSION` | IP link | opt | v1 | no | intelligence.client |
| `INTELLIGENCE_TIMEOUT_MS` | IP link | opt | 600000 | no | intelligence.client |
| `INTELLIGENCE_RETRY` | IP link | opt | 0 | no | intelligence.client |
| `CUSTOMER_ID` | Tenant | opt | orangehrm | no | client/health |
| `CLIENT_ID` / `CLIENT_SECRET` | Tenant | **req** | — | **yes** (secret) | intelligence.client (OAuth2 `/oauth/token`) |
| `API_SECRET` | Auth | opt | — | **yes** | apiAuth |
| `WEBHOOK_SECRET` | Auth | opt | — | **yes** | (reserved Jira webhook) |
| `SECRETS_PROVIDER` | Secrets | opt | env | no | lib/secrets |
| `AZURE_KEY_VAULT_URL` | Secrets | cond | — | no | lib/secrets (keyvault) |
| `MTLS_CERT_PATH` / `MTLS_KEY_PATH` / `CA_CERT_PATH` | mTLS | opt | — | path | reserved (ADR-0006) |
| `JIRA_BASE_URL` | Jira | **req** | — | no | jira.client |
| `JIRA_PROJECT_KEY` | Jira | **req** | — | no | jira.client / zephyr.client |
| `JIRA_EMAIL` | Jira | **req** | — | no | jira.client (Basic auth user) |
| `JIRA_API_TOKEN` | Jira | **req** | — | **yes** | jira.client (Basic auth token) |
| `JIRA_API_VERSION` | Jira | opt | 3 | no | jira.client |
| `JIRA_TIMEOUT_MS` | Jira | opt | 15000 | no | jira.client |
| `ZEPHYR_API_URL` | Zephyr | opt | https://api.zephyrscale.smartbear.com/v2 | no | zephyr.client |
| `ZEPHYR_API_TOKEN` | Zephyr | opt | — | **yes** | zephyr.client |
| `ZEPHYR_CYCLE_ID` | Zephyr | opt | — | no | zephyr.client (reuse cycle) |
| `APP_BASE_URL` | App | opt | https://opensource-demo.orangehrmlive.com | no | playwright.runner |
| `APP_USERNAME` / `APP_PASSWORD` | App | opt | Admin / admin123 | **yes** | playwright.runner |
| `PW_HEADLESS` | Playwright | opt | false | no | playwright.runner |
| `PLAYWRIGHT_BDD_TIMEOUT_MS` | Playwright | opt | 900000 | no | playwright.runner |
| `CAPTURE_VIDEO` / `SESSION_MODE` | Playwright | opt | false / shared | no | BDD support |
| `RUN_PERF` | Perf | opt | true | no | nonfunctional.runner |
| `PERF_BASE_URL` / `PERF_TEST_TYPE` / `PERF_VUS_MAX` / `PERF_EXEC_TIMEOUT_MS` | Perf | opt | — / smoke / 20 / 600000 | no | run-perf |
| `RUN_SECURITY` | Security | opt | true | no | nonfunctional.runner |
| `PENTEST_ENABLED` | Security | opt | false | no | nonfunctional.runner |
| `SEC_BASE_URL` / `SEC_EXEC_TIMEOUT_MS` | Security | opt | — / 600000 | no | run-security |
| `ZAP_*` (AUTO_LAUNCH, PATH, API_KEY, FAIL_ON, …) | Security | opt | — | ZAP_API_KEY: **yes** | run-security |
| `LOG_LEVEL` / `LOG_DIR` / `LOG_MAX_FILES` / `LOG_MAX_SIZE_BYTES` | Logging | opt | info / logs / 14 / 10485760 | no | lib/logger |
| `STREAM_CHILD_OUTPUT` / `TRIGGER_TAIL` / `INTELLIGENCE_LOG_FILE` | Logging | opt | — | no | trigger / childLog |
| `ISSUE_KEY` / `ZEPHYR_CYCLE_ID` / `BASE_URL` | Misc | opt | — | no | scripts |

## 2. Tenant-owned AI selection (Model B, ADR-0011) — status **live** (references only)

The EP owns AI **selection** and ships it in an immutable `ExecutionContext`. These override the scalars in
`config/ai-profile.json`; **credentials are references, never raw keys**:
`AI_PROFILE_PATH`, `AI_PROVIDER`, `AI_MODEL`, `AI_FALLBACK_MODEL`, `AI_MAX_TOKENS`, `AI_TEMPERATURE`,
`AI_CREDENTIAL_REF` (`kv://…`), `PROMPT_PACK`, `PROMPT_VERSION`, `KNOWLEDGE_REF` (`kv://…`). A *raw* AI key
(`*_API_KEY`, etc.) is still **forbidden** and aborts boot — see §6.

## 3. Functional (BDD) tuning knobs — status **tuning**

Allowlisted by namespace prefix, each with an in-code default; not enumerated in
`.env.example` to keep it readable. Families: `AUTH_*` (OrangeHRM app session/auth timeouts),
`CUCUMBER_*` (worker/step/hook timeouts), `PIM_*`, `ADMIN_*`, `LEAVE_*`, `FORM_*`, `GRID_*`
(page-object/component waits), `CDP_*` (Chrome DevTools), `APP_*`/`TEST_ADMIN_*`/`CONTRACT_BASE_URL`
(app-under-test). Override only to tune the BDD suite; safe defaults ship in code.

## 4. Reserved (declared, not yet consumed)

`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` (ADR-0007), `HEALTH_TIMEOUT_MS`,
`REPORT_STORAGE_PATH`, `ARTIFACT_STORAGE_PATH`, `FEATURE_FLAGS`. Allowlisted so they
can be adopted without a governance change; documented here until wired.

## 5. Legacy — dormant `src/` monolith (status **legacy**, scheduled for removal)

These are read only by the dormant `src/` tree and a few legacy scripts, **not** by
the live runtime. They are **not** in `.env.example` and will be deleted with the
`src/` consolidation (ADR-0002 / TD-11). Do not add them to production config.

`NUCLEI_*`, `SQLMAP_*`, `FFUF_*`, `SECLIST_PATH` (extra DAST tools), `PENTEST_AUTH_*`,
`PENTEST_TARGET_URL`, `PENTEST_ALLOWED_HOSTS`, `PENTEST_FAIL_ON`/`WARN_ON`,
`HEALER_*`, `HEAL_MODE`, `LOCATOR_*`, `AGENT_*`, `PIPELINE_*`, `DECISION_LOG_*`,
`RUN_CHECKPOINT_DIR`, `PREFLIGHT_*`, `SKIP_*`, `LOG_ROTATION_*`/`ROTATION_*`/`MAX_LOG_SIZE_MB`/`LOG_MAX_AGE_DAYS`
(duplicate of the live `LOG_*`), `RATE_LIMIT_*`, `REQUIRE_WEBHOOK_SECRET`,
`WEBHOOK_TRIGGER_STATUSES`, `DISCOVERY_RUN_SECRET`, `VAULT_ADDR`/`VAULT_TOKEN`/`VAULT_SECRET_PATH`
(HashiCorp Vault — the live plane uses `SECRETS_PROVIDER=keyvault` instead),
`PROJECT_KEY`/`APP_NAME`/`APPLICATION_NAME`/`APP_AUTH_URL`, `ARTIFACT_RETENTION_DAYS`.

## 6. Removed / forbidden — raw AI credentials (status **forbidden**)

No AI provider/model/prompt/credential value is *resolved* in the EP, and no **raw** AI credential may
exist here. Any raw-key-shaped AI variable (known or future provider) is rejected at boot and in CI.
AI **selection** (provider/model/prompt-pack references) is permitted under Model B (§2). See
`lib/config-allowlist.js`.

## Secrets ownership

| Secret | Storage (dev) | Storage (prod) |
|---|---|---|
| `CLIENT_SECRET`, `JIRA_API_TOKEN`, `ZEPHYR_API_TOKEN`, `APP_PASSWORD`, `API_SECRET`, `WEBHOOK_SECRET`, `ZAP_API_KEY` | `.env` (git-ignored) | Azure Key Vault via `SECRETS_PROVIDER=keyvault` (CSI / Managed Identity) |
| mTLS cert/key | file paths | Kubernetes Secret / CSI volume |

Never hardcode. Never commit. Rotate on exposure.
