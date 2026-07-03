# TESTING.md — the canonical testing document

This is the ONE authoritative description of how Versicle is verified. Other
documents point here instead of duplicating commands: `AGENTS.md` is
GENERATED from this file's local-gate table (`npm run docs:generate`; the
drift gate in `src/app/docs/docs.test.ts` fails `npm test` if they diverge),
and `README.md`/`verification/README.md` link here. If any hand-written
document disagrees with this file, this file wins — fix the other one. The
program rules that govern testing live in `plan/overhaul/README.md` §4
("Program rules"); the relevant ones are restated at the bottom of this
document.

Every command below (except the Docker and CI lanes, which are cited from
their scripts/workflows) was run against the tree as of 2026-06-12.

## The local gate (run before every PR)

| Check | Command | Expectation |
|---|---|---|
| Lint | `npm run lint` | 0 errors (warnings are ratchets being burned down) |
| Typecheck (app + tests + e2e + packages) | `npx tsc -b` | clean |
| Unit/integration tests | `npm test` (= `npx vitest run`) | green |
| Production build | `npm run build` | succeeds |
| Dependency boundaries | `npm run depcruise:check` | counts ≤ baseline |
| Lint-debt ratchet | `npm run lintdebt:check` | counts match `lint-debt-allowlist.json` |
| Dead code | `npm run knip` | zero findings |
| Worker-chunk + bundle checks | `npm run check:worker-chunk` | all five checks pass |
| Single-instance deps | `npm run check:single-instance` | one physical copy each |
| License gate | `npm run licenses:check` | clean |
| Coverage (when touching/moving tests) | `npm run coverage` | totals ≥ `coverage-baseline.json` |

CI (`.github/workflows/ci.yml`) runs the same set on every PR and on pushes
to `antigravity`/`main`: a quality job (lint, `tsc -b`, depcruise ratchet,
lint-debt ratchet, license gate, knip), vitest in two shards, and build +
worker-chunk purity (with the pinned-release dictionary compile, cached).
Node comes from `.nvmrc`; CI installs with `npm ci` only.
`check:single-instance` is local-only today (it pins one physical install of
yjs/zustand/lib0/firebase; the lockfile makes it deterministic, and the
runtime complement `single-yjs-instance.test.ts` runs in every vitest job).

## Unit & integration tests (vitest)

- **Single config:** `vitest.config.ts` at the repo root. Do **not** add a
  `test` block to `vite.config.ts` — when a root `vitest.config.ts` exists,
  vitest silently ignores it (this drift already happened once; see the
  comment in `vitest.config.ts`).
- **Discovery:** `src/**/*.{test,spec}.*` only. Tests are co-located with
  their subjects (`Foo.test.ts` next to `Foo.ts`). The Playwright suite
  (`verification/`) and agent worktrees (`.claude/`) are excluded.
- **Environment:** jsdom by default, with `src/test/setup.ts` (fake-indexeddb,
  media/speech mocks, localStorage, ResizeObserver, matchMedia). Node-only
  suites opt out per file with the `@vitest-environment node` pragma (the
  emulator suites do this — the Firebase SDK's emulator transports are
  unreliable under jsdom).
- **Run one file / pattern:**

  ```bash
  npx vitest run src/lib/ingestion.test.ts
  npx vitest run --shard=1/2          # what CI does, two shards
  ```

- **State of the suite (2026-06-12, Phase 9 close):** 307 files — 305
  passed, 2 skipped (the emulator-gated suites, below); 3,103 tests — 3,063
  passed, 37 skipped, 3 todo; ~80 s wall clock. The growth over the Phase 0
  baseline (258 files) is the contract tier (fork/provider/backend/repo/
  engine contract suites), captured-fixture suites (Y.Doc eras v1–v8,
  tts-storage blobs, IDB v18/v24), and seeded fuzz/perf/property
  companions — see `plan/overhaul/prep/phase9-close.md` §4 for the
  reconciliation.

### The shared test harness (`src/test/harness/`)

One import for the patterns that replace per-file `vi.mock` piles: real-store
seeding/reset, typed service doubles (`makeDbServiceDouble`,
`makeLibraryDbDouble`), toast capture through the real store, a typed
`FakeTTSProvider`, domain fixtures, and `renderWithStores()` for component
tests. **Rule of thumb:** prefer a DI seam + a double from the harness over
`vi.mock`; prefer seeding the real store over re-declaring its shape. New
tests must not hand-roll DBService/useTTSStore mocks — extend the harness
instead. Seeded fuzz tests use `src/test/fuzz-utils.ts` (deterministic LCG;
`*.fuzz.test.ts` companions).

### The E2E test API (`window.__versicleTest`)

`src/test-api.ts` installs a typed page-side API — `flushPersistence()`
(deterministically drains the y-idb + DBService write debounces; replaces
sleep-based waits) and `resetApp()` (full local wipe without reload). It is
installed only behind `import.meta.env.DEV || VITE_E2E === 'true'`; the
verification Docker build sets `VITE_E2E=true`. Production builds never
execute it. New page-side test seams go here, not into new `window.__*`
globals.

## Typechecking (tests included)

`npx tsc -b` builds the project-reference graph in `tsconfig.json`:

- `tsconfig.app.json` — app sources (tests excluded),
- `tsconfig.node.json` — root config files,
- `tsconfig.test.json` — **all vitest test code** + `src/test/`,
- `tsconfig.e2e.json` — `verification/**` + `playwright.config.ts`.

All ~42k LOC of test code typechecks as a build invariant. `npm run build`
runs `tsc -b` too, so a build is also a full typecheck.

## Lint

`npm run lint` (`eslint .`, flat config in `eslint.config.js`). Rule levels
follow the **ratchet model** (see below). The boundary bans established by
the overhaul are at **error** with their carve-outs named in the config:
path-alias imports, `idb`-import + `'readwrite'`-literal bans outside
`src/data/`, runtime `epubjs` outside the reader engine, raw
`fetch`/XHR/sendBeacon outside `src/kernel/net/`, native
`alert`/`confirm`/`prompt`, window `keydown` listeners outside the shortcut
service, `toLocale*` outside `kernel/locale`, toast imports outside the
sync presentation subscriber, and `vi.mock` in the engine/provider/data
directories. Notable levels:

- `@typescript-eslint/consistent-type-imports` — **error** (worker-purity
  contract C12: a missing `type` keyword can pull store code into the TTS
  worker chunk).
- `import/no-cycle` — **warn** as a fast in-editor signal; the depcruise
  `no-circular`/`no-circular-runtime` rules (both **error**, both at 0) are
  the authoritative gate.
- `jsx-a11y` recommended preset — **error** for the Phase 8 directories
  (`components/ui/`, `app/settings/`, `app/shortcuts/`, the pill feature
  dirs); **warn** everywhere else. Do not silently re-upgrade individual
  rules while violations exist; flip a directory only at zero warnings.
- `as any` / `: any` / `eslint-disable` counts are ratcheted separately by
  `npm run lintdebt:check` against `lint-debt-allowlist.json` (one justified
  entry per file; counts only decrease — `npm run lintdebt:update` locks a
  decrease in).

## Dependency boundaries (dependency-cruiser) — the ratchet model

`.dependency-cruiser.cjs` encodes the boundary rules of master plan §2.
At the Phase 9 end state most rules are at **error with zero violations**
(`no-circular`, `no-circular-runtime` — measured on the runtime-only graph
`.dependency-cruiser.runtime.cjs` — `types-imports-nothing`,
`kernel-imports-nothing`, `data-no-upward`, `domains-no-store`,
`lib-not-to-components`, `ui-imports-kernel-only`). Two legacy-geography
counters remain severity **warn** with frozen baselines in
`.dependency-cruiser-baseline.json` that may only go **down**:
`lib-not-to-store` (19) and `worker-no-state-typegraph` (16). The full
rule→enforcement table lives in `architecture.md` §3 and
`plan/overhaul/prep/phase9-close.md` §3.

```bash
npm run depcruise          # full report
npm run depcruise:check    # FAILS on any error-rule hit or count above baseline
npm run depcruise:baseline # regenerate after paying down violations; commit it
```

**The ratchet philosophy (program rule 3):** new tooling lands at warn with a
committed baseline; a rule flips to error only when its count reaches 0, in
the phase that establishes that boundary. Never flip a rule to error while
the repo violates it, and never increase a baselined count — pay violations
down or don't touch the boundary.

## Worker-chunk + bundle checks

```bash
npm run check:worker-chunk                 # vite build + scan
npm run check:worker-chunk -- --skip-build # reuse an existing dist/
```

`scripts/check-worker-chunk.mjs` builds the production bundle and runs five
emitted-artifact assertions:

1. **Worker purity (C12):** the TTS worker chunk's full import closure
   (via sourcemaps) contains no `zustand`, `yjs`, or `src/store/` source —
   the ground truth behind the `import type` lint and depcruise rules.
2. **Prod mock purity (rule 9):** no MockBackend / MockFireProvider /
   MockGenAIClient source in ANY production chunk.
3. **Lazy-lexicon purity (P5c):** the Bible lexicon JSON stays out of the
   entry chunk.
4. **Entry-chunk budget (P8):** firebase/genai/epubjs stay out of the entry
   chunk; gzip sizes ratchet against `bundle-baseline.json`.
5. **PWA shell (P8):** single manifest with installability fields; the SW
   precache and runtime-caching expectations hold.

If a check fails, find the leaked value-import (`ANALYZE=true vite build`
renders treemaps to `stats.html`/`stats-worker.html`); do not weaken the
script.

## Single-instance check

`npm run check:single-instance` (`scripts/assert-single-instance.cjs`) fails
unless exactly one physical copy of `yjs`, `zustand`, `lib0`, and the
firebase SDK is installed — the vendored workspace forks declare them as
peer dependencies, and a second copy silently breaks `instanceof` checks
inside the Yjs middleware. Run it whenever dependencies change.

## Coverage + baseline

```bash
npm run coverage   # vitest run --coverage (v8); summary + coverage/coverage-summary.json
```

The committed floor is `coverage-baseline.json`, re-pinned UPWARD at the
Phase 9 close (lines 75.49%, statements 74.29%, functions 69.89%, branches
65.50% — about ten points above the Phase 0 capture on every metric). **The
baseline never decreases** (program rule 8): any PR that deletes or moves
tests must re-run `npm run coverage` and show the totals did not drop;
when coverage legitimately moves, regenerate the file and explain the delta
in the same PR. Not yet a CI gate — enforced by review against the committed
baseline. Coverage counts **all** of `src/` (not just imported files), so
deleting a test cannot inflate the percentages.

## Emulator-gated suites (Firebase security rules + sync contract)

Two suites run against the Firebase emulator and **auto-skip when no emulator
is reachable**, so the default `npx vitest run` stays green without one:

- `src/lib/sync/security-rules.test.ts` — pins `firestore.rules` +
  `storage.rules` (the BYO-Firebase deploy artifacts wired in
  `firebase.json`).
- `src/lib/sync/syncBackendContract.emulator.test.ts` — the C3 SyncBackend
  contract suite (shared spec: `syncBackendContract.ts`, including the
  workspace-purge cases) against real Firestore under the repo's rules. Its
  sibling `syncBackendContract.mock.test.ts` runs the same behavioral spec
  against the mock backend on every `npm test` — one spec, N transports,
  same pattern as `engineParityScenarios`.

Running them (requires Java; ports come from `firebase.json` — Firestore
8080, Auth 9099, Storage 9199):

```bash
# one-shot: start emulators, run the suites, tear down
npx firebase-tools emulators:exec --only firestore,storage,auth \
  --project demo-versicle-rules \
  "npx vitest run src/lib/sync/security-rules.test.ts src/lib/sync/syncBackendContract.emulator.test.ts"

# or keep the emulator running in another terminal
npx firebase-tools emulators:start --only firestore,storage,auth \
  --project demo-versicle-rules
npx vitest run src/lib/sync/security-rules.test.ts
```

Last verified against a live emulator 2026-06-12 (the program close): 2
files, 37 passed + 1 todo — including the P4 purge cases and the y-cinder
realtime provider. The emulator's gRPC stream can hiccup on a cold start
(`RESOURCE_EXHAUSTED` on a Listen stream → "client is offline"); a retry
is legitimate for that signature. Whenever
`firestore.rules`/`storage.rules` change, this suite must run against the
emulator before merge.

## E2E suite (Playwright in Docker)

The journey suite lives in `verification/*.spec.ts` (Playwright;
`playwright.config.ts` defines three projects: `desktop` — 1280×720 Chrome,
`mobile` — Pixel 5, `webkit` — Desktop Safari with extended timeout/retries,
each with rationale comments worth reading).

**What `./run_verification.sh` actually does** (cited from the script):

1. Builds the `versicle-verify` image from `Dockerfile.verification`
   (playwright:v1.60.0-jammy base; `npm ci --legacy-peer-deps`;
   `VITE_E2E=true npm run build` — so the typed test API is installed).
2. Runs the container with `--ipc=host` (Playwright's recommendation; the
   default /dev/shm starves browsers) and mounts
   `verification/screenshots/` from the host.
3. Inside the container (`verification/docker_entrypoint.sh`): starts
   `npm run preview` on :5173, curl-waits for it, then runs
   `npx playwright test` with all passthrough arguments.

Arguments are **Playwright CLI arguments** (not pytest — that suite was
deleted long ago):

```bash
./run_verification.sh                                       # desktop + mobile (the default when no --project given)
./run_verification.sh verification/test_journey_library.spec.ts
./run_verification.sh --project=webkit                      # auto-serialized (--workers=1)
./run_verification.sh --logs <spec>                         # verbose page/console logs
./run_verification.sh --probe <spec>                        # IndexedDB/event-loop hang probe
```

`./jules_run_verification.sh` is a one-line `sudo` wrapper for environments
where Docker needs root. Timeouts in this suite are usually bugs/flakiness,
not performance — raising a timeout is a last resort.

**Honest caveats (know what a green run proves):** every page gets
`verification/tts-polyfill.js` (a mock Web Speech engine — no real TTS
provider runs in E2E). The sanitizer is disabled by default via the
`sanitizationDisabled` fixture option in `verification/utils.ts` (the
legacy whole-suite default); the P6 overlay/pinyin characterization specs
opt back onto the REAL sanitize path with
`test.use({ sanitizationDisabled: false })`, so the sanitizer IS exercised
end-to-end, but only where a spec opts in — most journeys still run with it
off (an honest open item in the program close-out). Sync journeys
run against `MockFireProvider`, not real Firestore (the emulator suites
above cover the rules); screenshots are captured for humans — there are no
`toHaveScreenshot()` golden assertions (visual goldens from master plan §7
were never built; an honest open item in the program close-out).

**In CI** the Docker E2E lane runs via
`.github/workflows/e2e-verification.yml`, one job per project, screenshots
uploaded as artifacts. The **desktop and mobile** projects run on every PR
(informational checks — no branch protection requires them); **webkit**
stays nightly + `workflow_dispatch` only (serial, timing-sensitive TTS
journeys — see `run_verification.sh`).

## Accessibility scans (three layers)

1. **Lint:** `eslint-plugin-jsx-a11y` recommended — error for the Phase 8
   directories, warn elsewhere (ratchet; see Lint).
2. **Component tests:** `vitest-axe` via the harness —
   `expect(await view.axe()).toHaveNoViolations()` (or `runAxe(container)`);
   opt-in per test, registered by `src/test/harness/axe.ts`.
3. **E2E surface scans:** `verification/test_a11y_axe.spec.ts`
   (@axe-core/playwright) scans the library grid, reader, settings dialog,
   and audio deck. **Baseline mode:** scans always run and attach full
   violation JSON as artifacts, but only fail on serious/critical violations
   when `A11Y_ENFORCE=1` is set:

   ```bash
   ./run_verification.sh --project=desktop --grep @a11y
   ```

## Android unit tests (Docker)

```bash
docker build -t versicle-android -f Dockerfile.android .   # may need sudo
docker run --rm versicle-android                            # runs ./gradlew test
```

(`run_android_tests.sh` wraps both steps. `Dockerfile.android.dockerignore`
exists specifically so the `android/` directory reaches this build context —
don't re-add `android` exclusions to it.)

## Program rules that govern tests

From `plan/overhaul/README.md` §4 — the ones every test-touching PR must
follow:

1. **Test-absorption ledger (rule 8).** A per-bug test file may be deleted
   only in the same PR that lands its assertions as a named
   `describe('regression: …')` block in the owning suite. The coverage
   baseline never decreases across such moves.
2. **Regression-describe convention — no one-off bug files.** A new
   regression test goes into the existing suite that owns the subject
   (`Foo.test.ts` next to `Foo.ts`), as a `describe('regression: <what>')`
   block. Never create `Foo_BugXyz.test.ts` / `Foo.repro.test.ts`-style
   one-offs — the 246-file sprawl this repo is digging out of came from
   exactly that habit.
3. **Ratchets never regress (rule 3).** `.dependency-cruiser-baseline.json`
   and `coverage-baseline.json` counts only move in the good direction;
   warn-level lint rules flip to error only at zero violations.
4. **Characterization before change (rule 7).** A subsystem's
   behavior-pinning suite (parity scenarios, contract suites, journeys) must
   be green before its internals are touched.
5. **Contract suites move with contracts.** A contract version bump requires
   a matching contract-suite change in the same PR (§3 operating rules).

## Map of test infrastructure

| Path | What it is |
|---|---|
| `vitest.config.ts` | The single vitest config (discovery, jsdom, coverage settings) |
| `src/test/setup.ts` | Global jsdom setup (fake-indexeddb, media/speech/localStorage mocks) |
| `src/test/harness/` | Typed doubles, store seeding, `renderWithStores`, vitest-axe |
| `src/test/fuzz-utils.ts` | Seeded PRNG for `*.fuzz.test.ts` |
| `src/test-api.ts` | `window.__versicleTest` (DEV/VITE_E2E only) |
| `tsconfig.test.json` / `tsconfig.e2e.json` | Test/e2e typecheck projects (in `tsc -b`) |
| `.dependency-cruiser.cjs` + `.dependency-cruiser-baseline.json` | Boundary rules (mostly error) + frozen ratchet counts |
| `.dependency-cruiser.runtime.cjs` | Runtime-only graph (for `no-circular-runtime`) |
| `coverage-baseline.json` | Coverage floor (never decreases; re-pinned at P9) |
| `scripts/check-worker-chunk.mjs` | Worker-chunk purity + bundle/PWA assertions (five checks) |
| `scripts/depcruise-baseline.mjs` | Ratchet regenerate/check |
| `scripts/lint-debt-ratchet.mjs` + `lint-debt-allowlist.json` | `any`/`eslint-disable` ratchet + justified rest |
| `scripts/assert-single-instance.cjs` | One physical yjs/zustand/lib0/firebase install |
| `knip.jsonc` | Dead-code gate config (`npm run knip`; intentional keeps carry reasons) |
| `src/app/docs/` | Generated-docs renderers + drift gate (`npm run docs:generate`) |
| `playwright.config.ts` + `verification/` | E2E projects + journey specs, utils, polyfills |
| `run_verification.sh` / `jules_run_verification.sh` | Dockerized E2E runner (+ sudo wrapper) |
| `firebase.json` + `firestore.rules` + `storage.rules` | Emulator config + the rules under test |
| `.github/workflows/ci.yml` | PR/push gate (lint, tsc, vitest shards, build, ratchets) |
| `.github/workflows/e2e-verification.yml` | Docker E2E: desktop+mobile per-PR, webkit nightly/manual |
