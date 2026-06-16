# End-to-End Flows

This document traces eight critical cross-cutting user journeys through every layer of the Versicle codebase — from the UI gesture down to the IndexedDB transaction and back up to the rendered screen. Each journey is covered as a detailed sequence diagram followed by a prose walkthrough of the key implementation decisions, data shapes, and failure modes.

The eight journeys are:

1. **Import a book** — file → extraction pipeline → IDB persistence → CRDT inventory write → library UI
2. **Open, read, and annotate** — book tap → epub.js lifecycle → location recording → annotation CRDT write
3. **Start TTS playback** — TTS button → TtsController → worker engine → audio output → progress write-back
4. **Cross-device sync** — local edit on Device A → Yjs CRDT → Firestore → Device B store patch
5. **Backup and restore** — snapshot capture → IDB checkpoint → validate-before-destroy → reload
6. **Staged workspace switch** — switch gesture → download → durable staging → boot-time apply → confirmation
7. **Semantic search of an open book** — embed-on-open → quota-throttled at the gateway → int8 cosine + RRF fusion → lazy CFI jump
8. **Cross-device cache hit** — Device A embeds + uploads → Device B consults the HEAD doc before the quota gate → hydrates the blob → zero Gemini quota

Before reading this document, familiarise yourself with the module boundaries in [Layering and boundaries](11-layering-and-boundaries.md), the CRDT store model in [State management](13-state-management-crdt.md), and the bootstrap sequence in [Bootstrap and lifecycle](14-bootstrap-and-lifecycle.md).

---

## 1. Application Boot Context

Every journey in this document happens inside an already-booted application. The boot sequence
([Bootstrap and lifecycle](14-bootstrap-and-lifecycle.md)) runs once at startup and must complete before any journey can begin. The relevant
phases, drawn from [`src/app/bootstrap.ts`](../../src/app/bootstrap.ts) and
[`src/app/boot/registerBootTasks.ts`](../../src/app/boot/registerBootTasks.ts), are:

```
interceptMigration → openDB → startYjsPersistence → whenHydrated →
migrations → syncInit → deviceRegistration → backgroundTasks
```

After `whenHydrated` all Zustand stores backed by `defineSyncedStore` (the Yjs middleware) have
been patched from their IndexedDB snapshot.  After `migrations` the CRDT schema version in the
live doc matches `CURRENT_SCHEMA_VERSION` (currently **9**).  After `deviceRegistration` the
`TtsController` has replayed persisted settings into the TTS engine and the engine reports
`engineReady: true` into `useTTSPlaybackStore`.

```mermaid
stateDiagram-v2
    [*] --> interceptMigration
    interceptMigration --> openDB : "no pending migration"
    interceptMigration --> Halted : "STAGED or RESTORING_BACKUP"
    openDB --> startYjsPersistence
    startYjsPersistence --> whenHydrated
    whenHydrated --> migrations
    migrations --> syncInit
    syncInit --> deviceRegistration
    deviceRegistration --> backgroundTasks
    backgroundTasks --> Ready
    Ready --> [*]
    Halted --> [*] : "page reload"
```

---

## 2. Journey 1 — Import a Book

### 2.1 Design Intent

Importing an EPUB must be idempotent at the content level (same bytes → same `bookId`), must never
corrupt existing reading progress on a "replace" import, and must handle duplicate detection both
by filename (synchronous, no DB round trip) and by ghost-matching (an inventory entry that has no
binary yet — a synced book from another device). The entire pipeline runs inside a FIFO queue so
a simultaneous user drop and a background re-ingest wave cannot interleave writes to the same
book.

### 2.2 Architecture

The import pipeline lives in the **library domain** ([Domain library](37-domain-library.md)):

```
UI (LibraryView / FileUploader)
  └─ ImportOrchestrator         src/domains/library/import/ImportOrchestrator.ts
       ├─ extractBook()         src/domains/library/import/extract.ts
       ├─ LibraryPersistence    src/domains/library/import/persist.ts
       │   └─ bookContent repo  src/data/repos/bookContent.ts
       └─ KeyedMutex            src/domains/library/mutex.ts
```

The `ImportOrchestrator` is the **single entry point** for all import variants (user drop,
settings-page upload, Drive sync, ContentMissing restore, re-ingest wave). It owns a two-priority
FIFO queue (`normalQueue` / `idleQueue`): normal user-initiated jobs always preempt background
re-ingest jobs. Every per-book mutation runs inside a `KeyedMutex` so `delete(X)/restore(X)`
races are impossible by construction.

### 2.3 Sequence Diagram

```mermaid
sequenceDiagram
    participant U as "User / UI"
    participant O as "ImportOrchestrator"
    participant E as "extractBook()"
    participant P as "LibraryPersistence"
    participant IDB as "IndexedDB (bookContent)"
    participant INV as "Inventory (Yjs)"
    participant RL as "ReadingList (Yjs)"

    U->>O: "importFile(file)"
    O->>O: "enqueue('import', normalQueue)"
    O->>O: "projection.importStarted()"
    O->>O: "findExistingBookIdByFilename()"
    alt "filename duplicate"
        O-->>U: "{ status: 'duplicate' }"
    else "ghost probe"
        O->>E: "extract(file, { depth: 'metadata' })"
        E-->>O: "BookMetadataExtraction"
        O->>O: "findGhost(probe)"
        alt "ghost match found"
            O->>E: "extract(file, { depth: 'full', preamble: probe })"
            E-->>O: "FullBookExtraction"
            O->>P: "ingest(retargetExtraction(extraction, ghost.bookId))"
            P->>IDB: "bookContent.ingest() + searchText.put()"
            O->>INV: "mutex.run → readingList.update FK"
            O->>INV: "projection.setStatic + removeOffloaded"
            O-->>U: "{ status: 'imported', adoptedGhost: true }"
        else "no ghost"
            O->>E: "extract(file, { depth: 'full', preamble: probe })"
            E-->>O: "FullBookExtraction"
            O->>P: "ingest(extraction, { mode: 'add' })"
            P->>IDB: "bookContent.ingest() + searchText.put()"
            O->>O: "mutex.run → registerNew()"
            O->>INV: "inventory.upsert(extraction.inventory)"
            O->>RL: "readingList.upsert({ bookId })"
            O->>INV: "projection.setStatic + removeOffloaded"
            O-->>U: "{ status: 'imported', bookId }"
        end
    end
```

### 2.4 Step-by-Step Implementation

**Step 1 — enqueue.** `importFile()` wraps its work in `this.enqueue('import', run, 'normal')`,
returning a `Promise<ImportJobResult>`. The internal pump is single-threaded (one `pumping` flag
guard): idle jobs only run when `normalQueue` is empty.

**Step 2 — filename duplicate check.** `findExistingBookIdByFilename()` scans
`inventory.all()` synchronously (O(n) over CRDT map keys), then falls back to
`persistence.getBookIdByFilename()` for pre-import DB records. If `onDuplicate === 'ask'`
(single import default) the call returns `{ status: 'duplicate', existingBookId }` so the UI can
surface a Replace dialog. Batch import defaults to `'skip'`.

**Step 3 — ghost probe.** A "ghost" is an inventory entry (known to the CRDT from a remote
device) that has no local static metadata (no IDB manifest row). The orchestrator detects ghosts
by calling `extract(file, { depth: 'metadata' })` — a fast epubjs open that reads only the OPF
metadata without walking spine chapters — then comparing `probe.title.trim()` and
`probe.author.trim()` against the inventory. `findGhost()` additionally requires that the
matching inventory entry has no entry in `projection.staticIds()` (the set of books with a local
manifest).

**Step 4 — full extraction.** `extractBook()` in [`src/domains/library/import/extract.ts`](../../src/domains/library/import/extract.ts)
is the single extraction implementation replacing three legacy duplicates. A full extraction:

- Opens the EPUB with epubjs (possibly reusing the metadata probe as `preamble`).
- Compresses the cover image and extracts its color palette (`coverPalette`, `perceptualPalette`).
- Computes a `contentHash` (SHA-256 of raw bytes) and a legacy `fileHash` (filename-independent tail).
- Walks all spine chapters through the offscreen renderer to produce TTS preparation batches,
  table image batches, section metadata, and a search text corpus.
- Produces a `FullBookExtraction` with a new UUID `bookId` (unless ghost/replace retargets it).

**Step 5 — persist.** `LibraryPersistence.ingest()` in [`src/domains/library/import/persist.ts`](../../src/domains/library/import/persist.ts)
calls `bookContent.ingest()` in one gated transaction
(the cross-context write gate — see [Storage gateway](20-storage-gateway.md)), then writes the search corpus via
`searchTextRepo.put()`. The search corpus write is non-fatal (failure is logged; the row is
rebuildable on first search).

**Step 6 — register (under mutex).** `registerNew()` runs inside `mutex.run(extraction.bookId, ...)`,
ensuring atomicity with any concurrent delete or restore on the same book. Inside the mutex:

- `inventory.upsert(extraction.inventory)` writes to the Yjs Y.Map `books` — this is the
  CRDT write that fans out to all synced devices.
- `readingList.upsert({ ...extraction.readingListEntry, bookId: extraction.bookId })` creates
  the reading-list entry WITH the `bookId` FK (Phase 7 §D).
- `projection.setStatic(bookId, metadata)` and `projection.removeOffloaded(bookId)` update
  the non-synced in-process projection store.

**Ghost adopt.** Ghost adoption takes the same path but calls `retargetExtraction(extraction, ghost.bookId)` before persisting — every `bookId`-bearing row in the extraction (manifest, resource, structure, spine ids, TTS prep ids, table ids, inventory, progress, overrides) is rewritten consistently to the existing `bookId`. This is implemented in [`src/domains/library/import/persist.ts`](../../src/domains/library/import/persist.ts#L33)
`retargetExtraction()`.

### 2.5 Key Invariants

Five invariants are enforced by `LibraryService` (documented in
[`src/domains/library/LibraryService.ts`](../../src/domains/library/LibraryService.ts#L1)):

| Invariant | Description |
|-----------|-------------|
| I-1 | Hydration is a per-key merge; a book written after the hydration read snapshot is never clobbered. |
| I-2 | Hydration never resurrects; keys absent from inventory at write time are dropped. |
| I-3 | Restore re-validates existence inside the mutexed register step. |
| I-4 | Failure paths restore the CAPTURED prior offload state. |
| I-5 | The offloaded set is updated per-key only (no wholesale setter). |

### 2.6 Failure Modes

- **StorageFullError** — caught in `runImport()`, surfaces as `"Device storage full."` error on the projection, returns `{ status: 'failed' }`.
- **Extraction failure** — any epubjs parse error propagates as a failed `ImportJobResult`; the queue continues with the next file.
- **Zombie guard** — `registerNew()` checks `inventory.get(bookId)` inside the mutex; if a concurrent `remove()` already landed, registration is silently skipped (no resurrection).
- **Search corpus failure** — non-fatal; the `searchText` row rebuilds lazily on the first search query.

---

## 3. Journey 2 — Open, Read, and Annotate

### 3.1 Design Intent

Opening a book must not block on the location registry (CFI ↔ percentage map), which can take
many seconds to generate for long books. Reading progress must be recorded in arrival order
(FIFO, never backwards), and a page-close / navigation away must save the current position
synchronously even if the async snapping pipeline is mid-flight. Annotation creation must be
instantly reflected in the CRDT so any synced device sees it within the next Firestore flush.

### 3.2 Architecture

```
ReaderView (React)
  └─ useEpubReader()          src/hooks/useEpubReader.ts
       ├─ EpubJsEngine         src/domains/reader/engine/EpubJsEngine.ts
       ├─ selectionBridge      src/domains/reader/engine/selectionBridge.ts
       ├─ ReadingSessionRecorder  src/domains/reader/session/ReadingSessionRecorder.ts
       │   └─ useReadingStateStore  (Yjs-backed)
       └─ useAnnotationStore   (Yjs-backed)
```

### 3.3 Sequence Diagram — Open and Read

```mermaid
sequenceDiagram
    participant RV as "ReaderView"
    participant H as "useEpubReader()"
    participant BC as "bookContent repo"
    participant EJ as "EpubJsEngine"
    participant LOC as "initializeLocations()"
    participant REC as "ReadingSessionRecorder"
    participant RS as "useReadingStateStore"

    RV->>H: "mount with bookId"
    H->>BC: "bookContent.getBookFile(bookId)"
    BC-->>H: "ArrayBuffer (EPUB binary)"
    H->>H: "createEpubJsBook(fileData)"
    H->>H: "registerSanitizeHook(book)"
    H->>EJ: "new EpubJsEngine({ book, rendition, container })"
    H->>H: "rendition.display(initialLocation)"
    H->>H: "setIsReady(true)"
    H->>LOC: "initializeLocations({ book, bookId, onReady })"
    LOC-->>H: "(resolves locationsReady promise)"
    H->>H: "setAreLocationsReady(true)"
    loop "user turns pages"
        EJ-->>H: "event { type: 'relocated', location }"
        H->>H: "reportLocation(location)"
        H->>REC: "recorder.onRelocated(sessionEvent)"
        REC->>REC: "enqueue to FIFO pump"
        REC->>REC: "snapCfiToSentence() (async)"
        REC->>RS: "updateReadingSession(bookId, cfi, pct, updates)"
    end
```

### 3.4 The epub.js Lifecycle

`useEpubReader()` in [`src/hooks/useEpubReader.ts`](../../src/hooks/useEpubReader.ts) implements the
lifecycle as a **cancellable generator** (`runCancellable(loadBookGenerator(bookId), cleanup)`).
The generator yields on each async step; on cancellation the cleanup callback destroys the
engine, the epub.js `Book`, the rendition, and the sandbox MutationObserver. This prevents the
common React 18 strict-mode double-mount from leaving a dangling epub.js instance.

Key steps inside the generator:

1. `bookContent.getBookFile(currentBookId)` — fetches the raw EPUB `ArrayBuffer` from IDB.
2. `createEpubJsBook(fileData)` — constructs an epub.js `Book` from the buffer.
3. `registerSanitizeHook(newBook, { allowTestBypass: true })` — installs the `serialize-at-sanitize` DOMParser hook (shared with the offscreen ingestion renderer so there is exactly one sanitization implementation).
4. `newBook.renderTo(viewerRef.current, { flow, manager: 'default' })` — constructs the epub.js `Rendition`.
5. `observeAndPatchSandbox(viewerRef.current)` — a MutationObserver that patches `<iframe sandbox>` to include `allow-scripts` immediately after epub.js creates each iframe (WebKit requires this for event handling).
6. `new EpubJsEngine({ book, rendition, container, locationsReady })` — the contract-C7 `ReaderEngine` port wrapping the raw epub.js objects. Set as the process-wide active engine via `setActiveReaderEngine(newEngine)`.
7. `rendition.display(startLocation)` — renders the first section. `startLocation` is `options.initialLocation ?? meta?.currentCfi`.
8. `initializeLocations({ book, bookId, isCurrent, onReady })` — loads a previously cached CFI registry or generates it in the background. When ready it calls `resolveLocationsReady()`, which resolves the `locationsReadyPromise` the engine holds, and sets `areLocationsReady: true` in React state.

### 3.5 The Selection Pipeline

Text selection uses the `selectionBridge` module rather than epub.js's own `'selected'` event. The reason (documented in [`src/hooks/useEpubReader.ts`](../../src/hooks/useEpubReader.ts#L317)): the epub.js `selected` event and the `mouseup`-based bridge both fired for one gesture in the legacy hook; the `mouseup` pipeline is more reliable on WebKit. `attachSelectionBridge(contents, onSelection)` is registered as a `rendition.hooks.content` hook and also run manually on already-loaded content (first section, which was loaded before hooks could be registered).

When the user selects text and lifts the mouse/finger, `selectionBridge` fires `onSelection(cfiRange, range, contents)`, which routes up to the `ReaderView`'s annotation popover state (in the non-synced `useReaderUIStore`). The user then confirms the highlight or note, which calls `useAnnotationStore.getState().add(annotation)` — a write to the Yjs-backed `annotations` Y.Map, immediately CRDT-replicated.

### 3.6 Reading Progress Recording

The `ReadingSessionRecorder` in [`src/domains/reader/session/ReadingSessionRecorder.ts`](../../src/domains/reader/session/ReadingSessionRecorder.ts)
serializes all location-change recordings on a per-book FIFO with a monotonic sequence number.
The critical fix (D6 from the overhaul plan) is that the **legacy code launched one async pass per relocation**, so a slow `snapCfiToSentence` for relocation N could commit AFTER N+1, leaving `currentCfi` pointing backwards. The new design:

- Captures all data (previous segment, dwell time, title, resolver) **at event time** before the first `await`.
- Queues the recording as a plain data object.
- The FIFO pump (`pump()`) processes exactly one item at a time, `await`ing the sentence snap, then committing in sequence.
- A `commit()` guard drops any recording whose `seq` is already covered by a prior commit.

**Panic save / `flushSync()`:** On unmount (navigation away, page close), the `ReaderView` calls `recorder.flushSync()` before `recorder.dispose()`. `flushSync` drains the pending queue synchronously (no sentence snapping — raw CFI ranges), commits the in-flight item if it hadn't committed yet (the async snap may still be in flight but its result will be dropped by the seq guard), and then writes the legacy final-segment panic save if the last-known segment exceeded 2 seconds of dwell.

### 3.7 Annotation CRDT Write

```mermaid
sequenceDiagram
    participant U as "User"
    participant SEL as "selectionBridge"
    participant AS as "useAnnotationStore"
    participant YJS as "Y.Doc (annotations map)"
    participant FST as "Firestore provider"

    U->>SEL: "mouseup on selected text"
    SEL->>AS: "onSelection(cfiRange, range, contents)"
    AS-->>U: "popover shown (ReaderUIStore)"
    U->>AS: "add({ bookId, cfi, text, color })"
    AS->>AS: "generateSecureId() for annotation.id"
    AS->>YJS: "Y.Map.set(id, annotation)"
    YJS->>FST: "Yjs update propagated to Firestore"
    FST-->>YJS: "remote ack"
```

The annotation `add` action in `useAnnotationStore` uses `generateSecureId()` (a `crypto.randomUUID()` wrapper) so IDs are stable across devices. The Yjs middleware intercepts the `annotations` record setter and writes to `yDoc.getMap('annotations')`, which the live Firestore provider picks up and flushes to the cloud within the configured `maxWaitFirestoreTime` debounce window (default 2 000 ms).

---

## 4. Journey 3 — Start TTS Playback

### 4.1 Design Intent

The TTS engine lives in a Web Worker (via Comlink) in the worker-engine configuration, or in-process in the main-thread fallback. The `TtsController` is the single command facade: UI components never import the engine directly. Settings changes push to the engine (store → engine direction); engine events mirror into the ephemeral playback store (engine → store direction). These two directions are structurally separate stores so an engine broadcast cannot echo back as a command (the S6 echo-loop elimination described in [`src/app/tts/TtsController.ts`](../../src/app/tts/TtsController.ts#L29)).

### 4.2 Architecture

```
ReaderCommands (UI)
  └─ useAudioCommands()         src/app/tts/useAudioCommands.ts
       └─ TtsController          src/app/tts/TtsController.ts
            ├─ TtsEngine          (in-process or Comlink proxy)
            │   └─ worker          src/workers/tts.worker.ts
            ├─ useTTSSettingsStore  (persisted, Yjs-synced)
            └─ useTTSPlaybackStore  (ephemeral, never synced)
```

### 4.3 Sequence Diagram

```mermaid
sequenceDiagram
    participant RC as "ReaderCommands"
    participant AC as "useAudioCommands()"
    participant TC as "TtsController"
    participant AI as "ensureAiConsentForBook()"
    participant ENG as "TtsEngine (worker)"
    participant PS as "useTTSPlaybackStore"
    participant RS as "useReadingStateStore"

    RC->>AC: "play()"
    AC->>TC: "controller.play()"
    TC->>AI: "ensureAiConsentForBook(currentBookId)"
    AI-->>TC: "consent resolved"
    TC->>ENG: "engine.play()"
    ENG-->>TC: "PlaybackSnapshot (status: 'playing')"
    TC->>PS: "setState({ isPlaying: true, status, activeCfi })"
    ENG-->>TC: "PlaybackSnapshot (activeCfi updated)"
    TC->>PS: "setState({ activeCfi })"
    ENG->>RS: "addCompletedRange(bookId, cfiRange)"
    ENG->>RS: "updateTTSProgress(bookId, queueIndex, sectionIndex)"
```

### 4.4 The Boot Wiring

`TtsController.initialize()` runs as the `tts/initialize` boot task (inside the `deviceRegistration` phase). It:

1. Reads `useTTSSettingsStore.getState()` and replays all persisted settings into the engine (`setBackgroundAudioMode`, `setBackgroundVolume`, `setPrerollEnabled`, `setSpeed`, `setVoice`).
2. Subscribes `this.engine.subscribe(snap => ...)` — the engine's PlaybackSnapshot stream. Every snapshot is written into `useTTSPlaybackStore`, including the derived `isAudiblePlayback(snap.status)` flag.
3. Subscribes `useTTSSettingsStore.subscribe((s, prev) => ...)` — pushes settings changes to the engine on change (rate, voice, language, preroll, background audio mode, provider switch).

The double-subscription design means the two data flows are completely orthogonal:
- Settings store → engine: push on diff.
- Engine → playback store: push every snapshot.
- Playback store has NO subscription inside `TtsController`: no echo loop.

### 4.5 Section Loading

When the reader navigates to a new section and audio is not playing, `useTTS()` (in [`src/hooks/useTTS.ts`](../../src/hooks/useTTS.ts)) calls `loadSectionBySectionId(currentSectionId, false, currentSectionTitle)` — load without autoplay, so the Play button starts from the current visual location. When the user presses Play, `controller.play()` runs the `withAiConsent()` gate before forwarding to the engine.

### 4.6 The AI Consent Gate

`ensureAiConsentForBook()` is called once per book per session (gated by `currentBookId`) before any play command reaches the engine. It resolves a UI dialog if the user has not yet consented to AI-assisted TTS for this book. The gate is at the egress boundary: **playback itself never blocks on the dialog outcome** — the dialog resolves before the engine is called.

### 4.7 Worker Write-Back (main-thread engine context)

In the worker-engine configuration, the engine runs inside a `tts.worker.ts` Web Worker. Write commands that affect Zustand stores flow back to the main thread via the `EngineHostCommand` typed channel. [`src/app/tts/createWorkerEngineClient.ts`](../../src/app/tts/createWorkerEngineClient.ts) defines `applyHostCommand()`:

```typescript
case 'updateTTSProgress':
  useReadingStateStore.getState().updateTTSProgress(command.bookId, command.queueIndex, command.sectionIndex);
  break;
case 'addCompletedRange':
  useReadingStateStore.getState().addCompletedRange(command.bookId, command.cfiRange, command.type);
  break;
case 'updatePlaybackPosition':
  useReadingStateStore.getState().updatePlaybackPosition(command.bookId, command.lastPlayedCfi);
  break;
```

These writes land in the Yjs-backed `useReadingStateStore`, which propagates them to Firestore and all synced devices.

### 4.8 Settings Sync (Store → Engine)

When the user changes playback speed in the settings UI, the Zustand subscription in `TtsController.initialize()` fires:

```typescript
const rate = selectActiveRate(s);
if (rate !== selectActiveRate(prev)) {
  void this.engine.setSpeed(rate);
}
```

The `selectActiveRate` selector reads the rate from the currently active profile (the persisted `useTTSSettingsStore` supports multiple per-language profiles). The voice-fallback algorithm in `resolveActiveVoice()` picks: saved profile voice for the active language → first voice matching the language → first available voice in any language.

---

## 5. Journey 4 — Cross-Device Sync (Edit on Device A, See on Device B)

### 5.1 Design Intent

All user state (reading progress, annotations, library inventory, reading list, preferences) is stored in a single shared Yjs document (`versicle-yjs` IDB database). The Firestore sync provider acts as a cloud transport for Yjs updates. When Device A makes an edit, the Yjs CRDT merges it and the Firestore provider pushes the encoded update. Device B's provider receives the update, the Yjs doc applies it, and the Zustand stores' Yjs middleware patches the React state automatically. The whole path is CRDT-safe: concurrent edits from both devices resolve without conflicts or data loss.

### 5.2 Architecture

```
Device A: Zustand store setter → Yjs Y.Map.set() → y-idb persistence
                                                  → Firestore provider → cloud

Device B: Firestore provider ← cloud
          → Yjs Y.Doc.applyUpdate() → Zustand middleware patch → React re-render
```

### 5.3 Sequence Diagram

```mermaid
sequenceDiagram
    participant UA as "Device A: UI"
    participant YA as "Device A: Y.Doc"
    participant IDBA as "Device A: y-idb"
    participant FS as "Firestore"
    participant IDBB as "Device B: y-idb"
    participant YB as "Device B: Y.Doc"
    participant ZB as "Device B: Zustand store"
    participant UB as "Device B: UI"

    UA->>YA: "annotations Y.Map.set(id, annotation)"
    YA->>IDBA: "y-idb debounced write (200 ms)"
    YA->>FS: "provider flush (maxWaitFirestoreTime 2s)"
    FS-->>YB: "Firestore snapshot / update"
    YB->>YB: "Y.applyUpdate(remoteUpdate)"
    YB->>ZB: "Yjs middleware observer → store patch"
    ZB->>UB: "React re-render (annotation appears)"
```

### 5.4 The Yjs Provider and y-idb

The shared `Y.Doc` is constructed lazily in [`src/store/yjs-provider.ts`](../../src/store/yjs-provider.ts#L42)
via `getYDoc()`. During the `startYjsPersistence` boot phase, `startYjsPersistence()` creates an
`IndexeddbPersistence('versicle-yjs', getYDoc(), { writeDebounceMs: 200, transactionRunner: runExclusiveIdbWrite })`.
The `transactionRunner` injection is a vendored fork addition ([Vendored forks](66-vendored-forks.md)): it routes all y-idb writes through the cross-context write gate so the TTS worker cannot overlap an active Yjs persistence write.

### 5.5 Sync Initialization

`syncInitTask` in [`src/app/boot/syncInit.ts`](../../src/app/boot/syncInit.ts) runs in the `syncInit` boot phase. It calls `getSyncOrchestratorAsync().then(o => o.start())` — NOT awaited, so network latency never delays the boot sequence.

`SyncOrchestrator.start()` in [`src/domains/sync/core/SyncOrchestrator.ts`](../../src/domains/sync/core/SyncOrchestrator.ts#L117) runs the Firebase auth listener. On sign-in it calls `this.connect(user.uid)`, which:

1. Checks the target workspace is not tombstoned.
2. Runs the quarantine layer 1 pre-attach probe (schema version check via workspace metadata).
3. Creates an automatic `pre-sync` checkpoint (at most once per 24 hours).
4. Awaits `whenLocalSynced()` (waits for the y-idb `synced` event — local data is canonical).
5. Stamps the workspace metadata with the current doc schema version (quarantine layer 3).
6. Checks if the client is a "clean client" (empty doc): if so, runs `performCleanSync` (downloads the remote state, merges into the local doc, then attaches the live provider); otherwise attaches the live provider directly.

### 5.6 ProviderConnection and Event Bus

`ProviderConnection.attach()` in [`src/domains/sync/core/ProviderConnection.ts`](../../src/domains/sync/core/ProviderConnection.ts#L48)
calls `backend.connect(doc, workspaceId, opts)` — this is the `SyncConnection` that holds the Firestore listener. Transport events (`connection-error`, `sync-failure`, `save-rejected`, `synced`, `flushed`) are translated into typed `SyncEvent` bus emissions. The bus's single subscriber (`wireSyncEvents` in `src/app/sync/wireSyncEvents.ts`) owns the UX side effects: toast notifications, sync status stamps in `useSyncStore`, heartbeat start/stop.

### 5.7 Schema Quarantine (Multi-Device Safety)

If Device B runs a newer schema version and Device A connects after being offline:

- **Quarantine layer 1** (pre-attach probe): the orchestrator reads `workspaceMeta.schemaVersion` from the Firestore workspace metadata doc. If `incomingVersion > currentSchemaVersion`, `onObsolete(incomingVersion)` fires — this locks the UI (the `ObsoleteLockView` shown in `App.tsx`) and stops the device heartbeat so the stale client stops announcing itself.
- **Quarantine layer 2** (live observer on `meta` map): `ProviderConnection` installs a `meta` Y.Map observer. If Device B stamps the doc's schema version during a migration, Device A sees the version bump on the live `meta` map and locks itself.
- **Quarantine layer 3** (maintenance stamp): after connecting, the orchestrator stamps the Firestore workspace metadata with the local doc's schema version so layer 1 stays accurate for future connects.

---

## 6. Journey 5 — Backup and Restore

### 6.1 Design Intent

A checkpoint is a binary snapshot of the entire Yjs document state. Checkpoints are created at two trigger points: automatically before each Firestore sync session (at most once per 24 hours) and as a protected pre-migration backup before a workspace switch. The restore operation is destructive — it wipes the live Yjs database and replaces it — but it is always preceded by a `validateSnapshot()` dry-run, so a corrupted checkpoint can never wipe live data (the "validate-before-destroy" discipline).

### 6.2 Architecture

```
CheckpointService        src/domains/sync/checkpoints/CheckpointService.ts
  ├─ captureDoc()        src/data/snapshot/YjsSnapshotService.ts
  ├─ validateSnapshot()  src/data/snapshot/YjsSnapshotService.ts
  ├─ applySnapshot()     src/data/snapshot/YjsSnapshotService.ts (vendored y-idb writeSnapshot)
  └─ checkpoints repo    src/data/repos/checkpoints.ts
```

### 6.3 Sequence Diagram — Create Checkpoint

```mermaid
sequenceDiagram
    participant T as "Trigger (sync/migration)"
    participant CS as "CheckpointService"
    participant YSS as "YjsSnapshotService"
    participant YDOC as "Y.Doc (live)"
    participant IDB as "IndexedDB (checkpoints store)"

    T->>CS: "createCheckpoint('pre-sync', { protected: false })"
    CS->>YSS: "captureDoc(getYDoc())"
    YSS->>YDOC: "Y.encodeStateAsUpdate(doc)"
    YDOC-->>YSS: "Uint8Array (binary snapshot)"
    YSS-->>CS: "stateBlob"
    CS->>IDB: "checkpoints.add({ blob, trigger, timestamp, size })"
    IDB->>IDB: "supersede older protected checkpoints"
    IDB->>IDB: "prune oldest if > CHECKPOINT_LIMIT (10)"
    IDB-->>CS: "checkpoint id (autoIncrement)"
```

### 6.4 Sequence Diagram — Restore Checkpoint

```mermaid
sequenceDiagram
    participant U as "User (RecoverySettings)"
    participant CS as "CheckpointService"
    participant YSS as "YjsSnapshotService"
    participant PERS as "y-idb persistence"
    participant LOCK as "withSwapLock()"
    participant MS as "MigrationStateService"

    U->>CS: "restoreCheckpoint(id, { pauseSync })"
    CS->>IDB: "checkpoints.get(id)"
    IDB-->>CS: "checkpoint (blob)"
    CS->>YSS: "validateSnapshot(blob)"
    Note over YSS: "dry-run on scratch Y.Doc — no destructive step yet"
    CS->>CS: "pauseSync() — sever Firestore connection"
    CS->>LOCK: "withSwapLock(async () => { ... })"
    LOCK->>PERS: "persistence.clearData()"
    LOCK->>PERS: "disconnectYjs()"
    LOCK->>YSS: "applySnapshot(blob)"
    Note over YSS: "writeSnapshot to versicle-yjs — commit-awaited"
    LOCK->>MS: "MigrationStateService.clear()"
    LOCK-->>CS: "lock released"
    CS->>CS: "window.location.reload()"
```

### 6.5 Key Implementation Details

**`captureDoc()`** calls `Y.encodeStateAsUpdate(doc)` — a single binary update representing the full document state as of the call moment. No async steps.

**`validateSnapshot()`** is a dry-run: it constructs a scratch `Y.Doc`, calls `Y.applyUpdate(scratch, update)`, and destroys the scratch doc. Any parse error throws an `AppError` with code `BACKUP_SNAPSHOT_INVALID`. This check runs **before** any destructive step. Its being a separate exported function means it can also be called from the workspace switch path (quarantine on the incoming remote blob).

**`applySnapshot()`** calls the vendored y-idb fork's `writeSnapshot()` primitive, which opens the `versicle-yjs` IDB database directly (not through a live `IndexeddbPersistence` binding) and writes the snapshot in a committed transaction. The promise resolves only after the transaction has committed — providing durability guarantees the old temp-doc approach (which relied on `IDBDatabase.close()` draining in-flight transactions) could not guarantee.

**The cross-tab swap lock** (`withSwapLock`) prevents two tabs from interleaving destructive applies. It uses `navigator.locks.request('versicle-yjs-swap', { mode: 'exclusive' }, work)` where available, with a sequential `fallbackTail` promise chain in jsdom. The lock is also used by the staged workspace swap (Journey 6).

**Protected checkpoints.** The `protected` flag on a checkpoint prevents it from being pruned by the rolling `CHECKPOINT_LIMIT` (10) eviction. Only one protected checkpoint exists at a time: `checkpoints.add()` with `{ protected: true }` supersedes (unprotects) any earlier protected row inside the same transaction before inserting the new one.

**Boot-time restore path.** If `MigrationStateService.getState()` shows `RESTORING_BACKUP` at boot, the `migrationInterceptorTask` calls `CheckpointService.restoreCheckpoint()` before the y-idb persistence binding is created. In this case `getYjsPersistence()` returns `null` so the code falls into the "boot path" branch: `deleteYjsDatabase()` (plain IDB deletion, not a persistence `.clearData()`) then `applySnapshot()`. The result is identical to the runtime path but avoids any live binding.

### 6.6 Failure Modes

| Failure | Behavior |
|---------|----------|
| Corrupted checkpoint (validation fails) | `validateSnapshot()` throws `BACKUP_SNAPSHOT_INVALID` before destructive step — live data untouched. |
| Crash during wipe (after `clearData`, before `applySnapshot`) | y-idb database is empty; next boot re-enters `RESTORING_BACKUP` and retries from staging. |
| Crash after `applySnapshot`, before `MigrationStateService.clear()` | Next boot re-enters `RESTORING_BACKUP`, re-runs the whole restore (idempotent since the snapshot is reapplied cleanly). |

---

## 7. Journey 6 — Staged Workspace Switch

### 7.1 Design Intent

Switching workspace is inherently dangerous: the operation must wipe the current Yjs database and replace it with downloaded remote state. The "staged swap" design (Phase 4 §D4) solves two problems:
1. A crash at any point must leave the user able to resume on next boot, not stuck in a broken state.
2. No destructive step should run before the downloaded remote state has been verified to be a valid Yjs update.

The solution is a three-database dance: staging DB (write verified remote state) → state machine commit → boot-time apply (wipe main + copy from staging) → confirm modal → clear staging.

### 7.2 Architecture

```
WorkspaceService.switch()       src/domains/sync/workspaces/WorkspaceService.ts
  ├─ downloadWorkspaceState()   src/domains/sync/core/downloadWorkspaceState.ts
  ├─ stageWorkspaceState()      src/domains/sync/workspaces/stagedSwap.ts
  ├─ MigrationStateService      src/domains/sync/workspaces/MigrationStateService.ts
  └─ window.location.reload()

Boot interceptor
  └─ applyStagedSwap()          src/domains/sync/workspaces/stagedSwap.ts
       ├─ readSnapshot()        src/data/snapshot/YjsSnapshotService.ts
       ├─ deleteYjsDatabase()   src/data/snapshot/YjsSnapshotService.ts
       ├─ applySnapshot()       src/data/snapshot/YjsSnapshotService.ts
       └─ MigrationStateService.setAwaitingConfirmation()
```

### 7.3 Sequence Diagram — Switch Phase

```mermaid
sequenceDiagram
    participant U as "User (WorkspacePicker)"
    participant WS as "WorkspaceService.switch()"
    participant BE as "SyncBackend (Firestore)"
    participant CP as "CheckpointService"
    participant DL as "downloadWorkspaceState()"
    participant ST as "stageWorkspaceState()"
    participant MS as "MigrationStateService"

    U->>WS: "switch(backend, targetWorkspaceId)"
    WS->>BE: "isWorkspaceAlive(targetWorkspaceId)"
    BE-->>WS: "true"
    WS->>CP: "createCheckpoint('pre-migration', { protected: true })"
    CP-->>WS: "backupId"
    WS->>DL: "downloadWorkspaceState(backend, targetId, opts)"
    Note over DL: "temp Y.Doc + temp provider, 15s timeout"
    DL-->>WS: "Uint8Array remoteBlob"
    WS->>WS: "readUpdateSchemaVersion(remoteBlob)"
    WS->>ST: "stageWorkspaceState(remoteBlob)"
    Note over ST: "validateSnapshot() + deleteYjsDatabase(staging) + applySnapshot(staging)"
    ST-->>WS: "staged durably"
    WS->>MS: "setStaged(targetId, backupId, currentId)"
    WS->>WS: "syncState.setActiveWorkspaceId(targetId)"
    WS->>WS: "window.location.reload()"
```

### 7.4 Sequence Diagram — Boot Apply Phase

```mermaid
sequenceDiagram
    participant BI as "Boot interceptor (migrationInterceptorTask)"
    participant AS as "applyStagedSwap()"
    participant LOCK as "withSwapLock()"
    participant YSS as "YjsSnapshotService"
    participant MS as "MigrationStateService"

    BI->>BI: "MigrationStateService.getState() == STAGED"
    BI->>AS: "applyStagedSwap(state, { pauseSync, setActiveWorkspaceId })"
    AS->>LOCK: "withSwapLock(async () => { ... })"
    LOCK->>YSS: "readSnapshot({ dbName: YJS_STAGING_DB_NAME })"
    YSS-->>LOCK: "blob"
    LOCK->>YSS: "validateSnapshot(blob)"
    Note over LOCK: "destructive window opens"
    LOCK->>YSS: "deleteYjsDatabase()"
    LOCK->>YSS: "applySnapshot(blob)"
    Note over LOCK: "versicle-yjs now holds target workspace"
    LOCK->>LOCK: "setActiveWorkspaceId(target)"
    LOCK->>MS: "MigrationStateService.setAwaitingConfirmation(target, backupId)"
    LOCK-->>AS: "lock released"
    AS->>AS: "window.location.reload()"
```

### 7.5 State Machine

The `MigrationStateService` persists state in `localStorage` (so it survives a page kill). The states and transitions:

```mermaid
stateDiagram-v2
    [*] --> STAGED : "WorkspaceService.switch() commits"
    STAGED --> STAGED : "crash during apply; same state on next boot"
    STAGED --> AWAITING_CONFIRMATION : "applyStagedSwap() completes"
    STAGED --> RESTORING_BACKUP : "applyStagedSwap() throws"
    AWAITING_CONFIRMATION --> [*] : "user confirms (clearStagedState)"
    AWAITING_CONFIRMATION --> RESTORING_BACKUP : "user cancels"
    RESTORING_BACKUP --> [*] : "restoreCheckpoint() completes"
```

### 7.6 Download and Temporary Provider

`downloadWorkspaceState()` in [`src/domains/sync/core/downloadWorkspaceState.ts`](../../src/domains/sync/core/downloadWorkspaceState.ts)
creates a **temporary** `Y.Doc` and a temporary Firestore provider attached to the target workspace. It resolves:
- On the provider's `'synced'` event (the initial handshake has landed): returns `Y.encodeStateAsUpdate(tempDoc)`.
- On a 15-second timeout: resolves with whatever synced so far (an unreachable or empty remote yields an empty update — legacy behavior pinned by the characterization suite).
- On a synchronous connection error (`onAttachError: 'reject'` for the switch path): rejects.

The temp doc and temp provider are **always destroyed** in the `finally` block, regardless of outcome.

### 7.7 Crash Safety Table

The failure table from [`src/domains/sync/workspaces/stagedSwap.ts`](../../src/domains/sync/workspaces/stagedSwap.ts#L21):

| Crash moment | State machine | Recovery |
|-------------|---------------|----------|
| During download/verify/stage | None (no commit) | Old workspace boots untouched; staging junk cleared by next switch. |
| After `setStaged`, before/during apply | STAGED | Apply re-runs from staging on next boot; switch completes. |
| After apply, before user confirms | AWAITING_CONFIRMATION | Existing confirm modal (unchanged P0 semantics). |
| User rolls back / apply throws | RESTORING_BACKUP | Existing pinned-checkpoint restore flow. |

### 7.8 Kill-Mid-Switch Harness

`pauseIfArmed(point)` in `stagedSwap.ts` implements a test-only pause: when the Playwright E2E suite sets `window.__VERSICLE_SWAP_PAUSE__` to a specific `SwapPausePoint` (`'swap:staged'`, `'swap:before-apply'`, `'swap:mid-apply'`), the function parks the async flow forever at that point. The Playwright test then calls `page.close()`, simulating a process kill at exactly that crash boundary. In production the flag is never set so the function is a no-op.

---

## 8. Journey 7 — Semantic Search of an Open Book

### 8.1 Design Intent

Semantic search must never degrade the search the user already has: regex full-text is the
**default path** and stays untouched: the embedding-cosine ranking is **purely additive**, fused on
top via reciprocal-rank fusion only when it is available. Embedding the open book costs Gemini API
quota, so the spend is paced by the cross-provider quota governor at the egress chokepoint — it can
never be bypassed — and is ordered outward from the reading position so the current chapter is
searchable first. CFIs are *not* computed at index time (the chunker has no live reader view); a hit
maps to char offsets at index time and the exact in-book CFI is resolved lazily at click time.

### 8.2 Architecture

The path spans the **search** and **google** domains plus app wiring:

```
ReaderView search box
  └─ app reader controller
       ├─ SearchSession.enqueueEmbedding(bookId, currentCfi)   src/domains/search/SearchSession.ts
       │    └─ EmbeddingIndexer.enqueue()                       src/domains/search/EmbeddingIndexer.ts
       │         ├─ chunkSection() (~320-token windows)         src/domains/search/chunker.ts
       │         ├─ EmbeddingClient.embed() (lazy facade)       src/domains/google/genai/embedding/
       │         │    └─ egress('gemini')  ── QuotaGovernor.acquire ──  src/kernel/quota/
       │         ├─ quantize int8 @ 768 (search worker)         src/workers/search.worker.ts
       │         └─ embeddings repo (packed blob)               src/data/repos/embeddings.ts
       └─ SearchSession.search(bookId, query)
            ├─ regex SearchEngine.searchDetailed()  (always runs — the default)
            ├─ semanticRank() — int8 cosine, query-embed cached  src/domains/search/semanticRank.ts
            ├─ fuseRrf()                                         src/domains/search/rrf.ts
            └─ resolveResultCfi() at click time                 src/app/reader/searchNavigation.ts
```

The two embedding CACHE stores (`cache_embeddings`, `cache_embed_jobs`) were added at **IDB
`DB_VERSION` 27** by the additive `migrateToV27` step. (This is a deviation from the original design,
which reserved v27 for retiring the `sync_log` store / SW legacy-cover fallback; that cleanup was
never done, so the embedding stores *are* the v27 bump and the retirement cleanup becomes the next,
**v28**, bump.)

### 8.3 Sequence Diagram — Embed and Search

```mermaid
sequenceDiagram
    participant RV as "ReaderView"
    participant SS as "SearchSession"
    participant IDX as "EmbeddingIndexer"
    participant EC as "EmbeddingClient"
    participant GW as "NetworkGateway.egress"
    participant QG as "QuotaGovernor"
    participant W as "search worker"
    participant ER as "embeddings repo"
    participant SR as "semanticRank + fuseRrf"
    participant NAV as "searchNavigation"

    RV->>SS: "enqueueEmbedding(bookId, currentCfi)"
    SS->>IDX: "enqueue(bookId, currentCfi, { interactive: true, lane: 'fg' })"
    IDX->>IDX: "orderOutward(sections, spineOrdinalFrom(cfi))"
    loop "per not-yet-embedded section"
        IDX->>IDX: "chunkSection() → ~320-token chunks"
        IDX->>EC: "embed(chunks, { profile: 'document', bookId, lane: 'fg' })"
        EC->>GW: "egress('gemini', …, { estTokens, lane: 'fg' })"
        GW->>QG: "acquire('fg', estTokens)"
        alt "RPD/cooldown exhausted"
            QG-->>GW: "throw NET_RATE_LIMITED"
            GW-->>EC: "(propagates; pass resumes next session)"
        else "admitted"
            QG-->>GW: "(recorded at admission)"
            GW-->>EC: "Response → vectors"
            EC->>EC: "client commit(actualTokens) reconcile"
        end
        IDX->>W: "quantize int8 @ 768 (per-vector scale)"
        IDX->>ER: "put(packed blob) + putJob(resume journal)"
    end
    RV->>SS: "search(bookId, query)"
    SS->>SS: "regex searchDetailed() (always)"
    SS->>SR: "semanticRank() — query embed cached, int8 cosine"
    SR-->>SS: "ranked chunk hits (char offsets)"
    SS->>SR: "fuseRrf(regex, semantic) — RRF k=60"
    SS-->>RV: "fused results"
    RV->>NAV: "user clicks a hit"
    NAV->>NAV: "resolveResultCfi(charOffset) → cfiFromRange → display(cfi)"
```

### 8.4 Foreground Embed-on-Open (Outward from the Reading Position)

The app reader controller calls `SearchSession.enqueueEmbedding(bookId, currentCfi)` —
`bookId`/CFI are passed as **arguments**, never read from a store inside the domain (the
`domains-no-store` boundary). `SearchSession` forwards to the injected `EmbeddingIndexer`, whose
`enqueue()` ([`src/domains/search/EmbeddingIndexer.ts`](../../src/domains/search/EmbeddingIndexer.ts)):

1. Loads the book's extracted text via the injected `SearchTextSource` (the `cache_search_text`
   corpus extraction already produces at import).
2. Orders sections **outward from the reading position** (`orderOutward()` over the spine ordinal
   `spineOrdinalFrom(currentCfi, …)`, falling back to section 0 when the CFI is absent or
   unparseable) — the page the reader is on becomes searchable first, then the pass fans out.
3. Per section, **resume-skips** any `{href, sectionTextHash}` the `cache_embed_jobs` journal already
   records as fully embedded *and* whose vectors are actually present in the persisted row — a
   section the journal marks complete but whose vectors are missing is treated as a miss and
   re-embedded (the corrupt-resume guard).
4. Chunks the section into **~320-token sentence-snapped windows** (`chunkSection()`), embeds the
   chunks through the injected `EmbeddingClient`, **quantizes each float32 vector to int8 at 768 dims
   with a per-vector scale** (the search worker's quantizer, passed as a port so the domain never
   deep-imports the worker), packs the int8 rows + float32 scales into one blob per section, and
   persists the embeddings row plus the resume journal incrementally so a mid-pass abort leaves
   resumable progress.

Each embed threads `consent: { bookId, interactive }` and a quota `lane` to the gateway. The
foreground reader pass is `{ interactive: true, lane: 'fg' }`; the background backfill (Journey 8's
sibling, the `embeddingBackfillTask` boot task) passes `{ interactive: false, lane: 'bg' }` so an
idle path never claims a user gesture and is paced on the slow background lane. Per-chunk
`charStart`/`charEnd` are persisted, but `cfiStart`/`cfiEnd` are left empty — the chunker works on
plain text and cannot produce a CFI without the live reader view (a deviation noted in the design:
chunk→CFI is resolved lazily at click time).

### 8.5 Gateway-Enforced Quota Throttle

Throttling is enforced **inside** `NetworkGateway.egress()`
([`src/kernel/net/NetworkGateway.ts`](../../src/kernel/net/NetworkGateway.ts)), not as a side-car
each client must remember to call, so it cannot be bypassed. The `gemini` destination carries a
`rateLimit` policy; `egress()` applies admission as an ordered pre-flight by calling the injected
`QuotaScheduler.acquire(lane, estTokens)`. The scheduler is the **cross-provider quota governor**
(`src/kernel/quota/` — `QuotaGovernor` + the `ptDay` midnight-Pacific day-key helper + an index
barrel), installed at the composition root via `setQuotaScheduler`. The governor:

- Tracks three windows per lane — sliding-60s **RPM** and **TPM** buckets plus a persisted daily
  **RPD** counter that resets at midnight Pacific (`ptDayString`).
- **Records the spend at admission (`acquire`)**, not at commit, so embeddings — which never call
  `commit` — still count and still persist. This is a deviation from the original design (which
  recorded at commit). `commit(actualTokens)` only reconciles that already-recorded event's token
  estimate to the actual cost; `release()` only frees the foreground claim and is called exactly once
  per egress in the gateway's `finally`.
- Reads its per-lane limits **fresh on every `acquire`** (never cached), so a settings edit takes
  effect on the next call; foreground leases preempt background.
- Persists RPD through an **injected `QuotaStore` port** (kernel touches no storage — the
  `kernel-imports-nothing` rule), wired at the composition root to
  [`src/data/repos/quotaCounter.ts`](../../src/data/repos/quotaCounter.ts), which writes a key in the
  existing `app_metadata` store — **no new store**.

When the daily budget is exhausted or a 429 cooldown is active, `acquire` refuses **before any
network call** by throwing `NetRateLimitedError` (the typed `NET_RATE_LIMITED` AppError, in
[`src/types/errors.ts`](../../src/types/errors.ts), `retryable: true` with a `retryAfterMs` —
deviation: it lives in the AppError taxonomy home, not `kernel/net`). The embedding pass stops and
resumes on the next reading session. The governor's consumers are `GeminiClient`, the cloud TTS
providers, and the embedding client; model rotation on 429 stays in `GeminiClient`, never the
governor (embeddings must not rotate — EM2 and `-001` are incompatible spaces). The free-tier quota
is **per-Google-Cloud-project**, so it is reconciled across the synced device mesh via an additive
`embedSpend` field on each `DeviceInfo` record (no CRDT format change). Editable per-lane limits, a
pause-all switch, and live used-vs-limit meters live in the GenAI settings tab.

### 8.6 Hybrid Ranking and RRF Fusion

`SearchSession.search()` always runs the regex `SearchEngine.searchDetailed()` first
([`src/domains/search/SearchSession.ts`](../../src/domains/search/SearchSession.ts)). The semantic
branch is entered **only** when all of: the semantic ports were injected, semantic search is ON, the
embedding client reports configured, and the book has a non-empty embedded row. When entered,
`semanticRank()` embeds the query once with the *query* profile (the result is **cached** per session
in a `QueryEmbeddingCache` so a repeated query never re-burns the shared daily budget), runs int8
cosine over the book's packed vectors in the worker, and maps each hit to char offsets (re-running
the deterministic chunker only for older rows that lack persisted offsets). The semantic hits are
then fused into the regex result via `fuseRrf()`
([`src/domains/search/rrf.ts`](../../src/domains/search/rrf.ts)): each list contributes
`1/(k + rank)` (standard `k = 60`), summed across both lists, deduped by `${href}|${charOffset}`
with the regex hit's richer fields winning the tie. Exact-match regex wins (names, quotes) survive
while "find the passage about X" semantic hits join, never displacing them.

**Regex is the graceful default** in every off-ramp. When semantic search is off, unconfigured, the
book is not yet embedded, or the semantic path throws an *expected* quota/network error
(`NET_RATE_LIMITED`, a GenAI 429/5xx, or a raw network failure), `search()` returns the regex result
**unchanged** — semantic is purely additive and can never break or regress full-text search. An
*unexpected* error (a genuine bug in the semantic path) is rethrown rather than silently swallowed.

### 8.7 Lazy CFI Jump

A search result carries `charOffset`/`matchLength`, not a CFI. When the user clicks a hit,
`searchNavigation.resolveResultCfi()`
([`src/app/reader/searchNavigation.ts`](../../src/app/reader/searchNavigation.ts)) resolves the char
offsets to a DOM `Range` against the live rendered section, the view's `cfiFromRange` produces the
occurrence CFI, and `display(cfi)` lands the reader on the page containing the match (also adding a
transient highlight). If resolution fails (e.g. re-rendered content), it degrades to the
section-level `display(href)` landing. This keeps the index free of an IDB format change: the
expensive, view-dependent CFI is computed once, at click time, for the one hit the user chose.

### 8.8 Failure Modes

| Failure | Behavior |
|---------|----------|
| Daily RPD / TPM / RPM exhausted, or 429 cooldown active | `QuotaGovernor.acquire` throws `NET_RATE_LIMITED` **before** the network call; the foreground pass stops and resumes on the next reading session; `search()` falls back to regex. |
| Book not yet embedded (pass still running) | The semantic branch sees an empty/absent embedded row → regex result returned unchanged. |
| Crash mid-pass | The `cache_embed_jobs` resume journal + the present-vectors guard let the next session pick up where it left off; a journal-complete-but-vectors-absent section re-embeds. |
| Stamp mismatch (`{model, dims, quant}` changed) | The whole book re-embeds (vectors in the old space can never be converted); the prior resume journal is discarded. |
| Embedding client unconfigured | `enqueue()` and the semantic branch are both no-ops; regex full-text is the path. |

---

## 9. Journey 8 — Cross-Device Cache Hit (the Artifact Lane)

### 9.1 Design Intent

Embedding a book costs Gemini quota; embedding the **same** book again on a second device wastes it.
The "Artifact Lane" mirrors a book's expensive embedding blob into the user's **own** BYO Cloud
Storage (a content-addressed object) plus a small Firestore HEAD-doc directory, so a book embedded
once on Device A is **downloaded** by the user's other devices instead of re-spending quota. The
load-bearing win is placement: the consult runs **before** the quota gate, so a cache hit hydrates
~251 KB and spends **zero** Gemini quota — the consult/download is firebase-SDK-owned and by
construction cannot route through `egress()`, so it never reaches `QuotaGovernor.acquire`. Sharing is
**cross-device only** (same uid, same BYO project); cross-*user* sharing and TTS-audio sharing are
explicitly deferred.

> [!IMPORTANT]
> **CI-PENDING caveat.** Every cloud round-trip — the Firestore+Storage emulator
> put/head/get/delete/sweep, the HEAD-after-Storage ordering, and the `storage.rules` security suite —
> auto-skips when no local emulators are reachable. The Artifact Lane is **code-complete and
> unit-verified against `MockBackend`** (3,296 tests green) but is **NOT yet proven end-to-end against
> real Firebase**. The descriptions below reflect the implemented contract; the real-cloud paths are
> MockBackend-verified, not yet emulator-verified in CI.

### 9.2 Architecture

The lane spans the **sync**, **search**, and **app** layers, implemented in Phases A–D:

```
Device A (upload):
  artifactPublisherTask (boot, idle/heartbeat/share-opt-in)  src/app/boot/artifactPublisher.ts
    ├─ contentKey(contentHash | model | dims | quant | extractionVersion)
    ├─ serializeArtifactBlob(row)                             src/domains/search/artifactBlob.ts
    └─ SyncBackend.putArtifact()  (uploadBytes THEN HEAD doc) src/domains/sync/backend/

Device B (consult, before the quota gate):
  embeddingBackfillTask / reader indexer
    └─ ArtifactConsult                                        src/app/google/artifactConsult.ts
         ├─ probeArtifact()  → SyncBackend.headArtifact()     (Firestore getDoc — cheap)
         └─ hydrateFromArtifact() → SyncBackend.getArtifact() (Storage getBytes)
              ├─ parseArtifactBlob()                          src/domains/search/artifactBlob.ts
              ├─ reconcile sectionTextHash vs live corpus
              └─ putHydrated(row, jobRow)  (one atomic txn)   src/data/repos/embeddings.ts
```

The C3 `SyncBackend` interface gained **five** additive artifact methods — a deviation from the
originally-planned trio: `headArtifact` / `putArtifact` / `getArtifact` (probe / write / read) from
Phase A, plus `deleteArtifactHead` / `sweepArtifacts` (GC) from Phase D. `FirestoreBackend` (the sole
`firebase/storage` importer) gained `uploadBytes` + `getBytes`, widening it from delete-only to
read/write; `MockBackend` carries an in-memory implementation (the only one the test suite exercises
without emulators).

Two cloud tiers, neither in the CRDT — both inside the workspace prefix so the blob is swept by the
existing `purgeStoragePrefix`:

```
users/{uid}/versicle/{workspaceId}/embeddings/{contentKey}.bin   ← payload  (Cloud Storage, ~251 KB)
users/{uid}/versicle/{workspaceId}/embedCache/{contentKey}        ← HEAD doc (Firestore, tiny)
```

### 9.3 Sequence Diagram — Device A Uploads, Device B Hydrates

```mermaid
sequenceDiagram
    participant A as "Device A: artifactPublisherTask"
    participant AE as "Device A: embeddings repo"
    participant BE as "SyncBackend (Firestore + Storage)"
    participant B as "Device B: embeddingBackfill loop"
    participant AC as "Device B: ArtifactConsult"
    participant QG as "Device B: QuotaGovernor"
    participant BR as "Device B: embeddings repo"

    Note over A: "share opt-in ON, heartbeat-active, idle"
    A->>AE: "getRow(bookId) (locally embedded)"
    A->>A: "contentKey(contentHash | model | dims | quant | extractionVersion)"
    A->>A: "serializeArtifactBlob(row)"
    A->>BE: "putArtifact (head-before-put no-op if present)"
    Note over BE: "uploadBytes to Storage FIRST, then setDoc HEAD"

    Note over B: "loaded-but-unread book"
    B->>AC: "probeArtifact(bookId, { interactive: false })"
    AC->>AC: "consent gate + manifest contentHash + key"
    AC->>BE: "headArtifact('embedCache/{key}')"
    BE-->>AC: "ArtifactHead (hit)"
    AC-->>B: "true"
    B->>AC: "hydrateFromArtifact(bookId)"
    AC->>BE: "getArtifact('embeddings/{key}.bin')"
    BE-->>AC: "ArrayBuffer (~251 KB)"
    AC->>AC: "parse + re-derive key (swap guard) + reconcile hashes"
    AC->>BR: "putHydrated(row, jobRow) — one atomic txn"
    AC-->>B: "row (hydrated)"
    B->>B: "continue — embed() NEVER called, QuotaGovernor untouched"
    Note over QG: "acquire never reached → zero Gemini quota"
```

### 9.4 Upload — the ArtifactPublisher (Phase C)

`artifactPublisherTask`
([`src/app/boot/artifactPublisher.ts`](../../src/app/boot/artifactPublisher.ts)) is a
`backgroundTasks`-phase boot task that runs on idle, only on a heartbeat-active device, only when the
default-OFF **"Share AI caches across my devices"** opt-in is on, and is a silent no-op when no cloud
backend is connected. For each locally-embedded, upload-consented book it derives the content key
from the embedding **row's** stamp (not live config, so the object is addressed by what was actually
embedded), serializes the blob via `serializeArtifactBlob`
([`src/domains/search/artifactBlob.ts`](../../src/domains/search/artifactBlob.ts)), and calls
`putArtifact` — which is **idempotent** (head-before-put: an already-present key is a no-op) and
writes **blob-to-Storage first, HEAD-doc second**, so a HEAD hit always implies the bytes landed.

### 9.5 Consult Before the Quota Gate (Phase B)

`ArtifactConsult` ([`src/app/google/artifactConsult.ts`](../../src/app/google/artifactConsult.ts)) is
the app-layer adapter that holds the store/manifest/backend edges the store-free codec and the
injected backend cannot reach. Two operations, both consulted **before** any embed:

- **`probeArtifact`** — consent gate first, then resolve `bookId → contentHash` via the manifest,
  derive the content-addressed `contentKey`, and `headArtifact` the `embedCache/{key}` doc (a cheap
  Firestore `getDoc`, never a Storage `list`). A `null` HEAD is a miss.
- **`hydrateFromArtifact`** — `getArtifact` the blob, parse the header, **re-derive the content key
  from the blob's own stamp and assert it matches** (a swap/bit-rot guard), reconcile each blob
  section's `sectionTextHash` against the live local corpus (dropping sections whose text has since
  changed — they re-embed next pass), then write the local embeddings row + job row in **one atomic
  transaction** via `putHydrated` (so a crash can never leave a section marked complete with absent
  vectors).

The crucial placement is in the **background backfill loop**: `runEmbeddingBackfill`
([`src/app/boot/embeddingBackfill.ts`](../../src/app/boot/embeddingBackfill.ts)) probes + hydrates
**before** its cross-device `remaining <= 0` quota gate, so even a device that has used up its daily
share still reuses a peer's embeddings for free. (The foreground reader path consults inside the
indexer's `enqueue`, which has no such gate.) Because `headArtifact`/`getArtifact` are SDK-mediated
(`via: 'sdk'`, not `'gateway'`), they cannot route through `egress()` and therefore never reach
`QuotaGovernor.acquire` — a full hit provably spends zero Gemini quota.

**Read-path consent is a hard requirement.** Downloading a peer's blob persists Google-derived
full-text vectors locally — consent-equivalent to a freshly-embedded row — but the firebase download
is `consent: 'oauth'`/`via: 'sdk'`, so the gateway's per-book gate is structurally unreachable.
Therefore both `probeArtifact` and `hydrateFromArtifact` are gated in the app layer by the **same
predicate** the embed they replace would require: the `makeArtifactConsentGate` helper ANDs the
share-AI-caches master switch into `(interactive || preEmbedLibrary || perBook === true)`. With
sharing OFF, every book is denied regardless of gesture or per-book bit. The upload path and the
consult path share this one consent predicate.

### 9.6 Lifecycle and GC (Phase D)

| Concern | Behavior |
|---------|----------|
| Per-book cloud delete | `LibraryService.remove` ([`src/domains/library/LibraryService.ts`](../../src/domains/library/LibraryService.ts)) resolves `contentHash` off the manifest and deletes the HEAD doc (`deleteArtifactHead`) **before** `deleteBook` destroys that manifest row; best-effort, never aborts the local delete. The content-addressed **blob is deliberately left** for the sweeper, since a sibling device may still need those bytes. |
| Persist-on-evict | Local IDB LRU eviction never touches the cloud mirror, with a **never-evict-a-book-whose-upload-is-unconfirmed** rule (the upload is opt-in/best-effort and may never have run — evicting would destroy the only copy). |
| Cloud sweeper | A separate `artifactSweeperTask` boot task ([`src/app/boot/artifactSweeper.ts`](../../src/app/boot/artifactSweeper.ts)) calls `sweepArtifacts(workspaceId, { ttlMs, now, budgetBytes })`, deleting both the HEAD doc and its sibling blob past TTL or over budget. |
| Workspace purge | `embedCache` is in `FirestoreBackend`'s `PURGE_SUBCOLLECTIONS` (deviation: wired in **Phase A**, not Phase D as originally scheduled), so a workspace delete sweeps the HEAD docs along with the blobs. |
| Drift metric | `hydrateFromArtifact` counts a HEAD-hit-but-object-absent observation (`getArtifactDriftCount`), self-heals by deleting the stale HEAD doc, and re-embeds — so steady-state drift is observable. |

### 9.7 Failure Modes

| Failure | Behavior |
|---------|----------|
| Consent denied (share off, no per-book bit) | `probeArtifact` → `false`, `hydrateFromArtifact` → `null`; the book is embedded normally (or, on a quota-exhausted bg device, skipped). |
| No backend / no `contentHash` (older book) | Cheap no-network short-circuit → `false`/`null`; falls through to per-device embed (no benefit, no error). |
| Definitive miss (`storage/object-not-found`) | `getArtifact` returns `null` → re-embed. |
| Transient / permission error on `getArtifact` | **Rethrown** — never mistake an offline blip for a miss and waste quota re-embedding (opposite polarity to `isWorkspaceAlive`'s fail-safe). |
| Stamp mismatch (re-derived key ≠ requested) | Blob rejected (swap/bit-rot guard) → `null` → re-embed. |
| HEAD present but blob absent | Drift counted + logged, stale HEAD self-healed, returns `null` → re-embed. |
| Section text diverged since upload | That section is dropped on reconcile and re-embedded next pass (partial reuse); the job row marks only the survivors complete. |

---

## 10. Cross-Cutting Architecture Observations

### 10.1 The Three-Layer Write Pattern

All journeys follow the same three-layer write pattern, which enforces the layering invariants ([Layering and boundaries](11-layering-and-boundaries.md)):

```mermaid
graph TD
    A["Domain service or store action"] --> B["KeyedMutex or write gate"]
    B --> C["IDB transaction (bookContent / y-idb)"]
    B --> D["Yjs Y.Map write (CRDT)"]
    D --> E["Firestore provider flush"]
    C --> F["IndexedDB commit"]
```

1. **Mutual exclusion** — per-book operations run under `KeyedMutex`; IDB writers use `runExclusiveIdbWrite`; staged swap and restore use `withSwapLock`.
2. **Validate before destroy** — every snapshot or import write that replaces existing data validates the incoming bytes on a scratch object first.
3. **Domain isolation** — domain modules never import stores. Store handles (inventory port, reading state port, etc.) are injected by the composition root (`src/app/library/createLibrary.ts`, `src/app/sync/createSync.ts`).

### 10.2 The FIFO Queue Pattern

Two FIFO queues appear in the codebase:
- `ImportOrchestrator` normal/idle queue: serializes import, restore, reprocess, and reingest jobs globally with two priority classes.
- `ReadingSessionRecorder` per-book FIFO: serializes recording commits so location updates are always applied in event order.

Both use the same `pumping` flag guard pattern: a single boolean ensures only one async pump is in flight at a time.

### 10.3 Yjs as the Sync Backbone

All journeys that produce user-visible state changes write through Yjs:
- Import → `inventory.upsert()` → Y.Map → Firestore → Device B
- Annotation → `useAnnotationStore.add()` → Y.Map → Firestore → Device B
- TTS progress → `updateTTSProgress()` → Y.Map → Firestore → Device B
- Workspace switch (target data) → `applySnapshot(blob)` → y-idb → Device B reads on boot
- Cross-device AI spend → `embedSpend` nested field on `DeviceInfo` → Y.Map → Firestore → other devices

The one exception is static book content (EPUB binary, extracted TTS prep, search corpus) which lives only in `EpubLibraryDB` (IndexedDB) and is never replicated through Yjs or Firestore. This is intentional: binary content is too large for a CRDT document. The embedding vectors (Journeys 7–8) are the same shape — device-local regenerable CACHE in IDB; the **only** cross-device coordination they need rides the existing synced device mesh (`embedSpend`) and the cloud Artifact Lane (Firestore HEAD docs + Cloud Storage blobs), neither of which touches the CRDT (the terminal v9 schema is unchanged).

### 10.4 Quota and the Egress Chokepoint

Journeys 7–8 add a second policy that, like consent, is enforced **inside** `NetworkGateway.egress()` so no client can forget it: cross-provider quota admission. The `QuotaGovernor` (`src/kernel/quota/`) keeps in-memory RPM/TPM windows + a persisted RPD counter, records spend at `acquire`, and refuses backpressured calls with the typed `NET_RATE_LIMITED` AppError *before* any network call. The placement is what makes the Artifact Lane's cost win possible: the consult/hydrate path is SDK-mediated (`via: 'sdk'`), so it cannot route through `egress()` and never reaches `acquire` — a cache hit is provably zero-quota.

### 10.5 Ephemeral vs. Persisted vs. Synced State

| State | Store | Synced | Persisted |
|-------|-------|--------|-----------|
| Annotations | `useAnnotationStore` | Yes (Yjs) | Yes (y-idb) |
| Reading progress | `useReadingStateStore` | Yes (Yjs) | Yes (y-idb) |
| Library inventory | `useLibraryStore` | Yes (Yjs) | Yes (y-idb) |
| TTS settings (rate, voice) | `useTTSSettingsStore` | Yes (Yjs) | Yes (y-idb) |
| TTS playback status | `useTTSPlaybackStore` | No | No (ephemeral) |
| Reader UI state | `useReaderUIStore` | No | No (ephemeral) |
| Static book metadata | `libraryViewStore` projection | No | No (IDB only, non-CRDT) |
| Sync connection status | `useSyncStore` (partial) | Partial | Yes (Yjs, some fields) |
| Embedding vectors / resume journal | `cache_embeddings` / `cache_embed_jobs` | No | No (IDB only, regenerable CACHE) |
| Cross-device AI spend | `useDeviceStore` (`embedSpend` on `DeviceInfo`) | Yes (Yjs) | Yes (y-idb) |
| Quota daily counter (RPD) | `quotaCounter` repo (`app_metadata` key) | No | Yes (IDB only, non-CRDT) |

---

## 11. Related Documents

For deeper coverage of individual subsystems touched by these journeys:

- [Bootstrap and lifecycle](14-bootstrap-and-lifecycle.md) — the boot sequence all journeys assume.
- [State management](13-state-management-crdt.md) — the Yjs CRDT model, store definitions, and hydration.
- [Storage gateway](20-storage-gateway.md) — IDB connection lifecycle, write gate, and the data layer.
- [Domain library](37-domain-library.md) — the full import/offload/restore domain.
- [Reader engine](30-domain-reader-engine.md) — epub.js engine, location system, and selection bridge.
- [Domain search](38-domain-search.md) — the search worker, regex engine, embedding indexer, RRF fusion, and the Artifact Lane codec.
- [Domain google](39-domain-google.md) — the GenAI four-part client pattern, the embedding client, and the quota governor's wiring.
- [TTS engine](32-domain-audio-tts-engine.md) — the TTS engine, worker bridge, and provider model.
- [TTS app integration](51-tts-app-integration.md) — `TtsController`, `useAudioCommands`, boot wiring.
- [Domain sync](36-domain-sync.md) — `SyncOrchestrator`, `WorkspaceService`, quarantine layers, the C3 `SyncBackend` (incl. the five artifact methods).
- [Backup and restore](23-backup-and-restore.md) — checkpoint format, pruning, and recovery flows.
- [Error handling and recovery](15-error-handling-and-recovery.md) — failure modes, `SafeModeView`, migration failure view.
- [E2E verification](64-e2e-verification.md) — the Playwright test harness for the workspace switch crash-safety matrix.
