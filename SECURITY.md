# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to the DBiz Product Engineering security
contact (do **not** open a public issue). Include affected component, reproduction,
and impact. You will receive an acknowledgement within 2 business days.

## Security model (summary)

This service is the customer-tenant **Execution Plane** of a sovereign-split platform.
Its security posture is defined by:

- **No raw AI credential may exist here** — enforced at boot (`middleware/startup-guard`,
  `docker-entrypoint.sh`); the process exits if any raw AI-provider credential is present. AI *selection*
  is shipped to the Intelligence Plane as references (`kv://…`) only (Model B, ADR-0011).
- **PII is scrubbed before the boundary** — `middleware/pii-scrubber` (unit-tested).
- **Customer connectors stay local** — the Jira API token, Zephyr token, and the OrangeHRM app
  credentials (`APP_USERNAME`/`APP_PASSWORD`) never cross the AI boundary; only PII-scrubbed story text does.
- **Privileged `/run` is authenticated** when `API_SECRET` is set (`middleware/apiAuth`).
- **Secrets and session state are never committed** — `.gitignore` / `.dockerignore`
  exclude `.env` and `.auth/`. CI and PRs must never introduce secrets.
- **Pluggable secret source** — `lib/secrets.js` defaults to the environment but can
  hydrate from Azure Key Vault (`SECRETS_PROVIDER=keyvault`, `AZURE_KEY_VAULT_URL`,
  Managed Identity) at boot, so `.env` is not required in production (TD-08).

## Known hardening backlog (tracked)

See [`docs/TECH-DEBT.md`](docs/TECH-DEBT.md) and the ADRs under [`docs/adr/`](docs/adr/).
Open items include: secrets from a managed vault (not `.env`), mTLS + short-lived tokens
between planes, non-root container, SBOM + image signing, and OAuth/OIDC on the API.

## Secret handling rules (contributors)

- Never commit `.env`, `.auth/`, Jira/Zephyr API tokens, JWTs, or the OrangeHRM app credentials.
- Rotate any credential that is exposed in chat, logs, or a shared environment.
- Use **least-privilege, short-lived** tokens: scope the **Jira API token** to the pipeline's
  project (read stories, create bugs/links) and the **Zephyr Essential token** to test-management
  operations only. Keep the app-under-test login (`APP_USERNAME`/`APP_PASSWORD`) to a non-privileged
  demo/QA account, never a production admin.
