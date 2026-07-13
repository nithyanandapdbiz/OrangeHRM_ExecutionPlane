# Production Hardening Report — Phase 4.1 (Findings F1–F4)

**Date:** 2026-07-13 · **Scope:** close the four certification findings from
[PRODUCTION-CERTIFICATION.md](PRODUCTION-CERTIFICATION.md) with additive, localized,
backward-compatible changes. **No** new features, API, contract, or artifact-format changes.

---

## Certification Delta

| Finding | Severity | Before | After |
|---|---|---|---|
| **F1** Browser resource leak | Medium | cleanup not guaranteed on error | `try/finally` — browser closed on every path ✅ |
| **F2** Run-store memory growth | Medium | unbounded Map | TTL + capacity caps + eviction + metrics ✅ |
| **F3** Checkpoint race | Low | shared `.tmp` → ENOENT | unique temp per write + retry/fallback ✅ |
| **F4** Artifact filename validation | Low | names trusted | canonical path guard, stays in run dir ✅ |

**Result:** Critical 0 · High 0 · Medium 0 · Low 0 — all findings closed.

---

## What changed, why, and evidence

### F1 — Browser resource leak → `src/discovery/appCrawler.js`
**Change:** wrapped the crawl lifecycle in `try { … } finally { await browser.close() }`.
The finally runs on *every* exit path (login/nav/extraction/timeout errors); the original
exception is never suppressed, and a cleanup failure is logged (not thrown).
**Why:** an unexpected throw between `chromium.launch()` and `browser.close()` previously
leaked a Chromium process.
**Evidence:** 2 unit tests (throw during `newContext`, throw during `newPage`) assert
`browser.close()` ran and the original error propagated; live discovery still completes
(6 routes). Behaviour + return shape unchanged (`context.close()` is implied by
`browser.close()`).

### F2 — Run-store memory growth → `discoveryRunStore.js` (IP) + `discoveryExecutionStore.js` (EP)
**Change:** added bounded retention — `DISCOVERY_RUN_TTL_MS` (default 24 h),
`DISCOVERY_MAX_COMPLETED_RUNS` (100), `DISCOVERY_MAX_FAILED_RUNS` (50). `evict()` runs on
each `create()`; **active (non-terminal) runs are never evicted**; each eviction is logged;
`metrics()` reports `retained/active/completed/failed/evicted`.
**Why:** the in-memory Map retained every run (incl. artefacts) indefinitely.
**Evidence:** 6 unit tests (3 EP + 3 IP) cover capacity eviction, TTL expiry, active-run
preservation, and metrics. Artefacts persist to disk, so eviction is lossless — existing
`get`/`getArtifacts` APIs are unchanged.

### F3 — Checkpoint race → `discovery.state.js` (EP + IP)
**Change:** the temp file is now unique per write
(`<file>.tmp.<pid>.<time36>.<rand>`); rename is retried once and falls back to a direct
write. Checkpoint **content is unchanged** (only the temp filename differs) → determinism
preserved.
**Why:** concurrent same-`runId` checkpoints shared one `.tmp` path → intermittent `ENOENT`
on rename.
**Evidence:** unit test fires **20 concurrent** `writeCheckpoint` on one runId — all succeed,
checkpoint readable; a determinism test confirms identical content for identical payloads.
Live: **0 `ENOENT`** in IP + EP logs after the change (was logged every run).

### F4 — Artifact filename validation → `scripts/discover.js`
**Change:** `isSafeArtifactPath(rel, baseDir)` rejects `..`, absolute paths, drive letters,
`.`, empty, and control characters, and verifies the resolved path stays inside the run
directory; `writeArtifacts` skips + logs unsafe names.
**Why:** IP-supplied artefact names were written via `path.join` without traversal guards.
**Evidence:** 2 unit tests cover accept (relative, subdir, unicode) and reject (traversal,
absolute, drive letter, control char, empty, `.`). Existing safe names
(`metadata.json`, `page-objects/*`, …) are preserved.

---

## Files modified / added

**Modified (6):**
`OrangeHRM_ExecutionPlane/src/discovery/appCrawler.js` (F1),
`.../src/discovery/discoveryExecutionStore.js` (F2),
`.../src/core/discovery.state.js` (F3),
`.../scripts/discover.js` (F4),
`DBiz_IntelligencePlane/src/services/discoveryRunStore.js` (F2),
`DBiz_IntelligencePlane/src/core/discovery.state.js` (F3).

**Tests added (2 files, 12 tests):**
`OrangeHRM_ExecutionPlane/test/discovery-hardening.test.js` (F1×2, F2×3, F4×2),
`DBiz_IntelligencePlane/tests/unit/discovery/hardening.test.js` (F2×3, F3×2).

---

## Verification (evidence)

| Check | Before | After |
|---|---|---|
| EP tests | 131 pass | **138 pass / 0 fail** |
| IP full suite | 974 pass | **979 pass / 0 fail** |
| IP discovery suite | 26 | **31 pass** |
| EP lint | clean | clean |
| Live discovery (F1 happy path) | completes | **completes (6 routes)** |
| ENOENT checkpoint warnings (F3) | every run | **0** |
| Determinism | preserved | preserved (F3 content test) |
| API / contracts / artefact formats | — | **unchanged** |

## Performance impact
Negligible: F1 adds one `finally`; F2 eviction is O(terminal runs) once per `create`; F3
changes only the temp filename; F4 is a per-file string check. No measurable regression in
crawl or synthesis time.

## Backward compatibility
Fully additive. No endpoint, request/response shape, artefact format, or public store API
changed. All pre-existing tests pass unchanged. New behaviour is env-tunable with safe
defaults.
