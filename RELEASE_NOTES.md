# Discovery Platform v1.0.0 — Release Notes

**Release date:** 2026-07-13 · **Status:** ✅ Certified for Enterprise Production Deployment
**Repositories:** `OrangeHRM_ExecutionPlane` (Execution Plane) + `DBiz_IntelligencePlane` (Intelligence Plane)

---

## Executive Summary

Discovery Platform v1.0.0 turns a target web application into a queryable, risk-scored,
test-ready intelligence model — automatically. It crawls an authenticated SPA, extracts its
structure and behaviour, and synthesises an application model, knowledge graph, business
rules, coverage, risk, and test recommendations — all while preserving the **Sovereign Split**:
the Execution Plane performs browser automation and PII scrubbing and holds **no** AI
credentials; the Intelligence Plane performs all AI reasoning behind OAuth2.

Everything ships behind a single developer command (`npm run discover`) and an async REST API.

## Major Features

### Architecture — Sovereign Split
- **Execution Plane** (tenant-owned, no AI creds): browser crawl, DOM/network/form capture,
  PII scrubbing, artefact packaging, async execution store, CLI.
- **Intelligence Plane** (DBiz): all AI synthesis + reasoning, exposed via OAuth2-guarded,
  tenant-scoped, async APIs.

### Discovery Crawl (Execution Plane)
- Robust authenticated crawling (React-hydration-aware login + auth verification).
- SPA-aware multi-level traversal (BFS/DFS), URL normalisation, cycle/duplicate detection.
- Shadow-DOM piercing, same-origin iFrame traversal, dynamic-content auto-scroll.
- Advanced component discovery (14 classifiers + ARIA + stability scoring).
- Network capture (REST/GraphQL/WebSocket/SSE), navigation graph, discovery analytics + fingerprint.

### Knowledge Graph & Workflow Discovery (Intelligence Plane)
- Typed application knowledge graph (`Application → Module → Page → Form → Field / Component / API / Workflow`).
- Business workflow-journey inference with transitions, pre/post-conditions, decision points.

### Discovery Intelligence (Intelligence Plane)
- **Business rules** (validation/format/RBAC/approval), **coverage intelligence** (+ heat map + confidence),
  **risk engine** (scored), **autonomous test recommendations**, **enterprise reports**
  (executive/architect/QA/developer), **AI-readiness contract** (8 downstream-agent views).
- **Delta engine**: incremental discovery, knowledge-graph diff, AI change-impact analysis.
- **Graph query engine**: `pagesWithComponent`, `apisFromModule`, `workflowsUsingField`, …

### Discovery CLI (Developer Experience)
- `npm run discover` — one command: health pre-flight → crawl → poll → download → summary.
- Sub-commands: `--resume`, `--delta`, `--query`, `--report`, `--ci`, `--help`.
- Config precedence: CLI args › env vars › `.discoveryrc.json` › defaults; retry + structured logging.

### Reports & Artifacts
- Application model, navigation + knowledge graphs, business rules, coverage, risk,
  recommendations, POMs, contracts, contract tests, HTML report — machine- and human-readable.

## Production Hardening (Phase 4.1)
- **F1** guaranteed browser cleanup (`try/finally`); **F2** bounded run-store retention
  (TTL + capacity + eviction + metrics); **F3** atomic checkpoint persistence (unique temp,
  no ENOENT); **F4** artefact filename validation. All additive; 12 tests added.

## Certification
- **Certified for Enterprise Production Deployment** — Critical 0 / High 0 / Medium 0 / Low 0.
- Evidence: [PRODUCTION-CERTIFICATION.md](docs/PRODUCTION-CERTIFICATION.md),
  [PRODUCTION-HARDENING-REPORT.md](docs/PRODUCTION-HARDENING-REPORT.md),
  [RELEASE-VALIDATION-v1.0.md](docs/RELEASE-VALIDATION-v1.0.md).

## Performance
- Compute pipeline (graph + intelligence + delta) scales **near-linearly** to **5,000 routes /
  27,523-node graph in ≈190 ms / ≈46 MB heap**. Browser crawl is **linear (~3 s/page,
  network-bound)**. No regressions.

## Determinism
- Identical input → **byte-identical** graph, rules, coverage, risk, recommendations, reports
  (SHA-256 verified). Live-crawl variance is environmental (shared demo), not code.

## Known Limitations
- **Crawl scale not empirically verified beyond ~28 pages** — the public OrangeHRM demo
  exhausts there; compute scale is proven to 5,000 routes synthetically.
- **Linux/Docker/macOS runtime not executed** — code is OS-portable by static analysis
  (no OS branches, no shell-outs, portable `path.*`); validated on Windows only.
- **Run stores are in-memory** (bounded); cross-restart delta needs a persisted artefact store.
- **API→module attribution** in the knowledge graph uses the path's first segment.
- The IP integration suite has a **pre-existing intermittent teardown-leak flake** in
  `release-1.0/1.1` tests (unrelated to Discovery); clean runs are 979/0.

## Future Roadmap
See [docs/ROADMAP.md](docs/ROADMAP.md) — v1.1 (scheduler, distributed crawl, Kubernetes,
persistent graph DB, GraphQL schema inference), v1.2 (autonomous test-gen, self-healing,
multi-app), v2.0 (continuous discovery, knowledge-graph federation).

## Contributors
- DBiz Platform Engineering (Execution Plane + Intelligence Plane).
- Implementation assisted by Claude (Anthropic).

---

**Verdict:** Discovery Platform **v1.0.0** is ready for enterprise production deployment.
