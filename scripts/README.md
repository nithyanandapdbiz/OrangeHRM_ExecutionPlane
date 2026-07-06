# Scripts

CLI scripts for the OrangeHRM Agentic QA Platform (Execution Plane). All scripts are
run from the project root via `node scripts/<name>.js`.

Integrations: **Jira** (issue tracking / stories & bugs) + **Zephyr Essential**
(test management) + **OrangeHRM** (the React web app under test). The DBiz
Intelligence Plane provides AI orchestration; no AI credential ever lives here.

---

## Pipeline Runners

| Script | Purpose |
|--------|---------|
| `run-full-pipeline.js` | End-to-end pipeline: Story → Generate → Run → Heal → Bugs → Report |
| `qa-run.js` | Configurable QA orchestrator (`--skip-story`, `--run-only`, `--headless`, etc.) |
| `run-and-sync.js` | Run tests and sync results to Zephyr Scale |
| `run-story.js` | Process a single Jira story into Zephyr test cases (thin alias to `trigger.js`) |
| `run-story-tests.js` | Generate specs from a Jira story and execute them |
| `run-tagged-tests.js` | Run tests filtered by tag (`--tag smoke`, `--tag OHRM-T138`) |
| `trigger.js` | Low-level CLI trigger — POST a Jira issue key to the Execution-Plane server |

## Generators

| Script | Purpose |
|--------|---------|
| `generate-report.js` | Generate custom HTML report from test results |
| `generate-allure-report.js` | Generate Allure report from `allure-results/` |
| `create-jira-bugs.js` | Create Jira Bug issues for failed tests (linked to the parent story) |
| `proactive-healer.js` | Self-heal failing tests (retry with updated OrangeHRM locators) |

## Diagnostics

| Script | Purpose |
|--------|---------|
| `diag-zephyr.js` | Diagnose Zephyr Scale (Essential) API connectivity |
| `test-endpoints.js` | Smoke-test all Express API endpoints |
| `validate-integration.js` | Validate end-to-end integration (Jira + Zephyr + Playwright) |
| `test-jira-bug-create.js` | Self-test Jira Bug creation and write a validation report |
| `pre-flight.js` | Pre-run environment / credential checks (Jira, Zephyr, OrangeHRM) |

## Utilities

| Script | Purpose |
|--------|----------|
| `ensure-dirs.js` | Create and manage all output directories; wipe stale contents pre-run |
| `git-sync.js` | Git agent — `git add -A` → commit → push to current branch |
| `manual-auth.js` | Establish an authenticated OrangeHRM session for the suite to reuse |
