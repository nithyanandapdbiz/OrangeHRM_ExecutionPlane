# Module-Based Feature File Layout

Each sub-folder under `tests/features/` corresponds to a functional **module** of
the OrangeHRM app (e.g. `employee-login/`, `pim-add-employee/`, `admin-add-user/`).
All Cucumber scenarios for a module live inside that module's folder.

## Module derivation

Module folders map to OrangeHRM modules and the Jira story they automate. When a
generator classifies a module it uses this confidence waterfall:

1. Explicit caller override (`opts.module`)
2. Jira **components** — `components[0].name`
3. Jira **labels** — first label
4. Story title slug — always available as a last resort

Falls back to `general/` only when no Jira signal is present (with a warning).

## File-naming rules

1. **One folder per module-slug.** Folder name is the kebab-case slug of the
   OrangeHRM module (e.g. "PIM Add Employee" → `pim-add-employee/`).
2. **One feature file per story:**
   `tests/features/<module-slug>/<story-slug>.feature`.
3. No nested sub-folders.
4. **Background** at file top covers the common precondition, e.g.
   `Given I am signed in to OrangeHRM` and `And I navigate to the "<module>" module`.
5. **Tags on every scenario** (mandatory):
   - `@AI_SDLC-T<id>` — test-case key (one per scenario)
   - `@<module-slug>` — e.g. `@pim`, `@admin`, `@login`
   - one or more design-technique tags: `@smoke`, `@negative`, `@validation`,
     `@regression`, `@search`, …

## Tag pattern

Test-case tags follow `^@?AI_SDLC-T\d+$` — a generic AI-SDLC tag, not tied to any
tracker. Jira story/issue keys (e.g. `OHRM-1`) are alphanumeric and are recorded
in Zephyr traceability, not embedded in Gherkin.

## Companion rule

Any Playwright automation of these scenarios MUST follow the Page Object Model —
see the page objects in `tests/pages/` and locators in `tests/locators/`.
