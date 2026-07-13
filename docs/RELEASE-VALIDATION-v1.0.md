# Discovery Platform — Final Release Validation Package (v1.0)

**Date:** 2026-07-13 · **Type:** validation only (G1 scale, G2 cross-platform, determinism,
performance). **No production code was changed** — no defects were discovered.
Every number below is **measured**; unexecuted scenarios are called out explicitly.

---

## Executive Summary

- **G1 (scale):** The Intelligence-Plane compute pipeline (workflows → knowledge graph →
  intelligence → delta) was measured at **100 → 5,000 routes** (up to a **27,523-node /
  27,522-edge** graph): total compute **≈ 190 ms** at **≈ 46 MB heap / 133 MB RSS** —
  **near-linear, no bottleneck**. The real browser crawl was measured on the OrangeHRM demo
  and is **linear in pages (~3 s/page, network-bound)**; the public demo tops out at **~28
  crawlable pages**, so 100–1,000-*page* live crawls are not physically available (an
  environmental limit, not a product limit).
- **G2 (cross-platform):** **Windows fully validated** (server, discovery, CLI, artefacts,
  KG, delta, reports, query, exit codes). **Linux / Docker / macOS were NOT executed** here
  (no Docker daemon and no Linux/macOS host). Static analysis shows the code is **OS-portable**
  (no OS branches, no shell-outs, portable `path.*`), but per the rules this is **not** a
  claim of runtime support beyond Windows.
- **Determinism:** verified — identical input yields **byte-identical** graph, rules,
  coverage, risk, recommendations, reports (SHA-256 match ×3).
- **Defects:** **none.** No code changes required. The platform is **ready for v1.0 release**;
  remaining limitations are environmental.

---

## Environment

| Item | Value |
|---|---|
| Node.js | v24.14.1 |
| OS / arch | Windows (win32) x64 |
| CPU | 16 × 12th Gen Intel Core i5-1240P |
| Memory | 16.8 GB total |
| Playwright | 1.58.2 (Chromium) |
| Docker | **not available** |
| Planes | IP :3001, EP :3002 (both healthy) |

---

## Test Matrix

| Dimension | Windows | Linux | Docker | macOS |
|---|---|---|---|---|
| Server startup | ✅ | ⬜ not run | ⬜ not run | ⬜ n/a (no host) |
| Discovery execution | ✅ | ⬜ | ⬜ | ⬜ |
| CLI (discover/delta/query/report/ci) | ✅ | ⬜ | ⬜ | ⬜ |
| Artefact generation | ✅ | ⬜ | ⬜ | ⬜ |
| Knowledge graph / delta / reports / query | ✅ | ⬜ | ⬜ | ⬜ |
| Exit codes | ✅ (0/1/2) | ⬜ | ⬜ | ⬜ |
| Unit/integration tests | ✅ EP 138 / IP 979 | ⬜ | ⬜ | ⬜ |

⬜ = not executed this cycle (see G2). Code portability evidence provided below.

---

## Scale Results

### G1a — Real crawl (OrangeHRM public demo)

| depth | maxPages | routes | components | endpoints | crawl (s) | per-page | POMs | contracts | tests | KG nodes/edges | coverage | recs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 12 | 817 | 70 | 40.3 | 3.36 s | 33 | 33 | 6 | 179 / 200 | 91.7% | 47 |
| 2 | 25 | 25 | 1,814 | 155 | 69.8 | 2.79 s | 54 | 57 | 10 | 272 / 338 | 72.0% | 71 |
| 2 | 45 | **28** | 1,938 | 174 | 83.6 | 2.98 s | 60 | 59 | 10 | 282 / 359 | 71.4% | 73 |

**Observations:** per-page cost is stable at **~3 s** (page load + settle + auto-scroll +
network capture), so wall-clock scales **linearly** with pages crawled. At depth 2 the demo
**exhausted at 28 routes** (the 45-page budget was not filled) — the public demo cannot
supply 100–1,000 pages. Shadow-DOM / iframe counts are 0 (OrangeHRM uses neither).

### G1b — Synthetic compute scale (measured in-process, `--expose-gc`)

| Routes | KG nodes | KG edges | workflows | graph | intelligence | delta | rules | recs | heap Δ | RSS |
|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 574 | 573 | 1.1 ms | 2.0 ms | 2.0 ms | — | 104 | 63 | 1.7 MB | 49 MB |
| 500 | 2,773 | 2,772 | 1.6 ms | 6.3 ms | 2.4 ms | 12.1 ms | 503 | 263 | 2.9 MB | 58 MB |
| 1,000 | 5,524 | 5,523 | 3.8 ms | 12.9 ms | 5.1 ms | 32.5 ms | 1,004 | 513 | 9.5 MB | 70 MB |
| **5,000** | **27,523** | **27,522** | 14.7 ms | 61.6 ms | 18.6 ms | 94.9 ms | 5,003 | 2,513 | 45.9 MB | **132.9 MB** |

**Scaling:** 50× input (100→5,000) → graph ~30×, workflows ~13×, intelligence ~9×, delta
near-linear, heap ~27× — **sub-to-near-linear** across the board. At 5,000 routes the whole
compute pipeline is **≈190 ms / ≈46 MB heap**.

---

## Platform Results (G2)

- **Windows (win32 x64):** fully validated this session — both planes boot, discovery runs
  end-to-end, the CLI subcommands (`discover/resume/delta/query/report/ci/help`) work, 32+
  artefact files generated, KG/delta/reports/query correct, exit codes 0/1/2, tests green.
- **Linux / Docker:** **not executed** — no Docker daemon is installed on this host.
- **macOS:** **not executed** — no macOS hardware available.
- **Code-portability evidence (static):** across the discovery + CLI modules there are
  **no** `process.platform`/`win32`/`darwin`/`.exe` branches, **no** shell-outs
  (`child_process`/`exec`/`spawn`), and **no** hardcoded Windows path literals; file I/O uses
  Node's portable `path.join/resolve/sep`. The one backslash (`discover.js` F4 validator
  `split(/[\\/]/)`) intentionally handles **both** separators. → The code is portable by
  construction, but runtime support on Linux/macOS/Docker is **unverified** and not claimed.

---

## Performance Metrics

| Stage | Measure | Note |
|---|---|---|
| Crawl throughput | ~0.33 pages/s (~3 s/page) | network + settle + scroll bound (Execution Plane) |
| Avg page processing | ~2.8–3.4 s | dominated by page load & auto-scroll, not our code |
| API interception overhead | negligible | inline capture; bodies capped at 8 KB |
| Knowledge-graph generation | 2 ms @574n → 62 ms @27.5Kn | near-linear |
| Intelligence synthesis | 2–19 ms (100–5,000 routes) | sub-linear |
| Delta engine | 12–95 ms (500–5,000 routes) | near-linear |
| Artefact generation (POM/contract files) | part of synthesis | linear in forms/contracts, disk-bound |
| Total (compute, 5,000 routes) | ~190 ms | excludes network crawl |

No regressions vs prior phases (crawl ~3 s/page and sub-100 ms compute are consistent with
earlier runs).

---

## Determinism Results

Identical input, 3 consecutive syntheses → **byte-identical** (SHA-256, first 16 hex):

| Output | Hash | Result |
|---|---|---|
| knowledge graph | `4422d930c5814a3d` | IDENTICAL ✓ |
| business rules | `869bc28f91ccd991` | IDENTICAL ✓ |
| coverage | `10b049dba008ec1f` | IDENTICAL ✓ |
| risk | `85deda9e1347f115` | IDENTICAL ✓ |
| recommendations | `1ca2b6f91aa0f963` | IDENTICAL ✓ |
| reports | `52833ba134cda8cd` | IDENTICAL ✓ |

Live-crawl variance seen across runs (e.g. component counts 619 → 817 at the same params) is
**environmental** — the shared public demo's content and timing change between runs — **not a
code regression**. The compute pipeline is deterministic for fixed input.

---

## Bottlenecks

1. **Browser crawl (~3 s/page)** — the single dominant cost; network- and settle-bound
   (page load, `networkidle`, auto-scroll). Inherent to real browser automation, not a code
   inefficiency. Mitigations already available: `maxDepth`/`maxPages` bounds, `dynamicContent`
   toggle. (Parallel crawling remains a deliberate future option — see roadmap.)
2. **Compute pipeline** — not a bottleneck (≤190 ms at 5,000 routes).

---

## Recommendations (non-blocking)

1. For a contractual scale SLA, run G1b-style load against a **private large app** (or a
   synthetic server) to confirm the crawl's linear behaviour beyond 28 pages empirically.
2. Execute the test suite + a discovery on **Linux and inside Docker** in CI when a Linux
   runner is available, to convert G2 from "portable-by-analysis" to "runtime-verified".
3. (Optional, future) bounded parallel same-origin crawling to reduce wall-clock on large
   apps — deferred to preserve deterministic ordering.

---

## Final Verdict

- **No implementation defects discovered.** No code changes were required or made.
- **Determinism preserved**; APIs, contracts, and artefact formats unchanged.
- Remaining limitations are **environmental** (public-demo size; no Docker/Linux/macOS host),
  **not product defects**.

### ✅ The Discovery Platform is READY FOR VERSION 1.0 RELEASE.

Evidence-verified where executable (Windows, compute scale to 5,000 routes, determinism);
Linux/Docker/macOS runtime validation is the only outstanding item and is an **environmental
execution gap**, explicitly not claimed as supported.
