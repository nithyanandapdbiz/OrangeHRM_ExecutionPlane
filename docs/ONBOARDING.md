# Onboarding a New Tenant ExecutionPlane

This repository is the **canonical template** for a customer Execution Plane that
consumes the DBiz Intelligence Plane. A new tenant is created by **cloning it and
filling in configuration only** — no framework code changes.

> The Execution Plane owns tenant business + AI selection + connectors. The
> Intelligence Plane owns the AI runtime. See [ARCHITECTURE.md](ARCHITECTURE.md)
> and [adr/ADR-0011-tenant-owned-ai-execution-context.md](adr/ADR-0011-tenant-owned-ai-execution-context.md).

## 1. Clone & install
```sh
git clone <this-repo> <tenant>-execution-plane && cd <tenant>-execution-plane
npm ci
```

## 2. Fill in tenant identity — `config/customer.json`
Copy the template and edit **values only**:
```sh
cp config/customer.template.json config/customer.json
```
| Field | Meaning |
|-------|---------|
| `customerId` / `customerName` | tenant id + display name (used in headers, banners, health) — e.g. `orangehrm` / `OrangeHRM` |
| `domain` | business domain sent to the IP (e.g. `human-resources`, `insurance`, `retail`) |
| `jira.issueTypes` | your Jira project's issue-type names (`story`, `bug`, `epic`, `task`, `subtask`) |
| `zephyr` | Zephyr Essential `folder` for generated cases + `statuses` (`pass`/`fail`) |
| `pipeline` | per-run create limits (`testCaseCreateLimit`, `bugCreateLimit`) |

The framework reads these — you never edit `.js` to change tenant identity.

## 3. Choose your AI — `config/ai-profile.json` (Model B)
```sh
cp config/ai-profile.template.json config/ai-profile.json
```
Set `provider` / `model` / `fallbackModel` / `promptPack` / `knowledgeRefs`, and a
**credential reference** `credentialRef: kv://<tenant>/ai/<name>` (never a
raw key — the IP resolves it). Switching provider (Anthropic → OpenAI → Gemini → …)
is a config edit; no code change. See [CONFIGURATION.md](CONFIGURATION.md).

## 4. Set environment & secrets — `.env`
```sh
cp .env.example .env    # .env is git-ignored; .env.example is the tenant env template
```
Fill: `INTELLIGENCE_API_URL`, `CLIENT_ID` + `CLIENT_SECRET` (OAuth2, from DBiz),
`JIRA_BASE_URL` / `JIRA_PROJECT_KEY` / `JIRA_EMAIL` / `JIRA_API_TOKEN`,
`ZEPHYR_API_URL` / `ZEPHYR_API_TOKEN`, the app-under-test creds
(`APP_BASE_URL` / `APP_USERNAME` / `APP_PASSWORD`), and `SECRETS_PROVIDER`.
**No raw AI provider keys** — the guard aborts boot if any raw AI key is present (AI *selection*
references are fine). Full contract: [CONFIGURATION.md](CONFIGURATION.md).

## 5. Validate & run
```sh
npm run config:check     # validates config + prints a secret-safe summary
npm test                 # unit + fitness tests must pass
npm start                # boots; /health shows tenant + Jira/Zephyr/IP reachability
npm run e2e              # trigger a pipeline run (live trace) for ISSUE_KEY (e.g. OHRM-1)
```

## 6. What you will NOT touch
`server.js`, `routes/`, `clients/`, `runners/`, `lib/`, `middleware/` — the framework.
If onboarding requires editing any of these, that is a template defect — file it.

## Onboarding checklist
- [ ] `config/customer.json` filled (no template placeholders remain)
- [ ] `config/ai-profile.json` filled; `credentialRef` is a `kv://` reference
- [ ] `.env` filled with Jira + Zephyr + app creds; no raw AI key present
- [ ] `npm run config:check` green · `npm test` green
- [ ] `/health` shows your `customer`/`domain`, `jira.connected: true`, and `intelligenceApi.reachable: true`
- [ ] a pipeline run (`npm run e2e`) completes end-to-end

## Guides
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Decisions: [adr/](adr/)
- Configuration contract: [CONFIGURATION.md](CONFIGURATION.md)
- AI selection (Model B): [adr/ADR-0011-tenant-owned-ai-execution-context.md](adr/ADR-0011-tenant-owned-ai-execution-context.md)
- Security: [../SECURITY.md](../SECURITY.md)
