# Discovery Platform — Release Manifest

| Field | Value |
|---|---|
| **Release** | Discovery Platform **v1.0.0** |
| **Release name** | Discovery Platform 1.0 |
| **Release timestamp** | 2026-07-13 |
| **Certification** | ✅ Certified for Enterprise Production Deployment (Critical 0 / High 0 / Medium 0 / Low 0) |
| **Architecture** | Sovereign Split — Execution Plane + Intelligence Plane |

## Repository versions

| Repository | Version | Branch | Role |
|---|---|---|---|
| `OrangeHRM_ExecutionPlane` | 1.0.0 | `main` | Execution Plane (crawl, CLI, controller) — Discovery Platform home |
| `DBiz_IntelligencePlane` | 1.0.0 (Discovery API v1.0) | `release/v2.0-enterprise` | Intelligence Plane (synthesis, intelligence, delta) |

## Commit identifiers

**Execution Plane (`main`):**
| Commit | Message |
|---|---|
| `1b2c48f` | feat(discovery): sovereign-split discovery integration + crawl engine |
| `098f990` | feat(cli): enterprise discovery CLI (npm run discover) |
| `08193cb` | test(discovery): EP discovery, CLI and hardening test suites |
| `7b45a4e` | docs(release): v1.0.0 ADRs, certification, validation and release notes |
| `a3be4c3` | chore(release): ignore discovery runtime artefacts |

**Intelligence Plane (`release/v2.0-enterprise`):**
| Commit | Message |
|---|---|
| `5d32ab8` | feat(discovery): intelligence-plane synthesis, modelling, intelligence + API |
| `a547917` | test(discovery): IP synthesis, modeler, intelligence, delta and hardening tests |
| `d10d672` | chore(release): discovery changelog + ignore discovery runtime artefacts |

## Interface versions

| Interface | Version |
|---|---|
| Discovery REST API (OpenAPI) | 1.0.0 |
| AI-Readiness contract | 1.0 |
| Checkpoint schema | 1 |

## Documentation versions

| Doc | Version / ID |
|---|---|
| ADRs | 0012, 0013, 0014, 0015 |
| Production Certification | v1.0 (2026-07-13) |
| Production Hardening Report | Phase 4.1 |
| Release Validation | v1.0 |
| Release Notes | v1.0.0 |

## Quality gate evidence (at release)

| Gate | Result |
|---|---|
| Execution Plane tests | 138 / 138 pass |
| Intelligence Plane tests | 979 pass / 0 fail (clean run) |
| Lint (EP) | 0 problems |
| Determinism | byte-identical (SHA-256 verified) |
| Compute scale | near-linear to 5,000 routes / 27,523-node graph (~190 ms) |
| Security | no secrets on disk/git; OAuth2 enforced; PII scrubbed |

## Tag

```
git tag -a v1.0.0 -m "Discovery Platform 1.0"     # in OrangeHRM_ExecutionPlane
```

> Note: the IP integration suite has a pre-existing intermittent teardown-leak flake in
> `release-1.0/1.1` tests (unrelated to Discovery); clean runs are 979/0.
