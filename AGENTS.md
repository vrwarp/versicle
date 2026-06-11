# AGENTS.md — working agreement for AI agents

Versicle is maintained almost entirely by AI agents. These documents are the
instruction channel — when they drift from reality, agents faithfully execute
the drift. If you find an instruction here that contradicts the tree, fixing
the document is part of the task.

## Canonical documents

- **`TESTING.md`** (repo root) — the ONE authoritative testing document:
  every test/lint/typecheck/ratchet command, the E2E and emulator flows, and
  the program rules that govern tests. Do not duplicate its content here or
  elsewhere; link to it.
- **`plan/overhaul/README.md`** — the master overhaul plan. Its §4 "Program
  rules" are binding for every change.
- **`architecture.md`** — describes the PRE-overhaul architecture and is
  stale in places; see the banner at its top. For current architectural
  direction, read the master plan first.

## Pull Request prerequisites

All of these must pass before a PR (details and what each one is:
`TESTING.md`):

1. `npm run lint` — clean (0 errors; don't add warnings — warn-level rules
   are ratchets being burned down).
2. `npx tsc -b` — clean. This typechecks the app AND all test/e2e code.
3. `npm test` — green.
4. `npm run build` — succeeds.
5. `npm run depcruise:check` — within baseline. **Never raise
   `.dependency-cruiser-baseline.json` counts**; restructure your change so
   it doesn't add boundary violations.
6. `npm run licenses:check` — clean (new production deps must be
   GPL-3.0-compatible; vendored artifacts need `third-party/inventory.json`
   entries).
7. `npm run check:worker-chunk` — when touching anything imported by the TTS
   worker, `src/store/`, or import styles (`import type` discipline).
8. For user-visible changes: run the relevant Playwright journeys via Docker
   (below) and check the screenshots.
9. If `firestore.rules` / `storage.rules` change: run the emulator-gated
   rules suite (command in `TESTING.md`).

## Playwright verification suite (E2E)

The suite is Playwright TypeScript specs in `verification/*.spec.ts` (the
old Python/pytest suite is long gone — never create `.py` tests). It runs in
Docker; arguments pass through to `npx playwright test`:

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
2. Record a screenshot in `verification/screenshots/` for key steps (use the
   `captureScreenshot` helper in `verification/utils.ts`).
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

(`Dockerfile.android.dockerignore` exists so `android/` reaches this build
context — do not re-add `android` to it.)

## Docker

You need to use `sudo` to run docker.

## Program rules (Phase 0+) — binding for every change

From `plan/overhaul/README.md` §4; the ones agents trip over most:

1. **Regression tests go into owning suites.** A new regression test is a
   `describe('regression: <what>')` block inside the existing `Foo.test.ts`
   co-located with `Foo.ts` — NEVER a new one-off file
   (`Foo_BugXyz.test.ts`, `Foo.repro.test.ts`). A per-bug file may be
   deleted only in the same PR that lands its assertions as such a block
   (the test-absorption ledger).
2. **Ratchets never regress.** `.dependency-cruiser-baseline.json` violation
   counts and `coverage-baseline.json` totals only move in the good
   direction. New lint/boundary tooling lands at **warn** with a committed
   baseline; a rule flips to error only when its violation count is zero.
3. **One vitest config.** `vitest.config.ts` is the single source of test
   discovery. Never add a `test` block to `vite.config.ts` (vitest silently
   ignores it) and never add a second config.
4. **Test seams are typed and centralized.** Page-side E2E seams go into
   `src/test-api.ts` (`window.__versicleTest`), not new `window.__*`
   globals. Unit-test doubles come from `src/test/harness/` — do not
   hand-roll new `vi.mock` piles for DBService/stores.
5. **Commit style:** Conventional Commits — `type(scope): imperative
   subject` ≤72 chars; body explains *why*. One logical change per commit.
6. **Cross-root imports use path aliases.** Importing across the top-level
   `src/` roots uses the alias, never `../` chains: `@app/ @components/
   @db/ @hooks/ @lib/ @store/ ~types/ @test/ @workers/` (declared in
   `tsconfig.app.json` `paths`; mirrored in `vite.config.ts` AND
   `vitest.config.ts` `resolve.alias` — vitest does not read
   vite.config.ts). `types/` is `~types` because TypeScript rejects
   `@types/…` specifiers (TS6137). Same-directory and within-subtree
   imports stay relative. Enforced at error severity by
   `no-restricted-imports` in `eslint.config.js`; bulk-fix with
   `node scripts/codemod-aliases.mjs`.

## Project README.md

Whenever you update the project `README.md` file, make sure to include as a preamble an explanation for what `Google Jules` is and that `Versicle` is an experimental project implemented almost entirely with `Jules`.

## Updating the EpubLibraryDB versions

Whenever you update the `EpubLibraryDB` version in `src/db/db.ts` (currently
24), you must update the hardcoded version in the specs that open the
database directly:

1. `verification/test_maintenance.spec.ts` (two `indexedDB.open("EpubLibraryDB", …)` sites)
2. `verification/test_journey_reprocessing.spec.ts` (three sites)

(Long-term these specs should import the version constant instead — if you
are touching them anyway, that improvement is welcome.)
