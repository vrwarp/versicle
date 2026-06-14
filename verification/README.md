# Verification suite (Playwright E2E)

This directory is the Playwright end-to-end suite: 74 TypeScript specs
(`*.spec.ts`) that drive the built app as user journeys. **The canonical
testing document is `TESTING.md` at the repo root** — commands, the Docker
flow, and the program rules live there; this file only describes what is in
this directory.

> History note: an earlier pytest/Python suite lived here and is fully gone.
> If any document tells you to run `verification/*.py` or pass pytest flags,
> the document is stale — fix it.

## Running

```bash
./run_verification.sh                                      # Docker; desktop + mobile projects
./run_verification.sh verification/test_journey_library.spec.ts
./run_verification.sh --project=webkit                     # auto-serialized (--workers=1)
./run_verification.sh --help                               # full usage
```

`./jules_run_verification.sh` is the `sudo` wrapper. Projects (`desktop`,
`mobile`, `webkit`) and their timeout/retry rationale are in
`playwright.config.ts` — read its comments before "fixing" flakiness with
bigger timeouts.

## Contents

### Specs

- `test_journey_*.spec.ts` — user-journey tests (library, reading, audio,
  sync, backup, workspaces, search, Chinese features, …). The convention
  for new coverage: extend a suitable journey or add a focused new one.
- `test_a11y_axe.spec.ts` — @axe-core/playwright scans of the core surfaces
  (baseline mode; fails on serious/critical only when `A11Y_ENFORCE=1`).
  Tagged `@a11y`.
- `test_bug_*.spec.ts`, `verify_*.spec.ts`, feature specs — older
  single-concern tests. Do not add new one-off bug specs; fold regression
  coverage into the owning journey (TESTING.md, program rules).
- `test_maintenance.spec.ts`, `test_journey_reprocessing.spec.ts` — open
  `EpubLibraryDB` directly with a **hardcoded version**; they must be
  updated when `src/db/db.ts` bumps the DB version (see AGENTS.md).

### Infrastructure

- `utils.ts` — the shared `test` fixture and helpers (`resetApp`,
  `waitForPersistedWrites`, `ensureLibraryWithBook`, `captureScreenshot`,
  `getReaderFrame`). It injects `tts-polyfill.js` into every page and
  currently disables content sanitization on every page
  (`__VERSICLE_SANITIZATION_DISABLED__` — a known honesty gap, see
  TESTING.md "Honest caveats"). Deterministic persistence waits go through
  `window.__versicleTest.flushPersistence()` (installed by `src/test-api.ts`
  in DEV/VITE_E2E builds).
- `tts-polyfill.js` — main-thread mock of the Web Speech API with word
  timing; all E2E TTS runs against this, never a real provider.
- `_idb_probe.js` — opt-in IndexedDB/event-loop hang instrumentation
  (enable with `./run_verification.sh --probe …`).
- `docker_entrypoint.sh` — container entrypoint: starts `npm run preview`,
  waits for :5173, runs `npx playwright test "$@"`.

### Fixtures & artifacts

- `*.epub` — test books (`alice.epub` is the standard fixture;
  `create_test_chinese_epub.cjs` generates the Chinese-content fixture).
- `screenshots/` — created at runtime, mounted from the host by
  `run_verification.sh`; specs save key-step screenshots here via
  `captureScreenshot`. There are **no golden-image assertions yet**
  (no `toHaveScreenshot()`); screenshots are for humans and CI artifacts.
