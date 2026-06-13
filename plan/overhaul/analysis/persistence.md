# Subsystem analysis: Local persistence & data layer

Scope: `src/db/` (DBService, db, BookRepository, ContentAnalysisRepository, validators, index), `src/types/db.ts`, `src/lib/idb-write-lock.ts`, `src/lib/crypto.ts`, `src/lib/BackupService.ts`, `src/lib/export.ts`, `src/lib/export-notes.ts`, `src/lib/json-diff.ts`, `src/lib/MaintenanceService.ts`.

All paths relative to repo root. Line numbers refer to the worktree at analysis time (branch `claude/amazing-davinci-d7336e`, HEAD `3b0cfcff`).

---

## What it is

The IndexedDB-backed binary/static/cache storage layer for Versicle. After the Yjs migration, IndexedDB (`EpubLibraryDB`, schema v24) holds only three domains — STATIC (immutable book content: manifests, EPUB blobs, structure), CACHE (regenerable: render metrics, TTS audio, TTS preparation, session state, table images), and APP (sync checkpoints, sync log, flight-recorder snapshots, an unused `app_metadata` store). All *user* data (inventory, progress, annotations, lexicon, reading lists) lives in a separate Yjs doc persisted to a second IndexedDB database (`versicle-yjs` via forked `y-idb`) — outside this subsystem but constantly merged with it.

`DBService` is the worker-safe data-access god object; `BookRepository`/`ContentAnalysisRepository` are thin main-thread adapters that merge IDB rows with Yjs store state; `BackupService` serializes the Yjs doc + select IDB rows into JSON/ZIP backups; `MaintenanceService` prunes orphans and regenerates metadata; `idb-write-lock` serializes readwrite transactions to dodge a WebKit IndexedDB deadlock.

## File inventory

| File | Lines | Role |
|---|---|---|
| `src/db/db.ts` | 205 | Opens `EpubLibraryDB` v24 via `idb`, typed `DBSchema`, idempotent upgrade callback, deletes 23 deprecated stores, `closeDB` + `window.__CLOSE_DB__` test hook. |
| `src/db/DBService.ts` | 670 | Singleton data-access class: manifest/resource/structure CRUD, ingest transaction, delete/offload/restore, session-state mirror with WebKit-hang-safe debounced writes, TTS audio cache, locations, table images. Exports `handleDbError`. |
| `src/db/BookRepository.ts` | 90 | Main-thread merge of `ManifestBundle` (IDB) + `UserInventoryItem` (Yjs `useBookStore`) into `BookMetadata`; book deletion orchestration. |
| `src/db/ContentAnalysisRepository.ts` | 52 | Pure adapter over Yjs `useContentAnalysisStore`; reshapes rows into legacy `ContentAnalysis`. Touches no IndexedDB at all. |
| `src/db/validators.ts` | 110 | Hand-rolled `validateBookMetadata` type guard + DOMPurify-based string sanitization. Used only by `lib/ingestion.ts`. |
| `src/db/index.ts` | 2 | Re-exports `initDB`/`getDB`/`closeDB`. Nothing imports `db/index`; everyone imports `db/db` directly. |
| `src/types/db.ts` | 934 | The type hub: static/user/cache row types, sync types, flight-recorder types, plus a graveyard of legacy v17 types. 59 non-test importers. |
| `src/lib/idb-write-lock.ts` | 50 | Module-level promise chain serializing readwrite transactions; injected into forked `y-idb` as `transactionRunner` (`src/store/yjs-provider.ts:32`) and used by `DBService.writeSession`. |
| `src/lib/crypto.ts` | 38 | `generateSecureId` with `randomUUID` → `getRandomValues` → `Math.random` fallback chain. |
| `src/lib/BackupService.ts` | 373 | V2 backup: base64 Yjs snapshot + `static_manifests` + locations (+ passive `semanticData`); light JSON / full ZIP; restore wipes Yjs persistence and writes the snapshot with raw `indexedDB` calls. |
| `src/lib/export.ts` | 71 | Unified file export: Capacitor Filesystem + Share on native, `file-saver` on web. |
| `src/lib/export-notes.ts` | 30 | Markdown notes export via hand-rolled `<a download>` click — bypasses `export.ts`, web-only. |
| `src/lib/json-diff.ts` | 90 | Recursive JSON diff for `JsonDiffViewer.tsx` (checkpoint inspection UI). Self-contained, fine. |
| `src/lib/MaintenanceService.ts` | 179 | Orphan scan/prune for 3 of 8 stores; `regenerateAllMetadata` re-ingests every book. |
| `src/db/*.test.ts` | ~520 | DBService basics, quota error mapping, repository merge logic, validator tests. |

Closely-coupled neighbors examined for boundary quality: `src/lib/BookImportService.ts` (ingestion writes), `src/lib/sync/CheckpointService.ts` (uses `checkpoints`/`sync_log` stores), `src/lib/tts/TTSFlightRecorder.ts` (uses `flight_snapshots`), `src/lib/sync/validators.ts` (zod, dead), `src/components/GlobalSettingsDialog.tsx` (clear-all/restore UI), `src/lib/tts/providers/BaseCloudProvider.ts` (audio cache consumer).

## How it works (data & control flow)

**Connection.** `db.ts` caches a single `openDB` promise per JS context (`db.ts:100-105`). The upgrade callback is *idempotent*, not versioned: it creates every active store if missing and deletes 23 deprecated stores (`db.ts:160-179`). There are no per-version migration steps left (data migrations were removed in commit `a59a867b`, Jan 2026, which deleted `YjsMigration.ts` et al.).

**Ingest.** `BookImportService.addBook` → `lib/ingestion.extractBookData` → `dbService.ingestBook` writes manifest + resource + structure + TTS prep + table images in one transaction (`DBService.ts:212-246`), converting all Blobs to ArrayBuffers first because WebKit's IDB structured clone rejects Blobs (`DBService.ts:186-199`). The caller then writes the `UserInventoryItem` into Yjs (`useLibraryStore.ts:606-625`).

**Read/merge.** UI hydration calls `bookRepository.getBookMetadataBulk` → `dbService.getManifestBundleBulk` (one readonly txn over three stores, `DBService.ts:80-113`) → merges with `useBookStore.getState().books` → produces `BookMetadata`, reconstructing cover Blobs from ArrayBuffers (`BookRepository.ts:15-42`).

**Session state (TTS resume).** `cache_session_state` is mirrored in memory (`sessionCache`), mutated synchronously, and flushed to disk through a 500 ms debounce → per-service promise chain → process-wide `runExclusiveIdbWrite` → single synchronous `put()` with no intra-transaction await (`DBService.ts:426-531`). This three-layer design exists because WebKit hangs on (1) concurrent readwrite transactions and (2) read-modify-write awaits inside a transaction — both proven with `verification/_idb_probe.js`.

**Backup.** `generateManifest` (`BackupService.ts:140-173`): wait for Yjs sync → `Y.encodeStateAsUpdate(yDoc)` → base64; plus `getAll('static_manifests')`, `getAll('cache_render_metrics')`, and a human-readable `semanticData` tree. Restore (`BackupService.ts:200-348`): wipe `yjsPersistence`, write the snapshot into the `versicle-yjs` DB with raw `indexedDB.open` (duplicating y-idb's internal schema), put static manifests/locations back, unzip EPUBs into `static_resources`, sleep 1000 ms, then the dialog reloads the page (`GlobalSettingsDialog.tsx:452`).

**Maintenance.** `scanForOrphans`/`pruneOrphans` compare IDB keys against Yjs inventory for `static_resources`, `cache_render_metrics`, `cache_tts_preparation` only. `regenerateAllMetadata` re-runs the full import pipeline per book.

**Error handling.** Every DBService method wraps work in try/catch → `handleDbError` → typed `DatabaseError`/`StorageFullError` (`DBService.ts:27-45`). `StorageFullError` is caught at import sites (`useLibraryStore.ts:563,641`) and by a global unhandled-rejection handler (`App.tsx:125-129`).

**Worker story.** `DBService` is deliberately Yjs-free so the TTS engine worker can import it (`DBService.ts:58-63`); each JS context gets its own `dbPromise`, its own `DBService` singleton (own `sessionCache`), and its own `idb-write-lock` chain. Production engine currently runs on the main thread (`src/lib/tts/engine/mainThreadAudioPlayer.ts`); the worker path exists and is exercised by tests/smoke hooks (`src/main.tsx:46-48`, `src/workers/tts.worker.ts`).

---

## Technical debt

### P1. "Clear All Data" does not delete user data (Yjs persistence survives)
- **Severity:** critical | **Category:** correctness
- **Evidence:** `GlobalSettingsDialog.tsx:240-262` — `handleClearAllData` clears the 8 static/cache stores by hand, then `localStorage.clear()` with the comment "Clear LocalStorage (includes Yjs persistence)", then reloads. But Yjs persistence is **IndexedDB**, not localStorage: `src/store/yjs-provider.ts:30` (`new IndexeddbPersistence('versicle-yjs', yDoc, ...)`). Nothing calls `yjsPersistence.clearData()` (only `BackupService.ts:228` and `CheckpointService.ts:96,159` do). The `checkpoints`, `sync_log`, `app_metadata`, and `flight_snapshots` stores are also not cleared.
- **Impact:** In a privacy-centric app, the user-facing "delete ALL data?" action silently retains the entire library inventory, annotations, vocabulary, reading history (everything in the CRDT) plus sync checkpoints (which contain full Y.Doc snapshots, `types/db.ts:803-814`). After reload, user data reappears. Privacy promise broken; also poisons support/debugging ("I cleared my data but…").
- **Fix:** A single `wipeAllData()` in the data layer: `closeDB()` → `indexedDB.deleteDatabase('EpubLibraryDB')` + `yjsPersistence.clearData()` (or `deleteDatabase('versicle-yjs')`) + `localStorage.clear()` + Cache Storage cleanup, then reload. UI must not enumerate store names.

### P2. Cached cloud-TTS alignment silently lost — `alignmentData` vs `alignment` field drift
- **Severity:** high | **Category:** correctness
- **Evidence:** `cacheSegment` writes rows with field `alignmentData` (`DBService.ts:568-577`; row type `CacheAudioBlob`, `types/db.ts:290-301`). `getCachedSegment` returns the raw row but its signature claims `CachedSegment` (`DBService.ts:555-566`), whose field is named `alignment` (`types/db.ts:573-584`). The two types are structurally compatible enough that TS accepts it (`alignment` is optional). Consumer `BaseCloudProvider.getOrFetch` reads `cached.alignment` (`src/lib/tts/providers/BaseCloudProvider.ts:78-84`) — always `undefined` for rows written by `cacheSegment`.
- **Impact:** Every cache *hit* for cloud TTS (Google/OpenAI/LemonFox) loses word-level timepoints: highlighting/sync degrades exactly when the cache works, and only on the second playback — a classic invisible regression. Direct product of keeping two near-identical types (`CacheAudioBlob`/`CachedSegment`) for the same row.
- **Fix:** Delete `CachedSegment`; make `getCachedSegment` return `CacheAudioBlob` (or a mapped DTO) and fix the consumer to use one canonical field. Add a round-trip test asserting alignment survives cache write→read.

### P3. Backup/restore corrupts cover images (ArrayBuffer → `{}` through JSON)
- **Severity:** high | **Category:** correctness
- **Evidence:** `ingestBook` stores `coverBlob` as `ArrayBuffer` (`DBService.ts:186-193`). `generateManifest` does `db.getAll('static_manifests')` and embeds rows verbatim (`BackupService.ts:154,165-172`); `createLightBackup`/`createFullBackup` then `JSON.stringify` the manifest (`BackupService.ts:52,67`). `JSON.stringify(ArrayBuffer)` yields `{}`. On restore, `store.put(m)` (`BackupService.ts:271-277`) **overwrites** healthy local manifests with `coverBlob: {}`. `BookRepository.toBookMetadata` (`BookRepository.ts:18-24`) passes the `{}` through (it only converts `instanceof ArrayBuffer`), so covers render broken. Same hazard applies to the Android auto-backup payload (`src/lib/sync/android-backup.ts:21-27`).
- **Impact:** Restoring a backup destroys cover images for every book, including books that were perfectly healthy locally. Backup files are also bloated/inconsistent (key present, value useless).
- **Fix:** Strip or base64-encode binary fields explicitly in `generateManifest`; on restore, merge rather than blind-put (never overwrite a present local `coverBlob` with a non-binary value). Add a backup round-trip test with a real ArrayBuffer cover.

### P4. WebKit-deadlock mitigation is per-context and per-callsite — not a real invariant
- **Severity:** high | **Category:** correctness
- **Evidence:** (a) The lock is module state (`idb-write-lock.ts:24`), so the worker gets its own instance; `WorkerTtsEngine` runs a full `AudioPlayerService`+`PlaybackStateManager` in the worker, which calls `dbService.saveTTSState`/`updatePlaybackState` there (`PlaybackStateManager.ts:444,465`) — recreating the exact proven hang pair (Yjs `updates` write on main + `cache_session_state` write elsewhere; see `idb-write-lock.ts:7-18`) the moment the worker engine ships as default. (b) Within the main thread the lock only covers `writeSession` (`DBService.ts:479`) and y-idb; all other readwrite transactions bypass it: `ingestBook` (`DBService.ts:213`), `deleteBook` (:297), `updateBookStructure` (:271), `restoreBookResource` (:357), `saveLocations` (:598), `cacheSegment` (:571), the fire-and-forget `put` in `getCachedSegment` (:560), `MaintenanceService.pruneOrphans` (`MaintenanceService.ts:72`), `BackupService` restore writes (`BackupService.ts:273,283,311`), `CheckpointService` (`CheckpointService.ts:33`), `TTSFlightRecorder` (`TTSFlightRecorder.ts:223`). (c) The documented hang trigger #2 — intra-transaction `await get()` then `put()` (`DBService.ts:430-437`) — is still the implementation of `saveLocations` (`DBService.ts:600-602`), `updateBookStructure` (:274-280), `restoreBookResource` (:359-361), and the restore loop (`BackupService.ts:314-317`).
- **Impact:** The "at most one app-issued readwrite txn in flight" guarantee claimed at `idb-write-lock.ts:17-18` is false in general. Today the most frequent colliders are covered, but any of the bypassing writers can overlap a Yjs flush during playback and intermittently wedge the TTS sequencer on iOS/Safari — the exact failure class that already cost a multi-week investigation. The worker port silently reintroduces it wholesale. This is also a modification hazard: nothing tells a future contributor that new readwrite transactions must take the lock.
- **Fix:** Replace the promise-chain with the Web Locks API (`navigator.locks.request('idb-write', ...)`), which spans workers and tabs; route **all** readwrite transactions through a single storage gateway that takes the lock and forbids intra-transaction awaits by construction (e.g. `write(stores, (tx) => void)` where the callback must be synchronous). Lint/grep gate: no `transaction(..., 'readwrite')` outside the gateway module.

### P5. `types/db.ts` is a god module with a dead-type graveyard and inverted dependencies
- **Severity:** high | **Category:** architecture
- **Evidence:** 934 lines, 59 non-test importers (project-wide). It mixes: IDB row types, Yjs row types (`UserInventoryItem`, `UserProgress`…), sync wire types (`SyncManifest`, `SyncCheckpoint`, `SyncLogEntry`), TTS flight-recorder types (`FlightEvent`, `FlightSnapshot`, `types/db.ts:835-933`), and legacy v17 types. Dead or near-dead exports (zero non-test, non-hub usages): `BookSource`, `BookState`, `TTSContent`, `TTSPosition`, `ReadingHistoryEntry`, `UserJourneyStep`, `UserAiInference`, `StoreVersion` (verified by grep). Duplicated pairs that have already drifted: `Annotation` ≡ `UserAnnotation` (identical, both still imported — `AnnotationList.tsx:4`, `useReaderUIStore.ts:4` use the legacy one), `CachedSegment` vs `CacheAudioBlob` (caused P2), `TTSContent` vs `CacheTtsPreparation`. The hub also imports types *from the service layer*: `TTSQueueItem` from `../lib/tts/AudioPlayerService` (`types/db.ts:11`) and `Timepoint` from `../lib/tts/providers/types` (:2) — the app's foundational type module depends on its biggest service file (type-level cycle: AudioPlayerService → DBService → types/db → AudioPlayerService).
- **Impact:** Every domain touches one file; merge conflicts, accidental reuse of dead types, and drift like P2 are structural inevitabilities. The inverted `TTSQueueItem` dependency means you cannot reason about persisted shapes without loading the TTS engine's types, and renaming anything in `AudioPlayerService` ripples into the "DB types".
- **Fix:** Split into `types/storage/static.ts`, `types/storage/cache.ts`, `types/storage/app.ts` (checkpoints/log/flight), `types/user.ts` (Yjs rows), `types/sync.ts`. Delete dead exports; collapse duplicates to one canonical type each. Define the *persisted* queue-item shape in the cache types and have `AudioPlayerService` import it (dependency points inward).

### P6. `BookMetadata` is a legacy intersection type with everything optional
- **Severity:** high | **Category:** type-safety
- **Evidence:** `types/db.ts:483` — `export type BookMetadata = Book & Partial<BookSource> & Partial<BookState>` built from three *deleted-store* row types (`Book` :391, `BookSource` :427, `BookState` :456, all documented as "Stored in 'books'/'book_sources'/'book_states'" — stores deleted at `db.ts:165`). It is the most-referenced domain type (~57 usages across components/hooks/stores). `BookRepository.toBookMetadata` (`BookRepository.ts:19-41`) populates it ad hoc — e.g. `addedAt: inventory?.addedAt || Date.now()` fabricates a timestamp on every read for ghost books, and `filename: inventory?.sourceFilename || 'unknown.epub'`.
- **Impact:** Consumers must null-check fields that are in fact always present (or worse, don't and get away with it until a ghost book hits the path). The type lies about provenance: nothing distinguishes "manifest present, file offloaded" from "ghost book, no manifest" — those states are encoded in scattered booleans (`isOffloaded`) and store lookups instead. Blocks safe modification of anything book-shaped.
- **Fix:** Define an explicit view model owned by `BookRepository` (e.g. `LibraryBook { id, display: {...required}, source?: StaticBookManifest, availability: 'local'|'offloaded'|'ghost', inventory: UserInventoryItem }`). Migrate consumers; delete `Book`/`BookSource`/`BookState`.

### P7. No data-access boundary: three competing tiers, raw `getDB()` everywhere
- **Severity:** high | **Category:** architecture
- **Evidence:** Three inconsistent access patterns coexist with no rule: (1) repositories (`BookRepository`, `ContentAnalysisRepository` — the latter doesn't touch IDB at all, it's a Yjs adapter living in `src/db/`); (2) `dbService` imported directly by 14 non-test files including UI components and hooks (`ContentAnalysisLegend.tsx:10`, `useEpubReader.ts:3`, `useSmartTOC.ts:5`, `GlobalSettingsDialog.tsx:21`); (3) raw `getDB()` + hand-rolled transactions in 7 modules outside `src/db/` (`App.tsx:208`, `GlobalSettingsDialog.tsx:246`, `ingestion.ts:65`, `MaintenanceService.ts:28,66`, `BackupService.ts:147,268,310`, `TTSFlightRecorder.ts:165-223`, `CheckpointService.ts` ×6). Store-name string literals are sprinkled across all of them (e.g. the clear-all list in `GlobalSettingsDialog.tsx:247-254`).
- **Impact:** Schema changes require auditing the whole tree; the write-lock rule (P4) is unenforceable; tests mock at three different seams (`vi.mock('./DBService')`, `spyOn(dbService['getDB'])`, fake `idb` DBs); UI is welded to storage details (a component knows IDB store names).
- **Fix:** One gateway: `src/data/` exposing domain repositories (`bookContent`, `playbackCache`, `audioCache`, `diagnostics`, `checkpoints`) over a private connection module. `getDB` not exported outside `src/data`. ESLint `no-restricted-imports` for `db/db` and `db/DBService` elsewhere. `ContentAnalysisRepository` moves next to the Yjs stores (it isn't persistence).

### P8. Restore path: unvalidated input, raw y-idb internals, magic sleeps
- **Severity:** high | **Category:** correctness / security
- **Evidence:** `restoreLightBackup`/`restoreFullBackup` do `JSON.parse(text) as BackupManifestV2` with zero validation (`BackupService.ts:176-177,191`) — `zod` is installed (`package.json:71`) but unused here. `processManifest` then wipes the user's Yjs persistence (`BackupService.ts:228`) *before* the new snapshot is proven applicable, writes the snapshot by re-implementing y-idb's internal schema with raw `indexedDB.open('versicle-yjs')` (`BackupService.ts:235-263` — hardcodes `updates`/`custom` store names and autoIncrement layout of the *forked* y-idb), relies on `Y.applyUpdate` never running (the in-memory doc is not updated; correctness depends on the page reload at `GlobalSettingsDialog.tsx:452`), and ends with `await new Promise(r => setTimeout(r, 1000))` labeled "Wait for Yjs persistence to flush" (`BackupService.ts:344`). During the window between `clearData()` and reload, the live yDoc (still holding old state, still attached to `IndexeddbPersistence`) can write old-state updates into the freshly-cleared DB.
- **Impact:** A malformed/truncated backup file (or base64 of garbage) destroys local persistence before failing; `Y.applyUpdate` on the next boot with a corrupt snapshot can throw and brick startup. The raw-IDB write breaks invisibly if the y-idb fork changes its store layout. Sleep-based sequencing is the same class of bug the comment at `BackupService.ts:232-234` says was already hit once ("The previous 500ms timeout… dropped notes").
- **Fix:** zod-validate the manifest (version, base64 shape, arrays); dry-run `Y.applyUpdate(new Y.Doc(), snapshot)` in a try/catch *before* touching persistence; add an explicit `flush()`/`whenSynced` API to the y-idb fork instead of reaching into its schema; destroy the live persistence binding before wiping; remove the sleep.

### P9. Schema strategy: idempotent-only upgrade, destructive for stragglers, no multi-tab handling
- **Severity:** medium | **Category:** architecture / correctness
- **Evidence:** `db.ts:102-181` — version constant `24` inline, upgrade creates-if-missing then unconditionally deletes 23 legacy stores including v17/v18 *user-data* stores (`annotations`, `user_annotations`, `user_progress`…) with no export/backup beforehand; all migration code was deleted in `a59a867b`. `openDB` passes only `upgrade` — no `blocked`/`blocking`/`terminated` callbacks, so a version bump with another tab open stalls silently, and a connection killed by the browser leaves the cached `dbPromise` pointing at a dead connection. A rejected open is also cached forever (`db.ts:103-105` never resets `dbPromise` on failure), so one transient failure (Safari private mode, locked profile) bricks all DB access until reload.
- **Impact:** A user returning after a long absence (pre-Yjs install) gets their annotations/progress silently destroyed on first launch. Future schema work has no versioned-migration scaffold to hook into. Multi-tab PWA usage can hang upgrades with no user feedback.
- **Fix:** Versioned migration registry (`{toVersion, migrate(tx)}[]`) even if most steps are no-ops; before deleting a legacy user-data store, snapshot its contents into a recovery blob (or refuse + surface UI). Add `blocked`/`blocking` handlers (close + notify, reload prompt) and reset `dbPromise` on open failure with bounded retry.

### P10. Unbounded caches: LRU fields exist, eviction never implemented; no storage persistence request
- **Severity:** high | **Category:** performance / correctness
- **Evidence:** `CacheAudioBlob.lastAccessed` is documented "for LRU" (`types/db.ts:299-300`) and dutifully bumped on every read (`DBService.ts:560`), but grep shows no eviction logic anywhere for `cache_audio_blobs` (cloud-TTS MP3s — the heaviest growing data after EPUBs). `MaintenanceService.scanForOrphans/pruneOrphans` cover only 3 stores (`MaintenanceService.ts:34-51,80-106`): orphaned `static_manifests`, `static_structure`, `cache_table_images`, `cache_session_state` rows are never pruned (orphaned manifests are exactly what resurrects "ghost" books). `navigator.storage.persist()` / `storage.estimate()` are never called (grep: zero hits) — quota handling is purely *reactive* (`handleDbError` → `StorageFullError` → toast at `useLibraryStore.ts:563`).
- **Impact:** Long-term users accumulate gigabytes of dead audio; browsers under storage pressure may evict the *entire* origin (both IDB databases — the whole library and all user data) because best-effort storage was never upgraded to persistent. The `lastAccessed` write-on-read also adds an unserialised readwrite txn per cache hit (see P4).
- **Fix:** Request `navigator.storage.persist()` at first import; add an idle-time eviction job (size-budgeted LRU over `lastAccessed`); extend orphan scan to all per-book stores; surface `storage.estimate()` in settings.

### P11. Duplicated and dead validation layers; no validation at real boundaries
- **Severity:** medium | **Category:** duplication / dead-code
- **Evidence:** Three validation systems: (1) `src/db/validators.ts` hand-rolled guard, used only by ingestion (`ingestion.ts:368,543`), logs via `console.warn` (:11,35) against the `createLogger` convention; (2) `src/lib/sync/validators.ts` — zod schemas explicitly "Mirrors src/types/db.ts" with **zero production importers** (only its own tests) and already drifted: `UserAnnotationSchema.type` lacks `'audio-bookmark'` (`sync/validators.ts:55` vs `types/db.ts:188`), `readingSessions` shape uses `timestamp`/`duration` vs the real `startTime`/`endTime` (`sync/validators.ts:41-46` vs `types/db.ts:656-673`), `UserInventoryItemSchema` lacks `perceptualPalette`/`useSyntheticToc`; (3) no validation at the actual trust boundaries — backup restore (P8), Android backup read (`android-backup.ts:46`), Drive imports.
- **Impact:** Dead zod schemas with fuzz tests give false confidence ("we validate sync data" — nothing does); if someone wires them in as-is they'll *reject valid current data* (annotations of type `audio-bookmark`). Hand-rolled guard duplicates what zod does better.
- **Fix:** Single `src/data/schemas.ts` with zod schemas as source of truth (`z.infer` exports replace hand-written row types where practical); apply at: backup restore, android payload read, Firestore inbound sync. Delete `sync/validators.ts` + its fuzz tests or rewrite them against the new schemas. Fold `db/validators.ts` sanitization into the ingestion module.

### P12. Export utilities triplicated; two are broken on native
- **Severity:** medium | **Category:** duplication
- **Evidence:** `lib/export.ts` is the platform-aware exporter (Capacitor Filesystem+Share / `file-saver`). `lib/export-notes.ts:15-23` hand-rolls a `<a download>` click (web-only — silently broken inside the Capacitor Android WebView). `TTSAbbreviationSettings.tsx:73-80` hand-rolls the same anchor pattern a third time for CSV export.
- **Impact:** Notes export and abbreviation CSV export don't work (or work unreliably) on the Android app; three implementations to maintain.
- **Fix:** Both call `exportFile()`; `export-notes.ts` shrinks to pure markdown formatting.

### P13. DBService session-mirror correctness gaps
- **Severity:** medium | **Category:** correctness
- **Evidence:** (a) `saveTTSState` cold-start: if the mirror isn't seeded (`getTTSState` not called for that book), it creates a fresh record (`DBService.ts:504`) and the debounced write clobbers the on-disk `lastPauseTime` — correctness depends on undocumented caller ordering (`AudioPlayerService.ts:382` happens to read first on resume, but nothing enforces it). (b) `cleanup()` deliberately drops pending writes (`DBService.ts:632-641`) — combined with the 500 ms debounce, the last queue update before teardown is lost by design (test even asserts the loss, `DBService.test.ts:66-80`). (c) Two `DBService` singletons exist in worker mode with independent mirrors of the same rows (see P4). (d) Dead/unfinished code: `updatePlaybackState`'s `_lastPlayedCfi` param ignored (`DBService.ts:491`), the all-books branch of `getOffloadedStatus` is a 10-line commented-out musing returning an empty map (`DBService.ts:391-400`), unreachable post-`handleError` returns (`DBService.ts:112,405,419` — `handleError` is `never`), `offloadBook` locks `static_manifests` and never touches it (`DBService.ts:337-343`).
- **Impact:** TTS resume position/pause-time can be subtly wrong after crashes or cold writes; the API surface misleads (parameters and branches that do nothing).
- **Fix:** Make `loadSession` the only mutation entry (seed-before-write always); flush-on-teardown via `navigator.locks`/`visibilitychange` instead of dropping; collapse the dead branches/params; single engine-side owner for session rows (worker port should proxy session persistence to one context).

### P14. Three parallel Yjs-snapshot mechanisms
- **Severity:** medium | **Category:** duplication
- **Evidence:** `BackupService.generateManifest` (`BackupService.ts:151-152`), `CheckpointService.createCheckpoint` (`CheckpointService.ts:21-27`), and `android-backup.ts` (delegates to BackupService but stores a *second* full JSON copy in app data dir) all serialize `Y.encodeStateAsUpdate(yDoc)` with separate restore paths (`processManifest` vs `CheckpointService.restoreCheckpoint`, each with its own wipe-and-write sequence — `BackupService.ts:226-263` vs `CheckpointService.ts:96+`).
- **Impact:** Three slightly-different wipe/apply/reload dances to keep correct (P8's bugs must be fixed three times); checkpoint blobs additionally live inside `EpubLibraryDB` so "clear data" interplay differs per path.
- **Fix:** One `YjsSnapshotService` (capture/validate/apply with documented reload contract); Backup, Checkpoint, Android backup become thin format adapters over it.

### P15. Hygiene: stale README, unused stores, misc
- **Severity:** low | **Category:** hygiene / dead-code
- **Evidence:** `src/db/README.md` documents the v17 schema (`books`, `files`, `annotations`, `locations`, `lexicon`, `tts_cache`) — every listed store was deleted at `db.ts:160-179`. `app_metadata` store is created (`db.ts:153-155`) and never read or written anywhere. `src/db/index.ts` barrel is imported by nobody. `getManifestBundle` uses `getKey` while `getManifestBundleBulk` uses `count` for the same check (`DBService.ts:93` vs `:125`). "BOLT OPTIMIZATION" comments (`DBService.ts:90,382`, `MaintenanceService.ts:77`) are agent-artifact noise. `DBService.test.ts:76` sleeps 1100 ms real time (slow suite). `offloadBook` test asserts `resource?.epubBlob` is undefined, which passes whether the record was deleted or merely cleared (`DBService.test.ts:58-62`) — vacuous.
- **Impact:** Docs mislead; dead store ships in every upgrade; tests waste wall-clock and assert nothing.
- **Fix:** Rewrite README from the target design; drop `app_metadata` (or use it for the schema-version recovery metadata from P9); fake timers in tests.

---

## Problematic couplings (other subsystems reaching in / this reaching out)

1. **UI components own storage logic.** `GlobalSettingsDialog.tsx:246-254` hand-clears IDB stores by name (and gets it wrong — P1); `ContentAnalysisLegend.tsx:94` and hooks (`useEpubReader.ts:293,459`, `useSmartTOC.ts:69`) call `dbService` directly. Storage semantics live in the view layer.
2. **TTS engine ↔ DBService bidirectional tangle.** Five TTS modules import `dbService` (`AudioPlayerService.ts:4`, `PlaybackStateManager.ts:2`, `AudioContentPipeline.ts:1`, `TTSCache.ts:1`, `TableAdaptationProcessor.ts:1`) while `types/db.ts:11` imports `TTSQueueItem` *from* `AudioPlayerService` and `DBService.ts:18` imports it too — the persistence layer's row shape is defined by the TTS engine's biggest file. The `EngineContext` ports pattern (`engine/EngineContext.ts`) deliberately exempts `dbService`, which is exactly what breaks the cross-context lock (P4).
3. **BackupService → y-idb fork internals.** Raw `indexedDB.open('versicle-yjs')` re-implements the fork's store layout (`BackupService.ts:235-263`); also reaches into `useLibraryStore` state (`BackupService.ts:83,332-335`) and `yjs-provider` globals.
4. **Sync subsystem stores live in the content DB.** `checkpoints`/`sync_log` are defined in `EpubLibraryDB` (`db.ts:75-88`) but owned and accessed exclusively by `lib/sync/CheckpointService.ts` via raw `getDB()` — schema ownership and behavior ownership are in different subsystems.
5. **Diagnostics reaches in raw.** `TTSFlightRecorder.ts:165-227` does raw `getDB()` CRUD on `flight_snapshots` — another schema consumer outside the data layer.
6. **MaintenanceService → ingestion/TTS settings.** `regenerateAllMetadata` pulls `useTTSStore` extraction settings and calls `bookImportService` (`MaintenanceService.ts:142-151`), passing empty `abbreviations`/`alwaysMerge` — re-ingestion ignores the user's configured lists, so regenerated TTS prep differs from original import.
7. **Repositories → Zustand stores.** `BookRepository`/`ContentAnalysisRepository` import `useBookStore`/`useContentAnalysisStore` directly. Acceptable as the documented main-thread merge point, but it means "the db layer" transitively imports the entire Yjs stack — only file placement (not module structure) keeps it out of the worker.

## What's good (keep)

- **The three-domain IDB taxonomy** (STATIC / CACHE / APP with user data exclusively in Yjs) is clean, well-commented (`db.ts:22-30`), and the right local-first shape. Keep it as-is.
- **Worker-safety discipline**: `DBService`'s "must not import yjs" contract and its rationale are explicitly documented (`DBService.ts:58-63`, `BookRepository.ts:1-9`, `BookImportService.ts:1-8`) and tested via engine parity suites. The *idea* of a lean worker-safe core + main-thread merge adapters is sound; only the enforcement mechanism (file placement) needs hardening.
- **The WebKit-hang engineering**: in-memory mirror + debounce + single-synchronous-put + shared `transactionRunner` injection into the y-idb fork (`yjs-provider.ts:32`) is evidence-driven (probe-verified) and meticulously documented (`DBService.ts:426-437`, `idb-write-lock.ts:1-22`). Preserve the *invariant and documentation*; generalize the mechanism (P4) rather than discarding it.
- **Typed `DBSchema`** (`EpubLibraryDB`) gives compile-time store/key checking — extend, don't replace.
- **`handleDbError` → typed errors → UI**: one error-mapping function shared across the split (`DBService.ts:27-45`), `StorageFullError` surfaced both at call sites and via global rejection handler (`App.tsx:125`). Good shape.
- **V2 backup concept** — `Y.encodeStateAsUpdate` snapshots are exactly right for CRDT backup (vector clocks preserved, mergeable). The flaws are in validation/sequencing, not the concept.
- **Blob→ArrayBuffer normalization at write time** for WebKit (`ingestBook`) with reconstruction at read — correct policy; just centralize the read-side reconstruction (currently duplicated `BookRepository.ts:24`, `DBService.ts:617-623`).
- **`ingestBook` single-transaction atomicity** across five stores.
- **Small sharp utilities**: `crypto.ts`, `json-diff.ts`, `export.ts` (the platform-aware one) are appropriately scoped and fine.

## Target design

**`src/data/` becomes the only storage subsystem** (UI/hooks/services import repositories, never `idb`):

```
src/data/
  connection.ts      // openDB v25+, blocked/blocking/terminated handlers,
                     // dbPromise reset-on-failure, navigator.storage.persist()
  schema.ts          // EpubLibraryDB DBSchema + versioned migration registry
  write-gate.ts      // navigator.locks-based cross-context exclusive writer;
                     // API: write(stores, (tx) => void) — sync callback only,
                     // structurally preventing intra-txn awaits
  rows/              // zod schemas per store; z.infer = row types
  repos/
    bookContent.ts   // manifests/resources/structure (+ ingest txn, offload, restore)
    playbackCache.ts // session-state mirror (single owner; worker proxies via port)
    audioCache.ts    // get/put + size-budgeted LRU eviction job
    diagnostics.ts   // flight_snapshots (moves TTSFlightRecorder's raw IDB here)
    checkpoints.ts   // checkpoints + sync_log (moves CheckpointService's raw IDB here)
  snapshot/
    YjsSnapshotService.ts // capture/validate(dry-run applyUpdate)/apply+flush;
                          // BackupService, CheckpointService, android-backup adapt it
  maintenance.ts     // orphan scan/prune across ALL per-book stores; storage estimate
  wipe.ts            // wipeAllData(): both databases + localStorage + caches
```

**Types**: `types/db.ts` dissolves into `src/data/rows/*` (persisted shapes, zod-derived) and `types/user.ts` (Yjs rows). Persisted TTS queue-item shape lives in `rows/cache.ts`; `AudioPlayerService` imports it (arrow reversed). `BookMetadata` replaced by an explicit `LibraryBook` view model with an `availability: 'local' | 'offloaded' | 'ghost'` discriminant, produced solely by `BookRepository`.

**Enforcement**: ESLint `no-restricted-imports` bans `idb`, `data/connection`, and `data/schema` outside `src/data`; bans `'readwrite'` transactions outside `write-gate.ts`. The worker engine accesses session persistence through an `EngineContext` persistence port (same pattern already used for books/content analysis), keeping exactly one session-state writer per app instance.

**Boundary validation**: backup manifests, Android payloads, and Firestore inbound data validated with the same zod schemas before any destructive step; restore performs dry-run `Y.applyUpdate` on a scratch doc first.

## Migration notes

No user-visible data migration is required for most of this — it's module reshaping. Order of operations:

1. **Ship the P1 fix immediately** (clear-all must call `yjsPersistence.clearData()` + delete both DBs). Standalone, user-facing, no refactor dependency.
2. **Fix P2/P3 before any backup-format work**: P2 is a one-line field unification + test; P3 needs a backup-format decision — either strip `coverBlob` from backups (covers regenerate from EPUBs on next ingest) or base64 it. Bump `BackupManifestV2.version` to 3 with a reader that accepts 2 and sanitizes `coverBlob: {}` garbage (also write a one-time repair: on boot, scan `static_manifests` for non-ArrayBuffer/non-Blob `coverBlob` values left by past restores and null them so covers regenerate).
3. **Introduce `write-gate.ts` (Web Locks) behind the existing `runExclusiveIdbWrite` signature first** — drop-in swap for `yjs-provider.ts:32` and `DBService.writeSession`, verified against the existing TTS chapter-navigation flake suite and `verification/_idb_probe.js`. Then migrate the bypassing writers (P4 list) callsite-by-callsite. Only after that is the worker engine safe to enable by default.
4. **Carve repositories out of DBService incrementally** (it's already sectioned by comment headers): audioCache → playbackCache → bookContent. Keep `dbService` as a deprecated facade delegating to repos until imports are migrated, then delete. Move `TTSFlightRecorder` and `CheckpointService` raw-IDB code into `repos/` last (mechanical).
5. **IDB schema**: bump to v25 with the new migration registry; the v25 step is a no-op for current users but adds the legacy-store snapshot-before-delete guard (P9) for stragglers, drops `app_metadata` (or repurposes it for schema metadata), and records `schemaHistory` for future debugging. Add `blocked`/`blocking` handlers in the same change.
6. **Type split (P5/P6)** is pure refactor; do it with `git mv` + re-export shims from `types/db.ts` for one release, then delete the shim. The `TTSQueueItem` inversion requires touching `AudioPlayerService` — coordinate with the TTS subsystem overhaul.
7. **Backup/restore hardening (P8/P14)**: implement `YjsSnapshotService` + zod validation, then rewrite `processManifest` on top; requires adding an explicit `flush()`/`whenSynced` to the y-idb fork (small upstream-fork change, replaces both the raw-IDB write and the 1000 ms sleep). Existing v2 backup files must keep restoring — keep a v2 reader forever.
8. **Cache eviction + `storage.persist()` (P10)** are additive; land any time. Eviction must run through the write gate.

Test strategy: the behavioral seams to lock down *before* refactoring are (a) ingest→read round trip including ArrayBuffer/Blob normalization, (b) session-state write coalescing semantics, (c) backup generate→restore round trip with binary covers and a real Yjs doc, (d) quota error mapping. (a) and (d) exist; (b) exists partially; (c) does not — write it first.
