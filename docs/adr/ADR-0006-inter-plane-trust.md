# ADR-0006 — Inter-Plane Trust (mTLS + Short-Lived Tokens)

- **Status:** Proposed (decision required — NOT implemented)
- **Debt:** TD-09

## Context

The Execution Plane authenticates to the Intelligence Plane with a single, long-lived
OAuth2 client-credentials → short-lived JWT (Bearer header, see `clients/intelligence.client.js`; superseded the legacy static CUSTOMER_JWT). The IP can
revoke a tenant (the client handles `401 { blocked: true }`), but until it does, a stolen
token grants persistent cross-plane access, and there is no transport-level mutual
authentication between the planes.

## Decisions to ratify

1. **Short-lived, rotated credentials.** Replace the static JWT with one of:
   - *Option A — OIDC workload identity* (recommended): the EP's Managed Identity
     federates to the IP; tokens are minted per-call, minutes-long, auto-rotated.
   - *Option B — Issued JWT with short TTL + refresh*: smaller change, still a shared secret.
2. **Mutual TLS.** Require client certificates between planes (or a service mesh / mTLS
   sidecar) so the IP only accepts connections from attested EP workloads.
3. **Token scope.** Scope the credential to the specific IP routes the tenant's tier
   permits, so a leak cannot reach unrelated endpoints.

## Consequences

- Shrinks the blast radius of a leaked credential from "persistent" to "minutes".
- Pairs with TD-08 (secrets from Key Vault): the federation/cert material is sourced from
  the vault, never `.env`.
- Requires coordinated change on **both** planes — track the IP-side counterpart in the
  Intelligence Plane repository.
