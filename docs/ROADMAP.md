# Discovery Platform — Roadmap

> **Implemented in v1.0.0** (do not confuse with roadmap): authenticated SPA crawl,
> BFS/DFS, shadow-DOM/iFrame/dynamic-content, component + accessibility discovery,
> navigation graph, knowledge graph, workflow inference, business rules, coverage
> intelligence, risk engine, recommendations, delta/graph-diff/change-impact, graph query,
> enterprise reports, AI-readiness contract, CLI, production hardening, certification.

The items below are **planned, not implemented**. They are direction only.

## v1.1 — Scale & Persistence
- **Enterprise scheduler** — cron/queue-driven recurring discovery.
- **Distributed crawling** — bounded parallel same-origin crawl with deterministic merge.
- **Kubernetes scaling** — horizontal EP/IP scaling; shared queue backend.
- **Persistent graph database** — durable knowledge graph (replaces in-memory run stores);
  enables cross-restart delta + version history.
- **Advanced GraphQL schema inference** — operation/type extraction from captured traffic.
- **Cross-application dependency discovery** — links between discovered applications.

## v1.2 — Autonomy
- **Autonomous test generation from workflows** — executable suites from inferred journeys.
- **AI self-healing evolution** — selector-repair loops driven by the selector repository.
- **Multi-application discovery** — portfolio-wide crawl orchestration.
- **Enterprise portfolio intelligence** — aggregated coverage/risk across applications.

## v2.0 — Continuous Enterprise Intelligence
- **Full autonomous application understanding** — end-to-end model without seeds.
- **Continuous discovery** — always-on change detection + incremental re-model.
- **Enterprise knowledge-graph federation** — cross-tenant/cross-app graph queries.
- **Autonomous release intelligence** — change-impact-driven release gating.
- **Cross-platform application intelligence** — web + mobile + API surfaces unified.

---

*Roadmap items carry no delivery commitment and may change. Only v1.0.0 features are
supported and certified today.*
