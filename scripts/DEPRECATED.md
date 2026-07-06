# Deprecated scripts

These standalone scripts predate the current server-based pipeline
(`server.js` → `routes/run.js` → `runners/` + `clients/`, triggered via
`npm run e2e`). They are **orphaned** — not referenced by `package.json`, the
server, or any active module — and triage (TD-22) found several already broken:

| Script | Status | Evidence |
|--------|--------|----------|
| `run-and-sync.js` | Broken / half-disabled | An unconditional `return;` (line ~251) orphans the entire result-parse + Zephyr-sync section (`no-unreachable`). |
| `run-story-tests.js` | Broken | References `specFiles` outside the `banner()` scope where it is defined (`no-undef`) — throws when reached. |
| `run-bdd-and-sync.js` | Legacy | Function declared inside a block (`no-inner-declarations`); superseded by `runners/playwright.runner.js`. |
| `run-security-only.js` | Legacy | Superseded by `runners/nonfunctional.runner.js`; minor `no-useless-escape`. |
| `proactive-healer.js` | Legacy / experimental | Not wired into any pipeline; minor `no-useless-escape`. |
| `manual-auth.js` | Dev utility | OrangeHRM login/session helper; `localStorage` lints as `no-undef` (it runs in browser context via `page.evaluate`). |

## Why they are not "fixed"

Making dead code lint-clean would imply it works. It does not. These scripts are
retained read-only for historical reference and are **scheduled for deletion**
pending confirmation that no external automation (a developer's local workflow, an
old CI/cron job) still invokes them by path. They are excluded from the blocking
lint gate (maintained surface only) and surface in the advisory `npm run lint:all`.

The supported entry point for all of this functionality is `npm run e2e`.
