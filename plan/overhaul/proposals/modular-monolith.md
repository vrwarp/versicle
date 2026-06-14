# Versicle Overhaul Proposal — Domain-Modular Monolith with Enforced Boundaries

Lens: design the ideal end-state as a set of domain modules with explicit public APIs,
mechanically enforced dependency direction, UI strictly downstream of domain services, and
all singletons replaced by an explicit composition root — then derive the migration map.

Grounding: 21 analyst reports in `plan/overhaul/analysis/` (verified findings, file:line
evidence). Every move below names the current files it absorbs. Severity calibration uses
the re-verified verdicts (e.g. "Store↔TTS-engine runtime cycle" is treated as high, not
critical; "Zod sync validators dead" as high; both still get paid off in full).

---

## Target architecture

### Design principles

1. **Vertical domain modules, horizontal infrastructure.** Each domain owns its model,
   services, and UI in one directory with a single public API (`index.ts`) and an explicit
   `ports.ts` declaring what it needs from the outside world. Infrastructure (kernel, data,
   state, ui) is horizontal and domain-agnostic.
2. **The `EngineContext` pattern is the law, not the exception.** The one proven boundary in
   the codebase (`src/lib/tts/engine/EngineContext.ts` — hexagonal ports, type-only store
   coupling, Zustand + Fake implementations, parity tests) is generalized to every domain:
   services declare ports; `app/` injects adapters. Identified as the keeper by four
   independent analysts (tts-engine, tts-content, layering-deps, type-safety-errors).
3. **Stores are dumb caches.** All workflow logic (import sagas, sync lifecycle, TTS command
   routing, progress projection) leaves the store layer for domain services orchestrated by
   `app/` controllers. Stores hold state + pure reducers, period.
4. **One composition root.** `app/bootstrap.ts` constructs everything in explicit, awaited
   order. Module scope everywhere else is side-effect-free, lint-enforced. The 13
   module-scope singletons and 4 `getInstance()` singletons become constructor-injected
   instances.
5. **Worker safety is a build artifact, not a convention.** The TTS/search worker closures
   are asserted by dependency-cruiser rules plus a CI test on chunk contents, replacing
   today's un-linted `import type` discipline.
6. **Every boundary is contract-tested.** Dual implementations (worker/in-process engine,
   Firestore/Mock sync backend, real/fake providers) share one behavioral scenario suite —
   the `engineParityScenarios.ts` pattern, extended.

### Module map

```
packages/                          # vendored forks as npm workspaces (from git branch refs)
  zustand-middleware-yjs/          #   + syncedKeys, merge-hydration, per-key diff, whenHydrated
  y-idb/                           #   + explicit flush()/whenSynced
  y-cinder/                        #   pinned, emulator contract-tested

src/
  kernel/                          # L0 — shared kernel. Imports: nothing internal.
    types/                         #   types/db.ts dissolved by domain: book.ts, user-data.ts,
                                   #   tts.ts (TTSQueueItem/TTSStatus/Timepoint), sync.ts,
                                   #   flight-recorder.ts. Zero imports from any other layer.
    errors.ts                      #   AppError base (code union, cause, context, retryable,
                                   #   toJSON/fromJSON) + domain subclasses; Result<T,E>
    logger.ts                      #   createLogger only; GlobalLoggerService deleted
    flight-recorder/               #   TTSFlightRecorder generalized: namespaced ring buffer
                                   #   (TTS/SYNC/DB/GENAI/INGEST/UI), anomaly snapshots
    cfi/                           #   canonical CFI algebra on parsed EpubCFI components
                                   #   (absorbs lib/cfi-utils.ts; one separator set, one
                                   #   cfiContains/stripCfiWrapper; property-tested fast paths;
                                   #   locale parameter threaded — no hardcoded 'en')
    net/                           #   NetworkGateway + typed destination registry (hosts,
                                   #   data classification, consent, timeout, offline policy);
                                   #   CSP generated from it
    locale/                        #   getUILocale(), cached Intl formatters (date/relative/
                                   #   bytes/collator), message-catalog runtime (worker-safe)
    progress/resolve.ts            #   single progress-resolution + session-merge module
    utils: crypto.ts, csv.ts, json-diff.ts, language-utils.ts, device-id.ts,
           cancellable-task-runner.ts, fuzz-utils (test)

  data/                            # L1 — the ONLY IndexedDB subsystem. Imports: kernel.
    connection.ts                  #   openDB + blocked/blocking/terminated, reset-on-failure,
                                   #   navigator.storage.persist()
    schema.ts                      #   typed DBSchema + versioned migration registry (replaces
                                   #   idempotent-only v24 upgrade in db/db.ts)
    write-gate.ts                  #   navigator.locks exclusive writer spanning workers/tabs;
                                   #   sync-callback API bans intra-txn awaits structurally
                                   #   (absorbs lib/idb-write-lock.ts)
    rows/                          #   zod schemas per store; z.infer row types — the single
                                   #   validation source for backup/Android/Firestore ingress
    repos/                         #   bookContent, playbackCache (session mirror, single
                                   #   owner), audioCache (+LRU eviction job), searchText,
                                   #   diagnostics (flight snapshots), checkpoints
    snapshot/YjsSnapshotService.ts #   one capture/validate(dry-run applyUpdate)/apply+flush
    wipe.ts                        #   wipeAllData(): both DBs + localStorage + caches
    sw-contract.ts                 #   COVER_ROUTE constant + store names shared with sw.ts

  state/                           # L2 — CRDT + persisted state. Imports: kernel, data,
    provider.ts                    #   packages/*. NEVER imports domains/ or app/.
                                   #   Y.Doc + persistence started by app/bootstrap (no import
                                   #   side effects); whenHydrated(); dedicated 'meta' Y.Map
                                   #   owning schemaVersion
    registry.ts                    #   every store declared with tier: synced | local | ephemeral
    synced/                        #   useBookStore, useReadingStateStore, useAnnotationStore,
                                   #   usePreferencesStore (single keyed map), useReadingListStore,
                                   #   useVocabularyStore, useLexiconStore, useContentAnalysisStore,
                                   #   useDeviceStore — all with syncedKeys whitelists
    local/                         #   useTTSSettingsStore, useGenAIStore (logs excluded),
                                   #   useDriveStore, useLocalHistoryStore, useGoogleServicesStore,
                                   #   useSyncStore (moved from lib/sync/hooks/),
                                   #   useCredentialsStore (all API keys, one threat model)
    ephemeral/                     #   useAppUIStore, useReaderUIStore (no callbacks-as-state),
                                   #   useToastStore (queue), useBackNavigationStore,
                                   #   useSidebarStore, useTTSPlaybackStore (engine mirror)

  domains/                         # L3 — domain modules. Services import kernel + data + own
                                   # module + other domains' index.ts ONLY (allowlisted edges).
                                   # Services never import state/ — they declare ports.
                                   # Each module: model/ service/ ports.ts ui/ index.ts
    audio/                         #   engine/: PlaybackController (FSM + TaskSequencer with
                                   #     epoch/AbortSignal cancellation), QueueModel (immutable
                                   #     PlaybackStateManager), SessionStore port, AnalysisApplier,
                                   #     MediaMetadataPublisher, DragnetGesture; one monotonic
                                   #     immutable PlaybackSnapshot stream; standalone TtsEngine
                                   #     interface; EngineContext/PlaybackBackend/AudioSink ports;
                                   #     replicationSpec (definition only — wiring in app/)
                                   #   pipeline/: SectionQueueBuilder (pure), SegmentRefiner,
                                   #     ReferenceSectionDetector strategy, TableAdapter,
                                   #     LexiconEngine (CompiledLexicon value object,
                                   #     SystemLexiconProvider for lazy-loaded Bible JSON)
                                   #   providers/: ProviderDescriptor registry, narrow
                                   #     ITTSProvider + capability interfaces, PiperRuntime
                                   #     class, BaseCloudProvider, TTSCache
                                   #   ui/: AudioPill variants, UnifiedAudioPanel, TTSQueue,
                                   #     LexiconDialog (single instance), TtsHighlighter binding
    reader/                        #   engine/: ReaderEngine interface; EpubJsEngine = the ONLY
                                   #     runtime importer of epubjs; epubSecurity.ts (sanitize
                                   #     hook + sandbox patch, shared with extraction);
                                   #     epubTheming.ts; locations.ts
                                   #   extraction/: offscreen renderer + SentenceExtractor +
                                   #     CitationMarkerDetector (raw sentences, offset-correct
                                   #     normalization map, extractionVersion stamp)
                                   #   overlays/: HighlightLayerManager (one annotations.add/
                                   #     remove owner, layer registry, single orphan sweep),
                                   #     MeasuredOverlay portal primitive
                                   #   session/: ReadingSessionRecorder (serialized per-book)
                                   #   ui/: ReaderShell (<200 lines), panels, ReaderCommands
                                   #     context (kills window CustomEvents + callbacks-in-store)
    library/                       #   ImportOrchestrator (job queue: validate → identify
                                   #     SHA-256 → policy → extract once → persist → register),
                                   #     LibraryService (per-book keyed mutex for import/restore/
                                   #     offload/remove), cover-palette, entity-resolution as
                                   #     one-time linker (bookId FK on ReadingListEntry)
                                   #   ui/: LibraryView, useImportController, dialogs
    search/                        #   SearchEngine (kept), SearchSession (reader-scoped,
                                   #     injected worker factory), BookTextExtractor over
                                   #     data/repos/searchText; ui/: SearchPanel, SearchInput
    chinese/                       #   engine/: PinyinGeometryEngine (code-point safe),
                                   #     TraditionalConverter (length-guarded); dictionary/:
                                   #     offline-first DictionaryService (IDB, SW-cached);
                                   #     vocabulary/ (simplified-canonical keys);
                                   #     ui/: PinyinOverlay, VocabTriageCard, settings.
                                   #     Registers into reader's ContentProcessor slot via app/.
    sync/                          #   core/: SyncOrchestrator, AuthSession, ProviderConnection,
                                   #     SyncBackend interface (FirestoreBackend | MockBackend),
                                   #     downloadWorkspaceState(path); workspaces/: WorkspaceService,
                                   #     MigrationStateMachine (staged-swap restore);
                                   #     checkpoints/ (protected pruning, navigator.locks);
                                   #     typed SyncEvent bus (no useToastStore imports);
                                   #     device mesh; semantic-tree behind StatePorts
    google/                        #   GoogleAuthClient (per-service token map, interactive
                                   #     connect vs silent getToken + AuthRequiredError),
                                   #     DriveClient + DriveLibrarySync, GenAIClient interface
                                   #     (GeminiClient | MockGenAIClient) with per-feature
                                   #     zod-validated modules (tocTitles, referenceDetection,
                                   #     tableAdaptation, libraryMapping)

  ui/                              # design system. Imports: kernel ONLY (+ Radix/Tailwind).
                                   #   shadcn primitives (kept), Modal as the single dialog
                                   #   primitive, queue-based Toast, PillShell (dumb),
                                   #   ConfirmDialog/useConfirm, KeyboardShortcutService,
                                   #   LiveAnnouncer, useReducedMotion

  app/                             # L4 — composition root. Imports: everything below.
    bootstrap.ts                   #   explicit phase machine: interceptMigration → openDB →
                                   #   startYjsPersistence → whenHydrated → runMigrations →
                                   #   constructServices → registerDevice → hydrateReadModels
    container.ts                   #   explicit instances; no getInstance() anywhere
    migrations.ts                  #   static imports, sequential await, atomic version bump,
                                   #   loud failure → safe mode (replaces yjs-provider:83-171)
    adapters/                      #   store-backed port adapters: createZustandEngineContext,
                                   #   createWorkerEngineClient, replication wiring, SyncPorts,
                                   #   DrivePorts, GooglePorts, GenAI config provider
    controllers/                   #   TtsController (owns getAudioPlayer, the 18 calls leave
                                   #   useTTSStore), SyncController, ImportController policy,
                                   #   drive auto-sync policy (out of App.tsx)
    repositories/                  #   BookRepository / ContentAnalysisRepository read-model
                                   #   mergers (moved from src/db/, same worker-safety invariant)
    routes.tsx                     #   /, /notes, /read/:id, /settings/:tab? — React.lazy
    shell/                         #   RootLayout (shell-only + GlobalOverlayOutlet), boot views
    settings-registry.ts           #   SettingsPanel descriptors; lazy panel mount
    test-api.ts                    #   installTestApi() → window.__versicleTest, VITE_E2E-gated
    debug-hooks.ts                 #   DEV-gated window globals (one auditable file)

  workers/
    tts.worker.ts                  #   Comlink expose; closure = kernel + data + domains/audio
    search.worker.ts               #   closure = kernel + domains/search/engine
  sw.ts                            #   imports data/sw-contract.ts; runtime caching routes
  main.tsx                         #   ≤30 lines: render(bootstrap())
```

### Dependency direction (text diagram)

```
                 ┌─────────────────────────────────────────────┐
                 │                  app/  (L4)                 │
                 │  bootstrap · container · controllers ·      │
                 │  adapters · repositories · routes · shell   │
                 └──────┬───────────┬──────────┬───────────────┘
                        │           │          │
        ┌───────────────▼──┐   ┌────▼─────┐  ┌─▼──────────────┐
        │   domains/* (L3) │   │ state(L2)│  │   ui/          │
        │ audio reader     │   │ provider │  │ design system  │
        │ library search   │   │ stores   │  │ a11y services  │
        │ chinese sync     │   │ registry │  └─┬──────────────┘
        │ google           │   └────┬─────┘    │
        │ (ports.ts ◄──────┼────────┘ adapters │ kernel only
        │  injected by app)│   never imports   │
        └────────┬─────────┘   domains         │
                 │ index.ts-only cross-imports │
        ┌────────▼─────────────────────────────▼┐
        │               data/ (L1)              │
        │  connection · schema · write-gate ·   │
        │  rows(zod) · repos · snapshot · wipe  │
        └────────────────────┬──────────────────┘
        ┌────────────────────▼──────────────────┐
        │              kernel/ (L0)             │
        │ types · errors · logger · cfi · net · │
        │ locale · progress · flight-recorder   │
        └───────────────────────────────────────┘

  entries: main.tsx → app/bootstrap
           workers/* → kernel + data + one domain (no state/, no zustand, no yjs)
           sw.ts     → data/sw-contract only
  UI rule: domains/*/ui and app/shell are the only React-rendering layers;
           they may read state/ hooks; everything they command goes through
           domain services or app/ controllers — never raw singletons.
```

### Boundary rules (mechanically enforced, CI-blocking)

Encoded in dependency-cruiser + eslint flat config (`no-restricted-imports`,
`@typescript-eslint/consistent-type-imports`, `import/no-cycle` on the runtime graph,
`import/no-internal-modules` for cross-domain imports):

| # | Rule | Pays off |
|---|---|---|
| R1 | `kernel/` imports no internal module | "types/db.ts god type hub" |
| R2 | `data/` imports only `kernel/`; `idb` + `'readwrite'` transactions banned outside `data/` | "No data-access boundary", "WebKit write lock per-callsite" |
| R3 | `state/` never imports `domains/` or `app/`; `getState()` banned outside `state/` + `app/` | "lib services reach into store (97 getState)", "Dense store-to-store coupling" |
| R4 | `domains/*/{model,service}` may import `kernel`, `data`, own module, and other domains via `index.ts` per an explicit edge allowlist (`library→reader`, `search→reader`, `chinese→reader` types-only); never `state/` | "Service-locator architecture", "Circular lib/store layering" |
| R5 | `ui/` imports `kernel/` only | "CompassPill in ui/ imports 5 domain stores" |
| R6 | Worker runtime closures must exclude `state/`, `zustand`, `yjs` — dependency-cruiser rule + CI test asserting worker chunk contents | "Worker import-safety guarded only by import-type discipline" |
| R7 | No module-scope side effects outside `app/bootstrap.ts` + entries; no top-level `new` of stateful services; no `window.*` outside `app/debug-hooks.ts`/`test-api.ts` | "Module-scope side effects boot persistence/auth/globals" |
| R8 | No `import X from '../../..'` — path aliases `@kernel/@data/@state/@domains/@app/@ui`; one canonical path per module | "No path aliases", "dual import paths" |
| R9 | Raw `fetch`/`XMLHttpRequest` banned outside `kernel/net/`; CSP hosts == destination registry (unit-tested) | "No network gateway / egress policy" |
| R10 | `no-console` outside `kernel/logger.ts`; `no-alert`; `epubjs` imports banned outside `domains/reader/engine/`; `mainThreadAudioPlayer`-equivalent banned outside `app/` | "Logger duality", "Native confirm/alert", "epubjs ~90 untyped call sites" |

TypeScript project references (`tsconfig` per layer: kernel → data → state → domains → app,
plus `tsconfig.test.json`/`tsconfig.e2e.json`) make the direction rules a compile-time
property and finally typecheck all ~42k LOC of test code.

---

## How each confirmed debt is paid off

Grouped by theme; debts referenced by their report titles. Overstated-verdict items are
included at their recalibrated severity where they still warrant structural payment.

### Theme 1 — Layering, composition root, and cycles

- **"Module-scope side effects: importing modules boots Yjs persistence, Google auth, window
  globals" (critical)** — `app/bootstrap.ts` phase machine constructs Y.Doc/persistence
  (today `yjs-provider.ts:17,28-46`), SocialLogin init (`main.tsx:126`), sync manager, and
  the TTS controller in explicit awaited order. R7 lint-bans regression. Window hooks move
  to `app/debug-hooks.ts` (DEV) and `app/test-api.ts` (VITE_E2E), fixing **"main.tsx ships
  verification harness and debug globals to production"** and the unguarded
  `window.useReadingStateStore` write (`useReadingStateStore.ts:491`).
- **"App.tsx un-sequenced boot with implicit cross-effect ordering" (critical)** and
  **"Busy-wait polls in boot path"** — the same bootstrap machine replaces the 100ms book
  poll (`App.tsx:269-273`) with `state/provider.whenHydrated()`; subsystems register boot
  tasks so `App.tsx` stops importing `MigrationStateService`/`CheckpointService`/
  `DriveScannerService` directly.
- **"types/db.ts god type hub imports upward into lib/tts" (high)** — dissolved into
  `kernel/types/*` per R1; `TTSQueueItem`/`Timepoint` definitions move to
  `kernel/types/tts.ts` and `AudioPlayerService` imports them (arrow reversed). Also pays
  **"Boundary type leaks: TTSQueueItem in DB layer"** and ~50 of 65 madge cycles.
- **"Store↔TTS-engine runtime cycle" (recalibrated high)** — the 18 `getAudioPlayer()` calls
  leave `useTTSStore` for `app/controllers/TtsController`;
  `createZustandEngineContext`/`createWorkerEngineClient`/replication wiring relocate to
  `app/adapters/`. `domains/audio` then has zero state imports.
- **"lib/ services reach into store/ everywhere (54 edges, 97 getState)" (high)** and
  **"db/ imports store/ — repositories depend on UI state" (high)** — ports + adapters
  (R3/R4); `BookRepository`/`ContentAnalysisRepository` move to `app/repositories/`
  preserving their documented worker-safety constraint (`BookRepository.ts:1-9`).
- **"Zustand store and React hooks living inside lib/ (lib/sync/hooks/)" (medium)** —
  `useSyncStore` → `state/local/`, `useSyncToasts` → a SyncEvent-bus subscriber in
  `domains/sync` consumed by app shell.
- **"lib/sync internal tangle: CheckpointService↔FirestoreSyncManager" (medium)** —
  CheckpointService receives an injected `pauseSync`/shutdown handle from SyncController;
  `getInstance(config?)` replaced by `createSyncManager(config)` in the container.
- **"Zero route/feature code splitting: 229 of 266 modules load eagerly" (high)** —
  `app/routes.tsx` React.lazy + first-use dynamic import of firebase/Gemini/heavy services;
  sequenced after R7 so lazy chunks no longer boot the world (per layering-deps LD-8).
- **"Worker import-safety one typo away" (recalibrated medium)** — R6 makes it structural
  anyway: dependency-cruiser + chunk-content CI test on the existing ANALYZE visualizer
  data, plus `consistent-type-imports`.
- **"Schema migrations behind nested dynamic imports with swallowed errors" (high)** —
  `app/migrations.ts`: static imports, sequential `await`, one transactional version bump,
  failures surface to safe mode; deletes the double-`queueMicrotask` hack
  (`yjs-provider.ts:182-184`) and its spy test.
- **"Dead barrels, dual import paths, duplicate modules" / "No path aliases"** — knip-driven
  deletion (see "deleted" section); `lib/tts.ts` extractor relocates to
  `domains/reader/extraction/sentenceExtractor.ts`, removing the `lib/tts.ts` vs `lib/tts/`
  collision and the engine's upward type-import of `SentenceNode`.

### Theme 2 — CRDT bridge and state-model safety

- **"Ephemeral popover state synced through CRDT to other devices" (critical)** — popover
  moves to `state/ephemeral/useReaderUIStore`; the vendored middleware gains a `syncedKeys`
  whitelist so the class of bug is impossible; v6 migration deletes the `popover` key from
  the `annotations` map.
- **"Inbound hydration deletes state keys absent from the Y.Map" (critical)** — fork surgery:
  merge map JSON over declared defaults instead of replace-with-delete; then the ~20
  defensive `|| {}` fallbacks (`useBookStore.ts:58,71,79`, `selectors.ts:66-78`, etc.) and
  the v4→v5 "migration-as-backfill" hack are deleted.
- **"Migration runner is temporally fragile and fails silently" (high)** — single
  coordinator over `whenHydrated()`, atomic with the version bump, loud failures (same
  mechanism as Theme 1's migrations item).
- **"Schema quarantine only guards the 'library' map with a corruption window" (high)** and
  sync's **"Obsolete-client quarantine covers 1 of ~10 synced maps"** — `schemaVersion`
  moves to a dedicated `meta` Y.Map checked synchronously in the SyncBackend *before*
  applying remote updates; on obsolete, the provider is actually detached and the heartbeat
  stopped; `useUIStore` lock becomes a direct synchronous import. Dual-write
  `library.__schemaVersion` for one release so v5 clients still quarantine.
- **"Library import/restore/offload are race-prone multi-store sagas" (critical)** —
  `domains/library/LibraryService` + `ImportOrchestrator` with a per-book keyed mutex;
  `useLibraryStore` shrinks to a UI-projection cache; the five race-regression test files
  become one `LibraryService.concurrency` invariant suite.
- **"useTTSStore conflates persisted settings, live engine mirror, and command facade"
  (high)** — split into `state/local/useTTSSettingsStore` (replicated to the worker as an
  explicit data-only `TTSSettingsData` payload) and `state/ephemeral/useTTSPlaybackStore`
  (mirror, never replicated). Kills the **"Replication echo loop"** (full store re-serialized
  per sentence) and the engine-boot-on-rehydrate side effect; commands live on
  TtsController/engine handle. Also pays tts-ui's **"Leaky engine boundary"** (recalibrated
  medium): the store facade becomes complete and `mainThreadAudioPlayer` is lint-banned
  outside `app/`.
- **"Progress-resolution and session-merge logic duplicated 3-4x" (high)** —
  `kernel/progress/resolve.ts` consumed by store, hooks, selectors; reading-list upsert
  becomes one ProgressService subscription.
- **"useAllBooks: 220-line hand-rolled module-level cache mutated during render" (high)** —
  derived `libraryViewStore` recomputed via store subscriptions outside render; viable once
  per-key scoped diffing (fork surgery) fixes **"Write amplification: full-state deep diff
  per set()"** upstream. Also types the view model (**"Central library selector returns
  any[]"**, **"BookMetadata is a legacy intersection type"** → `LibraryBook` with
  `availability: 'local'|'offloaded'|'ghost'` produced solely by BookRepository).
- **"Per-device preferences create permanent undeletable top-level Y.Maps" (medium)** — v6
  folds `preferences/<deviceId>` maps into one internally-keyed map.
- **"Per-device UI state (activeContext) synced via Yjs; Notes not routable" (recalibrated
  medium)** — `/notes` route; navigation state leaves the CRDT for localStorage.
- **"UI store fragmentation; callbacks stored as state" (medium)** — `state/ephemeral/`
  consolidation; `ReaderCommands` React context replaces `playFromSelection`/
  `jumpToLocation` callbacks-in-store and the `'reader:chapter-nav'` window CustomEvent.

### Theme 3 — Persistence integrity

- **"'Clear All Data' leaves all user data behind" (critical)** — `data/wipe.ts`
  `wipeAllData()` closes + deletes both databases, clears yjs persistence, localStorage and
  caches; both reset entry points call it; UI never enumerates store names again
  (`GlobalSettingsDialog.tsx:246-254` deleted).
- **"WebKit-deadlock write lock is per-context and per-callsite" (high)** —
  `data/write-gate.ts` on `navigator.locks` (spans worker/tabs), sync-callback API,
  R2 lint ban on `'readwrite'` elsewhere. The detached-persistence WebKit IDB-hang
  workaround behavior is preserved behind the playbackCache repo (keeper).
- **"No data-access boundary: three competing tiers, raw getDB() in 7 modules" (high)** —
  `data/repos/*` become the only access path; TTSFlightRecorder and CheckpointService raw
  IDB CRUD move into `repos/diagnostics.ts` and `repos/checkpoints.ts`.
- **"Backup restore: unvalidated input, raw y-idb internals, magic sleeps,
  destructive-before-validated" (high)** and **"Backup restore wipes local data before
  validating replacement" (critical)** and **"Three parallel Yjs-snapshot mechanisms"** —
  `data/snapshot/YjsSnapshotService`: zod-validated manifest, dry-run `Y.applyUpdate` on a
  scratch doc, automatic pre-restore checkpoint, explicit y-idb `flush()`; BackupService /
  CheckpointService / android-backup become thin format adapters.
- **"Backup restore corrupts cover images (ArrayBuffer JSON-stringified)" (high)** —
  manifest v3 strips/base64s binary fields; v2 reader sanitizes `{}` coverBlobs; one-time
  boot repair nulls corrupted covers.
- **"Cached cloud-TTS alignment silently lost" (recalibrated medium)** — `CachedSegment`
  deleted; one canonical row type in `data/rows/cache.ts` with a write-read round-trip test.
- **"Schema strategy: idempotent-only upgrade destroys straggler user data" (medium)** —
  versioned migration registry in `data/schema.ts`, legacy-store snapshot-before-delete,
  blocked/blocking handlers.
- **"Unbounded caches: LRU fields exist but eviction never implemented" (high)** and
  tts-providers' **"TTS audio cache never evicted"** — size-budgeted idle-time LRU job in
  `data/repos/audioCache.ts` run by MaintenanceService; `navigator.storage.persist()` at
  first import; storage.estimate() surfaced in settings.
- **"Three validation layers, none at trust boundaries" (medium)** and **"Zod sync
  validators are dead code" (recalibrated high)** — `data/rows/` zod schemas become the one
  source, applied at backup restore, Android payload, and Firestore inbound
  (observe-then-enforce); `src/lib/sync/validators.ts` and `src/db/validators.ts` deleted.
- **"Session-state mirror correctness gaps" (medium)** — `repos/playbackCache.ts`
  seed-before-write, flush-on-teardown via web locks/visibilitychange, single owner per app
  instance with the worker reaching it via an EngineContext persistence port.

### Theme 4 — Sync correctness & security

- **"firestore.rules catch-all neuters tombstone protection; rule syntax invalid"
  (critical)** and **"No Cloud Storage rules/deploy story" (critical)** — rewritten
  non-overlapping `firestore.rules` with correct syntax and tombstone coverage of
  updates/history/maintenance/metadata; new `storage.rules` + `firebase.json` + documented
  deploy; a Firebase-emulator rules test suite gates both.
- **"Workspace switch has a data-loss window and a rollback that can silently fail"
  (critical)** — `MigrationStateMachine` staged-swap protocol (download → staging IDB →
  verify → atomic swap → reload), migration checkpoints pinned against pruning,
  `navigator.locks` around restore, migration state retained until restore succeeds.
- **"deleteWorkspace kills the whole manager and severs the active workspace" (high)** —
  WorkspaceService scoped teardown + reconnect; purges history/maintenance/metadata and
  Cloud Storage snapshots.
- **"FirestoreSyncManager is a 993-line god object" (high)** and **"Fragmented
  initialization and duplicated status plumbing"** — decomposed into
  SyncOrchestrator/AuthSession/ProviderConnection/WorkspaceService over the SyncBackend
  interface; one shared `downloadWorkspaceState(path)`; all async paths awaited; typed
  SyncEvent bus replaces the 8 `useToastStore` imports and drives lastSyncTime from flush
  events.
- **"Mock test mode interleaved through production code" (high)** and testing's
  **"Window-global test seams baked into production, incl. mock Firestore in the shipped
  bundle"** — `MockBackend` selected only in `app/bootstrap` under VITE_E2E; all
  `__VERSICLE_MOCK_FIRESTORE__` branches deleted; MockFireProvider leaves the prod import
  graph.
- **"Forked sync stack pinned to moving branch refs" (recalibrated medium)** — forks
  vendored as npm workspaces with provenance headers (see licensing); emulator contract
  suite becomes their acceptance gate.
- **"Schema migration runner races its own version bumps" (high)** — same coordinator as
  Theme 2.
- **"useSyncToasts serializes the entire progress map on every store update" (medium)** —
  origin-tagged remote-change events on the SyncEvent bus.

### Theme 5 — Audio/TTS domain

- **"Provider-event and gesture paths bypass the TaskSequencer" (critical)** — every
  externally-triggered transition (fallback recovery, dragnet, provider events) routed
  through the upgraded sequencer; dev-mode assertion that status/queue mutate only inside a
  running task. Combined with **"No cancellation in TaskSequencer" (high)**:
  epoch/AbortSignal cancellation, `ctx.checkStale()`, per-task watchdogs.
- **"Cloud-failure fallback double-fires and races the task sequencer" (critical)** and
  **"TTSProviderManager: duplicated fallback…"** — providers signal failure exactly once
  (reject only); fallback is one sequenced engine task (stop → awaited swap → replay) with a
  retry cap and a `providerChanged` event.
- **"Speed applied at both synthesis and playback" (critical)** — synthesize at 1.0; sink
  applies rate after src load; speed removed from request bodies and the cache key;
  per-provider non-1.0-speed tests.
- **"AudioPlayerService god object (1242 lines)" (high)** — decomposition into
  PlaybackController/QueueModel/SessionStore/AnalysisApplier/MediaMetadataPublisher/
  DragnetGesture per the engine target design; pays **"Two notification paths emit
  inconsistent snapshots"** (one monotonic immutable PlaybackSnapshot) and tts-ui's seek
  honesty item (`seekSentence` end-to-end).
- **"applySkippedMask mutates queue in place" (recalibrated high)** — QueueModel is
  copy-on-write with immutable snapshots; a parity scenario asserts fresh queue identity on
  both transports.
- **"Dual-transport contract unowned" (high)** — standalone `TtsEngine` interface; commands
  as acks; parity scenarios grow to absorb restore/masks/adaptations/navigation/dragnet/
  fallback and replace the 12 per-bug regression files.
- **"Flight recorder split-brained across threads" (high)** — worker-side
  snapshot/exportBuffer API on WorkerTtsEngine; DiagnosticsTab reads via the engine handle;
  recorder generalizes into `kernel/flight-recorder` (namespaced).
- **"No provider registry" (high)** — `ProviderDescriptor` registry as single source of
  truth; settings UI rendered from it; fixes tts-ui's **"triple-defined provider types"**.
- **"useTTSStore god store with dual voice-settings representation" (high)** — see Theme 2
  store split; profiles become the only representation.
- **"API key keystroke rebuilds provider" (high)** — buffered edits, re-init on blur/save.
- **"Piper not offline-capable" (high)** and **"piper-utils module-global singleton"
  (high)** — `PiperRuntime` class (request-id protocol, blob LRU, dispose); voices.json
  cached stale-while-revalidate; onnxruntime-web vendored into `public/piper/`; postinstall
  string-patching replaced by checked-in vendored worker source (with PROVENANCE.md).
- **"TTSProviderManager: stale-provider event leaks, no dispose" (high)** — dispose() +
  unsubscribe on the provider contract; `VoiceDownloadable` capability interface replaces
  `as any` duck typing.
- **"NFKD normalization after offset bookkeeping corrupts CFIs for non-ASCII books"
  (critical)** — extraction segments raw text with a per-node raw↔normalized offset map;
  composed-accent/ligature regression tests; `extractionVersion` stamp + background
  re-ingestion of affected books.
- **"Escaped template literal in preprocessTableRoots" (high)** —
  `TableAdaptationProcessor.preprocessTableRoots` deleted in favor of the shared
  `kernel/cfi` `preprocessBlockRoots`, with a range-CFI round-trip test.
- **"AudioContentPipeline god class" (high)** and **"Citation markers dropped on the primary
  analysis path" (high)** — pipeline split per the module map; `{sentences, citationMarkers}`
  travel together; the `ctx.readerUI.setCurrentSection` UI write moves to the host.
- **"Lexicon assembly cache never populated" (recalibrated medium)** — CompiledLexicon value
  object keyed by (bookId, language, store version), invalidated by subscription; Bible
  rules become lazy-loaded JSON behind `SystemLexiconProvider`; one
  `resolveBiblePreference()` replaces the store→singleton push.
- **"Dead features on the hot path (SyncEngine no-op highlight)"** — SyncEngine deleted
  (word-boundary noise across the Comlink channel removed) unless real highlighting is
  scheduled; the decision is recorded either way.

### Theme 6 — Reader domain

- **"ReaderView.tsx 1408-line god component" (critical)** and **"useEpubReader 1006-line god
  hook" (high)** — decomposed per the module map; ReaderShell <200 lines; lifecycle,
  theming, selection bridge, and the Chinese content processor extracted.
- **"Rendition/Book leak across app; store holds rendition closures" (high)** and
  **"epubjs boundary: ~90 untyped call sites" (high)** — `ReaderEngine` facade; EpubJsEngine
  is the only epubjs importer (R10); local `epubjs.d.ts` stub deleted in favor of upstream
  types + a minimal augmentation inside the engine (**"Local epubjs.d.ts stub shadows better
  upstream types"**). Acceptance test of the boundary: swapping to foliate-js would be a
  one-module change.
- **"Homegrown CFI string algebra guards all user data" (recalibrated medium-high)** —
  `kernel/cfi` rebuilds canonical paths on parsed EpubCFI components; string fast paths
  survive only behind property-based equivalence tests (the existing fuzz infrastructure);
  locale-aware segmenter threaded (also pays i18n's **"CFI sentence-snapping hardcodes the
  'en' segmenter"**).
- **"Six overlay systems, conflicting styles, orphan-sweep scar tissue" (high)** —
  HighlightLayerManager + one style registry + MeasuredOverlay primitive; tts-ui's
  **"orphan-highlight DOM sweep copy-pasted 3x"** lands here as the single TtsHighlighter.
- **"Reading-history writes race and double-record" (high)** — ReadingSessionRecorder with
  serialized per-book writes and one `recordSession` helper.
- **"Unconditional flow()+display() on every settings change"**, **"Locations generation
  uncancellable"**, **"Offscreen renderer duplicates security plumbing"** — split effects;
  cancellation token + ingest-time locations; shared `epubSecurity.ts` used by live and
  offscreen paths (keeper: sanitize-at-serialize XSS boundary preserved verbatim).
- **"Sanitizer no-op directives; sandbox patch neutralizes iframe sandbox" (medium)** and
  privacy's **"EPUB content can phone home" (high)** — sanitizer config rewritten to
  express real intent; remote resource URLs rewritten to blocked placeholders at sanitize
  time; tracking-pixel EPUB regression fixture; img-src tightened.

### Theme 7 — Library, search, Chinese

- **"Batch import bypasses duplicate/ghost detection and silently drops failures"
  (critical)** — single ImportOrchestrator pipeline; batch = N jobs; per-file
  success/duplicate/failure surfaced in ImportProgressUI.
- **"Extraction pipeline triplicated" (high)**, **"useLibraryStore.addBook ~300-line god
  action" (high)**, **"ReprocessingInterstitial overlapping reprocess runs" (high)** — one
  `extractBook(file, depth, signal)`; reprocess routed through the job queue; in-flight
  guard by bookId; cancellable-task-runner (keeper) wired through.
- **"BookExtractionData user-domain outputs are dead code… drop perceptualPalette and
  language" (high)** — registration consumes the extractor's inventory output; one-time
  backfill of palette/language into Yjs from local manifests.
- **"Two competing book identities (filename vs UUID)" (high)** and **"fileHash is a
  filename-embedding djb2 fingerprint"** — real SHA-256 contentHash; `bookId` FK on
  ReadingListEntry resolved once at import/CSV-link time; entity-resolution demoted to a
  one-time linker.
- **"Worker-side XML parsing path is dead" (high)** and **"Result navigation cannot target a
  specific match" (high)** — SearchEngine sheds the dead negotiation; per-occurrence offsets
  → CFIs; navigation by CFI with a temporary highlight; `scrollToText` + 500ms timer
  deleted. **"Module-level singleton with split-brain lifecycle"** — reader-session-scoped
  SearchSession with injected worker factory. **"Index rebuilt every session"** —
  `data/repos/searchText` persistence.
- **"Pinyin misalignment for astral-plane characters" (high)**, **"Pinyin/traditional engine
  welded inside useEpubReader" (high)**, **"Vocab-triage UI embedded in CompassPill"
  (high)**, **"14MB dictionary in git / ~80MB heap / not offline" (high)** — the
  `domains/chinese` module per the map: code-point-safe PinyinGeometryEngine, positions
  keyed by section and invalidated on reader events (fixes the recalibrated
  overlay-lifecycle debt structurally), IDB-backed DictionaryService with SW caching and a
  CI-built dictionary (out of git, fail-hard compile, provenance stamped),
  simplified-canonical vocabulary keys with a one-time Yjs merge migration.

### Theme 8 — Google, GenAI, network boundary

- **"No per-service token isolation in auth strategies" (critical)** and **"Interactive
  popup is the only token refresh" (critical)** — GoogleAuthClient per-service token map
  with expiry/scope validation; `connect()` vs silent `getToken()` throwing typed
  `AuthRequiredError`; auto-disconnect only on definitive revocation; loginHint injected
  (severs the auth→useSyncStore import and the duplicate auth path in
  `lib/sync/auth-helper.ts`).
- **"Strategy pattern in name only" (high)** — one SocialLogin-backed class, platform
  options as constructor args.
- **"No validation of structured LLM output" (high)** and type-safety's **"GenAI responses
  parsed as T with zero runtime checks"** — per-feature zod schemas (Gemini responseSchema
  derived from them), input-membership checks, semantic clamps; the SmartLinkDialog
  validation pattern generalized.
- **"E2E mock seams baked into production code in three files" (high)** — GenAIClient
  interface, MockGenAIClient selected at the composition root; all three localStorage checks
  deleted.
- **"API key, full prompts, and base64 table images persisted to localStorage" (high)** —
  explicit partialize allowlist; logs redacted by default in an in-memory ring buffer
  (`kernel/flight-recorder` GENAI namespace); persist-version migration strips existing
  logs.
- **"Error taxonomy by message-substring matching" (high)** — `kernel/errors` AppError codes
  + instanceof branching at every boundary (replicating the `handleDbError` keeper pattern).
- **"No network gateway / egress policy" (critical)** and **"CSP is decorative" (high)** —
  `kernel/net` NetworkGateway + destination registry; R9 lint ban; CSP generated from the
  registry into nginx/vite/index.html meta (Capacitor covered); registry==CSP unit test.
  The dead CostEstimator/useCostStore is replaced by gateway byte counters or deleted.
- **"Background Gemini analyses auto-fire book content" (recalibrated medium)** — per-book
  AI consent bit in synced preferences enforced inside the gateway; transient "AI analysis
  active" indicator; deterministic zero-egress detection stays the default.
- **"GenAI config split across store and mutable singleton" (medium)** — config read
  per-call from an injected provider; `configure` removed from the EngineContext port; the
  hardcoded `gemini-1.5-flash` fallbacks deleted.

### Theme 9 — App shell, design system, accessibility, i18n

- **"GlobalSettingsDialog: 718-line god container" (high)** — `app/settings-registry.ts` of
  lazy self-contained panels (DiagnosticsTab is the model); `/settings/:tab?` route.
- **"CompassPill: 828-line seven-variant god component" (recalibrated high, two reports)** —
  dumb `ui/PillShell`; variants move to their domains (AudioPill/CompactAudioPill/
  SummaryPill → `domains/audio/ui`; annotation/sync/vocab pills → their domains);
  ReaderControlBar becomes a ~50-line variant router on the ReaderCommands context; the
  dead rendition prop chain and **"Ad-hoc cross-tree communication: window CustomEvent +
  callback in Zustand" (high)** are deleted together.
- **"Two overlapping global keyboard registries" (critical)** — `ui/KeyboardShortcutService`:
  one window listener + one rendition bridge, scoped declarative registration, dev-mode
  collision errors; raw keydown listeners lint-banned.
- **"No aria-live channel for TTS playback" (high)**, **"Focusable buttons inside
  aria-hidden overlay" (high)**, **"epub.js iframe has no screen-reader contract" (high)**,
  **"Zero automated a11y verification" (high)** — LiveAnnouncer in RootLayout wired to TTS
  transitions and the queued toast pipeline; ReaderOverlay decorative/interactive contract;
  iframe titled in epubSecurity; jsx-a11y lint + vitest-axe in the component harness +
  axe-core Playwright scans of five core surfaces.
- **"Hardcoded lang=en with zero language attribution" (high)** and the i18n gap's
  **"No UI-locale dimension exists" (high)** / **"Service layer authors user-facing English
  prose" (high)** — ADR: *i18n-ready, en-only*. `kernel/locale` owns getUILocale(),
  documentElement.lang, cached Intl formatters; the new choke points (toast queue,
  useConfirm, settings registry labels, `presentError(code, params)`) take typed message
  keys, never prose; TTS spoken filler resolved by book.language from the worker-safe
  catalog. Two-locale rule documented.
- **"Single-slot toast store drops messages" (medium)**, **"Native confirm()/alert()"
  (medium)**, **"Modal vs Dialog vs Sheet overlap"**, **"Back-nav tie-break"** — queue-based
  Toast above the router gate; `useConfirm()` + no-alert lint; Modal as the lone primitive;
  back-nav registry keeps its shape with (priority, seq) ordering.
- **"Three competing tab implementations"**, **"No focus management policy"**, **"Motion
  layer unowned"** — Radix Tabs mandated; Sheet-based sidebars; prefers-reduced-motion
  override + useReducedMotion(); dead `tailwind.config.js`/`App.css` deleted.

### Theme 10 — Type safety, errors, observability

- **"246 test files are never type-checked" (high)** — `tsconfig.test.json` +
  `tsconfig.e2e.json` in `tsc -b`, CI-gated.
- **"No error-handling conventions" (recalibrated medium)** and **"Error taxonomy vestigial"**
  — written conventions + lint (typed throws, Result for expected failures, no empty catch
  without a reason comment); one `presentError(code)` UI mapper; vendor errors mapped once
  per boundary.
- **"Observability balkanized: FlightRecorder covers only TTS" (medium)** and **"Logging:
  two APIs, 112 bypasses" (medium)** — namespaced kernel flight recorder mirrored from
  logger warn/error; crash handlers snapshot; one Export Diagnostics panel;
  GlobalLoggerService deleted; no-console lint.
- **"tsconfig/ESLint leave strongest guards off" (medium)** — staged flags
  (noUncheckedIndexedAccess first), recommendedTypeChecked, no-floating-promises, CI ratchet
  driving production `as any` (138) and eslint-disable (245) counts to ~0.
- **"Expando-property smuggling and untyped window globals" (medium)** — normal promise
  returns, WeakMaps for DOM state, one `versicle-globals.d.ts` augmentation for the
  VITE_E2E test API.

### Theme 11 — Build, platform, licensing, verification infrastructure

- **"Vitest config duplication — fix landed in the dead config" (critical)** and **"Two
  divergent vitest configs"** — `vitest.config.ts` (mergeConfig) is the single source with
  explicit `include: ['src/**/*.test.{ts,tsx}']`; the `test` block leaves vite.config.ts.
- **"Dockerfile.android broken: .dockerignore excludes android/" (critical)** —
  per-Dockerfile ignore files + a scheduled CI build of the image.
- **"Non-reproducible CI installs and Node-version drift" (high)** — `npm ci` everywhere,
  overrides instead of --legacy-peer-deps, engines + .nvmrc.
- **"Persistence backbone rides on three personal-fork git deps" (high)** — npm-workspace
  vendoring with history, yjs/zustand as peers, single-yjs CI assertion — gated by the
  licensing workstream below.
- **"Offline caching is app-shell-only; SW update flow abrupt" (high)**, **"PWA manifest
  defined twice" (recalibrated medium)**, **"Boot hard-gates on SW; cover endpoint string
  5 copies" (high)** — Workbox runtime routes for fonts/dict/piper; prompt-style update
  toast; boot no longer gated on the controller; `data/sw-contract.ts` shared constants;
  dead static manifest deleted.
- **"No THIRD-PARTY-NOTICES; build strips license banners" (high)**, **"Modified PT Sans
  fonts violate OFL RFN" (high)**, **"GPL-3 espeak-ng blobs with zero provenance" (high)** —
  `third-party/inventory.json` source of truth → generated dist notices + in-app credits;
  CI license-allowlist gate landing *before* the fork/piper vendoring PRs; font family
  renamed with a persisted-preference migration; `public/piper/PROVENANCE.md`;
  `LICENSING.md` records the GPL-3.0-or-later floor.
- **"AGENTS.md and all runner docs describe a deleted pytest suite" (high)** — one canonical
  TESTING.md; AGENTS.md regenerated from it; DB-version constants imported by specs instead
  of hand-edited.
- **"CI gates don't enforce the contract" (high)**, **"Sleep-based synchronization" (high)**,
  **"E2E suite verifies a different app than users run" (high)** — see Test strategy.

---

## What gets deleted, merged, or rewritten

### Deleted outright (knip-verified, with their tests)

- `src/components/audio/` (AudioReaderHUD, SatelliteFAB) — dead directory with a maintained
  test; the auto-pause-in-library decision is recorded and, if wanted, reimplemented as a
  store policy.
- `src/hooks/use-local-storage.ts` + its 7 test files; `src/hooks/useBookProgress.ts`
  (dead duplicate of the live store hook).
- Dead barrels: `src/store/index.ts`, `src/db/index.ts`, comment-only
  `components/reader/index.ts`, `components/library/index.ts`; the `useBookStore` re-export
  alias at `useLibraryStore.ts:798`.
- `src/lib/tts/SyncEngine.ts` + onMeta/onBoundary plumbing and per-word Comlink forwarding
  (no-op consumer); `useTTSStore.syncState`; dead lexiconHash machinery on the audio cache
  key; dead ITTSProvider members; CostEstimator/useCostStore (superseded by gateway
  counters); `usageStats`/`footnoteMatches`/GenAI fake delay.
- `src/lib/sync/validators.ts` (+ fuzz tests) and `src/db/validators.ts` — replaced by
  `data/rows/` zod schemas. `lib/sync/android-backup.ts` dead cluster, IDLE/dangling
  machinery, `isBlocked`, `resetDeviceId`.
- `src/types/epubjs.d.ts` local stub (upstream types + minimal augmentation in
  `domains/reader/engine/`).
- The worker-XML-parsing negotiation in search (`supportsXmlParsing`, xml field, worker
  parse branch); `scrollToText` + the 500ms navigation timer.
- `scripts/patch_piper_worker.js` + the prepare-piper postinstall mutation (vendored patched
  worker checked in instead); `tailwind.config.js`, `App.css` contents,
  `public/manifest.webmanifest`, repo-root stray test files and debug artifacts (~28MB
  binaries), duplicate alice.epub.
- All inline mock seams in production: `__VERSICLE_MOCK_FIRESTORE__` branches,
  `localStorage.getItem('mockGenAIResponse')` checks, MockFireProvider static import,
  MockDriveService from the prod tree.
- `GlobalLoggerService`; ~115 raw console call sites (codemod to createLogger).
- Per-bug test sprawl: ~136 of 246 vitest files fold into behavioral suites (distinct
  assertions preserved as `describe('regression: …')` blocks) — including the 15
  AudioPlayerService suites, 12 engine per-bug files, 8 search files → 2, 7
  use-local-storage files → 0, 5 library race files → 1 invariant suite.

### Merged (duplications collapsed to one implementation)

- Progress resolution + session merge (4 copies → `kernel/progress/resolve.ts`).
- CFI containment/prefix logic (3 divergent separator sets → `kernel/cfi`); citation-removal
  mechanisms (DOM suppression wins; Sanitizer regexes dropped after the integration test
  verifies parity).
- Yjs snapshot capture/restore (3 mechanisms → YjsSnapshotService).
- Extraction pipeline (extractBookData/extractBookMetadata/reprocessBook → one
  `extractBook(file, depth, signal)`); import UX (2 implementations → useImportController).
- Export utilities (3 → `exportFile()`); reading-list CSV exporters (2 → 1).
- Relative-time/byte-size/plural formatting (3-5 copies → `kernel/locale/format.ts`).
- Default abbreviation list, SUPPORTED_TTS_LANGUAGES, Theme type (5 files), provider id
  unions (3 definitions), MODELS constant, cover-route string (5 copies), DeviceIcon,
  composite contentAnalysis key parsing (4 files) — each to one exported source.
- GoogleAuth web/Android strategy classes → one class; auth-helper's parallel sign-in path →
  `connect('identity')`.
- Lexicon rule-edit form (2 copies → RuleEditorForm); LexiconManager mounts (3 → 1
  store-driven instance).
- Vitest configs (2 → 1); CSP definitions (5 → generated-from-registry); nginx header
  blocks → single include.

### Rewritten (behavior-preserving reimplementation against pinned tests)

- `AudioPlayerService` → audio engine decomposition (parity scenarios pin behavior first).
- `useLibraryStore` workflows → ImportOrchestrator/LibraryService (race tests ported first).
- `FirestoreSyncManager` → sync core decomposition (emulator contract suite pins behavior).
- `ReaderView.tsx`/`useEpubReader.ts` → reader module (E2E journeys + new unit tests).
- `firestore.rules` (+ new storage.rules) — rewritten, emulator-tested.
- zustand-middleware-yjs inbound/outbound paths (fork surgery, pinned by
  `replication.test.ts`-style middleware contract tests + two-client e2e).
- `selectors.ts` view model → derived store with typed LibraryBook.
- Backup `processManifest` → YjsSnapshotService adapter (v2 reader kept forever).
- `types/db.ts` → kernel/types + data/rows split (temporary re-export shim, then deleted).

### Explicitly preserved (the keeper list the refactor must not trash)

EngineContext three-port boundary + replicationSpec + parity harness + handwritten fakes;
per-device progress data model (`bookId→deviceId→UserProgress`); single Y.Doc/one map per
domain topology; the WebKit IDB-hang engineering (mirror + debounce + detached persistence +
transactionRunner injection); sanitize-at-serialize XSS boundary with CFIs computed
post-sanitization; geometry-overlay portal pattern; v18 static/user/cache domain split +
ghost books; offscreen-extraction fidelity strategy; Capacitor Smart Handoff gapless
playback; transactional Piper voice download; content-addressed TTS audio cache;
BaseCloudProvider getOrFetch pipeline; checkpoint-before-danger discipline + Inspect→Diff→
Confirm restore + DataRecoveryView; schema-quarantine concept; back-navigation registry;
shadcn primitive layer; TTSQueue follow-scroll; LexiconManager test-with-trace UX;
deterministic-detector shadow telemetry; prompt-minimization in detectContentTypes;
seeded fuzz infrastructure; hermetic Dockerized E2E runner; data-testid discipline;
`getYjsOptions()` centralization (extended into `defineSyncedStore`).

---

## Migration roadmap

Each phase ships green to `antigravity` (the default branch); the app is releasable after
every phase. Phases 1–2 are sequential prerequisites; 3–4 sequential; 5–8 are parallelizable
domain tracks once 4 lands; 9–10 close out. Every phase has CI test gates that must pass
plus phase-specific exit criteria.

### Phase 0 — Guardrails (1 PR series, no behavior change)

**Scope:** dependency-cruiser with the full R1–R10 ruleset in *warn* mode (violation counts
frozen as the ratchet baseline); eslint `consistent-type-imports` + `import/no-cycle`;
single vitest config (kills the worktree-exclusion bug); `tsconfig.test.json`/
`tsconfig.e2e.json` wired into `tsc -b` CI; worker-chunk content test (no zustand/yjs);
`npm ci` + .nvmrc/engines in all workflows and Dockerfiles; per-Dockerfile ignore files +
scheduled Dockerfile.android build; coverage baseline recorded; lint+typecheck CI job;
path aliases added (codemod imports); `third-party/inventory.json` + generated
THIRD-PARTY-NOTICES + CI license-allowlist gate; forks pinned to commit SHAs.
**Ships:** identical app, trustworthy CI.
**Exit criteria:** CI fails on new boundary violations beyond baseline, on type errors in
tests, on a worker chunk containing zustand/yjs, on UNKNOWN licenses. All existing suites
green under the unified config.

### Phase 1 — Critical correctness & security hotfixes (independent, cherry-pickable)

**Scope (each its own PR with a regression test):** `wipeAllData()` clearing both DBs +
yjs persistence (Clear All Data); rewritten firestore.rules + new storage.rules +
firebase.json with emulator rules tests; workspace-switch staged-swap + pinned migration
checkpoints + navigator.locks; backup restore dry-run validation + pre-restore checkpoint +
cover-blob v3 fix + boot repair; NFKD/CFI offset fix with extractionVersion stamp;
TaskSequencer routing of the fallback/dragnet bypasses + single-shot provider failure;
speed-policy fix (synthesize at 1.0, speed out of the cache key); meta-map schema version
checked synchronously before remote apply (with dual-write for v5 clients); popover key
out of the annotations map (v6 migration, pre-migration checkpoint via the existing
CheckpointService flow); SW no-cache headers for sw.js/manifest/index.html.
**Ships:** users stop being exposed to data loss, cross-tenant rule gaps, and corrupted
CFIs/backups — before any restructuring.
**Exit criteria:** emulator rules suite green; two-client quarantine e2e green; restore
round-trip test with binary covers green; non-ASCII extraction regression tests green;
engine parity suite green with the sequencer changes.

### Phase 2 — kernel/ and data/ (foundation modules)

**Scope:** create `kernel/` (types split with re-export shim at `types/db.ts`, AppError
taxonomy, logger consolidation, generalized flight recorder, `cfi/` canonicalization with
property tests, `progress/resolve.ts`, `locale/` formatters, `net/` gateway + destination
registry + generated CSP). Create `data/` per the map: connection/schema migration registry
(IDB v25), write-gate on navigator.locks, rows (zod), repos carved from DBService
section-by-section (deprecated `dbService` facade delegates until imports migrate),
YjsSnapshotService (Backup/Checkpoint/android become adapters), wipe.ts, sw-contract.ts.
y-idb fork gains `flush()/whenSynced`.
**Ships:** same behavior; storage and shared logic have one home; egress is gated.
**Exit criteria:** R1/R2/R9 flip to *error* in dependency-cruiser; zero raw `getDB()`/
`'readwrite'` outside data/; CFI fuzz equivalence suite green; ingest→read, session
coalescing, backup round-trip, quota-mapping behavioral seams locked by tests before the
carve-out; registry==CSP test green.

### Phase 3 — state/ (fork surgery + store discipline)

**Scope:** vendor the three forks as workspaces (licensing checklist applied);
zustand-middleware-yjs surgery: syncedKeys whitelist, merge-over-defaults hydration,
per-key scoped diffing, `whenHydrated()`; `defineSyncedStore` wrapper; store registry +
tiers; move useSyncStore/useSidebarStore/useCostStore under state/; useTTSStore split
(settings vs playback mirror, persist-name migration from `tts-storage` v3); credentials
store; toast queue store; delete the ~20 defensive fallbacks; v6 migration completion
(preferences fold-in, reading-list bookId backfill, vocabulary simplified-key merge,
palette/language inventory backfill) run by the new coordinator.
**Ships:** cross-device popover ghosts gone; new synced fields safe to add; page-turn write
amplification gone.
**Exit criteria:** middleware contract tests (hydration-merge, whitelist, per-key diff,
echo-loop) green; two-client v5↔v6 quarantine e2e green; replication parity tests green
against the split TTS stores; R3 flips to error for `state/`→`domains/`.

### Phase 4 — app/ composition root

**Scope:** bootstrap phase machine (absorbs App.tsx boot, the SW soft gate, migration
interceptor, device registration, drive auto-sync policy); container replaces all 17
singletons; `app/migrations.ts` static/awaited; adapters
(createZustandEngineContext/createWorkerEngineClient/replication wiring, SyncPorts/
DrivePorts/GooglePorts); TtsController absorbs the 18 getAudioPlayer calls;
repositories move from src/db/; routes (/, /notes, /read/:id, /settings/:tab?) with
React.lazy; test-api.ts (VITE_E2E) + debug-hooks.ts (DEV); MockBackend/MockGenAIClient
selected here only.
**Ships:** Notes/Settings URL-addressable; deterministic boot; mocks out of the prod bundle;
first bundle-size win.
**Exit criteria:** R7 (no module side effects) and the no-getState rule flip to error;
Playwright suite green using `window.__versicleTest` (flushPersistence/seedLibrary) instead
of sleeps; entry-chunk budget recorded in CI; boot-failure states render the existing
recovery surfaces.

### Phase 5 — domains/audio (largest domain track)

**Scope:** engine decomposition (PlaybackController/QueueModel/SessionStore port/
AnalysisApplier/MediaMetadataPublisher/DragnetGesture; cancellation-capable sequencer;
single PlaybackSnapshot stream; standalone TtsEngine interface; worker flight-recorder
export); pipeline split (SectionQueueBuilder/SegmentRefiner/detector strategy/TableAdapter/
LexiconEngine + SystemLexiconProvider with lazy Bible JSON); provider registry +
narrowed ITTSProvider + capabilities + dispose; PiperRuntime + vendored onnxruntime +
checked-in patched worker; raw-sentence persistence with playback-only refinement behind
extractionVersion. Parity scenario suite expanded to restore/masks/adaptations/navigation/
dragnet/fallback before each rewrite lands; per-bug suites deleted as they're absorbed.
**Ships:** identical playback UX with cancellation correctness, true offline Piper, working
production diagnostics export.
**Exit criteria:** expanded parity suite green on both transports; cross-provider contract
suite green; vi.mock banned inside domains/audio (fakes only); audio test file count down
per the consolidation map; bundle: Bible lexicon + piper out of the entry chunk.

### Phase 6 — domains/reader + library + search + chinese

**Scope:** ReaderEngine facade (EpubJsEngine sole epubjs importer; stub deleted);
overlays/HighlightLayerManager + MeasuredOverlay; ReadingSessionRecorder; ReaderShell
decomposition with ReaderCommands context (CustomEvent + callbacks-in-store deleted);
extraction/ consolidation (shared epubSecurity, ingest-time locations);
ImportOrchestrator/LibraryService + useImportController + SHA-256 identity + bookId FK;
derived libraryViewStore (selectors rewrite); SearchSession + searchText repo + CFI
navigation; chinese module extraction (engine/dictionary/vocabulary/ui) with the
ContentProcessor registration slot; dictionary out of git (CI build).
**Ships:** reader/library UX unchanged; import surfaces unified with per-file results;
search results land on the exact match; pinyin correct for astral-plane text.
**Exit criteria:** R4/R5/R10 flip to error (epubjs imports = 1 module; ui/ imports kernel
only); reader E2E journeys green incl. hostile-EPUB fixture; LibraryService concurrency
invariants green; jsdom-fixture unit tests for the chinese engine; ReaderView <200 lines.

### Phase 7 — domains/sync + google

**Scope:** SyncBackend interface + Firestore/Mock implementations; orchestrator/auth/
connection/workspace decomposition with the SyncEvent bus; deleteWorkspace purge +
scoped teardown; GoogleAuthClient consolidation; DriveClient/DriveLibrarySync (concurrency
pool, Changes API); GenAIClient + per-feature zod modules; GenAI log redaction + persist
migration; emulator contract suite as the fork acceptance gate; per-book AI consent bit +
egress indicator.
**Ships:** sync resilient to workspace operations; silent token refresh; validated LLM
output; auditable egress.
**Exit criteria:** Firebase-emulator contract suite green (rules + provider + workspace
flows); Playwright sync journeys green on MockBackend; nightly emulator sync journey green;
zero message-substring error branching (lint rule).

### Phase 8 — UI shell, design system, accessibility, i18n readiness

**Scope:** settings registry + lazy panels; CompassPill dissolution into PillShell +
domain pills; queue Toast above the router gate; useConfirm codemod (no-alert);
KeyboardShortcutService + LiveAnnouncer + lang attribution + reduced-motion policy;
message-catalog choke points (presentError, toast, confirm, settings labels) per the
i18n-ready ADR; jsx-a11y + vitest-axe + axe Playwright scans; font rename (OFL fix) with
persisted-preference migration.
**Ships:** consistent overlay/confirm/toast behavior; keyboard conflicts gone; AT can follow
playback; a11y regressions blocked by CI.
**Exit criteria:** axe scans of five core surfaces pass at serious/critical; shortcut
collision test green; zero native alert/confirm; no-literal-string lint enabled for
migrated directories.

### Phase 9 — Performance & PWA polish

**Scope:** Workbox runtime caching (fonts/dict/piper) + prompt-style SW updates; vendor
manualChunks + CI bundle budgets on the ANALYZE tooling; firebase dynamic import behind
sync enablement; audio-cache LRU eviction job + storage.persist(); replication delta
broadcasting verified (queue identity); locations at ingestion.
**Ships:** smaller first paint, genuinely offline app, bounded storage.
**Exit criteria:** bundle budget gates green; offline E2E journey (airplane-mode service
worker run) green; storage eviction integration test green.

### Phase 10 — Ratchet to zero & lockdown

**Scope:** delete all temporary re-export shims and the deprecated dbService facade; flip
every dependency-cruiser rule to error with baseline=0; finish test consolidation
(246→~110 vitest files, ~40 Playwright journeys, ~10 screenshot goldens); coverage ratchet
locked; as-any/eslint-disable ratchet to ~0 in production code; regenerate architecture.md,
AGENTS.md (from TESTING.md), per-module READMEs from the registry; delete stale docs
(PORTING-TO-WORKER.md framing, pytest references).
**Ships:** the end state, enforced.
**Exit criteria:** zero boundary violations; zero shims; docs CI check (README freshness
hooks); knip clean.

---

## Risk register

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | **User-data migration breaks existing libraries** (v6 CRDT migration, IDB v25, tts-storage split, backup v3, font-preference rename). | Medium / catastrophic | Every data-touching phase: automatic pre-migration checkpoint via the existing CheckpointService flow (keeper); migrations atomic with version bump in one transaction, loud-fail into the existing safe-mode/recovery surfaces (ObsoleteLockView, DataRecoveryView, CriticalMigrationFailureView); v5 quarantine guaranteed by dual-writing `library.__schemaVersion`; two-client upgrade e2e (v5 doc snapshot vs v6 client) required before each schema phase ships; v2 backup reader kept forever; IDB legacy stores snapshotted before deletion. |
| 2 | **Fork surgery regresses the CRDT bridge** (hydration-merge, syncedKeys, per-key diff change replication semantics). | Medium / high | Vendored forks get their own contract suites before surgery (hydration, echo-loop, whitelist, diff scoping); replication.test.ts + engine parity suites must stay green; y-cinder's existing 46-file emulator suite becomes a CI acceptance gate; surgery behind option flags defaulting to old behavior for one release where feasible. |
| 3 | **Engine/worker topology regression during AudioPlayerService decomposition** (the 197-commit churn file). | High / high | Expand parity scenarios to cover restore/masks/adaptations/navigation/dragnet/fallback *before* each extraction; decompose behind the existing TtsEngine handle so UI contracts don't move; worker chunk-content test prevents bundle poisoning; in-process path retained for tests only, with parity asserting equivalence. |
| 4 | **Rules rewrite locks users out of their own Firestore data** (BYO-Firebase, users must redeploy rules). | Medium / high | Emulator rules suite covers old-data shapes; rules are backward-accepting (tombstone enforcement added without narrowing legitimate writes); in-app sync settings detect permission-denied and surface a "redeploy rules" guide; release notes + version-gated prompt. |
| 5 | **Long refactor drifts / stalls half-done** (the codebase's own history shows abandoned half-splits). | High / medium | Phase exit criteria flip lint rules to *error* — a phase isn't done until its boundary is mechanically enforced; ratchet counters (violations, as-any, vi.mock-in-engine) prevent silent backsliding; every phase leaves the default branch releasable; temporary shims have deletion deadlines tied to Phase 10. |
| 6 | **Test consolidation deletes a load-bearing regression assertion.** | Medium / medium | Rule: consolidation PRs may only *move* assertions (regression-tagged describes), never drop them; coverage baseline from Phase 0 must not decrease; per-bug files deleted only in the same PR that lands the absorbing suite. |
| 7 | **epub.js remains unmaintained; facade hides but doesn't remove the dependency.** | Certain / medium | The ReaderEngine boundary is designed so a foliate-js spike is a one-module change (explicit acceptance test); pinned fork + sanitize-at-serialize keeps the security posture; no new epubjs-internal usage can appear (R10). |
| 8 | **WebKit/IDB regressions from the navigator.locks write gate** (the hang workaround is evidence-driven and subtle). | Medium / high | Write gate introduced behind the existing `runExclusiveIdbWrite` signature first (drop-in), validated against the TTS chapter-navigation flake suite and `verification/_idb_probe.js` on real WebKit in the Docker matrix before bypassing writers migrate; detached-persistence behavior preserved verbatim behind the repo. |
| 9 | **Sequencer cancellation changes playback timing on Android/native** (Smart Handoff, background keep-alive). | Medium / medium | Capacitor provider behavioral suite (keeper) + parity scenarios pin gapless-handoff semantics; flight recorder (now exportable in production) used for field diagnosis; staged rollout via the Android workflow. |
| 10 | **Bundle/code-splitting breaks boot ordering** (lazy chunks historically booted everything via store side effects). | Low after Phase 4 / medium | Code splitting is explicitly sequenced *after* the side-effect ban (R7) flips to error; boot phase machine makes ordering observable; offline E2E + SW update journey gate Phase 9. |
| 11 | **Licensing/provenance violations crystallize during vendoring** (forks, piper blobs, fonts). | Medium / legal | Phase 0 lands the inventory + CI allowlist gate *before* any vendoring PR; vendoring checklist (LICENSE verbatim, fork headers, PROVENANCE.md); font rename is the only user-visible change and carries its preference migration. |
| 12 | **AI-agent execution quality** (the plan will largely be executed by agents; the debt being paid was agent-generated). | High / medium | Boundaries are *mechanical*, not conventions — agents cannot merge violations; AGENTS.md/TESTING.md regenerated to describe reality; small-PR phase decomposition with named exit criteria; parity/contract suites as the agents' oracle. |

---

## Test strategy for the end state

Six-tier pyramid (per testing-verification), with the boundary architecture making each
tier cheap:

1. **Pure-logic units** (vitest, node env): one suite per module + `.fuzz` companions on the
   seeded infrastructure (kernel/cfi equivalence, segmenter, lexicon trie, progress
   resolution, palette math); benchmarks as `*.bench.ts` outside the gate.
2. **Contract/parity suites for every dual implementation** — the
   `describeXContract(makeHarness)` pattern generalized from `engineParityScenarios.ts`:
   TtsEngine worker vs in-process (expanded), ITTSProvider across all five providers,
   SyncBackend Firestore-emulator vs Mock, data repos over real IDB vs fake-indexeddb,
   middleware bridge hydration/diff semantics. These suites are the spine: a behavior is
   "supported" iff a scenario pins it on both sides.
3. **Service/integration tests** with real stores + real Y.Doc + typed harness doubles from
   `src/test/harness/` (typed factories replacing the 712 hand-rolled vi.mock blocks;
   inline mocks of data repos and stores lint-banned). LibraryService/ProgressService/
   SyncOrchestrator invariants (ported race tests) live here.
4. **Component tests** only where real logic renders, via one `renderWithStores()` helper
   with real ephemeral stores; vitest-axe smoke included in the shared harness; presenters
   (the TTSSettingsTab model) tested props-in/callbacks-out with no mocks.
5. **~40 Playwright journeys** through the single `window.__versicleTest` build-flag-gated
   API (flushPersistence awaiting the real debounce queues, resetApp, seedLibrary) — no
   sleeps; sanitization ON with a hostile-EPUB journey; desktop matrix on PR;
   mobile + webkit + Firestore-emulator sync journey nightly; offline/SW-update journey;
   axe scans of the five core surfaces failing on serious/critical.
6. **~10 toHaveScreenshot goldens** (library, reader themes, settings, audio deck); all
   other captures failure-only.

**Enforcement that keeps it true:** lint/typecheck/dependency-cruiser + sharded vitest +
Playwright desktop on every PR with `npm ci` and CI=1; coverage ratchet (never below
baseline, directed at data/ + state/ + domains/sync first); worker-chunk content assertion;
registry==CSP test; license gate; bundle budgets; new-test-path convention check (co-located
`Foo.test.tsx` only). One canonical TESTING.md from which AGENTS.md is generated, so the
agents that maintain this codebase are pointed at the real harness — closing the loop that
created most of this debt in the first place.
