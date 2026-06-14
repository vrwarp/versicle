# Versicle Overhaul — Strangler-Fig Incremental Sequence

Lens: **safety of the journey**. The app must be shippable after every step; every phase ends with the
full verification suite green and a usable app for existing libraries. Characterization tests land
*before* the subsystem they protect is touched; each strangler completes by **deleting** its legacy code,
never by leaving two live paths. Where an analyst verdict was *overstated*, this plan adopts the corrected
severity (noted inline) — we still fix it, but we don't let it distort sequencing.

Sources: 21 verified analysis reports in `plan/overhaul/analysis/` (all file:line references below are
theirs, re-checked against the working tree at `3b0cfcff`).

---

## Target architecture

### Layer stack (strict, lint-enforced)

```
entries ──────────────────────────────────────────────────────────────────────
  main.tsx ─► src/app/bootstrap.ts (the ONLY place with module-order side effects)
  src/workers/{tts,search}.worker.ts ─► L1 only (runtime closure asserted in CI)
  src/sw.ts ─► L1 + shared constants from src/data (coverUrl, store names)

L6  components/ + layouts/ + features/*          (reader, library, audio, chinese,
    │   never import src/data directly            search, sync-ui, settings panels)
L5  hooks/
    │
L4  src/app/        bootstrap • boot phases • migrations • controllers
    │               (TtsController, SyncOrchestrator, LibraryService/ImportOrchestrator,
    │                DriveLibrarySync) • repositories (BookRepository,
    │                ContentAnalysisRepository) • host adapters
    │                (createZustandEngineContext, createWorkerEngineClient,
    │                replicationSpec) • installTestApi/debug-hooks
L3  store/          registry.ts declares every store: synced | local-persisted | ephemeral
    │               stores = state + pure actions; zero engine/manager imports
L2  src/data/       connection • schema + versioned migration registry • write-gate
    │               (navigator.locks) • rows/ (zod) • repos/ (bookContent, playbackCache,
    │               audioCache, diagnostics, checkpoints, searchText) • snapshot/
    │               (YjsSnapshotService) • wipe.ts
L1  lib/            pure logic & engines behind ports: tts/ (engine core, EngineContext/
    │               PlaybackBackend/AudioSink ports, providers + registry), cfi/ (canonical
    │               CFI kernel), reader-engine/ (sole epubjs importer), sync/core
    │               (SyncBackend port), net/ (NetworkGateway + destination registry),
    │               genai/ (GenAIClient port), google/ (GoogleAuthClient), locale/,
    │               progress/resolve.ts, logger, crypto, utils
L0  types/          imports NOTHING (types/tts.ts, types/book.ts, types/user-data.ts,
                    types/sync.ts, types/flight-recorder.ts, types/errors.ts)
```

### Boundary rules (dependency-cruiser + ESLint, CI-blocking by Phase 9)

1. `types/` imports nothing (kills the `types/db.ts:2,11 → lib/tts` inversion and ~50 of 65 madge cycles).
2. `getState()` outside `store/` + `app/` is forbidden (today: 97 sites in `lib/`, 160 repo-wide).
3. Worker runtime closure excludes `zustand`/`yjs`/`store/**` — asserted by a build-time chunk-content
   test, plus `@typescript-eslint/consistent-type-imports` + `import/no-cycle`.
4. All IndexedDB access via `src/data/` repos; `'readwrite'` transactions and `idb` imports banned
   outside `src/data/` (the write-gate API takes a synchronous callback, structurally banning
   intra-transaction awaits — preserves the WebKit-hang discipline of `DBService.ts:58-63`).
5. All network egress via `lib/net/NetworkGateway.egress(destinationId, req)`; raw `fetch`/XHR banned
   outside `lib/net/`; CSP generated from the destination registry and unit-tested against it.
6. `components/ui/` imports only `lib/utils` + Radix (kills the CompassPill 5-store inversion).
7. Only `lib/reader-engine/` imports `epubjs`; only `lib/tts/providers/` touches synthesis SDKs;
   only `app/` constructs singletons. No module-level side effects outside `app/bootstrap.ts`.
8. One canonical import path per module; path aliases `@types/@lib/@data/@store/@app/@components`.
9. Mock/test seams (MockFireProvider, MockGenAIClient, `window.__versicleTest`) selected only at the
   composition root behind `import.meta.env.DEV || VITE_E2E` — never reachable from a prod import graph.

### Seam interface catalog (the strangler seams, in the order they are carved)

| Seam | Interface | Replaces |
|---|---|---|
| State bridge | `defineSyncedStore({name, schema, syncedKeys, defaults})` + `whenHydrated()` on the forked middleware | `getYjsOptions()` ad-hoc wiring, `App.tsx:269-273` poll loop |
| Storage | `src/data/` repos + `write(stores, syncCb)` write-gate + `YjsSnapshotService.capture/validate/apply` | raw `getDB()` in 7 modules, 3 snapshot mechanisms, per-callsite locks |
| Sync transport | `SyncBackend` (Firestore \| Mock) + typed `SyncEvent` bus + `downloadWorkspaceState(path)` | 8 inline `__VERSICLE_MOCK_FIRESTORE__` branches, toast imports in the manager |
| TTS engine | standalone `TtsEngine` interface; commands-as-acks; one monotonic immutable `PlaybackSnapshot` stream | `useTTSStore` command facade + dual notification paths |
| TTS providers | `ProviderDescriptor` registry `{id, kind, capabilities, locality, build(ctx)}` | 6 hand-maintained registration sites, `as any` capability pokes |
| Reader | `ReaderEngine` facade (display/relocate/resolve/highlight-layer API) + `HighlightLayerManager` + `ReaderCommands` context | `(rendition as any)` in 8+ files, `window` CustomEvent, callbacks-in-store |
| CFI | `lib/cfi/` canonical algebra on parsed `EpubCFI`, fast paths gated by property-based equivalence tests | 3 divergent separator sets, homegrown string algebra at `cfi-utils.ts:188-230` |
| Import | `ImportOrchestrator` job queue: validate → identify (SHA-256) → policy → `extractBook(file, depth, signal)` → persist → register | `useLibraryStore.addBook` 300-line saga, triplicated extraction |
| Google/GenAI | `GoogleAuthClient` (per-service token map; `connect()` vs silent `getToken()`), `GenAIClient` (zod-validated per feature) | strategy-pattern-in-name-only, message-substring error taxonomy |
| Egress | `lib/net/destinations.ts` registry + `NetworkGateway` | 11 scattered fetch sites, decorative CSP |
| Errors | `AppError` base (code union, `cause`, `toJSON`) mapped once per boundary (the `handleDbError` pattern, `DBService.ts:27-45`) + `presentError(code, params)` | substring matching (`App.tsx:234`, `GenAIService.ts:118`) |

Keepers explicitly built upon (not replaced): the EngineContext/PlaybackBackend/AudioSink ports,
`replicationSpec.ts` + parity scenarios, the three-domain IDB taxonomy, per-device progress modeling
(`bookId → deviceId → UserProgress`), the WebKit IDB-hang engineering, sanitize-at-serialize XSS
boundary, geometry-overlay portals, checkpoint-before-danger discipline, `handleDbError`,
`useBackNavigationStore`, the hermetic Dockerized E2E runner, seeded fuzz infra, GPL-3.0-or-later.

---

## How each confirmed debt is paid off

Grouped by theme. Debt titles are the analysts'; the phase that retires each is in brackets.
Overstated findings are paid off at their corrected severity.

### A. Data integrity & migration safety

- **"'Clear All Data' leaves all user data behind"** — `wipe.ts: wipeAllData()` closes + deletes both
  DBs (`EpubLibraryDB`, `versicle-yjs`) + `yjsPersistence.clearData()` + localStorage/caches; both reset
  entry points (`GlobalSettingsDialog.tsx:246-254` and recovery) call it; post-wipe boot E2E. [Phase 0]
- **"Backup restore wipes local data before validating replacement"** + **"Backup restore corrupts cover
  images"** — zod-validate manifest, dry-run `Y.applyUpdate` on a scratch doc, automatic pre-restore
  checkpoint, all *before* any destructive step; manifest v3 strips/base64s binary fields with a
  sanitizing v2 reader kept forever; one-time boot repair nulls `{}` coverBlobs. [Phase 0 hotfix; full
  `YjsSnapshotService` in Phase 3]
- **"Ephemeral popover state synced through CRDT"** — popover moves to `useReaderUIStore` (contained
  hotfix); the `annotations.popover` Y.Map key is deleted in the v6 migration. [Phase 0 + Phase 2]
- **"Inbound hydration deletes state keys absent from the Y.Map"** — fork surgery: merge-over-declared-
  defaults hydration; then the ~20 defensive `|| {}` fallbacks (`useBookStore.ts:58,71,79` etc.) are
  deleted, restoring honest types. This is the single highest-leverage fix in the plan: until it lands,
  *no* phase can safely add a field to a synced store. [Phase 2]
- **"Migration runner is temporally fragile and fails silently"** + **"Schema migration runner races its
  own version bumps"** — `app/migrations.ts` coordinator: static imports, runs once after
  `whenHydrated()`, sequential `await`, version bump atomic with the transform in one `yDoc.transact`,
  failures surface to safe mode; the nested-`queueMicrotask` hack and its spy test die. [Phase 2]
- **"Schema quarantine only guards the 'library' map"** + **"Obsolete-client quarantine covers 1 of ~10
  maps and never disconnects"** — schema version moves to a dedicated `meta` Y.Map checked synchronously
  in the sync layer *before* applying remote updates; on obsolete, the provider is actually destroyed and
  the heartbeat stopped; dual-write `library.__schemaVersion` for one release so v5 clients still
  quarantine. [Phase 2 meta map; Phase 4 enforcement]
- **"WebKit-deadlock write lock is per-context and per-callsite"** — `src/data/write-gate.ts` on
  `navigator.locks` (spans tabs + workers), drop-in behind the existing `runExclusiveIdbWrite`
  signature first, then bypassing writers migrated callsite-by-callsite. [Phase 3]
- **"Workspace switch has a data-loss window"** — immediate: pin migration checkpoints against pruning
  (`protected` flag, no DB bump needed) and keep migration state until restore succeeds; full fix:
  staged-swap protocol (download → staging IDB → verify → atomic swap → reload) under
  `navigator.locks`. [Phase 0 partial; Phase 4]

### B. Sync & cloud security

- **"firestore.rules catch-all neuters tombstone protection; rule syntax invalid"** — rewritten
  non-overlapping rules with correct syntax, covering updates/history/maintenance/metadata, validated by
  a Firebase-emulator rules suite. Tightening is safe: rules were effectively allow-all for owners. [Phase 0]
- **"No Cloud Storage rules/deploy story; deleteWorkspace leaves data behind"** — `storage.rules` +
  `firebase.json` + documented deploy; `deleteWorkspace` purges history/maintenance/metadata + Storage
  snapshots; a one-time "purge deleted workspaces" maintenance action for past deletions. [Phase 0 rules;
  Phase 4 purge]
- **"deleteWorkspace kills the whole manager"** — conditional sever scoped to the deleted path, via the
  `WorkspaceService` extraction. [Phase 4]
- **"FirestoreSyncManager is a 993-line god object"** — decomposed into `AuthSession` /
  `WorkspaceService` / `ProviderConnection` / `SyncOrchestrator` over the `SyncBackend` seam, with one
  shared `downloadWorkspaceState(path)`; the manager survives as a thin façade until call sites migrate,
  then is deleted. [Phase 4]
- **"Mock test mode interleaved through production"** — `SyncBackend` injection at the composition root;
  `MockFireProvider` leaves the prod import graph (it currently ships in the user bundle,
  `FirestoreSyncManager.ts:31`). [Phase 4]
- *(overstated → medium)* **"Forked sync stack pinned to moving branch refs"** — branch refs → commit
  SHAs immediately (lockfile already pins; this stops silent drift on refresh); the emulator contract
  suite becomes the forks' acceptance gate; forks vendored as npm workspaces later, gated by the
  licensing checklist. [Phase 0 pin; Phase 4 vendor]

### C. TTS correctness, engine & content

- **"Speed applied at both synthesis and playback"** — synthesize at 1.0 always; rate applied at the
  sink after src load; speed removed from request bodies and the cache key; non-1.0-speed test per
  provider. Small, standalone, user-audible — ships as a hotfix. [Phase 0]
- **"Cloud-failure fallback double-fires and races the task sequencer"** + **"Provider-event and gesture
  paths bypass the TaskSequencer"** — providers signal failure exactly once (reject only); fallback
  becomes a single sequenced engine task (stop → awaited swap → replay) with retry cap; dev-mode assert
  that status/queue mutation only happens inside a running task. [Phase 5b]
- **"No cancellation in TaskSequencer"** — epoch/AbortSignal cancellation + `ctx.checkStale()` +
  per-task watchdogs; the serialize-all-mutations concept is kept. [Phase 5b]
- **"AudioPlayerService god object (1242 lines)"** — decomposed behind the existing ports into
  `PlaybackController` (FSM + sequencer, sole status writer), immutable `QueueModel`, `SessionStore`
  port (owning the WebKit-detach policy), `AnalysisApplier`, `MediaMetadataPublisher`, `DragnetGesture`;
  APS becomes a façade, then is deleted. [Phase 5b]
- **"Two notification paths emit inconsistent snapshots"** — one immutable `PlaybackSnapshot` with a
  monotonic sequence number, emitted from exactly one place. [Phase 5b]
- **"Replication echo loop"** + **"useTTSStore god store with dual voice-settings representation"** —
  split into persisted `useTTSSettingsStore` (replicated as an explicit data-only `TTSSettingsData`)
  and ephemeral `useTTSPlaybackStore` (engine mirror, never replicated); queue broadcast only on
  identity change. [Phase 5b]
- **"Dual-transport contract unowned"** — `TtsEngine` as a standalone interface; the parity scenario
  suite (restore, masks, adaptations, navigation, dragnet, fallback) is expanded *first* as the
  characterization gate, absorbing then deleting the 12+ per-bug regression files; `vi.mock` banned in
  the engine directory in favor of the existing fakes. [Phase 5 entry gate]
- **"Flight recorder split-brained across threads"** — `snapshot/exportBuffer` exposed on
  `WorkerTtsEngine`; `DiagnosticsTab` reads via the engine handle. [Phase 5b]
- *(overstated → high)* **"applySkippedMask mutates queue in place"** — `PlaybackStateManager` becomes
  copy-on-write; a parity scenario asserts fresh queue identity on both transports. [Phase 5b]
- **"No provider registry"**, **"API key keystroke rebuilds provider"**, **"Piper not offline-capable"**,
  **"piper-utils module-global singleton"**, **"TTSProviderManager stale-provider leaks/no dispose"** —
  `ProviderDescriptor` registry as single source of truth (settings UI rendered from it); buffered key
  edits with explicit "test key"; voices.json cached stale-while-revalidate + offline enumeration;
  onnxruntime + patched Piper worker vendored in-repo (postinstall string-patching deleted — pays off
  **"prepare-piper: install-time string surgery"** too); `PiperRuntime` class with request-id protocol +
  LRU + dispose; manager disposes outgoing providers and injects one shared `AudioSink`. [Phase 5a]
- **"NFKD normalization after offset bookkeeping corrupts CFIs for non-ASCII books"** — fix-forward
  immediately (segment raw text, normalize only output segment text; composed-accent/ligature offset
  regression test), stamped with `extractionVersion`; affected books re-ingested in the background once
  the import queue exists. [Phase 0 fix-forward; Phase 7 backfill]
- **"Escaped template literal in preprocessTableRoots emits literal 'epubcfi(${range.parent})'"** —
  delete the broken copy, use `cfi-utils.preprocessBlockRoots`, add a range-CFI round-trip test. [Phase 0]
- **"AudioContentPipeline god class"** + **"Citation markers dropped on the primary analysis path"** —
  split into pure `SectionQueueBuilder` (no `ctx.readerUI` writes — returns `{queue, title}`),
  `ReferenceSectionDetector` strategy (deterministic | Gemini, telemetry as injected observer),
  `CfiGrouper`; `{sentences, citationMarkers}` always travel together with a test pinning marker hints
  on the loadSection path. [Phase 5c]
- *(overstated → medium)* **"Lexicon assembly cache never populated"** — `CompiledLexicon` value object
  keyed by (bookId, language, store version), invalidated by `useLexiconStore.subscribe`; Bible data
  becomes lazy-loaded JSON behind a `SystemLexiconProvider`. [Phase 5c]

### D. Boundaries, layering & boot

- **"Module-scope side effects: importing modules boots Yjs persistence, Google auth, window globals"**
  + **"App.tsx un-sequenced boot with implicit cross-effect ordering"** — `src/app/bootstrap.ts` with
  named, awaited phases (interceptMigration → openDB → awaitYjs → migrations → initSync →
  registerDevice → hydrate → background); `App.tsx` renders boot states only (≤100 lines); singletons
  constructed in bootstrap; all `window.*` debug hooks behind one `installTestApi()` gated by
  DEV/VITE_E2E. [Phase 1]
- **"types/db.ts god type hub imports upward into lib/tts"** — split by domain with a temporary
  re-export shim for the 59 importers; `TTSQueueItem`/`Timepoint` move to `types/tts.ts`, inverting the
  DB-schema-defined-by-engine-god-file dependency (also pays the persistence finding **"types/db.ts is a
  god module"**). [Phase 1]
- **"lib/ services reach into store/ (54 edges, 97 getState())"** — the EngineContext port pattern
  generalized: `SyncBackend`/`DrivePorts`/`GooglePorts` interfaces in `lib/`, store-backed adapters
  injected from `app/`; orchestration-level code (semantic-tree, DriveScannerService policy) moves to
  `app/` controllers. [Phases 1, 4, 7]
- **"db/ imports store/"** — `BookRepository`/`ContentAnalysisRepository` move to `app/repositories/`
  as read-model mergers (their worker-safety constraint is preserved verbatim). [Phase 1]
- *(overstated → high)* **"Store↔TTS-engine runtime cycle"** — host adapters + `mainThreadAudioPlayer`
  relocate to `app/`; the 18 `getAudioPlayer()` calls leave `useTTSStore` for an `app/TtsController`;
  `lib/tts` ends with zero store imports. [Phase 1 motion; Phase 5b completion]
- *(overstated → medium)* **"Worker import-safety guarded only by un-linted import-type discipline"** —
  `consistent-type-imports` + `import/no-cycle` + dependency-cruiser worker rule + CI worker-chunk
  content assertion. Cheap, lands first. [Phase 0]
- **"Yjs schema migrations behind nested dynamic imports with swallowed errors"** — see Theme A
  coordinator. [Phase 2]
- **"Zero route/feature code splitting (229/266 modules eager)"** — `React.lazy` routes + first-use
  dynamic import of heavy services, deliberately sequenced *after* side-effect cleanup (lazy chunks
  would otherwise still boot everything), with a CI bundle budget on the existing ANALYZE tooling.
  [Phase 8]
- **"Library import/restore/offload are race-prone multi-store sagas inside a store"** +
  **"useLibraryStore.addBook ~300-line god action"** — `LibraryService` with a per-book keyed mutex;
  the five race-regression test files are ported to service-level invariant suites *before* the
  rewrite; the store shrinks to a UI projection. [Phase 7]
- **"Dense store-to-store coupling"** + **"Progress-resolution duplicated 3-4x"** — stores become
  dumb caches; `lib/progress/resolve.ts` is the single home of resolution + session merge; the
  reading-list projection becomes one subscription. [Phase 2 tiers/registry; Phase 7 services]

### E. Library, ingestion, search, Google & GenAI

- **"Batch import bypasses duplicate/ghost detection and silently drops failures"** — interim: surface
  per-file results in ImportProgressUI; structural: batch = N jobs through the one `ImportOrchestrator`
  pipeline. [Phase 0 interim; Phase 7]
- **"Extraction pipeline triplicated"** + **"BookExtractionData dead outputs; perceptualPalette/language
  dropped from synced inventory"** + **"ReprocessingInterstitial overlapping runs"** — one
  `extractBook(file, depth, signal)`; registration consumes the extractor's inventory output (one
  producer); one-time backfill of palette/language into Yjs from local manifests; reprocess routes
  through the import queue with an in-flight guard. [Phase 7]
- **"Two competing book identities (filename vs UUID)"** — optional `bookId` FK on `ReadingListEntry`
  resolved once at import/CSV-link time; the fuzzy matcher demotes to a one-time linker; migration pass
  links existing entries. [Phase 7]
- **"Worker-side XML parsing path is dead"** + **"Result navigation cannot target a specific match"** —
  dead negotiation deleted; per-occurrence offsets → CFIs; navigate by CFI with a temporary highlight;
  reader-session-scoped `SearchSession` replaces the module singleton; extracted text persisted in a
  `searchText` repo (deleted with the book). [Phase 7]
- **"No per-service token isolation"** + **"Interactive popup is the only token refresh; any error
  force-disconnects"** — `GoogleAuthClient` with per-service `{token, idToken, expiresAt, scopes}`;
  strict `connect()` vs silent `getToken()` (typed `AuthRequiredError`); auto-disconnect only on
  definitive revocation. The force-disconnect guard is small enough to hotfix earlier if Drive users
  hurt. [Phase 7]
- **"Strategy pattern in name only"** — one SocialLogin-backed class, platform options as constructor
  args. [Phase 7]
- **"E2E mock seams baked into production (GenAI)"** + **"No validation of structured LLM output"** +
  **"GenAI responses parsed as T with zero runtime checks"** — `GenAIClient` interface (Gemini | Mock at
  composition root); per-feature modules own prompt + zod schema + input-membership checks (generalizing
  the `SmartLinkDialog.tsx:82-87` pattern). [Phase 7]
- **"API key, full prompts, and base64 table images persisted to localStorage"** — explicit partialize
  allowlist; logs in-memory ring buffer with `inlineData` redaction; persist-version migration strips
  existing logs. [Phase 7]
- **"Error taxonomy by message-substring matching"** — typed `AppError` subclasses thrown at source,
  mapped once per boundary; `instanceof` branching; `presentError(code, params)` in the UI. [Phase 7,
  with the taxonomy module landing in Phase 1]
- **"No network gateway / egress policy"** + **"GenAI logs persist book text…"** + **"CSP is
  decorative"** + **"EPUB content can phone home"** + **"'Offline' Piper depends on HF+cdnjs"** —
  `lib/net/` destination registry + `NetworkGateway`; CSP generated from the registry into nginx/vite/
  index.html meta; sanitizer rewrites remote EPUB resources to blocked placeholders with a
  tracking-pixel regression fixture; Piper localization handled in Phase 5a. *(overstated → medium)*
  "Background Gemini analyses auto-fire" gains a per-book AI consent bit + activity indicator at the
  gateway. [Phase 7 gateway; Phase 8 CSP emission]

### F. Reader & Chinese

- **"ReaderView.tsx 1408-line god component"** + **"useEpubReader 1006-line god hook"** — `ReaderShell`
  (<200 lines) composing `ReadingSessionRecorder`, `AnnotationLayer`, `DebugHighlightLayer`,
  `ImportJumpPrompt`, `TocController`; hook split into epubLifecycle/epubTheming/selectionBridge/
  chineseContentProcessor. [Phase 6]
- **"Rendition/Book leak across app"** + **"Local epubjs.d.ts stub shadows upstream types"** —
  `ReaderEngine` facade via context; `EpubJsEngine` the only runtime epubjs importer; stub deleted in
  favor of upstream types + a minimal augmentation. Acceptance test of the boundary: swapping to
  foliate-js would be a one-module change. [Phase 6]
- **"Six overlay systems, conflicting styles, orphan-sweep scar tissue"** — one `HighlightLayerManager`
  (layers: annotation|tts|history|debug), single style registry emitting iframe + parent CSS, one
  orphan-sweep implementation; geometry overlays share the measured-portal primitive. [Phase 6]
- **"Reading-history writes race and double-record"** — serialized per-book session writes, one
  `recordSession` helper. [Phase 6]
- *(overstated → medium-high)* **"Homegrown CFI string algebra guards all user data"** — canonical
  `lib/cfi/` on parsed components; string fast-paths survive only behind property-based equivalence
  tests; locale-aware segmenter threaded from `book.language` (also pays "CFI sentence-snapping
  hardcodes 'en'"). [Phase 5c kernel; Phase 6 adoption]
- **"Dead rendition prop chain"** + **"Ad-hoc cross-tree communication: window CustomEvent + callback
  in Zustand"** — typed `ReaderCommands` context (nextChapter/prevChapter/playFromCfi/getSelection);
  the CustomEvent and `useReaderUIStore.playFromSelection` callback die. [Phase 6]
- **"Pinyin misalignment for astral-plane characters"** + **"Pinyin/traditional engine welded inside
  useEpubReader"** + **"Vocab-triage UI embedded in CompassPill"** + **"14MB dictionary in git, ~80MB
  heap"** — self-contained `features/chinese/` registering through a generic ContentProcessor registry;
  code-point-safe `PinyinGeometryEngine` with section-keyed position maps; IndexedDB-backed
  `DictionaryService` with SW runtime cache; cedict.json leaves git (CI-built, provenance-stamped).
  [Phase 6]
- **"epub.js iframe reading surface has no screen-reader contract"** + **"Focusable buttons inside
  aria-hidden overlay"** — iframe titled where the sandbox patch runs; every overlay declares
  decorative vs interactive via a shared `ReaderOverlay` wrapper. [Phase 6]

### G. Shell, settings, a11y, i18n

- **"Two overlapping global keyboard registries"** — interim hotfix gating `useReaderNavigation` arrows
  on TTS status; structural `KeyboardShortcutService` (one window listener, scoped declarative
  registration, dev-mode collision errors). [Phase 0 interim; Phase 8]
- **"No aria-live channel for TTS playback state"** + toast findings — `LiveAnnouncer` in RootLayout +
  queue-based Toast store mounted above the router gate, shared pipe. [Phase 8]
- **"Hardcoded lang='en'"** + **"No UI-locale dimension; decision unrecorded"** + **"Service layer
  authors user-facing English prose"** — ADR in Phase 0 ("i18n-ready, en-only": paraglide-style typed
  catalog, worker-importable); the choke-point contracts built in Phases 7–8 (toast queue, `useConfirm`,
  settings registry, `presentError`) accept message keys + params from day one;
  `documentElement.lang` from `lib/locale/`; book-text render sites get `lang={book.language}`.
  [Phase 0 ADR; Phases 7–8 contracts]
- **"GlobalSettingsDialog: 718-line god container"** — registry of self-contained lazy `SettingsPanel`
  descriptors; DiagnosticsTab is the model; `/settings/:tab` route. [Phase 8]
- *(overstated → high)* **"CompassPill 828-line god component in ui/"** — dumb `PillShell` in `ui/`;
  variants move to their features (audio pills with Phase 5, vocab triage with Phase 6's Chinese module,
  annotation/sync pills with Phase 8); `ReaderControlBar` becomes a thin variant router on
  `ReaderCommands`. [Phases 5/6/8]
- **"Entire src/components/audio/ directory is dead code"** — knip-verified deletion; the
  auto-pause-in-library decision made explicitly. [Phase 1]
- **"Busy-wait polls in boot path"** — `whenHydrated()` replaces the 100ms poll. [Phase 2]
- **"Zero automated a11y verification"** — jsx-a11y lint + vitest-axe in the component harness +
  @axe-core/playwright scans of five core surfaces land in the *harness* phase so every later rewrite
  is born compliant. [Phase 0]
- *(overstated → medium)* **"Per-device UI state synced via Yjs; Notes not routable"** — `/notes` route;
  `activeContext` leaves the CRDT (orphan key pruned at next schema bump). [Phase 8]

### H. Build, test infrastructure, licensing

- **"Vitest config duplication — worktree fix landed in the dead config"** + **"Two divergent vitest
  configs"** — single `vitest.config.ts` (mergeConfig) with explicit `src/**` include. [Phase 0]
- **"Dockerfile.android broken (.dockerignore)"** + **"Non-reproducible CI installs"** — per-Dockerfile
  ignore files + scheduled image build; `npm ci` + `engines`/`.nvmrc` everywhere. [Phase 0]
- **"No test code is ever typechecked (~42k LOC)"** — `tsconfig.test.json`/`tsconfig.e2e.json` + `tsc
  -b` in CI; one-time error wave fixed up front. [Phase 0]
- **"AGENTS.md and all runner docs describe a deleted pytest suite"** — rewritten against the
  Playwright/Docker reality; one canonical TESTING.md; schema-version rule replaced by importing the
  constant. [Phase 0, regenerated again in Phase 9]
- **"E2E suite verifies a different app than users run"** + **"Sleep-based synchronization"** +
  **"Window-global test seams incl. mock Firestore in shipped bundle"** — sanitization ON by default +
  hostile-EPUB journey; `window.__versicleTest.flushPersistence()` replaces the hardcoded 1500ms sleep;
  one build-flag-gated `installTestApi()`; MockFireProvider exits the bundle via Phase 4 injection.
  [Phase 0–1; Phase 4]
- **"One-off regression-file sprawl"** + **"712 hand-rolled vi.mock blocks"** + **"Test placement
  anarchy"** — `src/test/harness/` typed factory doubles; consolidation happens *inside each strangler*
  (a per-bug file is deleted only when its assertions verifiably live in the consolidated suite);
  end-state ~110 vitest files from 246. [Phases 0 harness; 2–8 execution]
- **"CI gates don't enforce the contract"** — lint + typecheck + sharded vitest + Playwright desktop on
  PR; coverage baseline recorded before consolidation, ratcheted after. [Phase 0]
- **"No THIRD-PARTY-NOTICES; build strips license banners"** + **"GPL-3 espeak-ng blobs with zero
  provenance"** + **"Modified PT Sans fonts violate OFL RFN"** — `third-party/inventory.json` + generated
  notices + CI license allowlist land *before* any vendoring PR (they gate Phase 4 fork-vendoring and
  Phase 5a piper-vendoring); `public/piper/PROVENANCE.md`; font family renamed with a persisted-
  preference migration. [Phase 0 inventory/gate; Phase 8 font rename]
- **"Offline caching app-shell-only; abrupt SW updates"** + *(overstated → medium)* **"PWA manifest
  defined twice"** — Workbox runtime routes (fonts/dict/piper), prompt-style update toast, dead static
  manifest deleted, boot no longer hard-gated on the SW controller, one shared `coverUrl()` module
  replacing the 5 copies of `/__versicle__/covers/`. [Phase 3 coverUrl; Phase 8 PWA]

---

## What gets deleted, merged, or rewritten

### Deleted outright (knip-verified where applicable)

- `src/components/audio/` (AudioReaderHUD, SatelliteFAB) + its maintained test; `src/hooks/use-local-storage.ts` + 7 test files; `src/hooks/useBookProgress.ts` (dead twin); dead barrels `src/store/index.ts`, `src/db/index.ts`, comment-only `components/{reader,library}/index.ts`.
- `SyncEngine.ts` + onMeta/onBoundary plumbing (no-op highlight path) — decision: delete now, re-implement word highlighting properly against the `PlaybackSnapshot` stream if ever scheduled.
- `useTTSStore.syncState`; dead lexiconHash machinery on the audio cache key; `CostEstimator`/`useCostStore` (replaced by NetworkGateway byte counters); `supportsXmlParsing` + the worker XML parse branch; `scrollToText` + the 500ms timer; `script-loader.ts` (Chinese); `validators.ts` in `lib/sync` (absorbed into `src/data/rows` zod schemas); `MigrationStateService` IDLE/dangling/isBlocked dead paths; android-backup cluster (or explicitly wired — decided in Phase 4).
- `tailwind.config.js` (dead v3), `App.css` contents, `public/manifest.webmanifest` + orphaned root icon set, `scripts/patch_piper_worker.js` + `prepare-piper` postinstall (replaced by vendored worker), `GlobalLoggerService`, the vite-config `test` block, root stray test files and 28MB of committed debug artifacts, duplicate `alice.epub`, `src/types/epubjs.d.ts` local stub, `localStorage.getItem('mockGenAIResponse')` and all sibling prod mock seams, `MockDriveService` from the prod tree.
- ~136 test files via consolidation (246 → ~110), including the 15 overlapping AudioPlayerService suites, 12 TTS per-bug regression files, 5 useLibraryStore race files (ported to service invariants first), 8 search test files → 2, duplicated `use-local-storage`/selector/per-bug suites.

### Merged

- Modal/Dialog/Sheet → one Modal primitive; three tab implementations → Radix Tabs; three search inputs → one `SearchInput`.
- Three CFI separator sets + `stripCfiWrapper` clones → `lib/cfi/`; 4 copies of progress resolution → `lib/progress/resolve.ts`; duplicated session-merge + reading-list upsert blocks → one projection.
- Three Yjs snapshot mechanisms (Backup/Checkpoint/Android) → `YjsSnapshotService` with thin format adapters; three export utilities → `exportFile()`; two reading-list CSV exporters → one.
- Two manifest definitions → one VitePWA manifest; five copies of the cover-route string → `coverUrl()`; 5x CSP copies → one generated include; triplicated relative-time/byte-size formatters → `lib/locale/format.ts`; duplicated default-abbreviation lists → exported `DEFAULT_ABBREVIATIONS`; webspeech/capacitor shared `'local'` id → distinct registry ids; two GoogleAuth strategy classes → one; `useUIStore` fragments → shell UI store; 3 LexiconManager mounts → one store-driven instance; duplicated GenAI gating/TOC-title walks → `ensureGenAIReady` + `resolveSectionTitle`.

### Rewritten (strangled, legacy deleted at completion)

| Legacy | Replacement | Phase |
|---|---|---|
| forked `zustand-middleware-yjs` hydration/diff internals | `syncedKeys` + merge-over-defaults + per-key diff + `whenHydrated()` | 2 |
| `yjs-provider.ts` migration runner | `app/migrations.ts` coordinator + `meta` map | 2 |
| `DBService.ts` (670) + raw `getDB()` callers + `types/db.ts` (934) | `src/data/` repos + rows + write-gate + wipe | 1, 3 |
| `BackupService` restore path | `YjsSnapshotService` + manifest v3 | 0, 3 |
| `FirestoreSyncManager.ts` (993) | SyncOrchestrator/AuthSession/WorkspaceService/ProviderConnection over `SyncBackend` | 4 |
| `firestore.rules` | non-overlapping rules + storage.rules + emulator suite | 0 |
| `AudioPlayerService.ts` (1242) + `PlaybackStateManager` persistence | PlaybackController + QueueModel + SessionStore + publishers | 5b |
| `TTSProviderManager` fallback + providerFactory store reach-ins | registry + single sequenced fallback + ctx injection | 5a |
| `AudioContentPipeline.ts` (891) | SectionQueueBuilder + detector strategy + LexiconEngine | 5c |
| `ReaderView.tsx` (1408) + `useEpubReader.ts` (1006) | ReaderShell + ReaderEngine + HighlightLayerManager | 6 |
| `cfi-utils` string algebra | `lib/cfi/` parsed-component kernel | 5c–6 |
| `useLibraryStore.ts` (798) workflows + `lib/ingestion.ts` triplication | LibraryService + ImportOrchestrator + `extractBook` | 7 |
| `selectors.ts` module cache (416) | derived `libraryViewStore` outside render | 7 |
| `search.ts` singleton + engine edges | SearchSession + persisted text extractor | 7 |
| GoogleIntegrationManager strategies + GenAIService singleton config | GoogleAuthClient + GenAIClient | 7 |
| `GlobalSettingsDialog.tsx` (718), `CompassPill.tsx` (828), `useToastStore` | settings registry, PillShell + feature pills, toast queue + LiveAnnouncer | 5–8 |
| `App.tsx` (372) boot + `main.tsx` harness | `app/bootstrap.ts` + `installTestApi()` | 1 |

---

## Migration roadmap

Every phase ends shippable: full unit + E2E suite green, no data-format change without a forward
migration and a tested straggler path. "Test gate" = what must be green to merge the phase's final PR.
Reversibility notes state how a phase backs out.

### Phase 0 — Trustworthy harness + stop-the-bleeding hotfixes

**Why first:** the lens demands characterization before change, and today the harness itself lies
(active vitest config missing exclusions, zero typechecked tests, CI not enforcing the contract,
sleep-based sync). Simultaneously, a handful of confirmed criticals are standalone user-safety fixes
that need no refactor and must not wait.

**Scope — harness:** single vitest config; `tsconfig.test.json`/`tsconfig.e2e.json` + `tsc -b` in CI;
lint+typecheck CI job with `npm ci` + pinned Node; dependency-cruiser with the full target ruleset in
*warn* mode (violation counts frozen as a ratchet); worker-chunk content assertion;
`consistent-type-imports` + `import/no-cycle`; fork deps pinned to commit SHAs; Firebase-emulator
contract suite skeleton (rules tests + FireProvider acceptance); `src/test/harness/` typed doubles +
`renderWithStores()`; `window.__versicleTest.flushPersistence()` replacing the 1500ms sleep; jsx-a11y
lint + vitest-axe + axe Playwright scans; coverage baseline recorded; third-party inventory + generated
notices + CI license gate; i18n ADR recorded; Dockerfile.android ignore fix + scheduled build; AGENTS.md
/TESTING.md rewritten to reality.

**Scope — hotfixes (each an independent PR):** `wipeAllData()`; firestore.rules + storage.rules rewrite
with emulator tests; backup-restore validate-before-destroy + pre-restore checkpoint + manifest v3 +
cover repair; popover state → `useReaderUIStore`; migration-checkpoint pinning (`protected` flag);
TTS speed policy (synthesize at 1.0, rate at sink, cache key fix); NFKD fix-forward + regression test;
`preprocessTableRoots` deletion; batch-import per-file result surfacing; keyboard-arrow gating on TTS
status; alignmentData/alignment field unification with a round-trip test.

**Ships:** safer app for every existing user (working data wipe, secured rules, non-destructive
restore, correct playback speed, no CFI corruption for new non-ASCII ingests).

**Exit criteria:** CI enforces lint + typecheck (incl. all test code) + sharded vitest + desktop
Playwright on PR; emulator rules suite green; post-wipe boot E2E green; dependency-cruiser baseline
committed; license gate active. **Reversibility:** all hotfixes are local; rules rollback = redeploy old
rules (documented).

### Phase 1 — Carve the seams (pure code motion, zero behavior change)

**Scope:** split `types/db.ts` by domain with re-export shim (TTSQueueItem/Timepoint into `types/tts.ts`);
create `src/app/` and relocate `createZustandEngineContext`, `createWorkerEngineClient`,
`replicationSpec`, `mainThreadAudioPlayer`, `BookRepository`, `ContentAnalysisRepository`;
`useSyncStore` → `store/`, `useSyncToasts` → `hooks/`; `app/bootstrap.ts` with explicit awaited phases
— Yjs doc/persistence construction moves out of `yjs-provider` module scope, SocialLogin init out of
`main.tsx`; one `installTestApi()` for every window hook (E2E suite migrated to it in the same PR);
`AppError` taxonomy module lands (adoption is per-phase); path aliases codemod; knip-verified deletion
of dead components/hooks/barrels; `lib/tts.ts` → `lib/tts/sentence-extraction.ts` rename.

**Ships:** identical app behavior; smaller bundle (dead code gone, prod harness gated).

**Exit criteria:** madge runtime cycles 16 → ≤3 (remaining ones named and owned by later phases);
boot is an ordered explicit sequence (`App.tsx` ≤100 lines); E2E green with `VITE_E2E` gating; worker
chunk assertion green; dependency-cruiser violation count strictly below baseline. **Reversibility:**
pure motion with shims; any move reverts independently.

### Phase 2 — Strangler #1: the state backbone (Yjs bridge + migrations)

**Why this subsystem first (risk × value):** highest value — the merge-over-defaults fix
unblocks *safe schema evolution for every later phase* (today, adding any field to a synced store wipes
it for existing users), and the criticals here are the data-corruption class. Risk is real (it's the
data backbone) but uniquely well-contained: the fork is first-party, the seam is a single function
(`getYjsOptions` → `defineSyncedStore`), the changes are mostly additive options, and the
checkpoint-before-migration machinery already exists. TTS is bigger but already has the best seams and
its bugs are session-scoped, not persistent-data-scoped; sync depends on this phase's `meta` map —
so state goes first.

**Scope:** fork surgery (`syncedKeys` whitelist, merge-over-declared-defaults hydration, per-key scoped
diffing, `whenHydrated()`), each behind the fork's own contract tests + this repo's emulator acceptance
suite; `store/registry.ts` three-tier declaration, all stray stores moved under `src/store/`;
`app/migrations.ts` coordinator (static imports, awaited, atomic transactional bump, loud failure into
safe mode, automatic pre-migration checkpoint); **v6 data migration**: delete `annotations.popover`
key, create `meta` map with schemaVersion (dual-writing `library.__schemaVersion` so v5 clients
quarantine), fold `preferences/<deviceId>` maps into one keyed map; boot poll replaced by
`whenHydrated()`; the ~20 defensive `|| {}` fallbacks deleted; defensive-cast cleanup; write
amplification fix (per-key diff) verified against `selectors.perf.test.ts`.

**Ships:** silent for users except faster page turns (no full-tree diff) and no more phantom popovers
across devices.

**Exit criteria:** two-client quarantine E2E (v5 snapshot vs v6 doc) green; migration coordinator
invariant tests green (no double-apply, failure → safe mode with checkpoint id); fork contract suite is
the acceptance gate for the new pinned SHA; zero `|| {}` hydration fallbacks remain; `migration-race`
spy test deleted. **Reversibility:** v6 transforms are deterministic + LWW-mergeable; pre-migration
checkpoint restores via the existing Inspect→Diff→Confirm flow; the dual-write keeps v5 clients safe
for one full release.

### Phase 3 — Strangler #2: the storage gateway (`src/data/`)

**Scope:** `write-gate.ts` on `navigator.locks` lands first as a drop-in behind the
`runExclusiveIdbWrite` signature (verified against the TTS chapter-nav flake suite +
`verification/_idb_probe.js`), then bypassing writers migrate callsite-by-callsite; repos carved out of
`DBService` in order audioCache → playbackCache → bookContent → checkpoints → diagnostics
(`dbService` remains a deprecated delegating façade until importers migrate, then deleted); zod row
schemas in `rows/` (absorbing `lib/sync/validators.ts` and `db/validators.ts`); `YjsSnapshotService`
(capture / dry-run-validate / apply+flush; y-idb fork gains explicit `flush()`/`whenSynced`, replacing
the 1000ms sleeps) with Backup/Checkpoint/Android as format adapters; IDB v25: versioned migration
registry, legacy-store snapshot-before-delete for stragglers, `blocked`/`blocking` handlers,
`navigator.storage.persist()`; size-budgeted LRU eviction for `cache_audio_blobs` through the gate;
shared `coverUrl()` module (SW imports DB constants from `src/data`); ESLint bans on `db/db`,
`DBService`, raw `'readwrite'` outside `src/data/`.

**Ships:** persistent-storage request, audio cache stops growing unboundedly, restore round-trip with
binary covers verified.

**Exit criteria:** backup generate→restore round-trip test (real Y.Doc + binary covers) green —
written *before* the rewrite per the persistence report; all readwrite transactions route through the
gate (lint clean); multi-tab upgrade test (blocked/blocking) green; `dbService` façade deleted.
**Reversibility:** repo-by-repo; the façade keeps old imports compiling until each migration PR lands.

### Phase 4 — Strangler #3: sync

**Scope:** `SyncBackend` interface with `FirestoreBackend`/`MockBackend` chosen at the composition root
(all 8 inline mock branches deleted; MockFireProvider leaves the prod bundle); decomposition into
`AuthSession` / `ProviderConnection` / `WorkspaceService` / `SyncOrchestrator` with one
`downloadWorkspaceState(path)`; typed `SyncEvent` bus (toast/UX copy leaves the transport; `lastSyncTime`
from flush events); doc-level quarantine enforcement (synchronous `meta` check before applying remote
updates, provider destroy + heartbeat stop on obsolete, workspace metadata version updated
post-migration); staged-swap workspace switch (download → staging IDB → verify → atomic swap →
reload) under `navigator.locks`, preserving the localStorage state-machine keys with a new `STAGED`
status; `deleteWorkspace` purges history/maintenance/metadata + Storage and severs only the active
path; CheckpointService circular import inverted (injected shutdown handle); `getInstance(config?)` →
`createSyncManager(config)` owned by bootstrap; forks vendored as npm workspaces (yjs/zustand as peers,
single-yjs CI assertion) gated by the Phase 0 licensing checklist; boot auto-sync policy out of App.tsx.

**Ships:** workspace switching that cannot strand users mid-switch; honest delete; sync status UX from
events.

**Exit criteria:** emulator contract suite green against both backends (mock drift becomes impossible);
kill-mid-switch E2E (process death between download and swap) recovers cleanly; two-client obsolete
E2E disconnects the stale client before merge; `FirestoreSyncManager.ts` deleted; one-time "purge
deleted workspaces" maintenance action available. **Reversibility:** the façade pattern again; the
staged-swap keeps the old workspace intact until the atomic swap, which is itself the rollback point.

### Phase 5 — Strangler #4: TTS (providers → engine → content)

**Entry gate (characterization first):** expand `engineParityScenarios` to cover restore, skip masks,
table adaptations, navigation, dragnet, provider fallback, and queue identity on both transports;
absorb the durable assertions from the 15 APS suites + 12 per-bug files; ban `vi.mock` in
`src/lib/tts/engine/` (fakes only). No engine internals change until this suite is green on both
transports.

**5a — providers:** `ProviderDescriptor` registry (ctx = `{apiKey?, language, sink}` passed in — kills
the providerFactory→store cycle); narrowed `ITTSProvider` + capability interfaces + shared
cross-provider contract test; single failure path (reject-only) with manager dispose/detach;
`PiperRuntime` class; offline voices + vendored onnxruntime + checked-in patched worker (with
`PROVENANCE.md`, license gate enforced); buffered API-key edits; settings UI rendered from the registry.

**5b — engine:** `useTTSSettingsStore` / `useTTSPlaybackStore` split (persist name/version migration
chain preserved; replication becomes explicit `TTSSettingsData` — echo loop dies); single
`PlaybackSnapshot` stream with monotonic seq; TaskSequencer cancellation (epoch/AbortSignal +
watchdogs) and the dev-assert that only sequenced tasks mutate status; APS decomposition behind the
existing ports (PlaybackController/QueueModel/SessionStore/AnalysisApplier/MediaMetadataPublisher/
DragnetGesture); copy-on-write queue; sequenced single fallback task; flight-recorder worker export →
DiagnosticsTab via the handle; engine commands move from store actions to the `app/TtsController` +
complete `useAudioCommands` facade with the no-restricted-imports ban on `mainThreadAudioPlayer`.

**5c — content:** `SentenceExtractor` relocated to `lib/ingestion/` (persist RAW sentences; refinement
exclusively at playback behind `extractionVersion`); `SectionQueueBuilder` pure (readerUI write moves to
the host); `ReferenceSectionDetector` strategy + injected telemetry; `LexiconEngine` with
`CompiledLexicon` + lazy Bible JSON behind `SystemLexiconProvider`; `lib/cfi/` canonical kernel with
property-based equivalence tests (consumed by TTS now, reader in Phase 6); GenAI mock seam removed
(replaced by the Phase 7 `GenAIClient`, stubbed behind the port meanwhile).

**Ships:** correct fallback (no double-fire), offline Piper, gapless behavior preserved (Capacitor
Smart Handoff suite kept), diagnostics that actually capture production.

**Exit criteria:** expanded parity suite green on both transports over real Comlink/MessageChannel;
per-bug TTS test files deleted with assertions verifiably absorbed; `AudioPlayerService.ts` deleted;
`lib/tts` has zero store imports (dependency-cruiser error); provider contract suite green for all
five providers; worker-chunk assertion still green. **Reversibility:** ports make each sub-strangler
swappable; the in-process test topology keeps running throughout as the second implementation that
catches transport-specific regressions.

### Phase 6 — Strangler #5: reader + Chinese

**Entry gate:** characterization E2E for the six overlay behaviors (annotation add/remove, TTS
highlight follow, history highlight, note markers, pinyin alignment incl. astral-plane fixture, debug
layer) + reading-session recording, against the current implementation.

**Scope:** `lib/reader-engine/` (`ReaderEngine` interface, `EpubJsEngine` sole epubjs importer, shared
`epubSecurity.ts` reused by offscreen ingestion, theming, ingest-time locations); `lib/cfi/` adoption by
reader + stores; `HighlightLayerManager` + `ReaderOverlay` contract (decorative vs interactive,
titled iframe); `ReaderShell` decomposition with `ReadingSessionRecorder` (serialized per-book writes);
`ReaderCommands` context (CustomEvent + callback-in-store deleted; CompassPill triage path becomes
reachable or is deleted with the variant split); `features/chinese/` extraction (code-point-safe
pinyin engine, section-keyed positions, `DictionaryService` on IDB + SW cache, cedict out of git,
vocabulary simplified-key canonicalization with its one-time Yjs merge migration); epubjs.d.ts stub
deleted; selection pipeline unified; settings-driven `flow()/display()` effects split by actual inputs.

**Ships:** identical reading experience, correct pinyin for Ext-B/emoji, instant vocab toggles,
working SR contract.

**Exit criteria:** only `lib/reader-engine/` imports epubjs (lint error elsewhere); overlay
characterization suite green on the new manager; ReaderView <200 lines; axe scans of reader+TTS surface
pass; Chinese engine unit suite (alignment, filtering, round-trip, merging) green. **Reversibility:**
the engine facade is introduced *under* the existing components first (adapter over the live
rendition), components migrate one at a time, old paths deleted last.

### Phase 7 — Strangler #6: library/ingestion, search, Google/GenAI, egress

**Scope:** `LibraryService` + `ImportOrchestrator` (per-book keyed mutex; the five race tests ported to
service invariants *before* the cutover); one `extractBook(file, depth, signal)` with cancellable
streaming ZIP; real SHA-256 contentHash with legacy-fingerprint acceptance + lazy manifest upgrade;
inventory registration from extractor output + palette/language backfill; `bookId` FK on
ReadingListEntry + one-time linking migration; background re-ingestion of NFKD-affected books via the
job queue (`extractionVersion` driven); hydration at bootstrap via inventory deltas; derived
`libraryViewStore` replacing the selectors module cache; `useImportController` shared by all entry
points; search: `SearchSession` + persisted `searchText` repo + CFI navigation; `GoogleAuthClient` +
`DriveClient`/`DriveLibrarySync` split; `GenAIClient` + per-feature zod modules + redacted ring-buffer
logging + per-book AI consent bit; `lib/net/` destination registry + `NetworkGateway` + fetch lint ban;
typed error adoption across these services with `presentError`.

**Ships:** batch import that reports per-file results and respects duplicates; renamed-file restores;
search that lands on the exact match; Drive that doesn't force-disconnect; auditable egress.

**Exit criteria:** import journey E2E (single/batch/ZIP/Drive/restore/reprocess through one queue);
service invariant suite covers all five historical race bugs; `useLibraryStore` ≤ ~150 lines of
projection; registry==CSP unit test green; GenAI structured-output fuzz tests green; `selectors.ts`
module cache deleted with perf test still green. **Reversibility:** orchestrator runs behind the
existing `addBook` signature first; entry points cut over one at a time.

### Phase 8 — Shell, settings, a11y/i18n choke points, PWA/build finishers

**Scope:** routes `/`, `/notes`, `/read/:id`, `/settings/:tab` with `React.lazy` + first-use dynamic
import of firebase/drive/genai (safe now that side effects are gone) + CI bundle budget; settings
registry with lazy panels; CompassPill dissolution completed (PillShell + remaining variant moves;
ReaderControlBar as variant router); queue-based Toast + `LiveAnnouncer` + `useConfirm` (no-alert lint)
— all accepting message keys per the i18n ADR; `KeyboardShortcutService`; `lib/locale/` formatters
replacing the 16 ad-hoc `toLocale*` sites; `documentElement.lang` + book-text `lang` attributes; PWA:
single manifest, runtime caching (fonts/dict/piper), prompt-style SW update toast, soft boot gate;
CSP generated from the net registry into nginx/vite/index.html; font rename off OFL Reserved Names with
persisted-preference migration; `activeContext` out of the CRDT; motion policy + reduced-motion.

**Exit criteria:** entry chunk = library + store hydration only (budget enforced); axe scans of all
five surfaces pass; Lighthouse PWA installability + offline reader smoke green; settings/notes
deep-links work; zero native `confirm`/`alert` (lint). **Reversibility:** each item independent;
route-splitting is config-revertable.

### Phase 9 — Deletion audit, ratchet flip, docs

**Scope:** knip sweep; dependency-cruiser + boundary lint flipped from warn to **error** with zero
exceptions; type-shims from Phase 1 deleted; dual-write `library.__schemaVersion` retired (v7);
coverage ratchet locked at the new baseline; production `as any` (138) and eslint-disable (245)
counters driven to ~0 with CI ratchets; `architecture.md`, store/data/tts READMEs, AGENTS.md
regenerated from the registries (store registry, provider registry, destination registry, settings
registry, third-party inventory); test file count verified ≤ ~120 with the regression-absorption
ledger closed out.

**Exit criteria:** all boundary rules CI-blocking; docs generated, not hand-maintained; no deprecated
shims remain.

---

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | **v6 CRDT migration corrupts or strands existing libraries** (mixed-version device fleets) | Deterministic, LWW-mergeable transforms only; automatic pre-migration checkpoint via existing CheckpointService; dual-write `library.__schemaVersion` so v5 clients quarantine (tested with two doc snapshots + two-client E2E); DataRecoveryView escape hatch preserved untouched through Phases 2–4; migrations run once, atomically, loud-fail into safe mode with the checkpoint id displayed. |
| 2 | **Fork surgery changes hydration semantics** (merge-over-defaults could mask genuinely deleted keys) | Keep the fork's `previousState` delete-protection: deletions still propagate when the previous map version contained the key; contract tests with old-doc fixtures (v4/v5 snapshots) are the fork's acceptance gate; SHA-pinned bumps only. |
| 3 | **Workspace staged-swap bugs lose a library mid-switch** | Old workspace remains intact until the atomic swap; `navigator.locks` serializes; pinned (`protected`) checkpoints can't be pruned mid-flight; kill-mid-switch E2E in CI; localStorage state machine keys preserved so a client updated mid-switch still resolves. |
| 4 | **IDB v25 upgrade breaks stragglers / multi-tab** | Legacy user stores snapshotted before any deletion; `blocked`/`blocking` handlers with reload prompt; bounded retry with `dbPromise` reset; upgrade tested from a v18 fixture and a v24 fixture. |
| 5 | **TTS decomposition regresses playback behavior invisibly** (197-commit churn file) | Parity-scenario expansion is a hard entry gate before any engine change; both transports run the same scenarios over real Comlink; per-bug tests deleted only after their assertions are verifiably absorbed (ledger reviewed per PR); flight recorder (now worker-exporting) captures field regressions. |
| 6 | **Worker bundle silently grows or breaks during code motion** | CI worker-chunk content assertion (no zustand/yjs/store) from Phase 0; `consistent-type-imports` makes the typo class a compile error; the real bundled worker boots in E2E on every PR. |
| 7 | **Rules tightening locks out users with stale deployed rules** (BYO-Firebase: we don't control deployment) | Rules are additive-allow for owner paths actually used; "Rules out of date" doc + in-app surfacing of `save-rejected` errors with a check-your-rules hint; emulator suite prevents regression on our side. |
| 8 | **Background re-ingestion wave (NFKD/extractionVersion) hammers low-end devices** | Only books detected as affected (non-ASCII content heuristic); chunked, resumable jobs through the import queue at idle priority; user-visible progress + defer option. |
| 9 | **Test consolidation drops a regression** | Rule: a per-bug file is deleted in the same PR that adds its named `describe('regression: …')` block; coverage ratchet (recorded in Phase 0) must not drop; reviewers check the absorption ledger. |
| 10 | **localStorage store splits lose user settings** (tts-storage v3 → settings/playback split; genai log strip; font rename) | persist `migrate` chains under the original names (the established v1→v3 pattern); one-time copy with fallback read; font-preference string migration shipped with the rename. |
| 11 | **Route-splitting before side effects are fully gone reintroduces eager boot** | Hard sequencing: Phase 8 only; bundle budget CI catches a regression to eager-everything; dependency-cruiser no-module-side-effect rule. |
| 12 | **Strangler fatigue: parallel old/new paths linger** | Every phase's exit criteria include deleting the legacy artifact (façade, shim, old file); Phase 9 is a dedicated audit; dependency-cruiser ratchet forbids new references to deprecated paths. |

---

## Test strategy for the end state

Six-tier pyramid (per `testing-verification.md`), with the contract tier as the spine of the strangled
boundaries:

1. **Pure-logic units** (node env): one behavioral suite per module + `.fuzz` companions (seeded, via
   `src/test/fuzz-utils.ts`) for cfi kernel, lexicon, segmentation, progress resolution; benchmarks as
   `*.bench.ts` outside the gate.
2. **Contract/parity suites for every dual-implementation seam** — the `describeXContract(makeHarness)`
   pattern: TTS engine transports (in-process vs worker over real MessageChannel), TTS providers
   (shared `ITTSProvider` contract), `SyncBackend` (FirestoreBackend-on-emulator vs MockBackend),
   `src/data` repos (real idb vs fake-indexeddb), forked packages (fork acceptance suites are the gate
   for any SHA bump), zod row schemas (round-trip + old-fixture acceptance).
3. **Store/service integration**: real Zustand stores + real Y.Doc + typed harness doubles; the
   LibraryService/ProgressService invariant suites carry the historical race bugs forward; migration
   coordinator tests run against v4/v5/v6 doc fixtures.
4. **Component tests** only where logic lives, via `renderWithStores()` + vitest-axe; presentational
   panels (the TTSSettingsTab model) need no store mocks at all.
5. **~40 Playwright journeys**: deterministic waits through `window.__versicleTest`
   (flushPersistence/resetApp/seedLibrary), sanitization ON + hostile-EPUB journey, post-wipe boot,
   import (single/batch/ZIP/Drive), workspace switch incl. kill-mid-switch, two-client quarantine,
   TTS chapter-crossing playback, search-to-match navigation; desktop on PR, mobile+WebKit+emulator
   sync nightly.
6. **~10 `toHaveScreenshot` goldens** (library, reader themes, settings, audio deck); other captures
   failure-only. axe scans of the five core surfaces fail CI on serious/critical.

Cross-cutting gates: all test code typechecked (`tsc -b`); `vi.mock` banned in engine/provider/data
directories (fakes + DI seams instead); coverage ratchet from the Phase 0 baseline; boundary lints
(dependency-cruiser, no-restricted-imports, no-console, no-alert, jsx-a11y, fetch ban, readwrite ban)
at error level; the worker-chunk content assertion and registry==CSP test as permanent invariants.
End-state count: ~110 vitest files (from 246) + ~40 journeys + goldens, with every historical
regression preserved as a named `describe('regression: …')` block.
