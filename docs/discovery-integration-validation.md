# Discovery Integration — Validation Report

**Date:** 2026-07-12 · **Feature:** Sovereign-Split Discovery API · **ADR:** [ADR-0012](adr/ADR-0012-sovereign-discovery-integration.md)

## 1. Files Added

### Intelligence Plane (`DBiz_IntelligencePlane`)
| File | Purpose |
|---|---|
| `src/orchestrators/discoverySynthesis.js` | Composes existing agents/tools over the EP surface (no new discovery logic) |
| `src/services/discoveryRunStore.js` | Async, tenant-scoped run store (lifecycle + checkpoint durability) |
| `routes/discovery.js` | `POST /api/discovery` + status/artifacts/cancel/retry (async, tier-gated) |
| `tests/unit/discovery/discoverySynthesis.test.js` | 8 jest tests (synthesis + run store + tenant isolation) |

### Execution Plane (`OrangeHRM_ExecutionPlane`)
| File | Purpose |
|---|---|
| `src/discovery/appCrawler.js` | Deterministic Playwright BFS crawl + DOM/network/form capture (no AI) |
| `src/discovery/discoveryExecutionStore.js` | Async run store + on-disk artefact persistence |
| `routes/discovery.js` | Wires the controller into the apiRouter under `apiAuth` |
| `test/discovery-client.test.js` | Client endpoints + PII-scrub assertions |
| `test/discovery-execution.test.js` | Execution store + worker (happy/fail/cancel) |
| `docs/adr/ADR-0012-…md`, `docs/discovery-openapi.yaml`, this report | Documentation |

## 2. Files Modified
| File | Change | Backward-compatible? |
|---|---|---|
| IP `config/tiers.json` | Added `"discovery"` to the **enterprise** tier routes | ✅ additive |
| IP `server.js` | Mounted `require('./routes/discovery')(app)` | ✅ additive |
| EP `clients/intelligence.client.js` | Added `_get`, `discover`, `getDiscoveryStatus`, `downloadArtifacts`, `cancelDiscovery`, `retryDiscovery` | ✅ additive |
| EP `src/api/discovery.controller.js` | Replaced the missing-CLI spawn with the crawl→scrub→delegate→poll→download worker; added `getRunStatus`/`getArtifacts` | ✅ scaffold was non-functional |
| EP `server.js` | Mounted `require('./routes/discovery')(apiRouter)` | ✅ additive |

## 3. APIs Added
- **EP:** `POST /discovery/run`, `GET /discovery/runs/:id`, `GET /discovery/runs/:id/artifacts`, `POST /discovery/cancel/:id` (+ existing `summary`/`runs`).
- **IP:** `POST /api/discovery`, `GET /api/discovery/:id`, `GET /api/discovery/:id/artifacts`, `POST /api/discovery/:id/cancel`, `POST /api/discovery/:id/retry`.

## 4. Test Results
| Suite | Result |
|---|---|
| EP `npm test` (node:test) | **115 pass / 0 fail** (105 pre-existing + 10 new) |
| IP `npx jest` (full) | **956 pass / 0 fail** / 4 skipped (87 suites) |
| IP discovery unit | 8/8 pass |
| Synthesis end-to-end smoke | 1 route → 3 POM files + 1 contract test + 6.4 KB HTML report, 0 tool warnings |

## 5. Coverage (new code)
- IP synthesis: happy path, empty surface, selector resolution, artefact metadata.
- IP run store: lifecycle, tenant isolation, cancel, retry, tenant-scoped list.
- EP client: all 5 methods + URL-encoding + PII scrub.
- EP execution: lifecycle, 409-not-ready, worker happy/fail(reject)/fail(non-complete)/cancel.

## 6. Security Validation
- Transport is OAuth2 client-credentials (short-lived JWT); EP holds **no AI keys**.
- IP route sits behind the full `/api` guard chain + `requireFeature('discovery')` (enterprise tier).
- **PII:** EP strips `Authorization`/`Cookie` at capture, then runs `middleware/pii-scrubber.scrub`
  (field-name + value-regex incl. Luhn-validated cards) before egress — asserted by test.
- Run access is tenant-scoped on both planes (cross-tenant reads return 404/null).

## 7. Performance Impact
- Zero impact on existing routes (additive mounts).
- Discovery is fully async (202 + poll); no request blocks. Crawl bounded by `maxDepth`/`maxPages`;
  IP synthesis is deterministic + optional AI-enrich (gracefully skipped when unconfigured).

## 8. Backward Compatibility
- No existing route, agent, tool, contract, middleware or test was altered in behaviour.
- Both full test suites pass unchanged. Tier change is purely additive.

## 9. Sovereign-Split Compliance
| Rule | Status |
|---|---|
| EP performs browser/crawl/capture/scrub only | ✅ `appCrawler.js` — no AI imports |
| EP never calls Claude/OpenAI / builds prompts / generates POMs/models/contracts | ✅ delegates to IP |
| IP performs all AI reasoning + artefact synthesis | ✅ `discoverySynthesis.js` composes agents |
| Only scrubbed metadata crosses the boundary | ✅ scrub before `intel.discover()` |
| No duplicate discovery implementation | ✅ synthesis reuses existing agents/tools verbatim |

---

## Migration Notes
- **No breaking changes.** Deploy order: IP first (new route + tier), then EP.
- **Tenant enablement:** `discovery` is enabled for the **enterprise** tier; tenants on lower
  tiers receive `403 /discovery is not available on the <tier> tier`.
- **Config:** optional EP env — `DISCOVERY_POLL_INTERVAL_MS` (2000), `DISCOVERY_POLL_TIMEOUT_MS`
  (600000), `DISCOVERY_RUN_SECRET` (optional HMAC on `POST /discovery/run`).
- **Runtime artefacts** are written to EP `logs/discovery/<runId>/artifacts.json` and IP
  `artifacts/discovery/<runId>/` — recommend git-ignoring both.
- The dormant IP `scripts/run-discovery.js` CLI is superseded by the HTTP path and left untouched.
