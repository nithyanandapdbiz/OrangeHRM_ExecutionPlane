# ADR-0003 — Lint / Format / Test Quality Gates

- **Status:** Accepted — implemented incrementally (22 unit tests via `node:test`,
  GitHub Actions CI gate `.github/workflows/ci.yml` running `npm test`; lint wired as advisory)

## Context

The repository ships **no linter, formatter, type-checking, or test gate**, and ~190 JS files with no
enforced style. There are effectively **no unit tests of the orchestration code** (the 5 `.spec.js` are
generated discovery stubs; the Cucumber suite tests the OrangeHRM app, not this codebase).

## Decision

1. Add **ESLint** (`.eslintrc.json`) and **Prettier** (`.prettierrc`) with pragmatic, non-pedantic rules
   so the gate can be adopted incrementally without a disruptive mass-reformat.
2. Add `lint` / `lint:fix` / `format` scripts and a Node `engines` floor (≥20) to `package.json`.
3. **Do not** run a repo-wide auto-fix in the same change (it would touch every file and obscure real
   diffs). Reformat folder-by-folder behind reviewed PRs.
4. Introduce **JSDoc `@ts-check`** opportunistically for type-safety without a TypeScript migration.
5. Stand up a unit-test runner (Jest or Vitest) and a CI coverage gate; first targets: `pii-scrubber`,
   `intelligence.client` (error mapping), `alm.client`/`jira.client`/`zephyr.client` (sync summary),
   `playwright.runner` (BDD-mode + report parse), and the extracted `/run` step handlers (after ADR-0002).

## Consequences

Quality becomes enforceable and measurable. Adoption is incremental — no behavioural change in this step.
