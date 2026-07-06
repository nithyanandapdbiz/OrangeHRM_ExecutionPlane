# ADR-0004 — Deployment & Packaging

- **Status:** Proposed (partially implemented — Helm chart scaffolded; deploy + supply-chain decisions pending)
- **Debt:** TD-16, TD-10

## Context

The Execution Plane runs in each customer's Azure tenant. Until now the only artefact
was a `Dockerfile`; there was no repeatable way to deploy, configure per tenant, or
attest the image. A Helm chart now exists (`deploy/helm/execution-plane`) with a
container `HEALTHCHECK`, but several decisions remain before this is production-grade.

## Decisions to ratify

1. **IaC for cluster + identity.** Helm packages the workload, but the AKS cluster,
   container registry, Managed Identity, and Key Vault must be provisioned somewhere.
   - *Option A — Terraform module per tenant* (recommended): one reviewed module emits
     cluster refs, identity, and the secret store. Pro: auditable, repeatable. Con: build-out cost.
   - *Option B — Bicep* (Azure-native). Pro: first-class Azure. Con: less portable.

2. **Image supply chain (TD-10).** Decide and wire:
   - Non-root image: relocate the Playwright browser cache off `/root/.cache` so the
     chart's `runAsNonRoot` is satisfiable.
   - SBOM generation (Syft) + signing (cosign) + provenance attestation in CI.

3. **Scaling posture.** The chart pins `replicaCount: 1` (see ADR-0005). Ratify that
   single-instance is the supported topology until external state lands.

## Consequences

- `helm install` against a real cluster is **deploy-pending** (external infrastructure).
- The chart intentionally ships no HPA; adding one before ADR-0005 would corrupt run state.
