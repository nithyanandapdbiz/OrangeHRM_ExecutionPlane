# ADR-0011 — Tenant-Owned AI via ExecutionContext (Model B)

- **Status:** Accepted (2026-07) — supersedes the AI-ownership stance of ADR-0001
- **Decision owner:** ratified by the platform owner on explicit review

## Context

Two ownership models were in play:

- **Model A (prior, ADR-0001 "sovereign split"):** DBiz owns the AI (its key, its
  model). The EP holds zero AI config; the EP guard aborts boot on any AI-shaped var.
- **Model B (this ADR):** the **tenant** (Execution Plane) is the authoritative owner
  of AI **selection** — provider, model, prompt-pack, knowledge, credential
  **references** — and ships it to the shared, provider-agnostic DBiz runtime in an
  immutable ExecutionContext. DBiz executes solely from that context.

The platform owner selected **Model B** to make DBiz a shared multi-tenant Enterprise
Intelligence Platform (each tenant brings its own provider/model), with OrangeHRM
as the authoritative owner of its tenant-specific business + AI + connector config.

## Decision

1. **The EP owns AI selection**, canonically in [`config/ai-profile.json`](../../config/ai-profile.json)
   (env-overridable). It contains provider/model/parameters/promptPack/knowledgeRefs/
   routing/guardrails — and a credential **reference** (`kv://…`), never a raw key.
2. **The EP builds an immutable, versioned ExecutionContext V1** on every call
   ([`lib/execution-context.js`](../../lib/execution-context.js)) and ships it to the IP
   ([`clients/intelligence.client.js`](../../clients/intelligence.client.js)).
3. **Boundary redefined (still enforced):**
   - The EP performs **no inference** — no AI SDK import, no model call (FF-01, unchanged).
   - The EP holds **no raw AI credential** — raw provider keys remain forbidden
     (credential-shaped allowlist rule); tenants supply `AI_CREDENTIAL_REF`.
   - AI **selection** vars (`AI_PROVIDER`, `AI_MODEL`, `PROMPT_PACK`, …) are now
     **allowed** in the EP (previously forbidden under Model A).

## Consequences

- **EP side (done):** ai-profile, ExecutionContext V1 + builder/validator, allowlist
  relaxation, client wiring, tests (63/63), `.env.example`. Business fields remain at
  the top level of the request for backward compatibility.
- **IP side (REQUIRED follow-up — not yet done):** the Intelligence Plane must
  **resolve provider/model/credential-ref per request from `executionContext`** instead
  of its own global `ANTHROPIC_MODEL`/`ANTHROPIC_API_KEY` env. Until it does, runtime
  behaviour is unchanged (the IP ignores the context) — this is the migration seam.
  Tracked as the EP↔IP contract below. This *does* mean changing DBiz, which the review
  text discouraged; Model B cannot be completed without it.

## EP → IP contract (ExecutionContext V1)

```
POST /v1/<capability>
Headers: Authorization: Bearer <short-lived OAuth2 JWT>, X-Customer-ID, X-Request-Id
Body: { <business fields…>, executionContext: {
  version, metadata{executionId,correlationId,timestamp,source},
  tenant{id,name,domain}, identity{userId,roles},
  security{classification, credentialRefs{ai:"kv://…"}},
  ai{provider,model,fallbackModel,parameters,promptPack,knowledgeRefs,routing,guardrails},
  business, connectors{jira,zephyr}, telemetry{correlationId} } }
```

The IP resolves `credentialRefs.ai` against the tenant vault, selects `ai.provider`/
`ai.model`, loads `promptPack.ref@version`, and executes — requiring **no** tenant
configuration of its own. Versioned via `executionContext.version`.
