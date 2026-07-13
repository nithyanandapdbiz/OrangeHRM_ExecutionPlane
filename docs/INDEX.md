# Discovery Platform — Documentation Index (v1.0.0)

Central index for the Discovery Platform documentation across the Sovereign-Split repos.

## Start here
| Doc | Purpose |
|---|---|
| [README](../README.md) | Overview, setup, running the platform, §8b **CLI usage** |
| [RELEASE_NOTES](../RELEASE_NOTES.md) | v1.0.0 features, limitations, verdict |
| [CHANGELOG](../CHANGELOG.md) | Dated change history (all phases) |
| [ROADMAP](ROADMAP.md) | v1.1 / v1.2 / v2.0 direction (not implemented) |
| [RELEASE-MANIFEST](RELEASE-MANIFEST.md) | Versions, commits, API/doc versions, timestamp |

## Architecture & Decisions (ADRs)
| ADR | Topic |
|---|---|
| [ADR-0012](adr/ADR-0012-sovereign-discovery-integration.md) | Sovereign-Split Discovery integration (+ 8 diagrams) |
| [ADR-0013](adr/ADR-0013-discovery-crawl-enhancement.md) | Enterprise crawl (SPA-aware, multi-route) |
| [ADR-0014](adr/ADR-0014-discovery-phase2-enterprise.md) | Deep DOM (shadow/iframe/dynamic) + knowledge graph + workflows |
| [ADR-0015](adr/ADR-0015-discovery-phase3-intelligence.md) | Discovery intelligence (rules/coverage/risk/recs/delta/query/reports/AI-readiness) |

## API & Interfaces
| Doc | Purpose |
|---|---|
| [discovery-openapi.yaml](discovery-openapi.yaml) | OpenAPI 3.0 — EP + IP discovery endpoints |
| README §8b | CLI reference + CI/CD examples |
| [.discoveryrc.example.json](../.discoveryrc.example.json) | CLI configuration template |

## Certification & Validation
| Doc | Purpose |
|---|---|
| [PRODUCTION-CERTIFICATION.md](PRODUCTION-CERTIFICATION.md) | Enterprise production audit + scores |
| [PRODUCTION-HARDENING-REPORT.md](PRODUCTION-HARDENING-REPORT.md) | F1–F4 hardening + certification delta |
| [RELEASE-VALIDATION-v1.0.md](RELEASE-VALIDATION-v1.0.md) | G1 scale + G2 cross-platform + determinism + performance |
| [discovery-integration-validation.md](discovery-integration-validation.md) | Integration validation report |

## Capabilities → where documented
| Capability | Reference |
|---|---|
| Discovery crawl (SPA/shadow/iframe/dynamic) | ADR-0013, ADR-0014 |
| Knowledge graph & workflow discovery | ADR-0014 |
| Discovery intelligence (rules/coverage/risk/recs) | ADR-0015 |
| Delta / graph-diff / change-impact | ADR-0015 |
| Graph query engine | ADR-0015, OpenAPI |
| CLI / developer experience | README §8b |
| Troubleshooting | README §8b (health pre-flight) + `logs/discovery-cli.log` |
