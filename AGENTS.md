<!-- GENERATED FILE — do not edit by hand. -->
<!-- Rendered by src/app/docs/registryDocs.ts from the live registries. -->
<!-- Drift-gated by src/app/docs/docs.test.ts: a plain `npm test` fails when -->
<!-- this file disagrees with the registries. Regenerate: npm run docs:generate -->

# AGENTS.md — working agreement for AI agents

Versicle is maintained almost entirely by AI agents. These documents are the
instruction channel — when they drift from reality, agents faithfully
execute the drift. This file is therefore GENERATED from the canonical
sources (TESTING.md's gate table + the code registries) and drift-gated by
`src/app/docs/docs.test.ts`: if you need to change it, change the source
and run `npm run docs:generate`. If an instruction here still contradicts
the tree, fixing the source document is part of the task.

## Canonical documents

- **`TESTING.md`** (repo root) — the ONE authoritative testing document:
  every test/lint/typecheck/ratchet command, the E2E and emulator flows, and
  the program rules that govern tests. Do not duplicate its content; link
  to it. The PR-gate list below is rendered from its local-gate table.
- **`architecture.md`** — the end-state architecture, generated from the
  code's own registries (module map, C1–C12 contract inventory, boundary
  rules, persisted formats). Current by construction.
- **`plan/overhaul/README.md`** — the 2026 overhaul master plan
  (PROGRAM COMPLETE). Its §4 "Program rules" remain binding for every
  change; the close-out banner carries the operator hand-off list.
- **Module READMEs** — `src/kernel/`, `src/data/`, `src/store/`,
  `src/domains/` are generated (same gate); the rest are hand-written.

## Pull Request prerequisites — the gate

All of these must pass before a PR (what each one is: `TESTING.md`):

1. `npm run lint` — 0 errors (warnings are ratchets being burned down) *(Lint)*
2. `npx tsc -b` — clean *(Typecheck (app + tests + e2e + packages))*
3. `npm test` (= `npx vitest run`) — green *(Unit/integration tests)*
4. `npm run build` — succeeds *(Production build)*
5. `npm run depcruise:check` — counts ≤ baseline *(Dependency boundaries)*
6. `npm run lintdebt:check` — counts match `lint-debt-allowlist.json` *(Lint-debt ratchet)*
7. `npm run knip` — zero findings *(Dead code)*
8. `npm run check:worker-chunk` — all five checks pass *(Worker-chunk + bundle checks)*
9. `npm run check:single-instance` — one physical copy each *(Single-instance deps)*
10. `npm run licenses:check` — clean *(License gate)*
11. `npm run coverage` — totals ≥ `coverage-baseline.json` *(Coverage (when touching/moving tests))*

Conditional additions:

- `firestore.rules` / `storage.rules` changed → run the emulator-gated
  rules suite (command in `TESTING.md` §Emulator-gated suites).
- User-visible changes → run the relevant Playwright journeys via Docker
  (below) and check the screenshots.
- Registries, TESTING.md's gate table, or generated docs affected →
  `npm run docs:generate` and commit the result (a plain `npm test`
  fails on drift, so you cannot forget silently).

## Playwright verification suite (E2E)

The suite is Playwright TypeScript specs in `verification/*.spec.ts` (the
old Python/pytest suite is long gone — never create `.py` tests). It runs
in Docker; arguments pass through to `npx playwright test`:

```bash
# If you are Jules (or docker needs root), use the sudo wrapper:
./jules_run_verification.sh

# Otherwise:
./run_verification.sh                                      # desktop + mobile projects
./run_verification.sh verification/test_journey_library.spec.ts
./run_verification.sh --project=webkit                     # auto-serialized
```

Rules for E2E work:

1. Tests are modeled as **user journeys**. To cover a new feature or bug
   fix, extend a suitable existing journey or add a new one — keep journeys
   focused, not marathon-length.
2. Record a screenshot in `verification/screenshots/` for key steps (use
   the `captureScreenshot` helper in `verification/utils.ts`).
3. Use the deterministic waits from `verification/utils.ts`
   (`window.__versicleTest.flushPersistence()` / `resetApp`) — never add
   `waitForTimeout` sleeps for persistence.
4. Timeouts are almost always caused by bugs or flakiness in code or test,
   rarely by genuine slowness. Increasing a timeout is a last resort.

## Android Docker tests

```bash
sudo docker build -t versicle-android -f Dockerfile.android .
sudo docker run --rm versicle-android
```

(`Dockerfile.android.dockerignore` exists so `android/` reaches this
build context — do not re-add `android` to it.)

## Docker

You need to use `sudo` to run docker.

## Program rules — the ones agents trip over most

From `plan/overhaul/README.md` §4 (all of §4 is binding):

1. **Regression tests go into owning suites.** A new regression test is a
   `describe('regression: <what>')` block inside the existing
   `Foo.test.ts` co-located with `Foo.ts` — NEVER a new one-off file
   (`Foo_BugXyz.test.ts`, `Foo.repro.test.ts`). A per-bug file may be
   deleted only in the same PR that lands its assertions as such a block
   (the test-absorption ledger).
2. **Ratchets never regress.** `.dependency-cruiser-baseline.json`,
   `lint-debt-allowlist.json`, `coverage-baseline.json`, and
   `bundle-baseline.json` counts only move in the good direction. Most
   boundary rules are already at **error with zero exceptions** — do not
   add violations; restructure the change instead. New lint/boundary
   tooling lands at warn with a committed baseline; a rule flips to error
   only at zero violations.
3. **One vitest config.** `vitest.config.ts` is the single source of test
   discovery. Never add a `test` block to `vite.config.ts` (vitest
   silently ignores it) and never add a second config.
4. **Test seams are typed and centralized.** Page-side E2E seams go into
   `src/test-api.ts` (`window.__versicleTest`), not new `window.__*`
   globals. Unit-test doubles come from `src/test/harness/` — do not
   hand-roll `vi.mock` piles for repos/stores (`vi.mock` is lint-banned
   in the engine/provider/data directories).
5. **Commit style:** Conventional Commits — `type(scope): imperative
   subject` ≤72 chars; body explains *why*. One logical change per commit.
6. **Cross-root imports use path aliases.** Importing across the top-level
   `src/` roots uses the alias, never `../` chains: `@app/` `@components/` `@data/` `@domains/` `@hooks/` `@kernel/` `@lib/` `@store/` `~types/` `@test/` `@workers/`
   (declared in `tsconfig.app.json` `paths`; mirrored in
   `vite.config.ts` AND `vitest.config.ts` `resolve.alias` — vitest
   does not read vite.config.ts — and in `tsconfig.e2e.json` for specs).
   `types/` is `~types` because TypeScript rejects `@types/…`
   specifiers (TS6137). Same-directory and within-subtree imports stay
   relative. Enforced at error severity by `no-restricted-imports`;
   bulk-fix with `node scripts/codemod-aliases.mjs`.
7. **Generated docs are never hand-edited.** `architecture.md`, this
   file, and the kernel/data/store/domains READMEs are rendered from the
   registries — edit `src/app/docs/registryDocs.ts` (or the registry the
   fact lives in, or `TESTING.md` for the gate table) and run
   `npm run docs:generate`.

## Project README.md

Whenever you update the project `README.md` file, make sure to include as a preamble an explanation for what `Google Jules` is and that `Versicle` is an experimental project implemented almost entirely with `Jules`.

## IndexedDB schema changes

The schema and its versioned migration registry live in
`src/data/schema.ts` (currently `DB_VERSION = 28`). Bumping it is a
user-data format change (master plan §4 rule 4): append a migration step —
never edit a released one — and extend the captured-fixture upgrade tests in
`src/data/migrations.test.ts`. E2E specs open `EpubLibraryDB` without an
explicit version, so there are no hardcoded version numbers to chase.
