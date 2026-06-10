# Phase 1 — Verified deletion list

**Verified against:** `da24e3a5` (branch `claude/amazing-davinci-d7336e`), 2026-06-10.
**Method:** manual grep over `src/`, `verification/`, configs, `index.html`, `android/`, plus
`npx knip@latest` (ran successfully via npx, no repo knip config — results cross-checked by hand;
knip has known false positives here: `src/sw.ts` is the VitePWA injectManifest entry, ambient
`*.d.ts` files, `verification/tts-polyfill.js` / `_idb_probe.js` / `create_test_chinese_epub.cjs`
are loaded by path string from specs and `run_verification.sh`, `piper-wasm` is consumed by the
`prepare-piper` shell script, `@capacitor-community/safe-area` is configured in
`capacitor.config.ts`).

The tree has moved since the analysis reports (vitest unification, stray-test relocation,
preprocessTableRoots deletion, alignment-field unification). Every verdict below is re-verified
at HEAD; differences from the proposal are called out.

Verdict key: **DEAD** = zero references, delete files outright. **DEAD (edit)** = functionally
dead, removal requires edits in live files. **ALIVE** = referenced on a live path today — do NOT
delete in Phase 1. **DECISION** = dead but plan defers/disputes disposition. **DONE** = already
handled at HEAD.

---

## 1. Item-by-item verdicts

### 1.1 `src/components/audio/` (AudioReaderHUD, SatelliteFAB) + test — DEAD
- Paths: `src/components/audio/AudioReaderHUD.tsx` (76), `SatelliteFAB.tsx` (49), `SatelliteFAB.test.tsx` (90).
- Evidence: `grep -rn "components/audio|AudioReaderHUD|SatelliteFAB"` over `src/`, `verification/`, configs, `index.html` → zero hits outside the directory. knip independently flags `AudioReaderHUD.tsx` as an unused file (SatelliteFAB only survives knip because its own test imports it).
- Delete all 3 files. No edits elsewhere.

### 1.2 `src/hooks/use-local-storage.ts` + its test files — DEAD (8 tests at HEAD, not 7)
- Paths: `src/hooks/use-local-storage.ts` (135) and **eight** test files: `use-local-storage-bug.test.ts` (27), `-closure.test.ts` (26), `-other-tab.test.tsx` (44, relocated from repo root by `e781a361`), `-predictability.test.ts` (23), `-quota.test.tsx` (55), `-sync.test.tsx` (34), `use-local-storage.test.ts` (22), `use-local-storage.test.tsx` (55).
- Evidence: `grep -rn "use-local-storage|useLocalStorage"` excluding the hook's own files → zero hits in `src/` and `verification/`.
- Delete all 9 files (≈421 LOC).

### 1.3 `src/hooks/useBookProgress.ts` (dead twin) + test — DEAD
- Paths: `src/hooks/useBookProgress.ts` (66), `src/hooks/useBookProgress.test.ts` (122).
- Evidence: every `useBookProgress` reference in the app resolves to the *other* export of the same name in `src/store/useReadingStateStore.ts` (e.g. `ReadingHistoryPanel.test.tsx:12` imports from `../../store/useReadingStateStore`). Only the hook's own test imports `./useBookProgress`.
- Delete both files.

### 1.4 Dead barrels — DEAD (all four)
- `src/store/index.ts` (1 line: `// Store export`), `src/components/reader/index.ts` (1 line comment), `src/components/library/index.ts` (1 line comment), `src/db/index.ts` (2 lines re-exporting `./db`).
- Evidence: no directory-style imports (`from '.../store'`, `'.../db'`, `'.../components/reader'`, `'.../components/library'`) anywhere in `src/` or `verification/`. knip flags all four as unused files.
- Note: `src/components/reader/panels/index.ts` is a *live* barrel (not in scope, leave it).

### 1.5 `SyncEngine.ts` + onMeta/onBoundary plumbing — DEAD (edit); no-op confirmed
- Files deleted: `src/lib/tts/SyncEngine.ts` (105), `src/lib/tts/SyncEngine.test.ts` (63).
- No-op proof at HEAD: `AudioPlayerService.ts:172-174` — `this.syncEngine.setOnHighlight(() => { // No action currently })`; `onBoundary` handler is an empty body (`AudioPlayerService.ts:158-160`). The only consumers of SyncEngine output are these no-ops.
- Plumbing edits required (live files referencing it):
  - `src/lib/tts/AudioPlayerService.ts:2,85,114,155,162-163,172-174` — field, construction, `updateTime`/`loadAlignment` calls (keep `updateSectionMediaPosition` in `onTimeUpdate`).
  - `src/lib/tts/TTSProviderManager.ts:5,32,37,97-106` — `AlignmentData` import, `onBoundary`/`onMeta` event-interface members and dispatch.
  - `src/lib/tts/engine/WorkerTtsEngine.ts:20,31-32,178-179` — `boundary`/`meta` BackendEvent variants and dispatch cases.
  - `src/lib/tts/engine/createWorkerEngineClient.ts:132-133` — forwarding callbacks.
  - `src/lib/tts/engine/FakePlaybackBackend.ts:13,99-100` — `fireMeta`.
  - Optional deeper cut: `providers/types.ts:60` `{ type: 'meta'; alignment }` event + `BaseCloudProvider.ts:48-49` emit. **Do not** touch the cache-side alignment persistence (`types/db.ts:296-302` `alignment`/`alignmentData` on cached segments) — that is real data kept for the future PlaybackSnapshot-based highlighting (recent hotfix `7b96b27d` unified it).
- Test files to update (they mock SyncEngine): `AudioPlayerService.test.ts:46`, `AudioPlayerService_ReactiveSubscription.test.ts:65`, `AudioPlayerService_RestoreAnalysis.test.ts:51`, `engine/AudioPlayerService.isolated.test.ts:24`, `engine/engineParity.inprocess.test.ts:22`, `TTSProviderManager.test.ts:57-58`.

### 1.6 `useTTSStore.syncState` — DEAD (edit)
- Evidence: defined `src/store/useTTSStore.ts:130` (interface) and `:447` (impl). Only caller anywhere is `src/store/useTTSStore.test.ts` (lines 19-85 exercise it directly). No prod caller, no string reference via the worker replication spec.
- Edit: remove the action + interface member; rewrite/remove the corresponding `useTTSStore.test.ts` sections.

### 1.7 Dead lexiconHash machinery on the audio cache key — DEAD (edit)
- Evidence: `lexiconHash` exists only as `TTSCache.generateKey(text, voiceId, pitch=1.0, lexiconHash='')` (`src/lib/tts/TTSCache.ts:22-26`). The sole production caller is `BaseCloudProvider.ts:81`: `generateKey(text, options.voiceId)` — never passes it. Nothing computes a lexicon hash anywhere (`grep -rn lexiconHash src` → TTSCache + its test only).
- Edit: drop the param + `|${lexiconHash}` segment; update `TTSCache.test.ts:43-46`.

### 1.8 `CostEstimator` / `useCostStore` — DEAD (edit); write-only store confirmed
- Files deleted: `src/lib/tts/CostEstimator.ts` (85, contains both the class and `useCostStore`), `CostEstimator.test.ts` (32).
- Evidence: the only production reference is `BaseCloudProvider.ts:5,101` calling `CostEstimator.getInstance().track(text)`. Nothing anywhere reads the output: `grep -rn "useCostStore|sessionCharacters|estimateCost|getSessionUsage"` outside CostEstimator + tests → **zero hits**. Write-only telemetry.
- Edits: remove the import + `track()` call in `BaseCloudProvider.ts`; remove `vi.mock('./CostEstimator')` scaffolding from 9 test files: `AudioPlayerService.test.ts:101`, `_RestoreAnalysis.test.ts:114`, `_Resume.test.ts:39-46`, `_MediaSession.test.ts:33-40`, `_ReactiveSubscription.test.ts:126`, `providers/BaseCloudProvider.registry.test.ts` (asserts `track` is called — delete those assertions), `providers/OpenAIProvider.test.ts:7`, `providers/LemonFoxProvider.test.ts:7`, `providers/GoogleTTSProvider.test.ts:8`.

### 1.9 `supportsXmlParsing` + worker XML parse branch — DEAD in prod (edit)
- Evidence at HEAD unchanged from analysis: `search-engine.ts:25-27` returns `typeof DOMParser !== 'undefined'`; `DOMParser` does not exist in dedicated workers, so `canOffload` (`search.ts:103`) is always false in production; the `xml` branch only activates under JSDOM (`search-engine.xml.test.ts:55-58` asserts exactly that).
- Edits: `src/lib/search.ts` (canOffload + xml branch), `src/lib/search-engine.ts` (method, worker-side parse in `addDocuments`, second DOMParser cache), `src/types/search.ts:35` (`xml?` field — and note `SearchResult.cfi` at `:20` is also never produced; safe to drop in the same commit).
- Tests: delete `src/lib/search-engine.xml.test.ts` (59); update mocks in `src/lib/search.test.ts:18,136` and `src/test/search-client.repro.test.ts:39`.

### 1.10 `scrollToText` + 500 ms timer — **ALIVE** (do not delete in Phase 1)
- Referenced by: `src/components/reader/ReaderView.tsx:913` (definition) and `:1358` — wired into the rendered `SearchPanel`'s `onNavigate` (`rendition.display(href)` then `setTimeout(() => scrollToText(query), 500)`).
- It is degraded (only first occurrence, silent failure past 500 ms — analysis search.md Debt #2) but it is the *only* scroll-to-result behavior users have. Deleting now is a user-visible regression with no replacement until the Phase 7 search rewrite (CFI-bearing results).
- Verdict: ALIVE; deletion belongs to the search strangler, not Phase 1. The strangler proposal lists it under "deleted outright" — that line is wrong as a Phase 1 action.

### 1.11 `src/lib/utils/script-loader.ts` — DEAD
- Evidence: `grep -rn "loadScript|script-loader"` over `src/`, `verification/`, `index.html` → zero hits. knip flags it as an unused file. No test file exists. 17 LOC.

### 1.12 `src/lib/sync/validators.ts` — DEAD
- Paths: `validators.ts` (83), `validators.test.ts` (40), `validators.fuzz.test.ts` (319).
- Evidence: importers of `validateYjsUpdate` / `UserInventoryItemSchema` / `ReadingListEntrySchema` / `UserProgressSchema` / `UserAnnotationSchema` / `UserOverridesSchema` are exactly the two test files. (Do not confuse with the *live* `src/db/validators.ts` — `getSanitizedBookMetadata` is imported by `src/lib/ingestion.ts:8`.)
- Delete all 3 (442 LOC, of which 359 are tests testing dead code).

### 1.13 `MigrationStateService` dead paths — PARTIAL (module alive; three paths confirmed dead)
- Module is live: `App.tsx:29,93,144,159,164,179,185`, `ErrorBoundary.tsx:58`, `CriticalMigrationFailureView.tsx`, `WorkspaceMigrationConfirmModal.tsx:32` all use it. Only the *paths* die:
  - `isBlocked()` (`MigrationStateService.ts:55-59`) — zero callers outside `MigrationStateService.test.ts:68-86`.
  - `'IDLE'` status — never written anywhere (`grep "'IDLE'"` → type member `types/workspace.ts:30`, the check at `MigrationStateService.ts:97`, and tests). Therefore `getDanglingBackupId()` (`:94-101`) always returns null, and App.tsx's dangling-backup cleanup block (`App.tsx:178-186`) is unreachable.
- Edits: remove `isBlocked`, `getDanglingBackupId`, the `App.tsx:178-186` block, the `'IDLE'` member of `SyncMigrationState` in `types/workspace.ts`, and the matching test blocks (`MigrationStateService.test.ts:62-86,128-143`). architecture.md:309 still documents `isBlocked` as the boot gate — fix the doc line or leave for the Phase-0 docs rewrite.

### 1.14 android-backup cluster — DEAD today, **DECISION required (plan says Phase 4)**
- Paths: `src/lib/sync/android-backup.ts` (54), `android-backup.test.ts` (59).
- Evidence: zero references outside the pair (`grep -rn "android-backup|AndroidBackup"`). Nothing native hooks it either: `android/` has only `android:allowBackup="true"` in the manifest (default attr, no BackupAgent/plugin), `capacitor.config.ts` has no backup entry. `AndroidBackupService.writeBackupPayload` is never called.
- Decision: proposal text says "or explicitly wired — decided in Phase 4". Safe to delete now and re-create in Phase 4 if wanted (it's 54 LOC of straightforward Filesystem writes), but flag to the Phase 4 owner before batching.

### 1.15 `tailwind.config.js` — DEAD
- Evidence: project is on Tailwind **v4** (`tailwindcss@^4.1.18`, `@tailwindcss/postcss` in `postcss.config.js`, `@import "tailwindcss"` + `@theme` block in `src/index.css`). v4 ignores `tailwind.config.js` unless a CSS `@config` directive points at it — there is none (`grep "@config" src/*.css` → empty). No other file references the config (`grep -rn "tailwind.config"` → zero). The config's `breathing` keyframe is referenced nowhere in markup.
- Delete the file (61 LOC).

### 1.16 `src/App.css` contents — DEAD
- Evidence: contents are Vite-template leftovers (`.logo`, `logo-spin`, `.card` padding, `.read-the-docs`) — none of those classes appear in any tsx (`grep` → zero). `#root { margin: 0 auto }` is a no-op (block element, no width). Sole importer: `App.tsx:27`.
- Delete file + the `import './App.css'` line (39 LOC + 1).

### 1.17 `public/manifest.webmanifest` + orphaned root icon set — DEAD
- Evidence: VitePWA generates the real manifest from the inline `manifest` block in `vite.config.ts:56-76` and wins the write into `dist/manifest.webmanifest` (verified: built `dist/manifest.webmanifest` is the VitePWA one — "Versicle Reader"/pwa-192/pwa-512). `index.html` carries no manifest link (VitePWA injects it). The public copy's icon paths (`../icons/icon-*.webp`) point *outside* the web root and could never resolve.
- `icons/` (repo root, 7 tracked webp files, 496 KB) is referenced only by that dead manifest — zero other hits across `src/`, `android/`, `public/`, configs.
- Delete `public/manifest.webmanifest` (47 lines) + `icons/` (7 files).

### 1.18 `scripts/patch_piper_worker.js` + `prepare-piper` postinstall — **ALIVE** (blocked)
- Evidence: `package.json:17-18` — `postinstall` runs `patch-package && npm run prepare-piper`; `prepare-piper` copies piper-wasm artifacts into `public/piper/` and runs `node scripts/patch_piper_worker.js`. `public/piper/` is **gitignored** (`.gitignore:34`), i.e. the worker is *not* vendored at HEAD — the proposal's "replaced by vendored worker" hasn't happened yet.
- Verdict: ALIVE until the vendoring lands (and `package.json` is currently contended anyway). Do not delete in Phase 1 unless the vendoring commit ships first.

### 1.19 `GlobalLoggerService` — DEAD (edit within `src/lib/logger.ts`)
- Evidence: the class (`logger.ts:34`) is exported only via `export const Logger = new GlobalLoggerService()` (`:128`). Zero consumers of `Logger` anywhere (`grep -rn "\bLogger\b"` excluding logger.ts internals → nothing; knip flags `Logger` and `ScopedLogger` exports unused). `createLogger`/`ScopedLogger` are the live path (keep the class, un-export it).
- Edit: delete `GlobalLoggerService` + `Logger` export (~60 LOC); optionally un-export `ScopedLogger` and `LogLevel`.

### 1.20 vite-config `test` block — **DONE** at HEAD
- `vite.config.ts` no longer has a `test` block; it carries an explicit NOTE comment that vitest is configured exclusively in `vitest.config.ts` (landed in `e781a361`). Nothing to do.

### 1.21 Root stray files + committed debug artifacts — PARTIAL DONE; remainder DEAD (one correction)
- Already gone at HEAD (relocated/deleted by `e781a361`): `test-backup.ts`, `test-yjs.js`, `test-missing-notes.test.ts`, `test_use_local_storage_events.test.tsx`, root `use-local-storage-other-tab.test.ts`.
- Still tracked, zero references — DEAD: `verification_script.py` (42), `test_files.txt` (132, stale file list), `getDeviceId_perf.md` (12), `plan.md` (51, superseded stale plan — keep only if someone wants it archived under `plan/`).
- Committed debug artifacts, zero references — DEAD: `verification/test.zip` (166 B), `verification/videos/7a18….webm` (79 KB), `verification/debug_ids.txt` (420 B).
- **Correction to the proposal:** the "28 MB of committed debug artifacts" are mostly *live E2E fixtures*: `verification/pride-and-prejudice.epub` (24 MB) and `jane-eyre.epub`/`room-with-a-view.epub`/`frankenstein.epub` are all uploaded by `test_journey_firestore_sync.spec.ts:80-84` and `test_journey_library_view.spec.ts:24`. Do **not** delete; actual artifact cleanup is ~90 KB. (Shrinking the 24 MB fixture is a separate, worthwhile follow-up for whoever owns the E2E suite.)
- NOT dead: `jules_run_verification.sh` — documented agent entry point (`AGENTS.md:7-16`). `run_verification.sh`, `run_android_tests.sh` live.

### 1.22 Duplicate `alice.epub` — DEAD (the `public/alice.epub` root copy only)
- Four identical/sibling copies exist. Live: `public/books/alice.epub` (fetched by `EmptyLibrary.tsx:32` → `/books/alice.epub`), `src/test/fixtures/alice.epub` (used by `src/integration.test.ts:169`), `verification/alice.epub` (used by multiple specs). Dead: `public/alice.epub` (188 KB, same blob `22e7ed3e` as books copy) — zero references to `/alice.epub` anywhere.
- Delete `public/alice.epub` only.

### 1.23 `src/types/epubjs.d.ts` local stub — **ALIVE** (load-bearing; refactor, not deletion)
- The 136-line `declare module 'epubjs'` is an ambient module declaration that *shadows* the package's shipped types (`node_modules/epubjs/package.json` → `"types": "types/index.d.ts"`). Deleting it changes the type universe for every epubjs import — analysis reader.md D1 expects fallout fixes (42 `as any` casts, two `@ts-expect-error` in `cfi-utils.ts:251,273` that work around the stub).
- Verdict: a typed refactor task (delete stub → fix fallout → keep a small augmentation), not a Phase 1 mechanical deletion. Keep `src/types/epubjs-epubcfi.d.ts` (correct, bundle-size purpose — analysis concurs).

### 1.24 `localStorage.getItem('mockGenAIResponse')` + sibling prod mock seams — **ALIVE** (E2E depends)
- Seams: `AudioContentPipeline.ts:473`, `TableAdaptationProcessor.ts:77`, `GenAIService.ts:82,169,176` (`mockGenAIResponse` + `mockGenAIError`); also documented in `db/wipe.ts:47`.
- Live consumer: `verification/test_journey_smart_toc.spec.ts:31,126` sets/clears `mockGenAIResponse`. Removing the seam without migrating that spec breaks the E2E suite.
- Verdict: belongs to the Phase 1 `installTestApi()` PR (plan: "E2E suite migrated to it in the same PR"), not the deletion batches. Not a standalone deletion.

### 1.25 `MockDriveService` prod reachability — DEAD in prod tree; **DECISION: relocate vs delete**
- Path: `src/lib/drive/MockDriveService.ts` (113). Sole importer: `src/verification/test_drive_sync.test.ts:2` (a real vitest integration test that `vi.mock`s `DriveService` with it). Not reachable from any prod entry; never bundled (no prod import).
- Verdict: misplaced test infra, not live mock-in-prod. Either move it to `src/test/harness/` (edit one import in `test_drive_sync.test.ts`) or delete both if the Drive scan tests are slated for consolidation. Recommend relocate in Phase 1 (keeps coverage).

---

## 2. Additional dead code found by knip (high-confidence subset, hand-verified)

- **Unlisted direct dependencies (install-time risk, fix in a package.json window):** `@radix-ui/react-visually-hidden` imported by `GlobalSettingsDialog.tsx` and `lib0` imported by `lib/sync/drivers/MockFireProvider.ts` — both only present transitively. An innocent dedupe could break the build.
- **Unused dependencies (verified by grep):** `react-window` (only mentioned in comments of `LibraryView_Performance.test.tsx`), `husky` (no `.husky/`, no `prepare` script). `@types/dompurify`, `@types/jszip`, `@types/ua-parser-js`, `@types/uuid` likely stale (packages ship own types) — verify in the package.json window. `postinstall-postinstall` only matters for yarn — low confidence.
- **Unused exports worth deleting alongside their domain batches:** `resetDeviceId` (`lib/device-id.ts` — analysis sync.md #11 also flags it; only a test mock references it), `handleObsoleteClient` (`store/yjs-provider.ts`), `initDB` (`db/db.ts`), `isPermissionDeniedEvent` (`FirestoreSyncManager.ts`), `validateBookMetadata` (`db/validators.ts`), `idbWriteLockIdle`, `clearSegmenterCache`, `isModelLoadedInWorker`, the `LexiconApplier`/`ScopedLogger` class exports (instances/factories are the live surface).
- **`scripts/compile-dict.cjs`** — flagged unused; zero references in package.json scripts/READMEs/docs. It is the generator for `public/dict/cedict.json` (15 MB). Keep but document, or delete consciously — decision for the platform owner.
- knip false positives to ignore: `src/sw.ts`, `src/types/*.d.ts`, `verification/tts-polyfill.js`, `verification/_idb_probe.js` (used via `run_verification.sh` + `utils.ts`), `verification/create_test_chinese_epub.cjs` (referenced by chinese/font-profile specs), `piper-wasm`, `@capacitor-community/safe-area`.

---

## 3. Deletion batches (disjoint blast radii, each independently committable)

Gate for every batch: `tsc -b`, `vitest run`, `vite build` green; batches 1-5 also keep the
dependency-cruiser count non-increasing. No batch touches `package.json` (contended).

### Batch 1 — Orphaned components & hooks (pure file deletion, zero edits)
- Delete: `src/components/audio/` (3 files), `src/hooks/use-local-storage.ts` + 8 tests, `src/hooks/useBookProgress.ts` + test.
- 14 files, ≈824 LOC. Blast radius: none (zero importers).

### Batch 2 — Dead barrels, script-loader, GlobalLoggerService (lib-level, no domain logic)
- Delete: `src/store/index.ts`, `src/db/index.ts`, `src/components/reader/index.ts`, `src/components/library/index.ts`, `src/lib/utils/script-loader.ts`.
- Edit: `src/lib/logger.ts` — remove `GlobalLoggerService` + `Logger` export.
- 5 files + 1 edit, ≈82 LOC. Blast radius: none.

### Batch 3 — Sync domain dead code
- Delete: `src/lib/sync/validators.ts`, `validators.test.ts`, `validators.fuzz.test.ts` (442 LOC).
- Edit: `MigrationStateService.ts` (drop `isBlocked`, `getDanglingBackupId`), `App.tsx:178-186` (unreachable dangling cleanup), `types/workspace.ts:30` (`'IDLE'`), `MigrationStateService.test.ts` (drop dead-path blocks). Optional same-batch: delete `resetDeviceId` (`lib/device-id.ts`) + its mock in `store/selectors.perf.test.ts:13`.
- If the Phase 4 owner signs off: also delete `android-backup.ts` + test (+113 LOC) here.
- Blast radius: sync/ + App.tsx boot block + workspace types. Tests to update: `MigrationStateService.test.ts`.

### Batch 4 — TTS dead machinery (one batch because the same test files mock several of these)
- Delete: `SyncEngine.ts` + `SyncEngine.test.ts`, `CostEstimator.ts` + `CostEstimator.test.ts` (285 LOC).
- Edit (prod): `AudioPlayerService.ts` (syncEngine field/wiring/no-op handlers), `TTSProviderManager.ts` (onMeta/onBoundary members + dispatch + AlignmentData import), `engine/WorkerTtsEngine.ts` + `engine/createWorkerEngineClient.ts` (boundary/meta event variants), `engine/FakePlaybackBackend.ts` (`fireMeta`), `providers/BaseCloudProvider.ts` (CostEstimator import + `track()`; optionally the `meta` emit + `providers/types.ts:60`), `TTSCache.ts` (lexiconHash param), `store/useTTSStore.ts` (`syncState`).
- Edit (tests): SyncEngine mocks in 5 files (§1.5), CostEstimator mocks in 9 files (§1.8), `TTSCache.test.ts`, `useTTSStore.test.ts`, `TTSProviderManager.test.ts`.
- Blast radius: `src/lib/tts/**` + `store/useTTSStore` only. Suggest 3 stacked commits inside the batch: (a) syncState, (b) SyncEngine+plumbing, (c) CostEstimator+lexiconHash.

### Batch 5 — Search XML branch
- Delete: `src/lib/search-engine.xml.test.ts` (59).
- Edit: `src/lib/search.ts` (canOffload), `src/lib/search-engine.ts` (supportsXmlParsing + worker parse + DOMParser cache), `src/types/search.ts` (`xml?`, and the never-produced `cfi?`), mocks in `src/lib/search.test.ts` and `src/test/search-client.repro.test.ts`.
- Blast radius: search subsystem only. Behavior identical in real browsers (branch was unreachable).

### Batch 6 — Build/asset dead weight (no TS edits except one import line)
- Delete: `tailwind.config.js`, `src/App.css` (+ `App.tsx:27` import line), `public/manifest.webmanifest`, `icons/` (7 files, 496 KB), `public/alice.epub` (188 KB), `verification_script.py`, `test_files.txt`, `getDeviceId_perf.md`, `plan.md`, `verification/test.zip`, `verification/videos/`, `verification/debug_ids.txt`.
- ≈17 files, ≈384 text LOC + ≈770 KB binaries. Gate additionally: `vite build` and confirm `dist/manifest.webmanifest` unchanged (it is VitePWA-generated either way); quick visual smoke of the app shell (App.css/tailwind config are no-ops, this just proves it).

### Batch 7 — Test-infra relocation (decision-bearing, smallest)
- Move `src/lib/drive/MockDriveService.ts` → `src/test/harness/MockDriveService.ts`; update the one import in `src/verification/test_drive_sync.test.ts`.
- Blast radius: one test file.

### Explicitly deferred (NOT Phase 1)
| Item | Why deferred | Where it lands |
|---|---|---|
| `scrollToText` + 500 ms timer | live user behavior; removal = regression | Phase 7 search rewrite |
| `mockGenAIResponse`/`mockGenAIError` seams | live E2E dependency | Phase 1 `installTestApi()` PR (coordinated, not a deletion batch) |
| `scripts/patch_piper_worker.js` + `prepare-piper` | still executed by postinstall; `public/piper/` not vendored; package.json contended | after worker vendoring lands |
| `src/types/epubjs.d.ts` | load-bearing ambient shadow; typecheck fallout | reader types refactor (analysis reader.md step 1) |
| android-backup pair | plan defers delete-vs-wire to Phase 4 | Batch 3 if signed off |
| large `verification/*.epub` fixtures | live E2E fixtures, not artifacts | E2E consolidation (consider smaller fixture) |

---

## 4. Totals

- **Verified DEAD now (batches 1-7):** ≈45 files deleted + ≈20 files edited; ≈2,350 LOC removed (≈900 of it tests-of-dead-code) + ≈770 KB binary assets.
- **ALIVE (proposal said delete; re-verified as live):** 4 — `scrollToText`, piper patch/postinstall, `epubjs.d.ts`, mockGenAI seams (+ `jules_run_verification.sh` under "root strays").
- **Needs decision:** android-backup (Phase 4 owner), MockDriveService relocate-vs-delete, `plan.md` archive-vs-delete, `scripts/compile-dict.cjs` document-vs-delete.
- **Already done at HEAD:** vite-config `test` block; 5 of the root stray test files; `preprocessTableRoots` (0b6c1545).
- **knip:** ran via `npx knip@latest` (network OK); used as cross-check, all verdicts grep-confirmed.
