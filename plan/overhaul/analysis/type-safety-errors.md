# Cross-cutting analysis: type safety, error handling, logging

Subsystem key: `type-safety-errors`
Analyzed: 2026-06-10, branch `claude/amazing-davinci-d7336e` (HEAD 3b0cfcff)

---

## What it is

This is not a single module but the cross-cutting infrastructure that determines whether Versicle is *hard to break*: the TypeScript strictness regime, the error taxonomy and propagation conventions, runtime validation at trust boundaries (Firestore sync, backup import, GenAI responses, network JSON, localStorage, IndexedDB), and logging/observability (`src/lib/logger.ts`, `TTSFlightRecorder`, the toast store, the React `ErrorBoundary`).

The headline finding: **the scaffolding exists but is unenforced and largely disconnected**. There is a typed error hierarchy that only the DB layer uses; a zod validator module that nothing imports; a scoped logger that a third of error sites bypass; strict TS that 246 test files are excluded from; and an excellent TTS flight recorder that covers exactly one subsystem.

---

## File inventory

| File | Role |
|---|---|
| `src/types/errors.ts` | Error taxonomy: `AppError`, `DatabaseError`, `StorageFullError`, `DuplicateBookError`, `WorkspaceDeletedError` (62 lines, 5 classes) |
| `src/lib/logger.ts` | Two logger APIs: legacy `GlobalLoggerService` singleton (`Logger`) and `ScopedLogger` via `createLogger(namespace)`; level from `VITE_LOG_LEVEL` / DEV |
| `src/lib/sync/validators.ts` | zod schemas for synced Yjs entities (`UserInventoryItemSchema`, `UserProgressSchema`, `UserAnnotationSchema`, `UserOverridesSchema`, `ReadingListEntrySchema`) + `validateYjsUpdate` — **dead code at runtime** |
| `src/db/validators.ts` | Hand-rolled `validateBookMetadata` type guard + DOMPurify-based `sanitizeString` / `getSanitizedBookMetadata` (used by ingestion) |
| `src/components/ErrorBoundary.tsx` | React error boundary; routes to `CriticalMigrationFailureView` when migration state is `AWAITING_CONFIRMATION`; offers `DataRecoveryView` |
| `src/App.tsx:120-139` | Global `unhandledrejection` handler — only special-cases `StorageFullError`/`QuotaExceededError` |
| `src/lib/tts/TTSFlightRecorder.ts` | Ring-buffer event tracer (2000 events), anomaly auto-snapshot, IDB-persisted snapshots, export — TTS-only |
| `src/db/DBService.ts:27-45` | `handleDbError`: canonical raw-error → typed-error mapping (the one good propagation boundary) |
| `src/store/useToastStore.ts` | Single-slot toast store; the only user-facing error surface |
| `src/types/epubjs.d.ts` | Partial local type augmentation for epubjs — exists but incomplete, so call sites cast `as any` instead |
| `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js` | Strict mode on, but key flags missing; ESLint non-type-aware; tests excluded from `tsc -b` entirely |
| `src/lib/genai/GenAIService.ts` | GenAI boundary: structured-output requests, `JSON.parse(text) as T` with no runtime validation |
| `src/lib/BackupService.ts`, `src/lib/sync/android-backup.ts` | Backup import boundary: `JSON.parse(...) as BackupManifestV2`, destructive restore without snapshot validation |
| `src/lib/sync/FirestoreSyncManager.ts` | Sync boundary: applies remote Yjs updates and casts Firestore docs without validation; 26 eslint-disables |

---

## How it works (data & control flow)

### Type checking
- `npm run build` = `tsc -b && vite build`. `tsconfig.app.json` has `strict: true`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch` — but **excludes every `*.test.ts(x)` and `src/test/**`** (tsconfig.app.json:26). No tsconfig anywhere includes tests; `vitest.config.ts` has no `typecheck` block. So the 246 test files are never type-checked by anything.
- ESLint uses `tseslint.configs.recommended` (non-type-aware) — no `no-floating-promises`, no `no-unsafe-*`, no `no-console`, no `no-non-null-assertion` (eslint.config.js:12).
- Escape-hatch census (production = excluding `*.test.*` and `src/test/`):

| Metric | Total | Production only |
|---|---|---|
| `as any` | 463 | **138** |
| `: any` annotations | 249 | **81** |
| `as unknown as` | 163 | **11** |
| `@ts-expect-error`/`@ts-ignore` | 92 | **13** |
| `eslint-disable` comments | 659 (611 = `no-explicit-any`) | **245** |
| direct `console.*` (excl. logger.ts) | — | **112 lines / 41+ files** |
| non-null assertions (`x!`) | — | ~16–30 (modest) |

- Worst production offenders for `as any`: `src/hooks/useEpubReader.ts` (30), `src/lib/sync/FirestoreSyncManager.ts` (20), `src/components/reader/ReaderView.tsx` (12), `src/lib/ingestion.ts` (10), `src/components/reader/ReaderTTSController.tsx` (9), `src/db/db.ts` (8), `src/hooks/useCfiCoordinates.ts` (7).
- Roughly 90% of production `as any` is the **epubjs API surface** (`rendition.manager`, `rendition.annotations`, `getRange`, `views()`, `hooks.content`, `spine.hooks.serialize`). A local augmentation `src/types/epubjs.d.ts` exists and covers the basics, but nobody extends it — each new call site disables the lint rule and casts.

### Error taxonomy & propagation
- `src/types/errors.ts` defines 5 classes. Only the DB/import/library path actually uses them (`DBService.handleDbError`, `useLibraryStore` throws `DuplicateBookError`, `use-local-storage` throws `StorageFullError`, sync throws `WorkspaceDeletedError`). `WorkspaceDeletedError` extends bare `Error`, not `AppError` (errors.ts:56) — the taxonomy isn't even internally consistent. `originalError?: unknown` predates and ignores ES2022 `Error.cause`.
- Everything else throws bare `Error` with prose messages, and callers do **string matching**: `App.tsx:234` `err.message.includes('is not connected')`; `App.tsx:127` `event.reason?.name === 'QuotaExceededError'`; `GenAIService.ts:118` `error.message?.includes('429') || error.toString().includes('RESOURCE_EXHAUSTED')`.
- Catch-block census (production code, 264 `catch` blocks parsed):
  - **27 fully empty** (`catch {}` with at most a comment) — concentrated in `useEpubReader.ts` (9), `cfi-utils.ts`, `lib/tts.ts`, `TTSFlightRecorder.ts`, `FirestoreSyncManager.ts:971`, `BackupService.ts:335`, `CapacitorTTSProvider.ts:119`, `auth-helper.ts:89`, `CheckpointInspector.ts:64`.
  - **~28 more silent** (no log, no toast, no rethrow — after excluding the ~17 false positives in `DBService` where `this.handleError()` rethrows): `sw-utils.ts:44`, `BookImportService.ts:29,84,111`, `cancellable-task-runner.ts:51,120`, `MediaSessionManager.ts:319`, `piper-utils.ts:78,374`, `CheckpointInspector.ts:54,59`, `MockFireProvider.ts:233`, `use-local-storage.ts:74,82`, etc.
  - 82 use `console.*`, 104 use a logger, 28 toast, 25 rethrow. There is no convention for which to use; it's whatever the generating agent did that day.
- **User-facing surfacing is implicit and fragile.** The only global surface is the `unhandledrejection` handler in `App.tsx:120-139`, which handles exactly two cases (storage-full). `use-local-storage.ts:129` even relies on this by re-throwing via `setTimeout(() => Promise.reject(new StorageFullError(error)), 0)` — a hidden contract that errors must escape *unhandled* to be seen. There is no `window.addEventListener('error')` companion handler.
- `ErrorBoundary` (components/ErrorBoundary.tsx) is good: logs, detects migration-crash state via `MigrationStateService`, offers a recovery view. But its log goes to the console only — nothing persistent for a local-first app where users can't be asked for devtools output.

### Runtime boundary validation (the trust map as-built)

| Boundary | Validated? | Evidence |
|---|---|---|
| Firestore → Yjs sync payloads | **No.** `Y.applyUpdate(yDoc, stateVector)` straight from remote temp doc; zod schemas for exactly these shapes exist in `src/lib/sync/validators.ts` but are imported only by their own tests | FirestoreSyncManager.ts:463-464, 781; validators.ts:81-83 |
| Firestore workspace metadata | **No.** `snapshot.docs.map(d => d.data() as WorkspaceMetadata)` | FirestoreSyncManager.ts:818 |
| Backup import (JSON/ZIP) | **No.** `JSON.parse(text) as BackupManifestV2`; then **clears local Yjs persistence** (`yjsPersistence.clearData()`) before writing the unvalidated snapshot bytes; the snapshot is never test-applied to a scratch `Y.Doc` | BackupService.ts:177, 191, 226-229, 252; android-backup.ts:46 |
| GenAI structured responses | **No.** `JSON.parse(text) as T`; the Gemini `responseSchema` is advisory. Concrete bug: `detectContentTypes` does `startIndex !== -1 && index >= startIndex` — a model returning any other negative number (-2, -5) classifies the **entire section** as `reference`, which the TTS pipeline then skips | GenAIService.ts:211, 328-336 |
| Network JSON (Drive, Google TTS, Piper voices, dictionary) | **No.** `await response.json()` assigned to typed variables | DriveService.ts:74,97,139; GoogleTTSProvider.ts:65,107; PiperProvider.ts:87; useChineseDictionary.ts:24 |
| localStorage | Mixed. `MigrationStateService.getState` validates + self-heals (good); `use-local-storage.ts:33` and FirestoreSyncManager's five `JSON.parse(raw)` mock-mode reads do not | MigrationStateService.ts:20-33; use-local-storage.ts:33 |
| IndexedDB reads | Typed via `idb` `DBSchema` generics (compile-time only); `validateBookMetadata` guards ingestion input but stored rows are trusted on read | db.ts:31-98; db/validators.ts:9 |

### Logging
- `src/lib/logger.ts` ships **two** APIs: legacy `Logger` singleton (manual context arg — zero production call sites remain) and `ScopedLogger`/`createLogger` (used by ~41 files). The legacy class is dead weight.
- 112 production `console.*` lines bypass the logger entirely (worst: `piper-utils.ts` 9, `AudioContentPipeline.ts` 7, `SyncSettingsTab.tsx` 7, `cfi-utils.ts` 6, `ContentAnalysisLegend.tsx` 6). No ESLint rule prevents this.
- The logger has no sink other than the console: no ring buffer, no persistence, no export. For a local-first PWA + Android app, this means field bugs are nearly un-debuggable — except for TTS, which has `TTSFlightRecorder` (ring buffer of 2000 structured events, automatic anomaly snapshots persisted to IDB, shareable JSON export, `window.__ttsFlightRecorder` handle). GenAI similarly has its own bespoke log channel (`GenAILogEntry` → `useGenAIStore` via callback). Three observability systems, none shared.

---

## Technical debt

### TD-1. Zod validators are dead code; every sync/remote payload is trusted blindly
- **Severity: critical** | **Category: correctness**
- **Evidence:** `src/lib/sync/validators.ts:81-83` exports `validateYjsUpdate`; repo-wide grep shows the only importers are `validators.test.ts` and `validators.fuzz.test.ts`. Meanwhile `FirestoreSyncManager.ts:463-464` (`Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(tempDoc))` from remote), `:781` (`CheckpointService.applyRemoteState(remoteBlob)`), and `:818` (`d.data() as WorkspaceMetadata`) consume remote data unvalidated. The fuzz tests test schemas that protect nothing.
- **Impact:** A malformed or adversarial Firestore document (multi-device race, partial write, schema drift between app versions, compromised account) lands directly in the CRDT source of truth and **replicates to every device**. Corruption is durable and self-propagating. This is the single largest correctness hole in the app.
- **Fix:** Wire validation at the Yjs observation layer: after applying a remote update (and before user-visible commit on clean-sync/workspace-switch paths), run map-level shape validation with the existing zod schemas; quarantine/reject entities that fail; record to the (generalized) flight recorder. Validate `WorkspaceMetadata` reads. Make `validateYjsUpdate` actually called by the zustand-yjs bridge for inbound entity writes.

### TD-2. Backup restore wipes local data before proving the replacement is loadable
- **Severity: critical** | **Category: correctness**
- **Evidence:** `BackupService.ts:177/191` `JSON.parse(...) as BackupManifestV2` (no schema check; `manifest.version > this.BACKUP_VERSION` at :209 is the only check and passes when `version` is `undefined`). `:226-229` `yjsPersistence.clearData()` runs **before** `:252` writes the snapshot bytes, and the bytes are never validated as a decodable Yjs update (`Y.applyUpdate` on a scratch doc would throw on garbage — it's never attempted; the real validation happens only after reload). `android-backup.ts:46` has the same blind cast.
- **Impact:** A truncated download, wrong file, or hand-edited JSON destroys the local library: old state cleared, new state un-loadable. For the app's stated "local-first, recovery-oriented" posture this is the worst failure mode it can have.
- **Fix:** (1) zod-validate `BackupManifestV2`; (2) decode base64 and `Y.applyUpdate(new Y.Doc(), bytes)` in a try/catch *before* `clearData()`; (3) write an automatic pre-restore checkpoint via the existing `CheckpointService` so even a bad restore is reversible.

### TD-3. GenAI responses parsed as `T` with zero runtime checks; one live mis-classification bug
- **Severity: high** | **Category: correctness**
- **Evidence:** `GenAIService.ts:163` (`generateStructured<T>(prompt: string | any, schema: any, ...)`), `:211` `JSON.parse(text) as T`. Consumer bug: `detectContentTypes` `GenAIService.ts:331-334` — `startIndex !== -1 && index >= startIndex` treats any negative `referenceStartIndex` other than exactly `-1` as "everything is a reference"; there is also no upper-bound/integer clamp. `mapReadingListToLibrary` (:436) at least defaults `result.mappings || []`.
- **Impact:** LLM output is the definition of an untrusted boundary; a single off-spec response silently reclassifies a whole chapter as skippable references (TTS skips it), or writes garbage adaptations to the content-analysis repository — and those results are cached/persisted.
- **Fix:** Pair every Gemini `responseSchema` with a zod schema (single source: write zod, derive the Gemini schema). `generateStructured<T>` takes a `ZodSchema<T>` and `safeParse`s; clamp/validate semantic ranges (`referenceStartIndex ∈ {-1} ∪ [0, nodes.length)`) at the consumer.

### TD-4. 246 test files are never type-checked
- **Severity: high** | **Category: type-safety / testing**
- **Evidence:** `tsconfig.app.json:26` excludes `src/**/*.test.ts(x)`, `src/test/**`, `src/setupTests.ts`; `tsconfig.json` references only app+node projects; `vitest.config.ts` has no `typecheck`; `package.json` build = `tsc -b && vite build`. Tests also carry the bulk of the escape hatches (325 of 463 `as any`, 79 of 92 `@ts-expect-error`).
- **Impact:** Tests silently drift from the real API surface; refactors "pass" compilation while tests call removed methods (failures appear only as runtime vitest errors, or worse, vacuous mocks keep passing). The safety net the overhaul depends on is itself unchecked.
- **Fix:** Add `tsconfig.test.json` (extends app config, includes tests, adds vitest types) wired into `tsc -b`; CI gate. Burn down test `as any` with shared typed test-builders/mocks instead of per-file casts.

### TD-5. The epubjs boundary: ~90 untyped call sites instead of one typed adapter
- **Severity: high** | **Category: type-safety / architecture**
- **Evidence:** `useEpubReader.ts` (30 `as any` + 40 eslint-disables: e.g. :313-315 `(newBook.spine as any).hooks.serialize`, :384 `(newRendition as any).spread('none')`, :426, :437, :509, :747-755), `ReaderView.tsx:656,671,683,709,985,995` (`(rendition as any).annotations.*`, `getRange`), `ReaderTTSController.tsx:53-134`, `useCfiCoordinates.ts:27-110` (`(rendition as any).manager.container`), `ingestion.ts:78,255,482` (`(ePub as any)(file, { replacements: 'none' })`), `offscreen-renderer.ts:189-272`. A partial augmentation `src/types/epubjs.d.ts` already declares `Rendition`, `Book`, `Themes` etc., but is missing `manager`, `annotations`, `views()`, `getRange`, `getContents`, `spread`, `flow`, `spine.hooks`, `BookOptions.replacements` — so every site casts and disables lint.
- **Impact:** The reader — the core of the app — is effectively untyped at its engine interface. Renames/misuse of epubjs internals (already version-fragile, e.g. `manager.container`) fail only at runtime; the 9 empty catches in the same file paper over the resulting errors. This is the largest single concentration of unchecked code.
- **Fix:** Complete the `epubjs.d.ts` augmentation (all used members, including the undocumented manager/annotations APIs), then introduce a thin typed `ReaderEngine` adapter that is the *only* importer of epubjs; everything else consumes the adapter. Delete the per-site casts; lint forbids `as any` outside the adapter.

### TD-6. Central library selector returns `any[]` — the main view-model is untyped
- **Severity: high** | **Category: type-safety**
- **Evidence:** `src/store/selectors.ts:14-31` — `moduleCache` fields typed `any`/`any[]`; `:113` `const result: any[] = []`; `:207` cache record of `any`. `useAllBooks()` therefore returns `any[]`, and `useBook` returns an anonymous inline-spread object. There is no named `BookViewModel` type for "inventory merged with static metadata merged with progress".
- **Impact:** Every library/list/card component consumes `any`; field renames in `UserInventoryItem`/`StaticBookManifest` don't surface in consumers; dead fields accumulate (e.g. `allProgress`) with no signal.
- **Fix:** Define `BookViewModel` (and `BookProgressView`) types; type the module caches; the selector returns `BookViewModel[]`. This is mechanical but high-leverage — it re-types the whole library UI at once.

### TD-7. No error-handling conventions: 27 empty catches, ~28 silent catches, three competing surfaces
- **Severity: high** | **Category: correctness / hygiene**
- **Evidence:** Empty: `useEpubReader.ts:121,145,154,432,481,555,559,577,688`, `FirestoreSyncManager.ts:971`, `BackupService.ts:335`, `auth-helper.ts:89`, `lib/tts.ts:115,129`, `cfi-utils.ts:259,302`, `CapacitorTTSProvider.ts:119`, `CheckpointInspector.ts:64`, more. Silent (no log/toast/rethrow): `BookImportService.ts:29,84,111`, `cancellable-task-runner.ts:51,120`, `MediaSessionManager.ts:319`, `piper-utils.ts:78,374`, `sw-utils.ts:44`. Of 264 catch blocks: 82 `console.*`, 104 logger, 28 toast, 25 rethrow. 12 `.catch(() => {})` one-liners. Plus string-typed error contracts: `EpubReaderOptions.onError?: (error: string)` (useEpubReader.ts:201), `useTTSStore` error as `string | null`.
- **Impact:** Failures disappear (book import errors in `BookImportService` produce a `null` that callers can't distinguish from "not found"); identical failures behave differently depending on file; debugging requires reading every catch. Errors crossing layers degrade to strings, losing `cause`/type.
- **Fix:** Written conventions + lint enforcement: (a) no empty catch without `// reason:` comment (eslint `no-empty` with allowComment off + custom rule); (b) services throw typed `AppError` subclasses; (c) UI layers map error codes → toast/UI; (d) expected-failure lookups return `Result`/discriminated unions, not silent `null`; (e) every catch either rethrows, returns a typed fallback, or logs with namespace — never `console.*`.

### TD-8. Error taxonomy is vestigial: 5 classes, inconsistent, no `cause`, no serialization
- **Severity: medium** | **Category: architecture**
- **Evidence:** `errors.ts:56` `WorkspaceDeletedError extends Error` (not `AppError`); `AppError.originalError` instead of ES2022 `cause` (target is ES2022, `cause` is available); no codes for TTS/sync/GenAI/drive/ingestion domains, so e.g. `GenAIService.ts:118` does message sniffing for 429s and `TTSProviderManager.ts:80,147` hand-normalizes provider errors to `{ error?: string, message?: string }` shapes; worker bridge strips errors to `{ message }` (`createWorkerEngineClient.ts:128`) because nothing serializable exists.
- **Impact:** No programmatic error handling is possible outside the DB domain; retry/fallback logic (provider rotation, sync retry) is string-matching; worker/IPC boundaries lose error identity.
- **Fix:** One `AppError` base with `code: ErrorCode` (string-literal union), `cause`, `context?: Record<string, unknown>`, `toJSON()`/`fromJSON()` for the Comlink boundary. Domain subclasses: `SyncError`, `TtsProviderError(providerId, retryable)`, `GenAIError(status)`, `IngestionError`, `DriveError(httpStatus)`. Map vendor errors at each boundary exactly once (the `handleDbError` pattern, replicated).

### TD-9. tsconfig and ESLint leave the strongest guards off
- **Severity: medium** | **Category: type-safety**
- **Evidence:** `tsconfig.app.json:19-23` — no `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`. `eslint.config.js:12` uses non-type-aware `recommended`; no `no-floating-promises` (the codebase is full of intentional fire-and-forget — `void engine...` — but unintentional ones like `App.tsx:199 manager.initialize()` or `applyHostCommand`'s un-awaited repository writes (`createWorkerEngineClient.ts:73-83`) are invisible); no `no-console`; no `no-explicit-any` as error (611 disable comments show it's warn-and-suppress today); 8 `react-hooks/immutability` disables in `selectors.ts` document deliberate render-time cache mutation.
- **Impact:** Index access returns `T` not `T | undefined` (real risk in the many `Record<string, X>` store maps); dropped promises swallow rejections silently except for the two cases the global handler knows.
- **Fix:** Staged flag enablement (`noUncheckedIndexedAccess` first — biggest payoff in the store/selector code), switch ESLint to `recommendedTypeChecked` + `no-floating-promises` + `no-console` (allow in `logger.ts`), and a ratchet (count budget in CI) for `as any`/disable comments so the number only goes down.

### TD-10. Logging: two APIs, 112 bypasses, zero persistence
- **Severity: medium** | **Category: architecture / hygiene**
- **Evidence:** `logger.ts:34-86` legacy `GlobalLoggerService` (`Logger` export) — zero production call sites (grep shows only `createLogger` imports); `ScopedLogger` args typed `any[]` (:100-125). 112 direct `console.*` lines across 41+ production files (`piper-utils.ts` 9, `AudioContentPipeline.ts` 7, `SyncSettingsTab.tsx` 7...). No sink besides the console — nothing persists, nothing exportable, no correlation with the TTS flight recorder or GenAI log.
- **Impact:** Field debugging of a local-first PWA/Android app depends on the user opening devtools. The project already proved the value of the alternative (flight recorder snapshots solved TTS bugs); every other subsystem lacks it.
- **Fix:** Delete `GlobalLoggerService`; `createLogger` becomes the only API and writes to (a) console (level-gated) and (b) a generalized ring buffer (see Target design). ESLint `no-console` everywhere but `logger.ts`.

### TD-11. Observability is balkanized: FlightRecorder (TTS) + GenAI log + console
- **Severity: medium** | **Category: architecture**
- **Evidence:** `TTSFlightRecorder.ts` — ring buffer, anomaly detection (:82-95), IDB snapshots, export; sources hardcoded to TTS (`FlightEventSource`). `GenAIService.setLogCallback` → `useGenAIStore.addLog` is a second, unrelated structured log (also replicated from the worker via `addGenAILog` host command). `ErrorBoundary` and the `unhandledrejection` handler log to console only — crashes leave no artifact.
- **Impact:** Sync corruption, restore failures, and ingestion errors — the highest-stakes flows — have *no* black box, while TTS has a great one. Post-incident analysis impossible for exactly the subsystems that destroy data.
- **Fix:** Generalize `TTSFlightRecorder` → `FlightRecorder` with a source namespace (`TTS`, `SYNC`, `DB`, `GENAI`, `INGEST`, `UI`); `createLogger(ns)` mirrors warn/error into it; `ErrorBoundary.componentDidCatch` and `unhandledrejection` trigger snapshots; settings UI gains "export diagnostics" covering all sources (the snapshot list/share UI already exists for TTS).

### TD-12. Expando-property smuggling via casts
- **Severity: medium** | **Category: type-safety**
- **Evidence:** `(tempDoc as any)._tempProvider` (FirestoreSyncManager.ts:449,454,761,773 — used to pass a provider out of a Promise closure); `(textNode as any)._originalText` (useEpubReader.ts:643-648); `(contents as any)._listenersAttached` (:710-712); `(newSheet as any)._versicle_id` (:105-116); 28 `window as any` globals (`__VERSICLE_MOCK_FIRESTORE__`, `__YJS_DOC__`, `__ttsFlightRecorder`, `__CLOSE_DB__`, `__reader_added_annotations_count`...).
- **Impact:** Invisible contracts: nothing documents who reads `_tempProvider`; the temp-provider plumbing in particular is a refactor trap (two near-duplicate copies in `performCleanSync` and `switchWorkspace`). Window globals have no central registry or types.
- **Fix:** Replace closure-smuggling with ordinary local variables/return values (the `_tempProvider` cases need only restructuring the Promise); use `WeakMap<Text, string>` for `_originalText`/`_listenersAttached`; declare a single `versicle-globals.d.ts` augmenting `Window` with all `__VERSICLE_*` test hooks so they're typed and greppable.

### TD-13. Mock/test branches interleaved with production singletons force `any`
- **Severity: medium** | **Category: architecture (couples to sync subsystem)**
- **Evidence:** `FirestoreSyncManager` checks `(window as any).__VERSICLE_MOCK_FIRESTORE__` at 8+ sites (:121,177,311,637,706,803,835,956) with localStorage-JSON mock storage inline; `GenAIService.isConfigured`/`generateStructured` consult `localStorage.getItem('mockGenAIResponse')` (:82,168-190); `useEpubReader.ts:318` `__VERSICLE_SANITIZATION_DISABLED__`. `MockFireProvider` is `new MockFireProvider(config as any) as unknown as FireProvider` (:495).
- **Impact:** Every mock branch is an `as any` site and a production-bundle test path; the real and mock providers don't share a typed interface, so the cast hides drift.
- **Fix:** Extract a `SyncDriver` interface implemented by both `FireProvider` adapter and `MockFireProvider`; inject at construction (env/test-setup chooses). Same for a `GenAITransport`. Deletes ~15 casts and de-risks the mock drift.

### TD-14. Misc untyped utility APIs
- **Severity: low** | **Category: type-safety**
- **Evidence:** `json-diff.ts` — `DiffNode.value/oldValue/newValue: any`, `computeDiff(oldVal: any, newVal: any)` (:1-40); `GenAILogEntry.payload: any` (GenAIService.ts:27); `db.ts:92` `app_metadata.value: any`; `EpubReaderOptions.onPinyinPositionsUpdate?: (positions: any[])` (useEpubReader.ts:204) despite the shape being fully known (:678-686).
- **Impact:** Localized; these leak `any` into their consumers (JsonDiffViewer, GenAI log panel, pinyin overlay).
- **Fix:** `unknown` + narrowing for json-diff; `PinyinPosition` interface; keyed union for `app_metadata` values.

---

## Problematic couplings

- **`use-local-storage.ts:129` → `App.tsx:120` unhandledrejection:** the hook surfaces storage-full by *deliberately creating an unhandled rejection* (`setTimeout(() => Promise.reject(new StorageFullError(error)), 0)`). Error surfacing depends on a global side channel two modules away.
- **`FirestoreSyncManager` → UI stores:** a lib singleton imports `useToastStore` and `useSyncStore` directly (FirestoreSyncManager.ts:35-36) and toasts from deep inside connection logic — error presentation is welded to the sync engine (also true of `BackupService` → `useLibraryStore`).
- **GenAI logging spans three layers:** `GenAIService.setLogCallback` → `useGenAIStore.addLog`, and separately worker → `applyHostCommand('addGenAILog')` → same store (createWorkerEngineClient.ts:68). Two write paths to one log.
- **epubjs leaks untyped surface into 8+ reader files** (useEpubReader, ReaderView, ReaderTTSController, useCfiCoordinates, ContentAnalysisLegend, offscreen-renderer, ingestion, cfi-utils) instead of being wrapped once.
- **`DBService` error contract relies on rejection bubbling:** `StorageFullError` reaches users only if no intermediate catch swallows it — and 27 empty catches exist upstream.

## What's good (keep)

- **`DBService.handleDbError` (DBService.ts:27-45):** the canonical boundary pattern — log, map raw → typed (`QuotaExceededError` → `StorageFullError`), rethrow. Shared with `BookImportService`. Replicate this shape everywhere; do not redesign it.
- **TTS worker bridge typing (src/lib/tts/engine/):** discriminated-union `EngineHostCommand`, declarative `replicationSpec` with loud failure on un-replicated reads, boot-readiness gate, worker `error` listener + 15s timeout so module-init failures can't hang Comlink (createWorkerEngineClient.ts:104-121, 200-204). This is the best-engineered boundary in the app and the template for others.
- **`TTSFlightRecorder`:** ring buffer + anomaly auto-snapshot + IDB persistence + export. Generalize, don't rewrite.
- **`ErrorBoundary` + `MigrationStateService` integration:** crash during a workspace migration shows `CriticalMigrationFailureView` with the backup id; recovery tooling reachable from the crash screen. `MigrationStateService.getState` validates and self-heals localStorage.
- **`ScopedLogger`/`createLogger`** namespace pattern (41 files already adopted) and env-based level gating.
- **The zod schemas themselves** (sync/validators.ts) — well-shaped, fuzz-tested; they just need call sites.
- **`src/types/epubjs.d.ts`** — the right idea; needs completion, not replacement.
- **GenAIService correlation IDs** and request/response logging to a user-visible panel.
- **Checkpoint-before-risky-operation habit** (pre-sync, pre-migration checkpoints in FirestoreSyncManager.ts:296-308, 692).

## Target design

**1. Error taxonomy (`src/types/errors.ts` rewrite).** Single `AppError` base: `code` (string-literal union grouped by domain: `DB_*`, `SYNC_*`, `TTS_*`, `GENAI_*`, `DRIVE_*`, `INGEST_*`), ES2022 `cause`, optional `context`, `retryable: boolean`, `toJSON/fromJSON` for worker/Comlink crossings. Domain subclasses only where behavior differs. Vendor errors mapped to `AppError` at exactly one module per boundary (the `handleDbError` pattern).

**2. Throw-vs-Result convention.** Services *throw* typed errors for unexpected failures; *expected* outcomes (parse/validate/lookup misses) return discriminated results (`{ ok: true, value } | { ok: false, error }`). No empty catch without a `reason:` comment; every catch logs (scoped logger), maps, or rethrows. UI maps `error.code` → toast/inline UI in one `presentError(err)` helper; the unhandledrejection handler becomes the last resort that snapshots + toasts generically, not the designed channel.

**3. Boundary validation map (zod everywhere data enters):**
- Backup import: `BackupManifestV2Schema` + dry-run `Y.applyUpdate` on scratch doc + auto pre-restore checkpoint — *before* any destructive step.
- Firestore: validate `WorkspaceMetadata`; post-merge entity validation of Yjs maps using the existing schemas; quarantine invalid entities + flight-record.
- GenAI: zod-first schemas, Gemini `responseSchema` derived from them; `generateStructured` takes `ZodSchema<T>`; semantic clamps at consumers.
- Network JSON (Drive/GoogleTTS/Piper/dictionary): per-endpoint response schemas.
- localStorage: typed `readLocal(key, schema, fallback)` helper replacing raw `JSON.parse`.

**4. Observability.** Generalize `TTSFlightRecorder` → namespaced `FlightRecorder` (TTS/SYNC/DB/GENAI/INGEST/UI sources); `createLogger` mirrors `warn`/`error` into it; `ErrorBoundary` + global handlers snapshot on crash; one "Export diagnostics" UI. Delete `GlobalLoggerService`; `no-console` lint outside `logger.ts`.

**5. Type-debt eradication.** Complete `epubjs.d.ts` + single typed `ReaderEngine` adapter (only epubjs importer). `BookViewModel` type for selectors. `tsconfig.test.json` so all 246 test files compile. Staged compiler flags (`noUncheckedIndexedAccess` first). ESLint `recommendedTypeChecked`, `no-floating-promises`, `no-explicit-any: error`; CI ratchet driving `as any` (138) and disable-comments (245) monotonically to ~0 in production code, with the adapter files as the only sanctioned exceptions.

## Migration notes

Order matters; everything here is user-invisible except where noted.

1. **Safety first (no refactor prerequisites):** TD-2 backup validation + pre-restore checkpoint; TD-3 `referenceStartIndex` clamp; TD-1 workspace-metadata validation. These are small, isolated diffs that remove data-loss paths immediately and de-risk the rest of the overhaul.
2. **Test type-checking (TD-4)** before any large refactor — add `tsconfig.test.json`, fix the fallout (expect a few hundred errors, mostly mock typings), so subsequent refactors get honest test feedback. Add the CI ratchet counters at the same time to freeze new debt.
3. **Error taxonomy + logger consolidation (TD-7/8/10):** introduce new `AppError`; migrate domain-by-domain (DB already conforms; sync, then TTS providers, then GenAI/Drive/ingestion). Mechanical `console.*` → `createLogger` sweep with `no-console` enabled at the end. Keep `Logger` export as deprecated alias for one release, then delete.
4. **FlightRecorder generalization (TD-11):** additive — extend `FlightEventSource`, move file to `src/lib/diagnostics/`, keep the `flight_snapshots` IDB store and existing UI. No data migration needed (snapshot schema gains an optional `source` field, defaulted to `TTS` on read).
5. **epubjs adapter (TD-5) and `BookViewModel` (TD-6):** do these inside the reader/library subsystem refactors respectively — land the type augmentation first (zero runtime change), then move call sites file-by-file behind the adapter.
6. **Boundary zod wiring (TD-1 full form):** ship validation in "observe + flight-record" mode first (log violations, don't reject) for one release to measure real-world false positives against existing user docs; then enforce with quarantine. This avoids bricking sync for users whose historic CRDT docs contain shapes the schemas didn't anticipate (e.g. fields added by older app versions — note `UserInventoryItemSchema` currently lacks `language`-adjacent optional fields some docs may carry; zod non-strict object mode keeps unknown keys passing).
7. **Compiler flags last:** `noUncheckedIndexedAccess` will surface hundreds of `T | undefined` sites in stores/selectors; schedule it after `BookViewModel`/selector typing so fixes happen once.
8. **Mock-driver extraction (TD-13)** can ride along with the sync subsystem's own refactor; coordinate so the `SyncDriver` interface lands once.

No IndexedDB or Yjs data migrations are required by this subsystem's work; the only persisted-format change (flight snapshot `source` field) is backward-compatible.
