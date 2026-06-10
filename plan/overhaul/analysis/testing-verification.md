# Subsystem analysis: Test strategy & verification infrastructure

Repo root: `/Users/btsai/claude/versicle` (analyzed in worktree `.claude/worktrees/amazing-davinci-d7336e`).
All paths below are repo-relative. All numbers were produced with shell commands against the actual tree (2026-06-10).

## What it is

Everything that verifies Versicle: the Vitest unit/integration suite inside `src/` (246 test files, ~34,600 LOC, ~1,589 `it()` cases), the Playwright end-to-end "verification" suite (`verification/`, 73 `.spec.ts` files, ~7,900 LOC), the Docker harnesses that run them (`Dockerfile.verification`, `run_verification.sh`, `jules_run_verification.sh`, `run_android_tests.sh`, `Dockerfile.android`), the agent workflow contract (`AGENTS.md`, `.jules/*.md`), GitHub Actions CI (`.github/workflows/`), and the test-support code (`src/test/`, `verification/utils.ts`, `verification/tts-polyfill.js`, fakes/mocks living in `src/`).

Test:source LOC ratio inside `src/` is ~0.74 (34,633 test LOC vs 46,868 non-test LOC) — a *lot* of test code, but distributed as one-off bug-repro files rather than coherent suites, and **none of it is typechecked** (see debt #2).

## File inventory

### Runner configuration
| File | Role |
|---|---|
| `vitest.config.ts` | **Active** vitest config (jsdom, globals, `src/test/setup.ts`, `testTimeout: 60000`, excludes `verification/**` only). |
| `vite.config.ts:75-83` | A **second**, divergent `test:` block (excludes `.claude/**` but not `verification/**`). Dead when `vitest.config.ts` exists — vitest.config takes priority and the two are not merged. |
| `playwright.config.ts` | Playwright config: `testDir: './verification'`, 3 projects (desktop Chrome 1280×720, mobile Pixel 5, webkit with `timeout: 120000`, `retries: 3`), `baseURL` default `https://localhost:5173`, CI-conditional `forbidOnly`/`retries`/`workers` (which never activate in CI — see debt #11). |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | Project references. `tsconfig.app.json` **excludes** `src/**/*.test.ts(x)`, `src/integration.test.ts`, `src/test/**`. `tsconfig.node.json` includes only `vite.config.ts`. Nothing covers `verification/`, `playwright.config.ts`, `vitest.config.ts`, or root test files. |
| `eslint.config.js` | Lints all `**/*.{ts,tsx}` incl. tests (syntactic rules only, no type-aware rules); ignores `dist`, `coverage`, `venv`, `android`, `.claude`. |
| `package.json` | `"test": "vitest run"`, plus a duplicate alias `"tests": "vitest run"`. `husky ^9.1.7` listed in **dependencies** but there is no `.husky/` dir and no `prepare` script — dead. `@vitest/coverage-v8` installed; no coverage script, no thresholds. |

### Unit-test support (`src/test/`)
| File | Role |
|---|---|
| `src/test/setup.ts` (97 ln) | Global jsdom setup: `fake-indexeddb/auto`, HTMLMediaElement/Audio mocks, Blob.text/arrayBuffer polyfills, localStorage mock, matchMedia, ResizeObserver, speechSynthesis mocks. |
| `src/test/fuzz-utils.ts` (147 ln) | Seeded LCG PRNG (`SeededRandom`), `DEFAULT_FUZZ_SEED`, `DEFAULT_FUZZ_ITERATIONS=500`. Used by 10 `*.fuzz.test.ts` files. Sound. |
| `src/test/fuzz-utils.test.ts` | Tests the PRNG itself (determinism, distribution). |
| `src/test/search-client.repro.test.ts` | A search-concurrency repro test that lives in `src/test/` instead of next to `src/lib/search.ts` (which has its own `search.repro.test.ts` — two "repro" files for the same subsystem in two places). |
| `src/test/fixtures/alice.epub` (188K) | EPUB fixture — one of **four** copies of alice.epub in the repo (also `verification/`, `public/`, `public/books/`). |
| `src/test/README.md` | Describes `setup.ts` as mocking IntersectionObserver (it doesn't) — mild drift. |

### Misplaced/stray test files at REPO ROOT (all picked up or dead)
| File | Role / status |
|---|---|
| `test-missing-notes.test.ts` | Vitest test for the forked `zustand-middleware-yjs` undefined-handling. **Matches vitest's default include and runs in `npm test`** from the repo root. Belongs in the fork's repo or `src/store/`. |
| `test_use_local_storage_events.test.tsx` | Root-level duplicate of `useLocalStorage` storage-event coverage; untyped props (`{storageKey}` implicit any) — would fail typecheck if anything typechecked it. Runs in `npm test`. |
| `use-local-storage-other-tab.test.ts` | Another root-level duplicate of the same storage-event behavior. Runs in `npm test`. |
| `test-backup.ts` | Dead one-off Node script (manual backup/restore experiment); imports `y-indexeddb` which is not even in package.json (the app uses forked `y-idb`). Added 2026-04-14. |
| `test-yjs.js` | Dead 16-line console experiment with `zustand-middleware-yjs`. Added 2026-03-28. |
| `verification_script.py` | Dead standalone **Python** Playwright script (relic of the removed pytest suite). Added 2026-04-14. |
| `test_files.txt` | Stale generated list of test files (references deleted files: `src/db/test_db_migration.test.ts`, `src/lib/migration/YjsMigration.test.ts`, `UnifiedInputController_*` tests). Added 2026-01-21. |

### Unit/integration tests inside `src/` (246 files)
Representative inventory by cluster (each line = files → subject):
- `src/lib/tts/AudioPlayerService*.test.ts` — **12 files** (`.test`, `.predictability.test`, `_AnalysisUpdate`, `_Concurrency`, `_Critical`, `_LanguageSync`, `_MediaSession`, `_Predictability_Fix`, `_ReactiveSubscription`, `_RestoreAnalysis`, `_Resume`, `_StateProtection`) + `engine/AudioPlayerService.isolated.test.ts` + `src/verification/test_background_crash.test.ts` = **14 files for one class**.
- `src/hooks/use-local-storage*` — **7 files** (`.test.ts`, `.test.tsx`, `-bug`, `-closure`, `-predictability`, `-quota`, `-sync`) + 2 root-level copies = **9 files for one 100-line hook**. `use-local-storage.test.ts` and `use-local-storage-predictability.test.ts` contain the **same single assertion** (functional updater twice → 2).
- `src/store/useLibraryStore*.test.ts` — **6 files** (`.test`, `.race`, `.removeRace`, `.restoreRace`, `.offloadedRace`, `.offloadRevert`), each 26–65 lines, all using the same `createLibraryStore(mockDb)` setup.
- `src/lib/tts/TextSegmenter*.test.ts` — **9 files** (base, configurable, fuzz, merge, perf, punctuation, refine, regex, regression).
- `src/lib/tts/Lexicon*` — **8 files**; `src/lib/tts/AudioContentPipeline*` — **7 files**.
- `src/components/GlobalSettingsDialog.test.tsx` + `GlobalSettingsDialog.predictability.test.tsx` — the latter mocks **9 stores + Modal** to assert one render-loop bug.
- **Duplicate component tests in two conventions**: `src/components/reader/ReaderTTSController.test.tsx` (157 ln, keyboard cases) AND `src/components/reader/tests/ReaderTTSController.test.tsx` (152 ln, focus/visibility cases) — same component, different dirs, overlapping concern, different mock styles.
- Placement conventions in use simultaneously: co-located dot-suffix, co-located underscore-suffix, `components/reader/tests/`, `components/notes/__tests__/`, `src/test/`, `src/verification/`, repo root — **7 conventions**.
- `src/integration.test.ts` (244 ln) — the only cross-store integration test (add/list/delete book through `useLibraryStore` + fake-indexeddb); mocks ingestion, offscreen-renderer, epubjs.
- `src/verification/test_background_crash.test.ts` (143 ln) — **zero `expect()` calls**; a smoke test that merely runs `loadSection`/`play` and sleeps. `src/verification/test_drive_sync.test.ts` (215 ln) — store-level Drive "journeys" against `MockDriveService` (decent test, mislabeled "E2E", wrong directory).
- Benchmarks masquerading as tests: `src/lib/ingestion.perf.test.ts` and `src/lib/chinese/benchmark.test.ts` have **zero assertions** (pure `performance.now()` + console output, run on every `npm test`); `search-engine.perf.test.ts`/`LexiconService.perf.test.ts`/`cfi-utils.perf.test.ts` time things but assert only functional results — no perf budget is enforced anywhere.

### TTS engine test architecture (the good part)
| File | Role |
|---|---|
| `src/lib/tts/engine/engineParityScenarios.ts` | Shared behavioral contract (one set of scenarios) executed against both transports. |
| `engineParity.inprocess.test.ts` / `engineParity.worker.test.ts` | Run the contract in-process (DI: `AudioPlayerService.createWithContext(FakeEngineContext, FakePlaybackBackend, platformFactory)`) and over the real worker bridge (MessageChannel + Comlink). Drift between transports fails one side. |
| `replicationSpec.ts` + `replication.test.ts` | Declarative state-replication spec pinned from both sides (every EngineStateUpdate kind has a pusher and a cache handler; loud failures on unreplicated reads). |
| `FakeEngineContext.ts`, `FakePlaybackBackend.ts`, `FakeAudioSink.ts` | Typed, injectable fakes. |

### E2E suite (`verification/`, 90 tracked files, **28MB in git**)
| File(s) | Role |
|---|---|
| `verification/*.spec.ts` (73) | Journey-style Playwright tests (`test_journey_*` ×41, `test_bug_*`, `test_tts_*`, `verify_*` ×3, feature tests). Largest: `test_journey_sync_scenarios.spec.ts` (582 ln), `test_journey_firestore_sync.spec.ts` (374 ln). 211 `page.waitForTimeout()` calls; 178 `captureScreenshot()` calls; 621 `console.log` lines; **0 `toHaveScreenshot()`** assertions. |
| `verification/utils.ts` (262 ln) | Custom `test` fixture: injects `tts-polyfill.js` into every page, sets `window.__VERSICLE_SANITIZATION_DISABLED__ = true` on **every** page (line 60), optional `_idb_probe.js`, log suppression; helpers `resetApp` (deletes IDBs via `window.__DISCONNECT_YJS__`/`__CLOSE_DB__`), `waitForPersistedWrites` (= hard `waitForTimeout(1500)` encoding the app's 200ms/500ms persistence debounces), `ensureLibraryWithBook`, `captureScreenshot`, `getReaderFrame`. |
| `verification/tts-polyfill.js` | Main-thread mock of the Web Speech API (word-timing events) — all E2E TTS runs against this, never a real provider. Well-commented. |
| `verification/_idb_probe.js` | Opt-in IndexedDB/event-loop hang instrumentation (TTS_IDB_PROBE=1). Excellent diagnostic tooling. |
| `verification/docker_entrypoint.sh` | Starts `npm run preview`, curl-waits, runs `npx playwright test "$@"`. |
| `verification/README.md` | **Entirely stale**: describes a pytest suite (`conftest.py`, `run_all.py`, `utils.py`, `test_*.py`, `goldens/`) — none of which exist. There is no `goldens/` directory. |
| `verification/*.epub` (6) | Fixtures incl. `pride-and-prejudice.epub` (**24MB**), `jane-eyre.epub` (3MB). |
| `verification/videos/*.webm`, `test.zip`, `debug_ids.txt` | Committed debug artifacts. |
| `verification/create_test_chinese_epub.cjs` | Fixture generator (the right idea — could replace committed EPUBs). |

### Harness scripts & Docker
| File | Role |
|---|---|
| `run_verification.sh` (126 ln) | Builds `versicle-verify` image, runs container with `--ipc=host`, mounts screenshots, defaults `--project=desktop --project=mobile`, serializes WebKit. **Its `--help` text (lines 22-45) still describes the deleted Python runner** (`verification/run_all.py`, pytest `-k`/`-m`/`-n`, `--update-snapshots` which does nothing since no snapshot assertions exist). |
| `jules_run_verification.sh` | `sudo ./run_verification.sh "$@"` — one line. |
| `Dockerfile.verification` | playwright:v1.60.0-jammy base; `npm ci`; `COPY . .` (pulls the whole repo incl. 28MB of fixtures); `npm run build`; entrypoint. |
| `run_android_tests.sh`, `Dockerfile.android` | Dockerized `./gradlew test` for the Capacitor app (out of scope; sane). |

### Agent workflow & CI
| File | Role |
|---|---|
| `AGENTS.md` | The contract that the AI agents (the de-facto dev team) follow. Mandates: run verification suite for all changes, model tests as journeys, screenshots for key steps, PR prereqs (`npm run build`, lint clean, verification suite, `npm test`). **References pytest files/flags that no longer exist** (`verification/test_journey_sync.py`, `-n 0 verification/test_bug_spacer.py`) and instructs (lines 61-64) that `EpubLibraryDB` version bumps must update `verification/test_journey_sync.py` and `verification/test_maintenance.py` — neither file exists (the real ones are `.spec.ts`). |
| `.github/workflows/npm-test.yml` | PR + push(main): node 22, `npm install --legacy-peer-deps` (not `npm ci`), `npm test`. No lint, no tsc. |
| `.github/workflows/visual-verification.yml` | PR + push(main): 3-job matrix (desktop/mobile/webkit), each **builds the Docker image from scratch**, runs suite, uploads screenshots (14-day retention). `CI` env is **not** passed into `docker run`, so playwright.config's CI branches never fire. Nothing ever compares the screenshots. |
| `.github/workflows/android.yml`, `deploy.yml`, `docker-publish.yml` | Android tests (paths-filtered), Pages deploy (typecheck via `npm run build` happens here and in the Docker image build), image publish. |
| `.jules/bolt.md`, `sentinel.md`, `palette.md` | Agent memory journals (perf/security/UX learnings). Useful institutional memory; some entries have impossible dates (2024 entries describing 2026 work). |

## How it works (data & control flow)

**Unit path:** `npm test` → vitest reads `vitest.config.ts` (NOT `vite.config.ts` — when both exist vitest.config wins and they are not merged) → discovers `**/*.{test,spec}.*` from the repo root minus `verification/**` → this catches all 246 files in `src/` **plus the 3 stray root test files** → jsdom + `src/test/setup.ts` (fake-indexeddb, media/speech mocks) per file → 60-second per-test timeout.

**E2E path:** `jules_run_verification.sh` → sudo → `run_verification.sh` → docker build (npm ci, vite build) → container starts `vite preview` on :5173 → `npx playwright test` with `testDir: verification` → every page gets `tts-polyfill.js` (mock speech engine) + `__VERSICLE_SANITIZATION_DISABLED__=true`; sync journeys additionally set `__VERSICLE_MOCK_FIRESTORE__` / `__VERSICLE_MOCK_USER_ID__` / `__VERSICLE_MOCK_SYNC_DELAY__`, which production `FirestoreSyncManager` checks at ~10 call sites to swap in `MockFireProvider` (statically imported at `FirestoreSyncManager.ts:31`, i.e. shipped in the user bundle). Tests reset state via `window.__DISCONNECT_YJS__()` (`src/store/yjs-provider.ts:243`) and `window.__CLOSE_DB__()` (`src/db/db.ts:204`) then delete all IndexedDB databases. Screenshots are written to a mounted volume; CI uploads them as artifacts; no machine ever diffs them.

**Verification gate:** per `AGENTS.md`, agents must run the full Docker E2E suite + build + lint + `npm test` before any PR. CI re-runs `npm test` and the 3-browser E2E matrix on PRs.

## Technical debt

### 1. Two divergent vitest configs; the active one lacks the worktree exclusion, the fixed one is dead
- **Severity:** high · **Category:** correctness
- **Evidence:** `vitest.config.ts:1-11` (excludes `verification/**` only). `vite.config.ts:75-83` (excludes `.claude/**`/`**/.claude/**` only — added by commit `0fbd8e9c` specifically to stop `npm test` from crawling agent worktrees). Vitest gives `vitest.config.ts` priority and does **not** merge the two, so the `.claude` exclusion landed in a config block vitest never reads, and the active config would happily run `verification/*.spec.ts` if its single exclude line were lost.
- **Impact:** The worktree fix is ineffective via the documented entry point (`npm test`); any future consolidation that deletes the "redundant-looking" `vitest.config.ts` silently un-excludes the Playwright suite from vitest (Playwright specs imported under vitest throw at collection — instant suite breakage). Two sources of truth for test discovery, both half-right.
- **Fix:** One config. Move the `test:` block fully into `vite.config.ts` (so plugins/resolve stay unified) with explicit `include: ['src/**/*.test.{ts,tsx}']` (kills both the verification and root-file discovery problems structurally) and delete `vitest.config.ts`, or the inverse. Add a comment forbidding a second config.

### 2. No test code is ever typechecked — 42k+ LOC outside the compiler
- **Severity:** high · **Category:** type-safety
- **Evidence:** `tsconfig.app.json` `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/integration.test.ts", "src/test/**", ...]`; `tsconfig.node.json` includes only `vite.config.ts`; no tsconfig covers `verification/**` (7,894 LOC), `playwright.config.ts`, `vitest.config.ts`, or the root test files. `npm run build` (`tsc -b`) therefore typechecks zero test lines. ESLint covers them but without type-aware rules.
- **Impact:** Mocks drift silently from real interfaces (38 files hand-mock `useTTSStore`, 36 hand-mock DBService — nothing forces their shapes to match the modules they replace); `as any` proliferates (pervasive in `src/store/useLibraryStore.race.test.ts`, `src/verification/test_background_crash.test.ts`, etc.); refactors "pass" while tests assert against stale shapes; untyped root tests like `test_use_local_storage_events.test.tsx:5` (`{storageKey}` implicit any) survive indefinitely.
- **Fix:** Add `tsconfig.test.json` (extends app config, includes `src/**/*.test.*`, `src/test/**`, root configs) and `tsconfig.e2e.json` (includes `verification/**`, `playwright.config.ts`, node types), reference both from `tsconfig.json`, and run `tsc -b` in CI. Expect a one-time wave of real errors; fix mechanically. Then enable type-aware lint for tests and ban untyped `vi.mock` factories (prefer `satisfies` against the real module type).

### 3. One-off regression-file sprawl: 246 files, many per subject, with literal duplicates
- **Severity:** high · **Category:** duplication
- **Evidence:** 14 test files target `AudioPlayerService` (12 `src/lib/tts/AudioPlayerService*.test.ts` + `engine/AudioPlayerService.isolated.test.ts` + assertion-free `src/verification/test_background_crash.test.ts`). 9 files target the single `useLocalStorage` hook (7 in `src/hooks/` + 2 at repo root); `src/hooks/use-local-storage.test.ts` and `use-local-storage-predictability.test.ts` are the **same test** (both: two functional updates → expect 2); the root `use-local-storage-other-tab.test.ts` and `test_use_local_storage_events.test.tsx` duplicate `use-local-storage-sync.test.tsx`'s storage-event behavior. 6 files for `useLibraryStore` races sharing identical scaffolding. 9 `TextSegmenter` files, 8 `Lexicon*`, 7 `AudioContentPipeline*`. Two `ReaderTTSController.test.tsx` files in different directories. Two search "repro" files (`src/test/search-client.repro.test.ts`, `src/lib/search.repro.test.ts`).
- **Impact:** Agents (and humans) cannot find existing coverage, so every bug spawns a new file — the sprawl is self-reinforcing. Shared mock boilerplate is copy-pasted per file and drifts (see #9). Suite runtime and maintenance cost scale with file count; renaming a module means touching a dozen test files with near-identical headers.
- **Fix:** Consolidate to one suite file per subject (plus at most `.fuzz` and `.perf` companions), with regression cases preserved as `describe('regression: <issue>')` blocks inside the main file. Mechanical merge, no behavior change; delete exact duplicates. Target: 246 → ~110 files.

### 4. Test placement & naming anarchy (7 conventions) and tests in misleading places
- **Severity:** high · **Category:** architecture
- **Evidence:** co-located dot-suffix (`AudioPlayerService.predictability.test.ts`), co-located underscore-suffix (`AudioPlayerService_Critical.test.ts`), `src/components/reader/tests/`, `src/components/notes/__tests__/`, `src/test/`, `src/verification/` (vitest unit tests named like the Playwright suite: `test_drive_sync.test.ts` titled "…E2E"), and repo root. The duplicated `ReaderTTSController` tests exist *because* two conventions coexist.
- **Impact:** This is the root cause of #3 — there is no single answer to "where is the test for X", so coverage is invisible and gets re-created. `src/verification/` is actively confusing: it shares a name with the Playwright directory but runs under vitest.
- **Fix:** Single convention: `Foo.test.ts(x)` co-located with `Foo.ts(x)`; dissolve `src/components/reader/tests/`, `__tests__/`, `src/verification/` (move the drive-sync store test next to `DriveScannerService`, delete the assertion-free crash test or fold a real assertion into `AudioPlayerService.test.ts`). Enforce via an ESLint rule or a CI script that fails on new test files outside the convention.

### 5. The agent contract (AGENTS.md) and all runner docs describe a deleted Python/pytest world
- **Severity:** high · **Category:** testing
- **Evidence:** `AGENTS.md:13-16,27` (`./jules_run_verification.sh verification/test_journey_sync.py`, pytest `-n 0`); `AGENTS.md:61-64` mandates that `EpubLibraryDB` version bumps update `verification/test_journey_sync.py` and `verification/test_maintenance.py` — **neither exists** (`find verification -name "*.py"` → 0; the suite is 73 `.spec.ts` files). `run_verification.sh:22-45` help text describes `verification/run_all.py`, pytest markers, and `--update-snapshots` (no snapshot assertions exist). `verification/README.md` documents `conftest.py`, `run_all.py`, `goldens/` — none exist. `README.md:178` runs `/app/verification/test_journey_reading.py`.
- **Impact:** This codebase is maintained by agents that *follow these documents literally*. An agent obeying AGENTS.md's DB-version rule cannot comply (files don't exist) and may create `.py` files to satisfy it; pytest flags passed through to Playwright fail; the institutional instruction channel is corrupted. For an AI-built repo this is equivalent to a broken build script.
- **Fix:** Rewrite `AGENTS.md` against reality (spec.ts names, `--project`/`--workers` flags, the actual DB-version-coupled spec files — `test_journey_firestore_sync.spec.ts`/`test_maintenance.spec.ts` — or better, remove the manual coupling entirely by importing the version constant); regenerate `run_verification.sh --help` and `verification/README.md`; make one `TESTING.md` canonical and link the others to it.

### 6. E2E suite verifies a different application than the one users run
- **Severity:** high · **Category:** security
- **Evidence:** `verification/utils.ts:60` injects `window.__VERSICLE_SANITIZATION_DISABLED__ = true` into **every** test page; `src/hooks/useEpubReader.ts:318` then skips `sanitizeContent()` — so the XSS sanitization hook (the defense `.jules/sentinel.md` records multiple bypasses of) is never exercised end-to-end. All TTS journeys run against `verification/tts-polyfill.js`, never a real provider path. All sync journeys run against `MockFireProvider` via `window.__VERSICLE_MOCK_FIRESTORE__` (`FirestoreSyncManager.ts:177,311,637,706,803,835,956`), so real Firestore auth/rules/serialization are untested anywhere.
- **Impact:** A regression in sanitization, the real WebSpeech provider wiring, or Firestore serialization ships green. The suite's pass signal systematically overstates safety on exactly the highest-risk paths (XSS, data sync).
- **Fix:** Default sanitization ON in E2E; add one perf-budgeted journey that loads a hostile EPUB and asserts script neutering (fixture via `create_test_chinese_epub.cjs`-style generator). Add a nightly sync journey against the Firebase emulator. Keep the TTS polyfill (real engines aren't testable headless) but cover real-provider request shaping in unit tests of the providers (already partially present under `src/lib/tts/providers/`).

### 7. Sleep-based synchronization is the suite's concurrency model
- **Severity:** high · **Category:** testing
- **Evidence:** 211 `waitForTimeout` calls across 73 specs; `verification/utils.ts:182-184` `waitForPersistedWrites` = a bare 1500ms sleep whose comment documents it exists to outwait the app's 200ms (y-idb) and 500ms (DBService) write debounces; `navigateToChapter` ends with `waitForTimeout(1000)` (`utils.ts:101`); 89 raw `setTimeout` sleeps in `src` unit tests; WebKit project carries `retries: 3` + `timeout: 120000` (`playwright.config.ts:73-81`) explicitly to absorb "environmental flakiness"; `vitest.config.ts:8` sets a 60-second default test timeout, so a hung unit test stalls the suite for a minute before failing.
- **Impact:** Chronic flakiness (the configs and shell scripts are full of archaeology about it), slow suites (211 sleeps ≥ several minutes of pure waiting per project, ×3 projects), and masked hangs. Sleeps also hide real races: a test that needs 1500ms to "drain writes" is asserting that nobody can reload within 1.5s of a write — which users can.
- **Fix:** Expose a deterministic flush: a single test API (`window.__versicleTest.flushPersistence(): Promise<void>`) that awaits the y-idb + DBService debounce queues, replacing `waitForPersistedWrites`; replace navigation sleeps with locator waits/`expect.poll`. In unit tests, replace `setTimeout` sleeps with `vi.waitFor`/fake timers (the engineParity scenarios already model this). Drop default `testTimeout` to 10s with per-test overrides.

### 8. "Visual Verification" performs no visual verification
- **Severity:** medium · **Category:** testing
- **Evidence:** 178 `captureScreenshot()` calls, **zero** `toHaveScreenshot()`/snapshot assertions across `verification/`; no `goldens/` directory (README claims one); `.github/workflows/visual-verification.yml` uploads screenshots as artifacts that nothing compares; `run_verification.sh:42` advertises `--update-snapshots` which is a no-op.
- **Impact:** The screenshot machinery costs runtime and storage but prevents no visual regression; the workflow name gives false confidence. Visual breakages (theming, layout, reader rendering) are only caught if a human/agent happens to eyeball artifacts.
- **Fix:** Pick ~10 stable surfaces (library grid, reader page, settings tabs, audio deck, dark/sepia themes) and convert to real `expect(page).toHaveScreenshot()` with committed goldens and CI-updated baselines; demote the remaining 170 captures to failure-only (`screenshot: 'only-on-failure'`) to cut suite I/O.

### 9. 712 hand-rolled `vi.mock` blocks; the same internal modules re-mocked with divergent shapes
- **Severity:** high · **Category:** duplication
- **Evidence:** 712 `vi.mock` calls in 141 of 246 test files. 38 files mock `useTTSStore`, 36 mock `DBService`, 13 re-declare a `LexiconService` mock object, 9 mock `@capacitor/core` — each copy slightly different (compare `src/lib/tts/AudioPlayerService_Critical.test.ts:6-51`, `src/verification/test_background_crash.test.ts:13-67`, `src/lib/tts/engine/engineParity.inprocess.test.ts:8-46`). `GlobalSettingsDialog.predictability.test.tsx:6-50` mocks 8 stores + the Modal component to render one dialog.
- **Impact:** Any change to DBService/useTTSStore shape requires editing dozens of files; because mocks aren't typechecked (#2), missed ones keep passing against stale shapes — tests stop testing reality. New tests copy whichever variant the agent found first, compounding drift.
- **Fix:** Build `src/test/harness/` with typed factory doubles (`makeDbServiceMock(overrides) satisfies Partial<typeof dbService>`, `makeTTSStoreMock(...)`, `installCapacitorMock(platform)`) and migrate mechanically. Longer term, prefer the DI seams that already exist (`AudioPlayerService.createWithContext`, `createLibraryStore(db)`) over module-graph mocking, and add such seams where missing instead of `vi.mock`ing internals.

### 10. Assertion-free tests and benchmarks running in the unit gate
- **Severity:** medium · **Category:** dead-code
- **Evidence:** `src/verification/test_background_crash.test.ts` — 143 lines, 0 `expect` (its `it` is "should NOT stop playback state…" and asserts nothing). `src/lib/ingestion.perf.test.ts` — 0 `expect`, pure timing console output. `src/lib/chinese/benchmark.test.ts` — 0 `expect`. The other `.perf.test.ts` files time code but assert only trivial functional facts (`search-engine.perf.test.ts:44-45` asserts `results.length === 0`), enforcing no budget.
- **Impact:** Green checkmarks that verify nothing; benchmark noise slows every `npm test`; a perf regression cannot fail CI despite seven "perf" files implying it would.
- **Fix:** Give the crash test a real assertion (status remains 'playing' through `loadSection(…, autoPlay=true)`) or delete it. Convert benchmarks to `vitest bench` (`*.bench.ts`) excluded from the test gate, or add explicit relative budgets (fast-path ≤ N× reference) where a guarantee is actually intended (the `cfi-utils.fuzz` fast-vs-reference equivalence pattern is the model).

### 11. CI gates don't enforce the contract and drift from local reality
- **Severity:** high · **Category:** testing
- **Evidence:** `npm-test.yml:23` uses `npm install --legacy-peer-deps` (ignores the lockfile contract; every other path uses `npm ci`). **No CI job runs `npm run lint` or a standalone `tsc`** even though `AGENTS.md:54` makes lint/build mandatory (typecheck only happens incidentally inside Docker image builds and the deploy job). `visual-verification.yml:30-38` rebuilds the full Docker image per matrix job (3× `npm ci` + `vite build` per PR) and does not pass `CI` into `docker run`, so `playwright.config.ts:13-17` (`forbidOnly`, `retries: 2`, `workers: 1`) never activates in CI — a committed `test.only` passes CI silently while desktop/mobile get 0 retries. Workflows trigger on `main` while the working default branch is `antigravity` (push-triggered runs may never fire on the active branch). `husky` ships in `dependencies` with no hooks configured. Duplicate `"test"`/`"tests"` scripts.
- **Impact:** The advertised quality gates (lint clean, no `.only`, retry discipline, lockfile fidelity) are not actually enforced; PR feedback is slow (3 cold Docker builds); branch-trigger mismatch can leave the integration branch unguarded.
- **Fix:** Add a `quality` job: `npm ci`, `npm run lint`, `tsc -b` (with the new test/e2e tsconfigs). Switch npm-test to `npm ci`. Pass `-e CI=1` into `docker run` (or set retries/forbidOnly unconditionally). Build the Docker image once per workflow and share via artifact/registry cache, or drop Docker in CI and run Playwright directly on the runner against `vite preview`. Align workflow branch triggers with the real default branch. Remove husky or wire it up.

### 12. Production code carries scattered window-global test seams, including a mock provider in the shipped bundle
- **Severity:** high · **Category:** architecture
- **Evidence:** `src/db/db.ts:204` (`window.__CLOSE_DB__`), `src/store/yjs-provider.ts:22,243` (`__YJS_DOC__`, `__DISCONNECT_YJS__`), `src/hooks/useEpubReader.ts:318` (`__VERSICLE_SANITIZATION_DISABLED__`), `src/lib/sync/FirestoreSyncManager.ts` — `MockFireProvider` statically imported (line 31) and selected at runtime by `__VERSICLE_MOCK_FIRESTORE__` checks at ~10 sites (177, 311, 327, 637, 706, 717, 803, 835, 956), plus `__VERSICLE_FIRESTORE_DEBOUNCE_MS__`, `__VERSICLE_MOCK_USER_ID__`, `__VERSICLE_MOCK_SYNC_DELAY__` (`MockFireProvider.ts:78-80`).
- **Impact:** Test-only control flow is interleaved with production sync logic (every reader of FirestoreSyncManager must reason about mock branches); the mock Firestore ships to users and is activatable from any page console (`window.__VERSICLE_MOCK_FIRESTORE__ = true` before init silently reroutes "sync" to an in-memory fake — a data-loss footgun, not just hygiene); seams are undiscoverable and untyped.
- **Fix:** Consolidate into one `installTestApi()` module that registers a single typed `window.__versicleTest` object, included only when `import.meta.env.VITE_E2E === 'true'` (verification build sets it; tree-shaken otherwise). Inject `FireProvider` via a factory parameter so `MockFireProvider` is provided by the test boot path, not statically imported.

### 13. Dead files, stale snapshots, and committed binary/debug artifacts
- **Severity:** medium · **Category:** hygiene
- **Evidence:** Repo root: `test-backup.ts` (imports nonexistent `y-indexeddb`), `test-yjs.js`, `verification_script.py`, `test_files.txt` (stale file list referencing deleted tests), `getDeviceId_perf.md`, `plan.md` — all dated 2026-01→04, none referenced anywhere. `verification/` is 28MB tracked: `pride-and-prejudice.epub` 24MB, `jane-eyre.epub` 3MB, `videos/7a18….webm`, `test.zip`, `debug_ids.txt`. Four identical copies of `alice.epub` (`verification/`, `public/`, `public/books/`, `src/test/fixtures/`). `src/test/README.md` describes mocks that aren't in `setup.ts` (IntersectionObserver).
- **Impact:** Clone/build/Docker-context weight (the verification image `COPY . .` ingests all of it); stale lists actively mislead agents; root test files pollute the published package dir and the vitest run.
- **Fix:** Delete the six dead root files; delete `videos/`, `test.zip`, `debug_ids.txt`; replace giant EPUBs with generated fixtures (extend `create_test_chinese_epub.cjs` to synthesize a large book for stress tests) or fetch-on-demand with checksum; single canonical `alice.epub` in `src/test/fixtures/` with build-time copy to `public/`.

### 14. No coverage measurement, no test pyramid policy
- **Severity:** medium · **Category:** testing
- **Evidence:** `@vitest/coverage-v8` is installed (`package.json:93`) but no script invokes it; no thresholds; no per-area coverage knowledge. Distribution is inverted in places: 14 files on `AudioPlayerService` and 9 on `useLocalStorage`, while the Yjs↔Zustand bridge (the data-integrity core) has 2 files (`yjs-provider.test.ts`, `yjs-provider.migration-race.test.ts`) and cross-store flows have a single `integration.test.ts`.
- **Impact:** Nobody can see what the 34k LOC of tests actually cover; consolidation (#3) cannot prove safety without a baseline; effort keeps flowing to already-saturated hotspots.
- **Fix:** Add `test:coverage` and record a baseline before any consolidation; ratchet (fail CI if coverage drops >0.5% vs main). Use the report to direct new tests at the CRDT/persistence core rather than another AudioPlayerService file.

## Problematic couplings

- **E2E ⇄ production window globals:** the suite functions only because production modules register `__CLOSE_DB__` (`src/db/db.ts:204`), `__DISCONNECT_YJS__` (`src/store/yjs-provider.ts:243`), and honor `__VERSICLE_SANITIZATION_DISABLED__` (`src/hooks/useEpubReader.ts:318`) and `__VERSICLE_MOCK_*` (`src/lib/sync/FirestoreSyncManager.ts`, ~10 sites). Test infra and prod code mutually depend through untyped globals.
- **Mock in the prod bundle:** `MockFireProvider` is statically imported by production `FirestoreSyncManager.ts:31` — the sync subsystem owns a test double that the testing subsystem drives.
- **Timing knowledge duplicated:** `verification/utils.ts:167-184` hardcodes the persistence layer's debounce intervals (y-idb 200ms, DBService `cache_session_state` 500ms); if persistence tuning changes, the E2E suite silently becomes flaky or wasteful.
- **Deep module-path mocking:** 36 files `vi.mock` DBService and 38 mock `useTTSStore` by relative path — tests are hard-coupled to the file layout and private shapes of the db/store/tts subsystems; moving a file breaks dozens of mocks.
- **AGENTS.md ⇄ db schema:** `AGENTS.md:61-64` couples `src/db/db.ts` version bumps to hand-editing named verification files (which no longer exist) instead of the specs importing the version constant.
- **tts-polyfill ⇄ WebSpeechProvider semantics:** `verification/tts-polyfill.js` re-implements the event contract (`play()` resolves on `start`) that `WebSpeechProvider` depends on; provider behavior changes require parallel polyfill edits.

## What's good (keep)

- **The engine parity architecture** (`src/lib/tts/engine/engineParityScenarios.ts` + `engineParity.{inprocess,worker}.test.ts`): one behavioral contract run over both transports, with typed fakes (`FakeEngineContext`, `FakePlaybackBackend`, `FakeAudioSink`) and a real DI seam (`AudioPlayerService.createWithContext`). This is the template the whole suite should converge on.
- **Declarative replication pinning** (`replicationSpec.ts` + `replication.test.ts`): both sides of the worker state bridge fail loudly if a slice is added on only one side.
- **DI-based store testing** (`createLibraryStore(mockDb)` in the `useLibraryStore.*race*` tests): injected fake DB instead of module mocks — right pattern, wrong file granularity.
- **Seeded fuzz infrastructure** (`src/test/fuzz-utils.ts`, 10 `*.fuzz.test.ts` files), especially the fast-path-vs-reference equivalence style in `cfi-utils.fuzz.test.ts`.
- **Hermetic Dockerized E2E runner** (`Dockerfile.verification`, `docker_entrypoint.sh`, `run_verification.sh`): prod-like `vite preview` target, `--ipc=host`, mounted artifacts, WebKit serialization — hard-won environmental knowledge encoded in code and comments.
- **Journey-style E2E organization** with `data-testid` selectors and per-step screenshots — the *shape* of the suite is right; only its synchronization and assertions need work.
- **Diagnostic instrumentation culture:** `verification/_idb_probe.js` (IDB hang evidence), the TTS flight-recorder dump in `utils.ts:66-80`, and the unusually honest "why" comments in `playwright.config.ts` and `tts-polyfill.js`.
- **CI exists and runs both tiers on every PR** with artifact upload — the skeleton to build on.
- **Centralized jsdom environment** (`src/test/setup.ts` + `fake-indexeddb`) and functional fakes (`MockDriveService`, `MockCloudProvider`, `MockFireProvider` as a *concept*).
- **`.jules/` learning journals** — institutional memory worth keeping accurate.

## Target design

**Tiers (test pyramid for this app):**
1. **Pure-logic unit tests** (vitest, node env where DOM isn't needed): segmentation, CFI math, lexicon, validators, CSV — one file per module + optional `.fuzz` companion; benchmarks moved to `*.bench.ts`.
2. **Contract/parity suites** for every boundary that has two implementations or transports: TTS engine in-process vs worker (exists), TTS providers against a shared provider-contract spec, FireProvider vs MockFireProvider against a shared sync-driver spec, DBService against fake-indexeddb. Pattern: `describeXContract(makeHarness)` à la `engineParityScenarios`.
3. **Store/integration tests** (vitest + fake-indexeddb + real Yjs doc): library/reading-state/annotation flows through real stores with injected service fakes from `src/test/harness/`; replaces most component-level store-mock tests.
4. **Component tests**: only for components with real logic (dialog flows, reader controller); rendered with a single `renderWithStores()` helper instead of 8 `vi.mock`s.
5. **E2E journeys** (Playwright): keep ~40 journeys; deterministic waits via `window.__versicleTest` (flushPersistence, resetApp, seedLibrary); sanitization ON; desktop on PR, mobile+webkit+sync-emulator nightly.
6. **Visual regression**: ~10 `toHaveScreenshot` goldens; all other screenshots failure-only.

**Infrastructure:** one vitest config (projects: unit/node, unit/jsdom, bench) with `include: src/**`; `tsconfig.test.json` + `tsconfig.e2e.json` referenced from root so `tsc -b` checks everything; CI = lint + typecheck + vitest (sharded) + Playwright desktop + nightly matrix, all on `npm ci`, `CI=1` propagated; coverage ratchet. One canonical `TESTING.md`; `AGENTS.md` regenerated from it.

**Test seams:** a single `installTestApi()` (build-flag-gated) replaces all scattered window globals; `MockFireProvider` leaves the prod import graph via provider-factory injection.

## Migration notes

No user data is involved — this subsystem can be overhauled aggressively. Order matters because agents follow the docs:

1. **Fix the instructions first** (cheap, unblocks everything): rewrite `AGENTS.md`, `run_verification.sh --help`, `verification/README.md`, `README.md` testing section to match the TS Playwright reality; replace the DB-version manual rule with specs importing the version constant from `src/db/db.ts`.
2. **Make the compiler see the tests**: add `tsconfig.test.json`/`tsconfig.e2e.json`, run `tsc -b` locally, burn down the error wave (mostly `as any` formalization and stale mock shapes — each fixed mock is a latent bug found). Add `tsc -b` + `npm run lint` to CI as a new required job. Do this *before* consolidation so merges are typechecked.
3. **Unify vitest config** (delete `vitest.config.ts`, move a complete `test:` block with explicit `include: ['src/**/*.test.{ts,tsx}']` into `vite.config.ts`); this simultaneously fixes worktree discovery, root strays, and the verification-exclusion fragility. Verify file count collected equals 246 minus the 3 root strays before/after.
4. **Record a coverage baseline** (`vitest run --coverage`) and commit the summary; all later consolidation PRs must not drop it.
5. **Delete dead weight**: 6 root files, `verification/{videos,test.zip,debug_ids.txt}`, duplicate alice.epubs, `husky`, `"tests"` script. Migrate the 3 root test files' unique cases (if any — they look fully duplicated) into `src/hooks/use-local-storage.test.ts`, then delete.
6. **Consolidate per subsystem, in the same PR as that subsystem's refactor** (the overhaul will rewrite AudioPlayerService etc. anyway): merge the 12+ AudioPlayerService files into `AudioPlayerService.test.ts` + `engineParity*` (porting scenarios onto the parity harness where possible), 7 use-local-storage files into one, 6 useLibraryStore files into one, 9 TextSegmenter into base+fuzz+bench. Keep every distinct assertion; the git history preserves provenance.
7. **Introduce `src/test/harness/`** (typed doubles for DBService, stores, Capacitor, providers) and migrate files opportunistically — enforce "no new inline `vi.mock` of DBService/useTTSStore" via lint rule once the harness exists.
8. **Replace window seams with `installTestApi()`** behind `VITE_E2E`; keep the old globals as deprecated aliases for one transition period so the E2E suite migrates spec-by-spec (`resetApp`/`waitForPersistedWrites` first — converts 200+ sleeps into awaited flushes); then delete the aliases and the `MockFireProvider` static import.
9. **CI restructure last** (after suites are fast and deterministic): split PR gate vs nightly matrix, image caching or runner-native Playwright, `CI=1` into containers, branch triggers aligned with the real default branch, visual goldens enabled with `--update-snapshots` workflow.

Risks: step 2's error wave is large but mechanical; step 6 must be reviewed against the coverage baseline to avoid silently dropping regression cases; step 8 changes E2E timing behavior — land it one helper at a time with the WebKit project (the flakiest) as the canary.
