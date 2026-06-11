# Phase 3 prep — the storage gateway (`src/data/`): implementation-ready design

Status: READ-ONLY prep artifact. Verified against the working tree at HEAD
**`fb3dcd3f09e5fb749abb42cf3359d11014cde590`** (branch `claude/amazing-davinci-d7336e`,
2026-06-10). **The Phase 2 implementation chain was actively committing while this was
written** (tasks P2-7…P2-11 in flight: migration coordinator, v6 migration, real
`whenHydrated()`). Files under `src/store/**`, `src/app/boot/**`, and
`src/lib/sync/CheckpointService.ts` WILL have moved/changed by the time Phase 3 executes —
every line number below for those files must be re-verified at P3 start; line numbers for
`src/db/**`, `src/lib/idb-write-lock.ts`, `src/lib/BackupService.ts`, `src/sw.ts`,
`src/sw-utils.ts`, and `node_modules/y-idb/src/y-idb.js` were stable during this read.

Inputs: master plan `plan/overhaul/README.md` (§Roadmap P3, §Program rules 4–8),
`plan/overhaul/analysis/persistence.md` (P1–P15), `plan/overhaul/analysis/layering-deps.md`
(LD-1, LD-4, db sections), `proposals/strangler-incremental.md` §Phase 3 (lines 506–527) +
seam rows 73/122–124, `proposals/contract-first.md` C1 row (line 23) + Theme 1 (lines
96–107) + its "Phase 2 — Persistence gateway" section (line 287), and the conventions
established by `prep/phase2-fork-surgery.md`.

---

## Reality check (plan/analyses vs HEAD — every contradiction found)

The analyses were written against `3b0cfcff`. Phase 0 hotfixes + Phase 1 motion + the
in-flight Phase 2 have moved a great deal. Numbered ▲ findings; each affects scoping below.

**Already fixed — do NOT re-plan:**

1. ▲ **persistence P1 ("Clear All Data" leaves Yjs data) is FIXED** — `src/db/wipe.ts`
   (227 lines) is the single wipe owner: stops sync + y-idb persistence, deletes both
   databases by name (`APP_DATABASES`, `wipe.ts:30`), clears only app-owned localStorage
   keys/prefixes and `piper-voices` caches, surfaces `blocked` deletions. Both entry points
   call it (`GlobalSettingsDialog.tsx:246`, SafeMode `App.tsx:33`). BUT it landed in
   `src/db/`, not `src/data/`, and reaches writers via dynamic imports of
   `@store/yjs-provider` (`wipe.ts:106`) and `@lib/sync/FirestoreSyncManager` (`wipe.ts:92`)
   — this is the **db→store ratchet residual (baseline count: 1)** named "P3" in the master
   plan Phase 1 status note. Fix designed in §D9.
2. ▲ **persistence P2 (alignmentData drift) is FIXED** — `CachedSegment` is deleted;
   `DBService.getCachedSegment` returns `CacheAudioBlob` with a read-shim normalizing legacy
   `alignmentData` onto canonical `alignment` (`DBService.ts:573–590`; documented at
   `src/types/cache.ts:41`). The rows/ schema must keep the `alignmentData` read-shim.
3. ▲ **persistence P3 (cover corruption) is FIXED** — backup manifest **v3** with
   `coverBlobBase64` (`BackupService.ts:49–76`), merge-not-blind-put restore
   (`sanitizeManifestRow`, `:506–532`), a v2 reader kept forever, and the one-time boot
   repair `MaintenanceService.repairCorruptCoverBlobsOnce()` wired as the `db/open` boot
   task (`src/app/boot/openDatabase.ts`). Backup format v3 (P0's format change) is DONE —
   the one-in-flight token is currently held by **CRDT v6 (Phase 2)**.
4. ▲ **persistence P8 is HALF-fixed** — restore now zod-validates the envelope
   (`BackupService.ts:86–92`), dry-runs `Y.applyUpdate` on a scratch doc (`:305–312`), and
   writes an automatic pre-restore checkpoint (`:316–327`) before anything destructive. **What
   remains for P3:** the raw `indexedDB.open('versicle-yjs')` re-implementation of y-idb's
   store layout (`BackupService.ts:347–375`) and the 1000 ms "wait for flush" sleep (`:466`).
5. ▲ **persistence P5 / LD-1 (types/db god hub) is FIXED** — `types/db.ts` is now a
   deprecated type-only re-export shim (deletion deadline P9); `TTSQueueItem`/`Timepoint`
   live canonically in `src/types/tts.ts` and `AudioPlayerService` imports them (arrow
   reversed; `AudioPlayerService.ts:2,31`). Residue: `DBService.ts:14,18` still imports both
   types via the `@lib/tts/...` re-export paths instead of `~types/tts` — trivial cleanup
   when rows/ land. `types-imports-nothing` ratchet is 0.
6. ▲ **Repositories already moved** — `BookRepository`/`ContentAnalysisRepository` are at
   `src/app/repositories/` (P1), so the analysis's "db→store edges 3" is now **1** (wipe.ts
   only, per `.dependency-cruiser-baseline.json`: `db-not-to-store: 1`).
7. ▲ **`lib/sync/validators.ts` is already DELETED** (with its fuzz suite). "zod rows
   absorbing both validator modules" reduces to absorbing **`src/db/validators.ts` only**
   (110 lines: hand-rolled `validateBookMetadata` guard + DOMPurify `sanitizeString`, sole
   consumer `lib/ingestion.ts`).
8. ▲ **`window.__CLOSE_DB__` is gone** — E2E uses typed `window.__versicleTest.closeDb()`
   (`db.ts:201–202`); `flushPersistence` exists (`test-api.ts:124` →
   `dbService.flushSessionWrites()`, added at `DBService.ts:541–549`).
9. ▲ **CheckpointService got its P0 upgrades** — `protected: true` flag with
   supersede-older + prune-skip logic (`CheckpointService.ts:29–82`), and restore now clears
   `MigrationStateService` only **after** the snapshot is fully persisted (`:150–152,
   180–181`). The YjsSnapshotService design must preserve both semantics exactly.

**Changed ground the plans don't reflect:**

10. ▲ **The worker engine IS the only production TTS path now.** `src/app/tts/
    mainThreadAudioPlayer.ts:29–34`: `getAudioPlayer()` returns `WorkerEngineHandle`
    unconditionally — "there is no runtime engine-selection branch". The analysis's P4
    warning ("the worker port silently reintroduces [the WebKit hang pair] wholesale … the
    moment the worker engine ships as default") **has already happened**: the worker runs
    `AudioPlayerService` → `PlaybackStateManager.saveTTSState` (`PlaybackStateManager.ts:444,
    465`) against the worker's own `DBService` singleton with its **own** `idb-write-lock`
    promise chain (`idb-write-lock.ts:24` is module state, per-context). A worker
    `cache_session_state` write CAN overlap a main-thread Yjs `updates` flush today. The
    navigator.locks gate is therefore not hardening — it closes a **live** cross-context
    hazard, and is correctly the first P3 PR.
11. ▲ **`yjs-provider.ts` is fully reshaped** (P1b + P2 in flight): lazy `getYDoc()`,
    `startYjsPersistence()` owned by the boot registry, **live accessor**
    `getYjsPersistence()` (the stale-binding fix the analysis asked for), `disconnectYjs()`,
    `CURRENT_SCHEMA_VERSION = 6` already, and the y-idb binding already takes
    `{ writeDebounceMs: 200, transactionRunner: runExclusiveIdbWrite }`
    (`yjs-provider.ts:55–58`). The P3 drop-in swap point is exactly that one option value
    plus `DBService.writeSession` (`DBService.ts:479`).
12. ▲ **The y-idb fork is far richer than the analysis assumed** (read at
    `node_modules/y-idb/src/y-idb.js`, fork pinned
    `github:vrwarp/y-idb#e2a21f45…`, `package.json:79` — **not vendored**; only
    `zustand-middleware-yjs` is in `packages/`). It already has: `whenSynced`
    promise (`y-idb.js:164`), `transactionRunner` injection (`:19–24`), debounced batched
    flush with retry/backoff (`:242–332`), pagehide/visibilitychange best-effort flush
    (`:208–239`), and a destroy() that flushes pending updates (`:334–376`). **What it
    lacks:** (a) a public `flush(): Promise<void>` (the flush machinery is private;
    `_flushPromise` is internal); (b) durability on `whenSynced` — `synced` is emitted
    (`:177–181`) before the constructor's initial-state write (`:171–176`, issued inside
    `_fetchUpdates` at `:49` **without awaiting**) is committed. The
    temp-doc + `whenSynced` + `destroy()` dance in `CheckpointService.ts:138–148, 209–217`
    is durable only via the side effect that `IDBDatabase.close()` waits for in-flight
    transactions; (c) a snapshot-write primitive — which is why `BackupService.ts:347–375`
    re-implements the store layout raw. §D6 specs the surgery.
13. ▲ **`src/sw.ts` is already thin (26 lines)** — it delegates to `src/sw-utils.ts`
    (`createCoverResponse`). The real duplication at HEAD: the `/__versicle__/covers/`
    literal exists in **5 modules** (`sw.ts:15`, `BookListItem.tsx:67`, `BookCover.tsx:28`,
    `AudioPlayerService.ts:302`, `selectors.ts:144–145,345`), and `sw-utils.ts:3–5`
    re-declares `DB_NAME`/store-name constants plus a legacy `'books'`-store fallback
    (`:18–21`), opening its own unversioned `idb` connection (`:8`).
14. ▲ **`src/data/` exists but is occupied by a squatter** — `src/data/bible-lexicon.ts`
    (static TTS lexicon data, imported by `lib/tts/LexiconService.ts:3` and
    `lib/tts/AudioContentPipeline.ts:12`). `eslint.config.js` (comment at the alias rule)
    already says "src/data is reshaped in Phase 3" and gives it no alias. The squatter must
    relocate (→ `src/lib/tts/bible-lexicon.ts`, pure move) before the data-layer lint bans
    flip; P5c lazy-loads it anyway.
15. ▲ **The two proposals disagree on carving order**: strangler-incremental §Phase 3 says
    `audioCache → playbackCache → bookContent → checkpoints → diagnostics`;
    contract-first says `… → bookContent → diagnostics → checkpoints`. Real coupling at HEAD
    (§D5) favors **diagnostics before checkpoints**: `TTSFlightRecorder` is a self-contained
    raw-IDB consumer with zero contention, while `CheckpointService` is being actively
    modified by the in-flight P2 work (pre-migration checkpoints, protected flag) and
    statically imports `FirestoreSyncManager` + `MigrationStateService` — carve it last,
    after P2 stabilizes.
16. ▲ **`sync_log` is a dead store at HEAD** — defined in the schema (`db.ts:82–88`,
    created `:149–152`) with **zero** production readers or writers (grep: only `db.ts`).
    The analysis ("checkpoints/sync_log … accessed exclusively by CheckpointService") is
    stale: CheckpointService touches only `checkpoints`. Same class as the never-used
    `app_metadata` store (P15, still true, `db.ts:89–93,153–155`). v25 repurposes
    `app_metadata` (§D7); `sync_log` is left in place and flagged for the P4 sync strangler
    (its SyncEvent design may want it) with P9 as the deletion backstop.
17. ▲ **android-backup is unwired dead code at HEAD** — `AndroidBackupService` has zero
    production callers (grep). Its generation path already produces v3 (delegates to
    `backupService.generateManifest()`). The strangler defers the keep-or-delete ADR to
    Phase 4; for P3 it is a passive format adapter that costs nothing (§D6).
18. ▲ **`db.ts` connection defects all still present**: rejected `dbPromise` cached forever
    (`db.ts:102–105`/`186–191` — one transient open failure bricks DB access until reload);
    no `blocked`/`blocking`/`terminated` handlers; idempotent-only upgrade that
    unconditionally deletes 23 legacy stores including v17/v18 **user-data** stores with no
    snapshot (`db.ts:160–179`); version constant 24 inline. `navigator.storage.persist()` /
    `storage.estimate()`: zero hits repo-wide. Audio-cache eviction: zero hits
    (`lastAccessed` is dutifully bumped on every read via an unserialised fire-and-forget
    `db.put` — `DBService.ts:578` — itself a gate-bypassing readwrite txn).
19. ▲ **The WebKit-hang bypass list has shifted slightly** but P4's substance holds. At
    HEAD, readwrite transactions OUTSIDE the lock: `DBService.ts:216` (ingestBook), `:271`
    (updateBookStructure — intra-txn await get→put at `:274–280`), `:301` (deleteBook),
    `:337` (offloadBook — still locks `static_manifests` and never touches it, P13d), `:357`
    (restoreBookResource — intra-txn await at `:359`), `:622` (saveLocations — intra-txn
    await at `:624`), one-shot `db.put`s at `:578,595,672`; `lib/ingestion.ts:185`
    (reprocess txn over 4 stores); `BackupService.ts:362,395,404,433`;
    `MaintenanceService.ts:71,139`; `CheckpointService.ts:43` + `db.delete` `:233`;
    `TTSFlightRecorder.ts:223` + `db.delete/clear` `:207,215`. Only `DBService.writeSession`
    (`:479`) and y-idb take the lock.
20. ▲ **`src/db/README.md` is still the stale v17 document** (P15) — it gets deleted with
    the façade; the new `src/data/README.md` is generated from the target design.
21. ▲ Backup characterization is **better than the analysis's "(c) does not exist"**:
    `BackupService.test.ts` now pins validate-before-destroy (5 regression cases), v3 cover
    base64 round-trip, and `{}`-sanitization. What is still missing as a P3 entry gate: an
    end-to-end generate→restore round-trip against fake-indexeddb that pins the **current
    raw `versicle-yjs` write shape** (exactly one row in `updates` that hydrates a fresh doc
    to the snapshot) — the behavior the YjsSnapshotService rewrite must preserve.
22. ▲ Master plan §Roadmap P3 omits the `LibraryBook` view model (contract-first put it in
    its gateway phase). The master plan is authoritative: `BookMetadata`→`LibraryBook` is
    **out of P3 scope** (lands with P7 library workflows). Noted so nobody re-imports it.

---

## Design

Final geography (master plan §2; everything lands at its final address, nothing moves twice):

```
src/data/
  write-gate.ts        # D1 — navigator.locks gate; runExclusiveIdbWrite (drop-in) + write()
  connection.ts        # D2 — openDB, handlers, retry, storage.persist(); absorbs db/db.ts
  schema.ts            # D2/D7 — EpubLibraryDB DBSchema + versioned migration registry (v25)
  sw-contract.ts       # D3 — DB/store-name constants + cover read used by the SW entry
  covers.ts            # D3 — coverUrl(bookId) consumed by UI/engine/selectors
  rows/                # D4 — zod schemas per store; z.infer = row types
    static.ts cache.ts app.ts index.ts
  repos/               # D5 — audioCache, playbackCache, bookContent, diagnostics, checkpoints
  snapshot/
    YjsSnapshotService.ts  # D6 — capture/validate/apply primitives (doc passed in, no @store import)
  errors.ts            # handleDbError relocated verbatim (DBService.ts:27–45)
  wipe.ts              # D9 — wipeAllData + writer-hook registry (kills the db→store edge)
packages/y-idb/        # D6 — vendored fork (same treatment as zustand-middleware-yjs)
```

Layering: `src/data` imports `~types/*`, `@lib/logger`, `idb`, `yjs`, `y-idb`, `zod` —
**never** `@store/*`, `@lib/sync/*`, React, or zustand. This keeps every repo importable
from the TTS worker (the worker-safety contract `DBService.ts:58–63` generalizes from "one
file's docstring" to a depcruise rule).

### D1. The write-gate (`src/data/write-gate.ts`)

Two surfaces; the first is the drop-in.

```ts
/** Cross-context exclusive writer. Same name, same signature, same rejection-isolation
 *  semantics as src/lib/idb-write-lock.ts:31 — implemented on the Web Locks API. */
export function runExclusiveIdbWrite<T>(work: () => Promise<T>): Promise<T>;

/** Test helper, preserved: resolves when the backlog drains (idb-write-lock.ts:45). */
export function idbWriteLockIdle(): Promise<void>;

/** The structural API for repos. `populate` MUST be synchronous (returns void, not a
 *  Promise) — intra-transaction awaits, WebKit hang trigger #2 (DBService.ts:432–434),
 *  are unrepresentable. The gate opens the txn, calls populate, awaits tx.done, all
 *  inside the lock. */
export function write<Names extends readonly StoreNames<EpubLibraryDB>[]>(
  stores: Names,
  populate: (tx: IDBPTransaction<EpubLibraryDB, Names, 'readwrite'>) => void,
): Promise<void>;
```

Semantics (each pinned by the gate contract suite, §Test plan G.*):

- **Lock name** `'versicle-idb-write'`, mode `exclusive`, no `ifAvailable`/`steal`. FIFO
  fairness per the Web Locks spec — same ordering guarantee as the promise chain, but now
  spanning the TTS worker and other tabs (closes ▲10).
- **Fallback:** `navigator.locks` is absent in jsdom (the entire vitest suite runs on
  fake-indexeddb under jsdom, `src/test/setup.ts:2`) and Safari < 15.4. When
  `globalThis.navigator?.locks` is undefined, fall back to the existing module-level
  promise-chain implementation (copied verbatim). The contract suite runs against BOTH
  implementations (the locks path via a small in-process `navigator.locks` stub install,
  the chain path natively).
- **Rejection isolation:** a rejected `work` rejects its caller but never wedges the queue
  (pinned today by `idb-write-lock.ts:32–38`; under locks this is free — the lock releases
  when the callback's promise settles).
- **Re-entrancy:** awaiting `runExclusiveIdbWrite` from inside a held callback deadlocks —
  exactly as the old chain does (an inner enqueue awaited by the outer waits for the outer's
  own slot). Not a behavior change, but now cross-context. DEV-mode tripwire: a
  module-scoped `held` flag set around the callback; if a new request is issued while
  `held === true` in the same context, `logger.error` + flight-recorder breadcrumb
  (mirrors the P2 fork's DEV divergence-tripwire pattern). `write()`'s synchronous callback
  cannot express the hazard at all.
- **Watchdog (diagnostics only):** a 10 s timer logging "gate held > 10s by <label>" — a
  hung WebKit transaction inside the gate now blocks all writers in all contexts, which is
  the intended serialization but must be visible. Never force-releases.
- **Read-modify-write recipe** (replaces the intra-txn-await sites in ▲19): read in a
  plain readonly transaction *outside* the gate, compute, then `write()` with a synchronous
  `put`. Last-write-wins between read and write — identical to (actually narrower than)
  today's races, and the gate's serialization means no app writer can interleave.

Migration mechanics: `src/lib/idb-write-lock.ts` becomes a 3-line deprecated re-export of
`@data/write-gate` in the same PR (so `yjs-provider.ts:4` and `DBService.ts:19` compile
unchanged); both importers are flipped to the new path before P3 exit and the shim is
deleted **at P3 exit** (constitution rule 2: named deletion deadline = this phase).

### D2. Connection module (`src/data/connection.ts`) — format-free hardening

Absorbs `db/db.ts` verbatim, then fixes the ▲18 defects (none of which require a version
bump):

```ts
export function getConnection(): Promise<IDBPDatabase<EpubLibraryDB>>;
export function closeConnection(): Promise<void>;
export interface ConnectionEvents {
  onBlocked?(info: { oldVersion: number }): void;   // our open is blocked by another tab
  onBlocking?(): void;   // we block another tab's upgrade → close + prompt reload
  onTerminated?(): void; // browser killed the connection
}
export function configureConnectionEvents(events: ConnectionEvents): void; // wired by app/boot
```

- `blocked`/`blocking`/`terminated` passed to `openDB`. `blocking` closes the connection and
  invokes the callback; **the data layer never imports the toast store** — `app/boot/
  openDatabase.ts` (the existing `db/open` boot task) wires the callbacks to UI.
- **`dbPromise` reset-on-failure with bounded retry** (3 attempts, 250 ms backoff): a
  rejected open no longer bricks all DB access until reload (`db.ts:102–105`).
- `navigator.storage.persist()` requested once after first successful open (fire-and-forget,
  result logged; `storage.estimate()` surfacing in settings is P8).
- The version stays **24** and the upgrade callback is byte-identical in this PR — schema
  changes are exclusively the v25 PR (§D7, one-in-flight rule).

### D3. SW contract + shared `coverUrl()` (`src/data/sw-contract.ts`, `src/data/covers.ts`)

- `sw-contract.ts`: `DB_NAME`, `STATIC_MANIFESTS_STORE`, the legacy `BOOKS_STORE` fallback,
  `getCoverFromDB(bookId)`, `createCoverResponse(bookId)` — i.e. `src/sw-utils.ts` absorbed
  whole (its own `idb` import is legal inside `src/data/`). The SW cannot share the app's
  connection (separate JS context); it keeps opening read-only at current version. The
  legacy `'books'` fallback (`sw-utils.ts:18–21`) survives until P9 (a pre-v18 straggler's
  covers must render before their first main-app upgrade).
- `covers.ts`: `export const COVERS_ENDPOINT_PREFIX = '/__versicle__/covers/'`;
  `coverUrl(bookId): string`; `parseCoverPath(pathname): string | null`. Consumers migrated:
  `sw.ts:15–21` (prefix + parse), `BookListItem.tsx:67`, `BookCover.tsx:28`,
  `AudioPlayerService.ts:302`, `selectors.ts:144–145,345`. Grep gate at PR exit: the literal
  appears exactly once in `src/` (in `covers.ts`).
- `src/data/bible-lexicon.ts` relocates to `src/lib/tts/bible-lexicon.ts` in this PR (pure
  `git mv` + two import updates) so `src/data/` is exclusively the storage layer before any
  lint ban references the path (▲14).

### D4. Row schemas (`src/data/rows/`)

zod is the single source of truth for **persisted** shapes; `z.infer` exports become the row
types. Mapping from the Phase 1 type split (which already did the domain cut — rows/ absorbs
the *persisted* halves, `~types` keeps the view/domain types):

| rows/ module | Stores | Absorbs from |
|---|---|---|
| `static.ts` | `static_manifests`, `static_resources`, `static_structure` | `~types/book` persisted rows |
| `cache.ts` | `cache_render_metrics`, `cache_audio_blobs` (with the `alignmentData` read-shim note, ▲2), `cache_session_state` (embedding the persisted `TTSQueueItem` from `~types/tts:32`), `cache_tts_preparation`, `cache_table_images` | `~types/cache`, persisted slice of `~types/tts` |
| `app.ts` | `checkpoints` (incl. `protected?: boolean`, ▲9), `flight_snapshots`, `sync_log` (frozen as-is, ▲16), `app_metadata` envelope (v25 `schemaHistory` + `legacy-recovery` records, §D7) | `~types/sync`, `~types/flight-recorder` |

Rules:
- Schemas are `z.looseObject` at the envelope (forward-compatible: unknown fields pass
  through) with strict required keys — same posture the P0 backup envelope took
  (`BackupService.ts:86–92`).
- Binary fields (`ArrayBuffer | Blob`) validated with `z.custom` (WebKit stores
  ArrayBuffers, ingest normalizes — `DBService.ts:186–199` policy unchanged).
- **Where validation runs:** at untrusted ingress only — backup restore rows (replacing the
  loose `BackupManifestRow` handling), the android payload read, and (P4's job) Firestore
  inbound. Repos do NOT validate on every read/write in prod (perf; observe-mode DEV asserts
  in repos are fine). This matches the contract-first observe-then-enforce rule.
- `db/validators.ts` dissolves: `validateBookMetadata`/`getSanitizedBookMetadata`/
  `sanitizeString` move into `lib/ingestion.ts` (their only consumer) next to the
  sanitize-at-ingest boundary; the file + its test are deleted in the same PR with
  assertions absorbed (test-absorption ledger).
- `~types` modules keep re-exporting the inferred row types so the 59-importer shim chain
  (`types/db.ts` → domain modules → rows/) stays compile-stable until P9.

### D5. Repos carved from the 670-line DBService (order verified against HEAD coupling)

`dbService` remains as a **deprecated delegating façade** — every method body becomes a
one-line call into a repo; importers migrate per-PR; the façade and `src/db/` die at P3
exit. `handleDbError` (`DBService.ts:27–45`) relocates verbatim to `data/errors.ts`
(re-exported by the façade for `BookImportService.ts:9`).

Carving order, smallest blast radius first, with the HEAD consumer census that justifies it:

**1. `repos/audioCache.ts`** — sole consumer `lib/tts/TTSCache.ts:40,52`.
```ts
getSegment(key: string): Promise<CacheAudioBlobRow | undefined>;  // keeps alignmentData read-shim
putSegment(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void>;
runEviction(budgetBytes?: number): Promise<{ deleted: number; freedBytes: number }>;
```
- The `lastAccessed` bump on read (today a gate-bypassing fire-and-forget,
  `DBService.ts:578`) goes through `write()` and is **debounced**: skip the write when the
  stored `lastAccessed` is < 1 h old — removes one readwrite txn per cache hit during
  playback (the highest-frequency bypass in ▲19).
- New rows gain an optional `size: number` (byteLength) at write time — additive field, NOT
  a schema version bump.
- **LRU eviction (format-free design):** budget constant (default 512 MiB,
  `AUDIO_CACHE_BUDGET_BYTES`); job runs from the existing `background` boot phase + after
  every N puts; pass 1 streams a cursor over `cache_audio_blobs` collecting
  `{key, lastAccessed, size ?? value.audio.byteLength}` one row at a time (no `getAll` —
  the BOLT OOM comments at `DBService.ts:90` stay honored); pass 2 deletes
  oldest-first through `write()` in small batches until under budget, skipping rows touched
  in the last 24 h. v25 adds a `by_lastAccessed` index + size backfill as a later
  optimization (§D7) — eviction must not wait for the format change.

**2. `repos/playbackCache.ts`** — consumers: `AudioPlayerService.ts:358`,
`PlaybackStateManager.ts:444,465` (both worker-resident now, ▲10), `test-api.ts:124`,
`wipe.ts:191`.
```ts
getSession(bookId: string): Promise<CacheSessionStateRow | undefined>; // seeds the mirror (getTTSState)
saveQueue(bookId: string, queue: TTSQueueItem[]): void;                // saveTTSState
savePauseTime(bookId: string, lastPauseTime: number | null): Promise<void>; // updatePlaybackState
flushPending(): Promise<void>;   // flushSessionWrites — test API contract preserved
dropPending(): void;             // cleanup() — wipe path keeps drop-not-flush semantics (▲1)
```
The entire WebKit-hang-safe block moves **verbatim** (`DBService.ts:426–549`: in-memory
mirror, per-book seed-once `loadSession`, single-chain `enqueueSessionWrite`, 500 ms
debounced coalescing, single-synchronous-put `writeSession` through the gate) including its
documentation — this is an explicitly protected keeper. Known correctness gaps P13a
(cold-start clobber of `lastPauseTime`) and the dual-mirror problem (worker + main each own
a `sessionCache`) are **deferred to P5b** (`SessionStore` port / single owner per the C4
decomposition); P3 only notes them in the repo docstring. Rationale: fixing ownership
requires the EngineContext persistence port, which is engine surgery, not storage motion —
and the navigator.locks gate already removes the *hang* half of the dual-context problem.

**3. `repos/bookContent.ts`** — the big one. Consumers at HEAD: `BookImportService`,
`app/repositories/BookRepository`, `useLibraryStore.ts:2`, `useEpubReader.ts:293,459,468`,
`useSmartTOC.ts:69`, `ContentAnalysisLegend.tsx:94`, `AudioContentPipeline.ts:64,232,313,
321,372,380`, `TableAdaptationProcessor.ts:60`, `AudioPlayerService.ts:307,1059`,
`MaintenanceService`, `BackupService.ts:154`, plus the raw reprocess txn in
`lib/ingestion.ts:185`.
```ts
getManifestBundle(id) / getManifestBundleBulk(ids)       // DBService.ts:80–138 verbatim
getBookFile(id) / getSections(bookId) / getBookStructure(bookId)
ingest(data: BookExtractionData, mode: 'add' | 'overwrite'): Promise<void>  // 5-store atomic txn preserved
replaceDerivedContent(bookId, {manifest?, structure, ttsPrep, tableImages}): Promise<void>
                                                          // absorbs ingestion.ts:185's raw txn
updateToc(bookId, toc) / deleteBook(id) / offloadBook(id) / restoreResource(id, buf)
getLocations(bookId) / saveLocations(bookId, locations)
getTableImages(bookId) / saveTTSPreparation(row) / getTTSPreparation(bookId, sectionId)
getAvailableResourceIds(): Promise<Set<string>>
```
All writers re-expressed through `write()` (read-before outside the gate per D1's recipe);
`offloadBook` drops the never-touched `static_manifests` lock (P13d); the dead
`getOffloadedStatus` else-branch musing (`DBService.ts:391–400`) and unreachable
post-`handleError` returns die here. `MaintenanceService`'s orphan scan/prune migrates onto
repo methods in the same PR (cheap; full all-stores orphan coverage is a stretch goal, not
an exit criterion — master plan P3 scope omits it).

**4. `repos/diagnostics.ts`** — sole consumer `TTSFlightRecorder.ts:160–235` (raw `getDB()`
CRUD + `db.transaction` at `:223`). Mechanical: `saveSnapshot` (with the MAX_SNAPSHOTS
prune inside one gated txn), `listSnapshots` (metadata-only projection preserved),
`getSnapshot`, `deleteSnapshot`, `clearSnapshots`. Zero contention (▲15).

**5. `repos/checkpoints.ts`** — sole consumer `CheckpointService` (`:43` txn + `db.get/
getAll/delete`). Carved **last**, after P2's checkpoint-touching work has landed:
```ts
add(record: Omit<SyncCheckpointRow,'id'>, opts?: { protected?: boolean }): Promise<number>
   // owns supersede-older-protected + prune-skip-protected inside ONE txn (CheckpointService.ts:43–80 verbatim)
list(): Promise<SyncCheckpointRow[]>;  get(id): …;  remove(id): …
latestByTrigger(trigger: string): Promise<SyncCheckpointRow | undefined>  // for createAutomaticCheckpoint
```
`CheckpointService` itself **stays in `lib/sync/`** (its decomposition is P4); only its IDB
access moves down. Its `FirestoreSyncManager` import cycle is P4's named fix — P3 must not
touch it.

### D6. Snapshot unification: vendor + cut the y-idb fork, then `YjsSnapshotService`

**Vendoring (same treatment as the P2 zustand-middleware-yjs fork):** `packages/y-idb/`
npm-workspace with upstream LICENSE retained, `PROVENANCE.md` (upstream y-indexeddb SHA +
fork delta log), `yjs` moved to peerDependencies (it is a regular dep in the fork's
package.json today — same dedupe-by-luck hazard P2's ▲4 found; the existing
`scripts/assert-single-instance.cjs` extends to cover it), the fork's tests ported to
vitest, and a **contract suite pinning current semantics BEFORE any change**: constructor
hydration order, `transactionRunner` is used for every write path (initial write, debounced
flush, trim/storeState, set/del), debounce batching, retry/backoff, destroy-flushes-pending,
`clearData` deletes the database, `whenSynced` fires after updates apply.

**Fork surgery (two additive changes, each behind a contract test written first):**

```js
// 1. Instance method — the explicit flush the 1000 ms sleeps stand in for:
async flush(): Promise<void>
//   cancel scheduled debounce → run _flush now → await the commit (tx.oncomplete via the
//   existing _flushPromise) → loop until _pendingUpdates is empty and no flush in flight.
//   Resolves immediately when idle. destroy() reuses it (today's destroy duplicates the logic).

// 2. Module export — the snapshot-write primitive BackupService re-implements raw today:
export async function writeSnapshot(name, update, { transactionRunner } = {}): Promise<void>
//   open/create the DB with the fork's own store layout → clear 'updates' → addAutoKey(update)
//   → await transaction complete → close. Layout knowledge lives in exactly one module: the fork.

// 3. Durability fix on 'synced': the constructor's initial-state write (y-idb.js:171–176)
//   is awaited before 'synced' is emitted (y-idb.js:177–181). Today whenSynced can resolve
//   before that write commits (▲12b) — the temp-provider dance is durable only via
//   IDBDatabase.close() semantics. Contract test pins the new guarantee.
```

**`src/data/snapshot/YjsSnapshotService.ts`** — primitives only; the live doc is *passed
in*, never imported (keeps data/ below state/, the layering rule that makes this module
worker- and future-proof):

```ts
export function captureDoc(doc: Y.Doc): Uint8Array;                  // encodeStateAsUpdate
export function validateSnapshot(update: Uint8Array): void;          // scratch-doc dry-run
   // throws AppError('BACKUP_SNAPSHOT_INVALID') — same checks as BackupService.ts:305–312
export async function applySnapshot(update: Uint8Array,
   opts?: { dbName?: string /* default 'versicle-yjs' */ }): Promise<void>;
   // PRECONDITION (documented + DEV-asserted): the live binding for dbName is destroyed.
   // Implementation: y-idb writeSnapshot(dbName, update, { transactionRunner: runExclusiveIdbWrite })
```

**The three mechanisms become adapters** (orchestration stays where it lives today — the
shared *dance* is now three calls into one tested implementation; collapsing the
orchestrators themselves is P4's sync strangler):

| Adapter | Before (HEAD) | After |
|---|---|---|
| `BackupService.processManifest` Phase 3 | `persistence.clearData()` → raw `indexedDB.open('versicle-yjs')` re-implementing the fork layout (`:347–375`) → … → 1000 ms sleep (`:466`) | `validateSnapshot` (already done in Phase 1 of the method — dedupe) → `clearData()` → `applySnapshot(update)` → static rows via `bookContent` repo → **no sleep** (writeSnapshot is durable) → dialog reload unchanged |
| `CheckpointService.restoreCheckpoint` / `applyRemoteState` | temp-doc + `new IndexeddbPersistence` + `whenSynced` + destroy (`:138–148, 209–217`) | `validateSnapshot(blob)` → `clearData()`/`disconnectYjs()` (its own existing imports) → `applySnapshot(blob)` → `MigrationStateService.clear()` **after** (ordering ▲9 preserved) → reload |
| `android-backup` | already delegates to `backupService.generateManifest()` (v3) | unchanged; unwired (▲17); keep-or-delete ADR in P4 |

`waitForYjsSync` + capture in `generateManifest` (`BackupService.ts:207,216`) gains a
`getYjsPersistence()?.flush()` before `captureDoc` so a backup can never miss the last 200 ms
debounce window.

### D7. IDB v25 — THE one format change of this phase (lands last, one-in-flight rule)

Sequence check (master plan rule 4): backup manifest v3 (P0, **done**) → CRDT v6 (P2, **in
flight now**) → IDB v25 (this PR). The v25 PR has a hard entry gate: P2's exit criteria
verified green *and* one straggler-verification window passed (the two-client quarantine E2E
running in CI on the release branch). Every other P3 PR is format-free and independent of
this gate.

`src/data/schema.ts`:

```ts
export const DB_VERSION = 25;
export interface IdbMigration {
  toVersion: number;
  /** Runs inside the versionchange transaction; may await tx ops only. */
  migrate(db: IDBPDatabase<EpubLibraryDB>, tx: VersionChangeTx, oldVersion: number): Promise<void> | void;
}
export const MIGRATIONS: readonly IdbMigration[] = [ /* { toVersion: 25, … } */ ];
```

- **Step 0 (unversioned, runs every upgrade):** today's idempotent create-if-missing block
  (`db.ts:120–158`) — kept verbatim as the baseline so any pre-24 straggler still converges.
- **v25 step:**
  1. **Straggler guard (snapshot-before-delete, P9 fix):** before the legacy-store deletion
     loop (`db.ts:160–179`) runs, any surviving v17/v18 *user-data* store (`annotations`,
     `user_annotations`, `user_progress`, `user_inventory`, …) has its rows serialized into
     `app_metadata['legacy-recovery-v25']` (size-capped; bare JSON rows + store name +
     timestamp). Today's upgrade silently destroys a returning pre-Yjs user's data; after
     v25 it is recoverable via support/diagnostics. Then the deletion proceeds.
  2. `app_metadata` repurposed (it was never read/written, ▲16/P15): typed envelope in
     `rows/app.ts` holding `schemaHistory` (append `{ from, to, at }` every upgrade) and the
     recovery record.
  3. `cache_audio_blobs.by_lastAccessed` index + post-open idle backfill of the `size`
     field (optimizes D5.1's eviction; eviction itself shipped earlier, format-free).
  4. `sync_log` left untouched (▲16 — P4 decides, P9 backstop).
- `blocked`/`blocking` handlers are already live from D2; the **multi-tab upgrade test**
  (two fake-indexeddb connections, old-version holder gets `onBlocking`, new open gets
  `blocked` then proceeds after close) gates this PR specifically.
- **Fixtures (master plan §3):** a fixture builder constructs fake-indexeddb databases in
  v18 layout (legacy user stores populated) and v24 layout, then runs `getConnection()` at
  v25 and asserts: stores converge, recovery blob captured for v18, `schemaHistory`
  appended, zero data loss for v24 rows. These are the standing "v18 and v24 IDB fixtures"
  the master plan names.
- **Reversibility:** v25 is additive (snapshot-before-delete + index + metadata). A
  rollback build at v24 cannot open a v25 DB (IDB versions are monotonic) — so v25 ships
  only after the v6 stability window, and the straggler guard means the worst case is
  recoverable, not destructive.

### D8. Lint/ratchet flips at exit (C12)

- ESLint `no-restricted-imports` (error): `@db/db`, `@db/DBService`, `@db/*`, and bare
  `idb` everywhere outside `src/data/**` (the `src/data/sw-contract.ts` home makes the SW
  legal by construction, D3).
- ESLint `no-restricted-syntax` (error): `CallExpression[callee.property.name='transaction']
  > Literal[value='readwrite']` outside `src/data/` — the readwrite ban, since depcruise
  cannot see string arguments. Plus a belt-and-braces grep gate in
  `scripts/` (pattern from the P2 `|| {}` grep gate).
- dependency-cruiser: new `data-no-upward` rule (data → store/hooks/components/app
  forbidden) born at **error** with baseline 0; `db-not-to-store` baseline 1 → 0 (D9) then
  rule deleted along with `src/db/`; `components-not-to-db` 2 → 0 (the two are
  `GlobalSettingsDialog` + `ContentAnalysisLegend`, both migrate during D5).
- `.dependency-cruiser.cjs` `includeOnly`/worker rule extended to `packages/y-idb/src`
  exactly as was done for the zustand fork (`.dependency-cruiser.cjs:114–134`).

### D9. `db/wipe.ts` → `src/data/wipe.ts` + writer-hook registry (the named P3 ratchet debt)

The only db→store edge left (▲1) is `wipe.ts`'s dynamic imports of the two writers it must
stop. Inversion:

```ts
// src/data/wipe.ts  (everything else in wipe.ts moves verbatim — it is already correct)
export interface WipeHook { name: string; stop(): Promise<void> | void }
export function registerWipeHook(hook: WipeHook): void;   // idempotent by name
export async function wipeAllData(options?: WipeOptions): Promise<void>;
//  order: run hooks (each withTimeout(5s), wipe.ts:73–83 helper preserved) →
//  playbackCache.dropPending() → closeConnection() → delete APP_DATABASES →
//  clear app localStorage/caches → throw-on-blocked → reload
```

Registration lives in the app layer, where importing store + sync is legal:
`src/app/boot/registerBootTasks.ts` (the composition manifest, imported by `main.tsx`
before any boot phase runs) registers `{name:'sync/stop', stop: () =>
FirestoreSyncManager.resetInstance()}` and `{name:'state/stop-yjs-persistence', stop:
disconnectYjs}`. SafeMode safety argument: registration happens at manifest import time,
not boot success — and if the app crashed before the manifest loaded, neither writer was
ever started, so the missing hook stops nothing that runs. `App.tsx:10` and
`GlobalSettingsDialog.tsx:20` re-point to `@data/wipe` (alias added in this PR). Ratchet:
`db-not-to-store` 1 → 0.

---

## Execution order (PR-by-PR; each independently shippable, constitution rules 1–8)

PRs P3-1…P3-12 are **format-free restructuring** and may land any time after P2-6 (the
store registry) is merged; PRs touching `yjs-provider.ts` / `CheckpointService` (P3-3,
P3-10, P3-11) should land after P2-7…P2-11 to avoid churn. **P3-13 is the ONE format
change** and additionally waits for the v6 stability window.

| PR | Content | Exit criteria / gates |
|---|---|---|
| **P3-1** | Entry-gate tests FIRST (no prod change): backup generate→restore round-trip on fake-indexeddb pinning the current raw `versicle-yjs` write shape (▲21); write-gate contract suite G.1–G.6 written against the EXISTING `idb-write-lock` (pins drop-in semantics); repo round-trip characterization for ingest→read incl. Blob/ArrayBuffer normalization (extends `DBService.test.ts`) | suites green on unmodified code; absorption ledger updated |
| **P3-2** | Vendor y-idb → `packages/y-idb` (LICENSE, PROVENANCE.md, peer-dep yjs, vitest port, single-instance assertion extended); fork contract suite Y.1–Y.7 pinning CURRENT semantics | `npm ls` one yjs; license gate green; zero behavior diff; depcruise includeOnly updated |
| **P3-3** | `src/data/write-gate.ts` (D1) as drop-in; `idb-write-lock.ts` → deprecated re-export shim; swap `yjs-provider.ts:57` + `DBService.ts:479` import paths | G.1–G.6 green on both implementations; `test_tts_cross_chapter.spec.ts` green ×20 repeats with `TTS_IDB_PROBE=1` (probe reports zero outstanding-readwrite overlaps); full E2E green |
| **P3-4** | `connection.ts` (D2: handlers, retry, `storage.persist()`); `sw-contract.ts` + `covers.ts` (D3); `sw-utils.ts` absorbed; bible-lexicon relocated (▲14); `errors.ts` | multi-connection blocked/blocking unit test green; coverUrl literal grep = 1; cover E2E (`test_journey_library.spec.ts` covers render) green; version still 24, upgrade byte-identical |
| **P3-5** | `rows/` zod schemas (D4); `db/validators.ts` dissolved into ingestion; `~types` re-export chain kept stable | row round-trip property tests green; validators tests absorbed; `types-imports-nothing` still 0 |
| **P3-6** | `repos/audioCache.ts` + LRU eviction job + debounced lastAccessed (D5.1); `TTSCache` migrated | eviction unit tests (budget, skip-recent, streaming cursor) green; cloud-TTS cache-hit alignment regression test still green |
| **P3-7** | `repos/playbackCache.ts` (D5.2, WebKit block verbatim); PSM/APS/test-api/wipe call sites migrated | session-coalescing suite green incl. the deliberate teardown-drop pin; `flushPersistence` E2E call sites green; worker parity suites green |
| **P3-8** | `repos/bookContent.ts` (D5.3) + `replaceDerivedContent` absorbing `ingestion.ts:185`; BookImportService/BookRepository/hooks/components/Maintenance/Backup call sites migrated | ingest→read round-trip green; `test_journey_import_error`, `test_journey_smart_toc`, `test_maintenance` E2E green; `components-not-to-db` → 0 |
| **P3-9** | `repos/diagnostics.ts` (D5.4); TTSFlightRecorder migrated | flight-recorder suite green; engine-room E2E green |
| **P3-10** | `repos/checkpoints.ts` (D5.5); CheckpointService IDB access migrated (after P2 settles) | checkpoint suite green incl. protected-flag supersede/prune pins; `test_journey_recovery` green |
| **P3-11** | Fork surgery `flush()`/`writeSnapshot()`/synced-durability (D6) behind new contract tests Y.8–Y.10; `YjsSnapshotService`; BackupService + CheckpointService adapters cut over; raw `indexedDB.open` + 1000 ms sleep + temp-provider dance deleted | P3-1 backup round-trip green on the NEW path; checkpoint restore E2E green; `test_journey_backup` + `test_journey_workspace_switch` green; grep: zero `indexedDB.open('versicle-yjs')` outside packages/y-idb |
| **P3-12** | `wipe.ts` → `data/wipe.ts` + hook registry (D9); façade deletion: `dbService` + `src/db/**` deleted, 14 importers on repos, lint flips (D8) | `db-not-to-store` 0 and rule retired; readwrite/idb bans at **error**, zero exceptions; post-wipe boot test + SafeMode E2E green; knip clean for src/db |
| **P3-13** | **FORMAT CHANGE — IDB v25** (D7): migration registry, straggler snapshot-before-delete, app_metadata schemaHistory, by_lastAccessed index + size backfill | ENTRY GATE: P2/v6 exit criteria verified + stability window. v18/v24 fixture upgrades green; multi-tab upgrade test green; full unit + E2E green; reversibility note in PR body |

Phase exit (= strangler §Phase 3 exit verified): backup round-trip test green (written in
P3-1, before the rewrite); all readwrite transactions through the gate (lint at error);
multi-tab upgrade test green; `dbService` façade deleted; ratchet counters ≤ baseline with
`db-not-to-store` retired at 0.

---

## Test plan

**Existing suites that pin behavior (must stay green throughout; re-run per PR):**
`src/db/DBService.test.ts` (session coalescing incl. the asserted teardown drop),
`src/db/db-quota.test.ts` (quota → `StorageFullError` mapping), `src/db/wipe.test.ts`,
`src/lib/BackupService.test.ts` (validate-before-destroy ×5, v3 cover round-trip,
`{}`-sanitization), `src/lib/sync/CheckpointService.test.ts` (protected flag),
`src/lib/MaintenanceService.test.ts` (cover repair), `App_Boot.test.tsx` (post-wipe boot),
engine parity suites (worker transport unaffected by playbackCache carve), and E2E:
`test_journey_backup`, `test_journey_recovery`, `test_journey_workspace_switch`,
`test_maintenance`, `test_safe_mode`, `test_tts_cross_chapter` (+ `_idb_probe.js` under
`TTS_IDB_PROBE=1` — the WebKit-hang evidence harness).

**New contract/characterization suites (entry gates, written FIRST):**

- **G (write-gate), P3-1/P3-3:** G.1 FIFO ordering; G.2 rejection isolation (a rejecting
  work doesn't wedge followers — pins `idb-write-lock.ts:32–38`); G.3 `idbWriteLockIdle`
  drain; G.4 `write()` rejects a thenable-returning populate (DEV assert); G.5 fallback
  selection when `navigator.locks` undefined; G.6 same suite against a `navigator.locks`
  stub (request/queue semantics) — both implementations must pass identically.
- **Y (y-idb fork), P3-2/P3-11:** Y.1 constructor hydration applies stored updates; Y.2
  every write path uses `transactionRunner`; Y.3 debounce batching; Y.4 retry/backoff on
  txn error; Y.5 destroy flushes pending; Y.6 `clearData` deletes the DB; Y.7 `whenSynced`
  ordering. Surgery: Y.8 `flush()` durability (idle no-op, pending-drain, in-flight
  chaining); Y.9 `writeSnapshot` → fresh provider hydrates byte-identically; Y.10 `synced`
  not emitted before the initial write commits.
- **S (snapshot), P3-1/P3-11:** S.1 the end-to-end backup generate→restore round-trip
  (real Y.Doc with annotations + binary ArrayBuffer covers, through fake-indexeddb,
  reload-simulated rehydration asserts content equality) — written against the CURRENT raw
  path, then required green unchanged on the YjsSnapshotService path; S.2 checkpoint
  create→restore round-trip preserving `MigrationStateService` ordering; S.3
  `validateSnapshot` rejects truncated/garbage/empty updates.
- **R (repos), P3-1/P3-6…10:** per-repo round-trip on fake-indexeddb (a
  `describeRepoContract` mirroring `describeSyncBackendContract`): ingest→read with
  Blob→ArrayBuffer normalization, delete cascades (index-based stores), offload/restore,
  locations LWW, eviction (budget/skip-recent/streaming), diagnostics prune-at-cap,
  checkpoints protected-flag invariants.
- **M (migrations), P3-13:** v18-fixture upgrade → recovery blob + stores converge;
  v24-fixture upgrade → no-op for data + index added + schemaHistory appended; multi-tab
  blocked/blocking simulation; open-failure retry/reset.

**Fixture needs:** v18 + v24 IDB fixture builders (programmatic, committed as builder code
not binary dumps — fake-indexeddb is deterministic); a small real EPUB cover as
ArrayBuffer (reuse `verification/alice.epub` extraction); real Y.Doc fixtures reused from
P2's `src/store/__tests__/crdt-contract` capture set; a large-row generator for eviction
(no real audio needed — sized ArrayBuffers).

**Absorption ledger:** `db/validators.test.ts` → ingestion suite; `sw-utils.test.ts` →
data/sw-contract suite; any DBService per-method tests → repo contract suites; each
deletion in the same PR as its absorption, per rule 8.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Write-gate changes lock scope cross-context** — a hung WebKit txn inside the gate now stalls workers AND main (today only its own context's chain) | This is the intended serialization (concurrent readwrite is the proven hang *trigger*, so global one-at-a-time prevents the hang rather than spreading it); 10 s watchdog logging to the flight recorder; P3-3 gates on the cross-chapter flake suite ×20 with the probe asserting zero overlapping readwrite txns |
| **navigator.locks unavailable / divergent** (jsdom, Safari < 15.4) | Documented fallback to the verbatim promise chain; contract suite runs both paths; Capacitor Android WebView (Chromium) and iOS WKWebView ≥ 15.4 both support Web Locks |
| **Re-entrant gate deadlock introduced by repo composition** | `write()`'s synchronous callback makes it unrepresentable for new code; DEV tripwire for legacy `runExclusiveIdbWrite` nesting; review rule: repos never call repos inside a gate callback |
| **y-idb surgery corrupts the persistence path (total-data-loss class)** | Vendor + pin current semantics (Y.1–Y.7) before ANY change; surgery is additive (new methods, one ordering fix behind a test); `applySnapshot` precondition DEV-asserted; the S.1 round-trip written first is the acceptance gate |
| **v25 upgrade with a second tab open stalls or destroys straggler data** | blocked/blocking handlers shipped earlier (D2) and E2E'd; snapshot-before-delete converts the destructive straggler path into a recoverable one; v25 is the last PR, after v6 stability (one-in-flight rule bounds blast radius) |
| **Repo carving regresses the WebKit session discipline** (the multi-week-investigation class) | The mirror/debounce/single-put block moves verbatim with its documentation; coalescing suite + teardown-drop pin are entry gates; probe-instrumented E2E after P3-7 |
| **LRU eviction deletes audio mid-playback** | Skip rows touched < 24 h; `lastAccessed` bumped on every read; eviction batches through the gate so it can never overlap a playback write |
| **Phase 2 lands mid-phase and moves files under this design** (`yjs-provider`, CheckpointService, store registry) | P3-3/-10/-11 explicitly sequenced after P2-7…P2-11; the design binds to exported seams (`getYjsPersistence`, `disconnectYjs`, `transactionRunner` option), not line numbers; re-verify cited lines at each PR start |
| **Façade deletion breaks an unnoticed importer** (14 known) | Importers enumerated (▲ Reality check + D5 census); lint flip in the same PR makes any straggler a build error, not a runtime surprise |

---

## Dependencies

**Needs from earlier phases (all verified at HEAD or explicitly gated):**
- P0: typed test API (`flushPersistence`, `closeDb`), backup manifest v3 + cover repair,
  checkpoint `protected` flag, licensing gate (unblocks the y-idb vendoring PR), the
  coverage/depcruise ratchet harness.
- P1: path aliases (+ this phase adds `@data/`), `src/app/` composition layer (boot tasks
  host the connection-event wiring and wipe-hook registration), repositories already out of
  `src/db/`, types split (rows/ slots beneath the `~types` re-export chain).
- P2 (in flight): the store registry / `defineSyncedStore` (P2-6) before P3-3 swaps the
  `transactionRunner` import path; the migration coordinator + v6 fully landed and
  straggler-verified before **P3-13 only**; P2's vendoring pattern + contract-suite
  conventions reused wholesale.

**What later phases need from P3:**
- **P4 (sync):** `repos/checkpoints.ts` (CheckpointService decomposition target),
  `YjsSnapshotService.applySnapshot` (staged-swap workspace switch builds on it),
  `sync_log` decision owed by P4, android-backup keep-or-delete ADR, the gate spanning tabs
  (workspace switch under `navigator.locks` assumes it).
- **P5 (TTS):** `repos/playbackCache.ts` as the `SessionStore` port's backing (5b single
  session-owner fix is deferred there, D5.2); `repos/audioCache.ts` for provider caching;
  the worker-safe data layer as a depcruise rule instead of a docstring.
- **P8 (PWA):** `sw-contract.ts`/`covers.ts` as the SW's only app imports;
  `storage.estimate()` surfacing in settings.
- **P9:** deletion of the `idb-write-lock` shim is P3's own exit; `types/db.ts` shim, the
  SW legacy-`books` fallback, and `sync_log` (if P4 declines it) are P9 deletions; the
  `legacy-recovery-v25` blob gets a retention decision (delete after N releases).

---

## Follow-ups (appended at phase close, 2026-06-10)

Phase 3 landed in full — P3-1…P3-13, including the v25 format change (see the
README status banner). Exit criteria verified: backup round-trip green on the
YjsSnapshotService path (written in P3-1, before the rewrite); every readwrite
transaction through the gate (`idb`-import + readwrite bans at **error**, zero
exceptions — the schema fixtures live inside `src/data/__fixtures__/` so the
"zero exceptions" posture holds by construction); multi-tab upgrade tests green
(generic mechanism in `connection.test.ts`, the shipping v24→v25 scenario in
`migrations.test.ts` M.5); `dbService` façade, `src/db/**`, and the
`idb-write-lock` shim deleted with zero residual importers; `db-not-to-store`
retired at 0; v18/v24 fixture upgrades green. Deliberately deferred work, with
owners:

1. **Session-state single ownership (P13a + the dual-mirror problem) — P5b.**
   `repos/playbackCache.ts` moved the WebKit-safe block verbatim and documents
   both gaps in its header: the cold-start `lastPauseTime` clobber and the
   worker + main thread each owning a `sessionCache` mirror. The fix needs the
   EngineContext `SessionStore` port (engine surgery, not storage motion); the
   navigator.locks gate already removed the *hang* half of the dual-context
   hazard.
2. **`sync_log` adopt-or-delete — P4 (P9 backstop).** Still a dead store,
   schema frozen in `rows/app.ts` (▲16). P4's SyncEvent design decides; P9
   deletes it otherwise.
3. **android-backup keep-or-delete ADR — P4 (▲17).** Unwired at HEAD; passive
   v3 format adapter; cost nothing during P3.
4. **Eviction scan onto `by_lastAccessed` — next audioCache touch (any phase).**
   v25 added the index and the `size` backfill; the sweep still does the
   full-cursor total-bytes pass (it needs the total anyway). Re-pointing pass 2
   at index order (oldest-first cursor, stop once under budget) drops the sort
   and the in-memory entry list — cheap, but not load-bearing today.
5. **`legacy-recovery-v25` retention — P9.** The straggler snapshot needs a
   delete-after-N-releases decision (it is size-capped, so the cost of keeping
   it is bounded).
6. **P9 deletions inherited from P3:** the `types/db.ts` re-export shim; the SW
   legacy-`books` fallback in `sw-contract.ts` (pre-v18 straggler covers); item
   5 above; item 2 if P4 declines.
7. **`storage.estimate()` surfacing in settings — P8.** `storage.persist()` is
   requested at first open (D2); the UI surface was always P8 scope.
8. **Full all-stores orphan coverage in MaintenanceService — stretch goal,
   unowned.** The orphan scan/prune migrated onto repo methods (P3-8); coverage
   of every store pairing was explicitly a non-exit-criterion stretch goal and
   remains open.
9. **v25 straggler-verification window — release engineering.** Per master plan
   rule 4, the *next* format change (tts-storage split, P5b) lands only after
   v25's straggler path is verified in the wild (the two-client quarantine E2E
   on the release branch plus one release of `legacy-recovery-v25` telemetry
   silence). The local entry gate (v6 quarantine suite green) was verified at
   P3-13 time; the release-branch window is a CI/process gate outside this
   repo's tree.
