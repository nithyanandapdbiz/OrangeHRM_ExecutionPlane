# Deploying the Execution Plane

The Execution Plane runs **inside the OrangeHRM tenant** (one release per
tenant). It holds the customer's secrets and PII and never holds an AI-provider
credential — the container's startup guard exits if one is present.

## Artefacts

| Path | Purpose |
|------|---------|
| [`../Dockerfile`](../Dockerfile) | Multi-stage build (exec deps + Playwright + runtime) with a `HEALTHCHECK`. |
| [`helm/execution-plane/`](helm/execution-plane/) | Helm chart (Deployment, Service, ConfigMap, probes, pod hardening). |

## Status

| Stage | State |
|-------|-------|
| Container image build | ✅ scaffolded — `docker build` |
| Helm chart authored | ✅ scaffolded |
| Cluster `helm install` | ⏳ **deploy-pending** — requires a target AKS cluster, registry, and a populated secret (external infrastructure). |

## Prerequisites (external infrastructure)

1. A container registry reachable by the cluster; set `image.repository`/`image.tag`.
2. A Kubernetes `Secret` named per `values.yaml#existingSecret`, sourced from
   Azure Key Vault (CSI Secrets Store driver or External Secrets Operator):

   ```sh
   kubectl create secret generic execution-plane-secrets \
     --from-literal=CLIENT_ID=… --from-literal=CLIENT_SECRET=… \
     --from-literal=JIRA_API_TOKEN=… \
     --from-literal=JIRA_EMAIL=… \
     --from-literal=ZEPHYR_API_TOKEN=… \
     --from-literal=APP_USERNAME=… \
     --from-literal=APP_PASSWORD=… \
     --from-literal=API_SECRET=…
   ```

   It must **not** contain any AI-provider credential.

## Build

```sh
docker build -t <registry>/orangehrm-execution-plane:1.0.0 \
  --build-arg PLATFORM_PACKAGE_DIR=../OrangeHRM_AgenticQAPlatform .
docker push <registry>/orangehrm-execution-plane:1.0.0
```

## Validate the chart (no cluster needed)

```sh
helm lint deploy/helm/execution-plane
helm template ep deploy/helm/execution-plane | kubectl apply --dry-run=client -f -
```

## Deploy

```sh
helm upgrade --install ep deploy/helm/execution-plane \
  --namespace execution-plane --create-namespace \
  --set image.repository=<registry>/orangehrm-execution-plane \
  --set image.tag=1.0.0
```

## Operational constraints

- **`replicaCount` is pinned to `1`.** The app keeps run state in process-global
  memory and fixed artefact paths (TD-12); a second replica corrupts in-flight
  runs. The Deployment uses the `Recreate` strategy for the same reason. Scaling
  out is blocked until that state is externalised.
- Egress should be restricted to Jira, Zephyr, the Intelligence Plane, and the
  app under test (enable `networkPolicy` and add the rules for your environment).
