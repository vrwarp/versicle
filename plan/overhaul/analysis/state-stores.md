# Subsystem analysis: State management (Zustand + Yjs bridge)

Key: `state-stores`
Scope: `src/store/**`, `src/hooks/use-local-storage.ts`, the forked `zustand-middleware-yjs` dependency, and the boundary between stores and the rest of the app.
All paths relative to repo root. Line numbers verified against the working tree at analysis time.

---

## What it is

The global state layer of Versicle. ~22 Zustand stores hold all user-visible state. Nine of them are wrapped with a forked `zustand-middleware-yjs` (github:vrwarp/zustand-middleware-yjs) that mirrors store state into named `Y.Map`s on a singleton `Y.Doc` (`src/store/yjs-provider.ts:17`), which is persisted to IndexedDB via forked `y-idb` and synced to Firestore by `FirestoreSyncManager`. Five stores persist device-local state to `localStorage` via `zustand/persist`. The rest are ephemeral in-memory UI state. `selectors.ts` builds the "library view model" (books + covers + progress + reading list) consumed by the library and reader UIs.

This subsystem is the source of truth for the entire app: inventory, reading progress, annotations, preferences, vocabulary, lexicon rules, AI analysis cache, device registry, TTS settings, and sync configuration.

---

## File inventory

### Yjs-synced stores (CRDT-backed, cross-device)

| File | Y.Map name | Role |
|---|---|---|
| `src/store/useBookStore.ts` (101 ln) | `library` | Synced book inventory (`books: Record<bookId, UserInventoryItem>`) + `__schemaVersion` marker |
| `src/store/useReadingStateStore.ts` (491 ln) | `progress` | Per-device reading progress `bookId → deviceId → UserProgress` (CFI, %, completed ranges, up to 500 reading sessions); also TTS queue position |
| `src/store/useAnnotationStore.ts` (196 ln) | `annotations` | Highlights/notes CRUD + (mistakenly synced) popover UI state |
| `src/store/usePreferencesStore.ts` (123 ln) | `preferences/<deviceId>` | Theme, fonts, layout, Chinese-reading prefs; one top-level map **per device** |
| `src/store/useReadingListStore.ts` (51 ln) | `reading-list` | Reading list entries keyed by filename |
| `src/store/useVocabularyStore.ts` (57 ln) | `vocabulary` | Known Chinese characters map |
| `src/store/useLexiconStore.ts` (112 ln) | `lexicon` | TTS pronunciation rules + per-book Bible lexicon settings |
| `src/store/useContentAnalysisStore.ts` (245 ln) | `contentAnalysis` | AI-generated section analysis cache (`bookId/sectionId` keys) |
| `src/store/useDeviceStore.ts` (136 ln) | `devices` | Device registry with UA parsing, heartbeat throttling |

### localStorage-persisted stores (device-local)

| File | persist name | Role |
|---|---|---|
| `src/store/useTTSStore.ts` (528 ln) | `tts-storage` v3 | TTS settings (per-language profiles, provider, **API keys**) + live engine mirror (status/queue/activeCfi) + command facade |
| `src/store/useGenAIStore.ts` (113 ln) | `genai-storage` | Gemini API key, model, feature flags, **request logs (≤500)** |
| `src/store/useDriveStore.ts` (83 ln) | `drive-config-storage` | Linked Drive folder + file index + fuzzy finder |
| `src/store/useLocalHistoryStore.ts` (32 ln) | `local-history-storage` | `lastReadBookId` perf shortcut |
| `src/store/useGoogleServicesStore.ts` (41 ln) | `google-services-storage` | Connected Google services + client IDs |
| `src/lib/sync/hooks/useSyncStore.ts` (out of dir) | `sync-storage` | Firebase config/status, onboarding, workspace id |

### Ephemeral stores

| File | Role |
|---|---|
| `src/store/useLibraryStore.ts` (798 ln) | **Not a state store in practice** — import/restore/offload/hydration *workflow engine* + transient caches (`staticMetadata`, `offloadedBookIds`, import progress flags) |
| `src/store/useUIStore.ts` (26 ln) | 2 flags: global settings dialog open, obsolete-schema lock |
| `src/store/useReaderUIStore.ts` (73 ln) | Reader session UI (toc, immersive, section) + **function-valued callback registry** (`playFromSelection`, `jumpToLocation`) + compass state |
| `src/store/useToastStore.ts` (41 ln) | Single-toast notification state (no queue) |
| `src/store/useBackNavigationStore.ts` (60 ln) | Priority-ordered back-button handler registry |
| `src/hooks/useSidebarState.ts` (out of dir) | `useSidebarStore` — which reader side panel is open |
| `src/lib/tts/CostEstimator.ts` (out of dir) | `useCostStore` — session character count |

### Infrastructure

| File | Role |
|---|---|
| `src/store/yjs-provider.ts` (244 ln) | Y.Doc singleton, y-idb persistence, `CURRENT_SCHEMA_VERSION = 5`, migration runner, obsolete-client quarantine, `getYjsOptions()` shared middleware config |
| `src/store/selectors.ts` (416 ln) | `useAllBooks`/`useBook`/`useLastReadBook*` view-model hooks with hand-rolled module-level memoization |
| `src/store/index.ts` (1 ln) | Dead: contains only `// Store export` |
| `src/store/README.md` | Stale: documents 8 of 22 stores; references test files that don't exist |
| `src/hooks/use-local-storage.ts` (135 ln) | `useLocalStorage` hook — **zero production consumers**, 7 test files |
| `node_modules/zustand-middleware-yjs/dist/yjs.mjs` | Forked bridge: deep-diffs store state ↔ Y.Map, microtask-batched in/out, atomicKeys/disableYText options, schema-version check, onLoaded hook |

### Tests in scope
- `useLibraryStore`: 6 files (`*.test`, `.race`, `.removeRace`, `.restoreRace`, `.offloadedRace`, `.offloadRevert`) — five are single-bug race regressions.
- `useTTSStore`: 3 files with inconsistent naming (`useTTSStore.test.ts`, `useTTSStore_platform.test.ts`, `useTTSStore_voice_recall.test.ts`).
- `use-local-storage`: 7 files (`-bug`, `-closure`, `-predictability`, `-quota`, `-sync`, `.test.ts`, `.test.tsx`), several duplicating the same assertion (e.g. `use-local-storage.test.ts` and `-predictability.test.ts` are the same test).
- `yjs-provider.migration-race.test.ts` asserts implementation details (`queueMicrotask` was called, `setTimeout` was not).
- `selectors.test.ts` (673 ln, 16 tests), `selectors.perf.test.ts` (perf benchmark inside the unit suite).

---

## How it works (data & control flow)

### Outbound (store → Y.Doc)
Every `set()` on a yjs-wrapped store schedules a microtask (`yjs.mjs:650-657`) that deep-diffs the **entire store state** against the Y.Map's JSON (`patchSharedType`, `yjs.mjs:367`) inside a `doc.transact` with the store API as origin. All non-function keys are mirrored — there is **no partialize/whitelist concept** in the middleware. `disableYText: true` (set globally in `getYjsOptions`, `yjs-provider.ts:196`) stores strings as plain values; `atomicKeys` exempts keys from Y.Text conversion (only used for `__schemaVersion` in `useBookStore.ts:99`). A captured `previousState` protects against deleting keys inserted concurrently by remote peers (`yjs.mjs:420-425`).

### Inbound (Y.Doc → store)
`map.observeDeep` ignores own-origin transactions, batches via microtask, and calls `patchStore` → `store.setState(patchState(old, map.toJSON()), /*replace*/ true)` (`yjs.mjs:624-627`). `patchState` computes changes from the map JSON; crucially `getRecordChanges` (`yjs.mjs:187-209`) emits `DELETE` for any non-function key present in state but absent from the map JSON.

### Persistence & sync
`y-idb` `IndexeddbPersistence('versicle-yjs', yDoc, { writeDebounceMs: 200, transactionRunner: runExclusiveIdbWrite })` (`yjs-provider.ts:30-33`). `FirestoreSyncManager` applies remote updates directly to `yDoc` (`src/lib/sync/FirestoreSyncManager.ts:464`) and awaits `waitForYjsSync()` before going online.

### Versioning & migrations
`getYjsOptions()` injects `schemaVersion: 5`, `onObsolete: handleObsoleteClient`, `onLoaded: runMigrations` into **all nine** yjs stores. The middleware checks `map.get('__schemaVersion')` per map on every inbound transaction (`yjs.mjs:682-689`) — only the `library` map actually contains that key. `runMigrations` double-defers via nested `queueMicrotask` to outrun the middleware's own inbound microtask (`yjs-provider.ts:182-184`), then runs v1→v2 (prune bad reading sessions), v2/3→v4 (bump only), v4→v5 (init `fontProfiles`), with every store accessed through dynamic `import()` and every failure silently swallowed (`yjs-provider.ts:136-138, 163, 169-171`).

### Boot sequence (App.tsx)
`getDB()` → `waitForYjsSync()` → `useTTSStore.initialize()` (subscribes the store to the audio player) → device registration → **a hand-rolled poll loop waiting for `useBookStore` to be non-empty (10 × 100 ms, `App.tsx:269-273`)** → `hydrateStaticMetadata()` loads covers/manifests from IDB into `useLibraryStore.staticMetadata`.

### View model
`selectors.ts:useAllBooks` merges 4 stores (inventory, static metadata, progress, reading list) into the book list using a module-level cache mutated during render (`selectors.ts:12-32, 95-281`) with two-phase rebuilds and WeakMap-keyed per-book caching, because the `progress` map changes referentially on every page turn.

### Cross-store writes inside actions
- `useLibraryStore.addBook/addBooks/restoreBook` read `useTTSStore` (segmentation settings), write `useBookStore` (inventory) and `useReadingListStore` (entries), and mutate own transient caches — a 5-store saga per import (`useLibraryStore.ts:304, 364-385, 426, 473, 500, 539-559, 581, 734`).
- `useReadingStateStore.updateLocation/updateReadingSession` write `useLocalHistoryStore` and upsert `useReadingListStore`, reading `useBookStore` + `useLibraryStore` for titles (`useReadingStateStore.ts:134-177, 334-348`) — the reading-list projection block is duplicated verbatim.
- `yjs-provider.handleObsoleteClient` lazily imports `useSyncStore` and `useUIStore` (`yjs-provider.ts:64-73`).
- Reverse coupling: the DB layer `src/db/BookRepository.ts:11-12` imports `useBookStore` and `useContentAnalysisStore` to merge inventory into metadata reads.
- 160 `*.getState()` call sites outside `src/store` (services and components imperatively reaching into stores).

---

## Technical debt

### D1. Ephemeral popover UI state is synced through the CRDT to other devices
- **Severity: critical** | **Category: correctness**
- **Evidence:** `useAnnotationStore` is yjs-wrapped (`useAnnotationStore.ts:83-190`) and its state includes `popover: PopoverState` declared "Transient UI state (not synced)" (`useAnnotationStore.ts:35-37, 92-98`). The forked middleware mirrors **every non-function key** into the Y.Map — `getRecordChanges`/`patchSharedType` have no exclusion mechanism (`yjs.mjs:187-209, 367-506`; `YjsOptions` in `dist/index.d.ts` has only `atomicKeys/disableYText/yTextKeys/onLoaded/schemaVersion/onObsolete`). UI renders from this state: `src/components/reader/ReaderView.tsx:547` (`state.popover.visible`), `ReaderControlBar.tsx:29-30`.
- **Impact:** Every popover open/move/close writes to the Y.Doc → debounced IDB write → Firestore sync traffic. Inbound sync **replaces** local state (`setState(..., true)`), so device B receives device A's `popover.visible: true` with A's screen coordinates — phantom popovers and popovers that close themselves mid-interaction when any remote update arrives. Also bloats the CRDT history with pointer coordinates.
- **Fix:** Either (a) move popover state into an ephemeral store (e.g. `useReaderUIStore`), or (b) add a `syncedKeys` whitelist option to the forked middleware and apply it everywhere. One-time cleanup migration: delete the `popover` key from the `annotations` Y.Map (map keys are deletable; only top-level shared types are not).

### D2. Inbound hydration deletes any state key missing from the Y.Map — new fields can't be added safely
- **Severity: critical** | **Category: correctness / type-safety**
- **Evidence:** `patchStore` calls `setState(patchState(old, map.toJSON()), true)` and `getRecordChanges` emits `DELETE` for every non-function key in state not present in map JSON (`yjs.mjs:187-193, 624-627`). Consequences visible everywhere: defensive `state.books || {}` (`useBookStore.ts:58, 71, 79`), `state.entries || {}` (`useReadingListStore.ts:23, 27, 35`), `if (!progress) return null` (`useReadingStateStore.ts:414`), `booksRaw || {}` memo fallbacks (`selectors.ts:66-78`), `state.sections || {}` in all 8 ContentAnalysis actions. The v4→v5 migration exists **specifically to re-add `fontProfiles`** after hydration deletes it (`yjs-provider.ts:149-165`), since any field added to a yjs store's initial state is wiped on first load from an older doc.
- **Impact:** Every store's TypeScript contract is a lie at runtime (`books: Record<...>` can be `undefined`). Adding a field to a synced store silently breaks for all existing users unless a migration backfills it — a hidden tax on every schema evolution, discovered one crash at a time. AI agents repeatedly re-patched symptoms (`|| {}`) instead of the cause.
- **Fix:** Change the fork's inbound patch to merge over the store's declared initial/default state instead of replace-with-delete (treat map JSON as a partial overlay; only delete keys that the previous map version contained — it already tracks `previousState` for the outbound path). Then remove the ~20 defensive fallbacks and the type escapes.

### D3. Library import/restore/offload are race-prone multi-store sagas living inside a Zustand store
- **Severity: critical** | **Category: architecture / correctness**
- **Evidence:** `useLibraryStore.ts` (798 ln) holds the entire import pipeline: duplicate detection against two sources (`useLibraryStore.ts:273-292`), overwrite flow, "ghost book" metadata matching (394-471), batch import (571-654), restore-vs-download branching (721-786), plus hand-written compare-and-set guards against concurrent mutations: snapshot-and-compare of `offloadedBookIds` (146, 202-233), "zombie resurrection" guards repeated in four places (337, 443, 509, 754). Five separate race-condition regression test files exist for this one store (`useLibraryStore.race.test.ts`, `.removeRace`, `.restoreRace`, `.offloadedRace`, `.offloadRevert`). `App.tsx:269-273` polls `useBookStore.getState().books` in a 100 ms sleep loop waiting for the middleware to hydrate.
- **Impact:** Every new library operation must re-derive the same ad-hoc concurrency discipline; the five race tests document five production bugs from the same root cause (interleaved async workflows over shared mutable state with no serialization). The store cannot be reasoned about locally — correctness depends on the interleaving of `set()` calls across three stores and IDB.
- **Fix:** Extract a `LibraryService` owning import/restore/offload/remove as explicit workflows serialized by a per-book keyed mutex (a 20-line async queue). The store shrinks to a dumb cache (`staticMetadata`, `offloadedBookIds`, progress flags) written only by the service. Replace the App.tsx poll loop with an awaited "inventory hydrated" signal from the provider.

### D4. Migration runner is temporally fragile and fails silently
- **Severity: high** | **Category: correctness / architecture**
- **Evidence:** `runMigrations` is registered as `onLoaded` for all nine yjs stores via `getYjsOptions()` (`yjs-provider.ts:195`), so it fires up to nine times per boot; idempotence relies on a version check that is itself bumped inside async `.then()` callbacks (`yjs-provider.ts:134, 144, 162`), so concurrent invocations can all read `__schemaVersion = 1`. Correct ordering versus the middleware's inbound microtask is achieved by **nested `queueMicrotask`** ("to jump behind zustand-middleware-yjs's microtask", `yjs-provider.ts:174-184`) — a dependency on undocumented internals of the fork, pinned by a test that asserts spy counts on `queueMicrotask` (`yjs-provider.migration-race.test.ts:15-24`). All migration errors are swallowed: `.catch(() => {})` / "Silently ignore" (`yjs-provider.ts:136-138, 163, 169-171`).
- **Impact:** A failed or doubly-applied migration corrupts synced data with no signal. Adding migration v6 requires understanding microtask ordering across three modules. The silent catches (justified as "test env" guards) also hide real production failures.
- **Fix:** Single migration coordinator: provider exposes `whenHydrated(): Promise` (resolves after all stores applied their first inbound batch); migrations run once, awaited, before the app renders; version bump is atomic with the transform inside one `yDoc.transact`; failures surface to the safe-mode UI. Delete the nested-microtask hack and its spy test.

### D5. Schema quarantine only guards the `library` map and has a corruption window
- **Severity: high** | **Category: correctness**
- **Evidence:** The middleware's obsolete check reads `map.get('__schemaVersion')` on the store's **own** map (`yjs.mjs:682-689`), but only `useBookStore` carries that key (`useBookStore.ts:15, 51`). For the other eight maps `incomingVersion` is always 0, so newer-schema data in `progress`/`annotations`/etc. is applied to local state and persisted by y-idb (200 ms debounce) regardless. Quarantine for the library map then runs `handleObsoleteClient`, which severs sync via two **async dynamic imports** (`yjs-provider.ts:64-73`) — the doc has already merged and may already be persisted before `setFirestoreStatus('disconnected')` lands.
- **Impact:** An old client syncing against a newer peer can wedge new-format progress/annotation data into its local IDB before locking, defeating the quarantine's purpose ("prevent data corruption", `yjs-provider.ts:56`).
- **Fix:** Store the schema version once in a dedicated `meta` map; check it synchronously in `FirestoreSyncManager` **before** applying any remote update to `yDoc` (it already imports `CURRENT_SCHEMA_VERSION`, `FirestoreSyncManager.ts:15`), and make the UI lock synchronous (direct import — `useUIStore` has no dependencies, the "circular deps" comment is obsolete for it).

### D6. Dense store-to-store coupling web; domain logic split arbitrarily between stores and services
- **Severity: high** | **Category: architecture**
- **Evidence:** `useLibraryStore` imports 3 stores + 4 services (`useLibraryStore.ts:1-12`); `useReadingStateStore` imports 4 stores (`useReadingStateStore.ts:5-7`) and duplicates an identical reading-list-projection block in two actions (163-177 vs 334-348); `useTTSStore` lazily imports `useToastStore` to show a warning (`useTTSStore.ts:196-198`) and calls `LexiconService` (363-366); `yjs-provider` lazily imports 4 stores; DB layer reads stores (`BookRepository.ts:11-12`); 160 `getState()` call sites outside `src/store`. Three stores live outside `src/store` (`useSyncStore`, `useSidebarStore`, `useCostStore`).
- **Impact:** No layering: stores call services, services call stores, the DB layer calls stores. Changing the reading-list shape requires touching reading-state actions; changing TTS settings shape requires touching library import. Import cycles are dodged with lazy `import()` rather than fixed. Onboarding a new feature means guessing where its logic belongs.
- **Fix:** Enforce a rule: stores hold state + pure reducers only; cross-domain reactions live in services/orchestrators that subscribe to stores (`store.subscribe`) or receive domain events. Concretely: reading-list upsert becomes a single projection subscribed to progress changes; segmentation options are passed into `BookImportService` by the caller; all stores move under `src/store/`.

### D7. `useTTSStore` conflates persisted settings, a live engine mirror, and a command facade — with engine side effects at module import
- **Severity: high** | **Category: architecture**
- **Evidence:** One store holds: persisted per-language profiles/API keys (`useTTSStore.ts:23-89, 487-505`), volatile engine mirror state (`status`, `queue`, `activeCfi`, `isPlaying`, download progress — written by the player subscription in `initialize()`, 233-258), and pass-through commands (`play/pause/stop/jumpTo/seek` → `getAudioPlayer()`, 260-268, 437-442). `persist.onRehydrateStorage` calls `getAudioPlayer()` and configures it **during store module initialization** (506-525), so importing the store boots the TTS engine composition root — every test must mock `mainThreadAudioPlayer` (`useTTSStore_voice_recall.test.ts:4-15`). `loadVoices` is async and unsequenced; `setProviderId` fire-and-forgets it (313-317) and `setApiKey` re-triggers it (318-328), so concurrent calls interleave `set({voices})`/voice-fallback writes. `syncState` (127-131, 447-454) is dead code — zero callers — with a stale comment claiming "called by AudioPlayerService". Every engine status tick triggers `persist`'s localStorage serialization even though no persisted field changed.
- **Impact:** The TTS subsystem's worker/main-thread duality (which already has its own replication spec, `src/lib/tts/engine/replicationSpec.ts:58-68` reading `useTTSStore.getState()`) is entangled with settings persistence; ownership of "current voice" is split between `voice`, `profiles[lang].voiceId`, and the player. Race tests (`useTTSStore_voice_recall.test.ts`) exist because of this split-brain.
- **Fix:** Split into `useTTSSettingsStore` (persisted, no engine imports; engine reads it via the existing EngineContext port) and `useTTSPlaybackStore` (ephemeral mirror, written only by the player subscription). Commands become functions on the engine handle, not store actions. Delete `syncState`. Move engine configuration out of `onRehydrateStorage` into the explicit `initialize()` path that App.tsx already awaits.

### D8. Progress-resolution and session-merge logic duplicated 3–4×
- **Severity: high** | **Category: duplication**
- **Evidence:** "Local device first if >0.5%, else most-recent valid, else local" exists in: `useReadingStateStore.getProgress` (411-430), `useBookProgress` (449-475 — intentionally re-inlined with a comment explaining why it can't call `getProgress`), `selectors.resolveProgress` (`selectors.ts:38-53`), plus helper `getMostRecentProgress` (105-119). Session-merge logic (20-minute window, cap at 500, prune to 300) is duplicated wholesale between `addCompletedRange` (180-252) and `updateReadingSession` (254-349). The reading-list upsert block appears twice (see D6).
- **Impact:** The 0.5% threshold, merge window, and cap constants must be changed in lockstep across files; `useBookProgress` already drifted subtly (it inlines `isValidProgress` as `> 0.005` literals).
- **Fix:** One pure module `src/lib/progress/resolve.ts` (resolveProgress, mergeSession, constants) consumed by the store, the hooks, and selectors. Collapse `addCompletedRange` into `updateReadingSession(bookId, cfi?, pct?, updates)`.

### D9. `useAllBooks` hand-rolled render-time memoization (module-level mutable cache)
- **Severity: high** | **Category: architecture / performance**
- **Evidence:** `selectors.ts:12-32` defines a module-level `moduleCache` (WeakMap + 5 dep-tracking objects) mutated during render with six `eslint-disable react-hooks/immutability` pragmas (104, 161-164, 187-190, 271-276); the comment block (85-93) admits `useRef` mutation "violates React's pure render rules" and that `useMemo` cache eviction "breaks referential equality... triggering massive cascading Yjs and UI re-renders". A stale comment (198, 244) claims `getDeviceId` hits localStorage per call — it's cached after first read (`src/lib/device-id.ts:15, 28-43`). Root cause: the yjs middleware replaces the whole `progress` record on every page turn, so the view model must absorb high-frequency reference changes for ~all books.
- **Impact:** 220 lines of bespoke cache invalidation that nobody can safely modify; shared cache across all hook consumers makes render results order-dependent in principle; concurrent-mode tearing risk. A second copy of the merge logic lives in `useBook` (287-362).
- **Fix:** Move derivation out of render: a plain derived store (subscribe to the four source stores, recompute into a `useLibraryViewStore` outside React), or per-book row selectors with `useShallow`. Fix the upstream write amplification (D13) so the cache doesn't need to be heroic. Share the book-merge function between `useAllBooks` and `useBook`.

### D10. Dead code and stale documentation across the subsystem
- **Severity: medium** | **Category: dead-code / hygiene**
- **Evidence:** `src/hooks/use-local-storage.ts` has **zero production importers** (verified by grep over `src/**/*.{ts,tsx}` excluding tests) yet carries 7 test files / 242 test lines, two of which are duplicates of each other (`use-local-storage.test.ts` = `-predictability.test.ts`). `src/store/index.ts` is one comment line, never used as a barrel. `src/store/README.md` documents 8 of 22 stores and cites nonexistent `usePreferencesStore.test.ts`/`useReaderUIStore.test.ts`, and wrongly says annotations sync "to IndexedDB". `useTTSStore.syncState` is uncalled (see D7). Debug globals leak into production: `window.useReadingStateStore` (`useReadingStateStore.ts:490-491`), `window.__YJS_DOC__`/`window.__DISCONNECT_YJS__` (`yjs-provider.ts:20-23, 241-244`) — only the first lacks even a test-related justification comment.
- **Impact:** The hook is the clearest example of the "one regression test file per bug, never deleted" pattern; the README misleads new contributors; debug globals expose mutation of the source-of-truth doc to any script.
- **Fix:** Delete `use-local-storage.ts` + its 7 tests + `index.ts`; rewrite README from the store registry (see target design); gate debug globals behind `import.meta.env.DEV` or a test flag.

### D11. Per-device preferences create permanent, undeletable top-level Y.Maps
- **Severity: medium** | **Category: architecture / correctness**
- **Evidence:** `usePreferencesStore` uses share name `` `preferences/${getDeviceId()}` `` (`usePreferencesStore.ts:91`). Yjs top-level shared types can never be removed from a doc. `useDeviceStore.deleteDevice` (`useDeviceStore.ts:127-132`) removes the registry entry but not the preferences map.
- **Impact:** Every device that ever opened the app leaves a permanent map synced to all devices forever; doc size and Firestore payload grow monotonically; "delete device" doesn't actually delete its data.
- **Fix:** Single `preferences` map keyed by deviceId internally (`preferences.get(deviceId)`), so device entries are deletable; migration copies existing `preferences/*` content in and leaves tombstone-empty old maps (unavoidable, but they stop growing).

### D12. Plaintext secrets and unbounded logs in localStorage
- **Severity: medium** | **Category: security / performance**
- **Evidence:** TTS cloud API keys persisted verbatim (`useTTSStore.ts:487-494` partialize includes `apiKeys`); Gemini key plus **entire state including the ≤500-entry request log** persisted on every change — `partialize: (state) => ({ ...state })` (`useGenAIStore.ts:104-107`); Firebase config in `sync-storage` (`useSyncStore.ts:100`). Also `usageStats.estimatedCost` is never updated — `incrementUsage` copies it unchanged (`useGenAIStore.ts:77-83`).
- **Impact:** Any XSS exfiltrates Google/OpenAI/LemonFox/Gemini keys in one `localStorage` read; every GenAI log append re-serializes hundreds of log entries synchronously on the main thread.
- **Fix:** Exclude `logs` from partialize (keep in memory or move to IDB ring buffer); centralize secrets in one `useCredentialsStore` with a documented threat model (consider at-rest obfuscation via WebCrypto, acknowledging local-first limits); fix or remove `estimatedCost`.

### D13. Write amplification: full-state deep diff per `set()` against ever-growing maps
- **Severity: medium** | **Category: performance**
- **Evidence:** Outbound flush diffs the entire map JSON vs entire store state on every batched `set()` (`yjs.mjs:642-657` → `getChanges` recursion). `progress` holds up to 500 `readingSessions` × device × book (`useReadingStateStore.ts:11-12, 232-235`), and **every page turn** runs `updateReadingSession` (new objects for the whole chain) → full diff → `map.toJSON()` of the whole progress tree; same on inbound. `selectors.perf.test.ts` exists precisely to keep the downstream cache fast.
- **Impact:** O(library × history) work per page turn on the main thread, growing with usage; the heroic caching in D9 is the compensating mechanism.
- **Fix:** After D2's fork surgery, scope diffing per top-level key (only diff keys touched by the `set()`); move `readingSessions` history out of the hot progress record into a separate map or cap it far lower; consider sub-document maps per book.

### D14. UI-state store fragmentation with no taxonomy; functions stored as state
- **Severity: medium** | **Category: architecture / hygiene**
- **Evidence:** Seven ephemeral UI stores with overlapping scope: `useUIStore` (2 flags), `useReaderUIStore`, `useToastStore` (single toast — a second `showToast` silently replaces the first, `useToastStore.ts:39`), `useBackNavigationStore`, `useSidebarStore` (hidden in `src/hooks/useSidebarState.ts:27-30`), `useCostStore` (hidden in `src/lib/tts/CostEstimator.ts:18`), plus `compassState` in `useReaderUIStore`. `useReaderUIStore` stores **callbacks registered by ReaderView** as state (`playFromSelection`, `jumpToLocation`, `useReaderUIStore.ts:19-30`) — an imperative service registry masquerading as state.
- **Impact:** Discoverability suffers (3 stores outside `src/store`); toast collisions drop user-facing errors; callback-in-store invites stale-closure bugs and makes the reader's API surface invisible.
- **Fix:** Consolidate ephemeral UI state into `useAppUIStore` + `useReaderUIStore`; give toasts a queue; replace callback registry with a `ReaderController` service handle (context or module singleton) holding imperative methods.

### D15. Type-safety escapes around the bridge
- **Severity: low** | **Category: type-safety**
- **Evidence:** `__schemaVersion` written via `as unknown as Record<string, unknown>` casts despite being a declared field (`yjs-provider.ts:90, 134, 144, 162`); injectable `IDBService` uses `any` for options/callbacks (`useLibraryStore.ts:91-104`); `selectors.ts` module cache is `any`-typed throughout (12-31); local `const set = state.offloadedBookIds` shadows the zustand `set` inside `offloadBook` (`useLibraryStore.ts:696`); `window.useReadingStateStore` assignment uses `@ts-expect-error`.
- **Impact:** The casts hide the real typing problem (D2); shadowed `set` is a refactoring landmine.
- **Fix:** Falls out of D2/D3/D9 refactors; rename the shadowed variable immediately.

---

## Problematic couplings (with other subsystems)

1. **DB layer → stores (inverted dependency):** `src/db/BookRepository.ts:11-12` imports `useBookStore` and `useContentAnalysisStore` so metadata reads can merge Yjs inventory. The data layer should not know about UI state containers; pass inventory in, or move the merge into a service above both.
2. **Stores → TTS engine composition root:** `useTTSStore` imports `getAudioPlayer` (`useTTSStore.ts:4`) and boots/configures the engine from `persist.onRehydrateStorage` (506-525); `src/lib/tts/engine/replicationSpec.ts:58-68` and `providerFactory.ts:22` read `useTTSStore.getState()` back — a bidirectional dependency between state layer and engine.
3. **Stores → ingestion pipeline:** `useLibraryStore` directly drives `bookImportService`, `processBatchImport`, `extractBookMetadata` (`useLibraryStore.ts:3-10`) — workflow orchestration in the state layer.
4. **yjs-provider → sync + UI:** `handleObsoleteClient` lazily imports `useSyncStore` (lib/sync) and `useUIStore` (`yjs-provider.ts:64-73`); meanwhile `FirestoreSyncManager` imports `yDoc`/`CURRENT_SCHEMA_VERSION`/`waitForYjsSync` from the store layer (`FirestoreSyncManager.ts:15`) — version policy is owned by neither side.
5. **Sync/backup/maintenance services mutate stores directly:** `BackupService`, `CheckpointService`, `CheckpointInspector`, `MaintenanceService`, `DriveScannerService`, `GoogleIntegrationManager`, `semantic-tree`, `auth-helper`, `firebase-config` all import stores (grep list in analysis); 160 `getState()` sites outside `src/store` total — the store layer has no API surface, just raw state access.
6. **App.tsx boot ↔ middleware internals:** poll-loop on `useBookStore` content (`App.tsx:269-273`) and `waitForYjsSync` ordering encode assumptions about middleware hydration timing.

---

## What's good (keep)

- **Single Y.Doc, one named map per domain store** (`yjs-provider.ts:17` + per-store share names) — clean CRDT topology; keep it.
- **Per-device progress modeling** (`bookId → deviceId → UserProgress`, `useReadingStateStore.ts:22`) eliminates cross-device write conflicts *by construction* — the most important data-model decision in the app; preserve through any refactor.
- **`getYjsOptions()` centralization** (`yjs-provider.ts:191-199`) — one place for middleware policy; the target design extends this rather than replacing it.
- **Deterministic, replicated migrations concept** ("identical transforms on all clients, LWW merges safely", `yjs-provider.ts:76-82`) is sound — only the *execution* (D4) is fragile.
- **The fork's microtask batching + origin tagging** (`yjs.mjs:642-700`) correctly prevents echo loops and batches rapid `set()` calls; the `previousState` delete-protection (420-425) shows real CRDT care.
- **Schema-version quarantine + safe-mode UI** (`handleObsoleteClient` → `ObsoleteLockView`) — right instinct, wrong placement (D5).
- **Fine-grained subscription discipline in `useBook`/`useBookProgress`/`useLastReadBookId`** (`selectors.ts:287-322, 374-400`; `useReadingStateStore.ts:449-488`) — per-key selectors, conditional subscription to avoid page-turn re-renders; the *patterns* are excellent even where the surrounding cache (D9) is not.
- **Dependency injection for tests** (`createLibraryStore(injectedDB)`, `useLibraryStore.ts:122`; `createAnnotationStore()`); the race tests themselves are valuable executable specs of required invariants — port them to the new service.
- **`useLocalHistoryStore` as a deliberate read-path optimization** with documented rationale (`useLocalHistoryStore.ts:5-9`).
- **`useBackNavigationStore` priority-handler design** with documented priority bands and usage example.
- **`waitForYjsSync` timeout-guarded boot gate** (`yjs-provider.ts:207-230`).
- **`useSidebarState`'s documented design rationale** (why store > router state) — exemplary comment hygiene.

---

## Target design

**1. Three explicit store tiers, declared in one registry.**
`src/store/registry.ts` lists every store with `tier: 'synced' | 'local-persisted' | 'ephemeral'`, its Y.Map/persist name, and owner module. README generated from it. All stores (incl. `useSyncStore`, `useSidebarStore`, `useCostStore`) live under `src/store/`.

**2. A contract-first bridge (fork surgery).**
Extend the forked middleware with: `syncedKeys` whitelist (everything else stays local — fixes D1); default-merge hydration (never delete keys absent from the map — fixes D2); per-key scoped diffing (fixes D13); and an exported `whenHydrated()` promise per store. `getYjsOptions` becomes `defineSyncedStore({ name, schema, syncedKeys, defaults })` so every synced store states its contract in one place.

**3. Version & migration coordinator.**
Schema version lives in a dedicated `meta` Y.Map. `FirestoreSyncManager` checks it synchronously before applying any remote update (quarantine before merge — fixes D5). Migrations are pure `(docSnapshot) => transforms` run exactly once by a coordinator after `whenHydrated(allStores)`, atomically with the version bump in one transaction, with failures surfacing to safe mode (fixes D4). App boot awaits `whenHydrated` instead of polling.

**4. Stores are dumb; workflows are services.**
- `LibraryService`: import/overwrite/ghost-link/restore/offload/remove as serialized per-book operations (keyed async mutex); writes inventory + static-metadata cache + reading list through one code path. `useLibraryStore` shrinks to ~150 lines of cache + status.
- `ProgressService`: single `recordReading(bookId, update)` entry point; reading-list projection becomes a subscription to progress changes (one copy of the upsert).
- TTS: `useTTSSettingsStore` (persisted, engine-free) + `useTTSPlaybackStore` (ephemeral mirror written only by the engine subscription); commands live on the engine handle.
- `src/lib/progress/resolve.ts` is the single home of progress resolution + session merge (fixes D8).

**5. View model out of render.**
A derived `libraryViewStore` recomputed via store subscriptions (not during render) replaces the `useAllBooks` module cache; `useBook` shares the same merge function. With per-key diffing upstream, the recompute is cheap.

**6. Hygiene.**
Delete `use-local-storage.ts` + 7 tests, `syncState`, `index.ts`; consolidate the five `useLibraryStore` race tests into a `LibraryService.concurrency.test.ts` invariant suite; gate debug globals behind DEV; one `useCredentialsStore` for secrets; toast queue.

## Migration notes (getting there without breaking users)

1. **Order of operations:** fork surgery (D2/D1 options) first — it's additive and unblocks everything; then the migration coordinator (bump `CURRENT_SCHEMA_VERSION` to 6); then service extraction (pure code motion, no data change); selectors last.
2. **Data migrations needed (v6, deterministic, all-client):**
   - Delete `popover` key from the `annotations` map (key deletion is safe and LWW-mergeable).
   - Create `meta` map with `schemaVersion`; keep writing `library.__schemaVersion` for one release so v5 clients still quarantine (their check reads the library map). Remove the dual-write at v7.
   - Fold `preferences/<deviceId>` maps into a single `preferences` map keyed by device id; old top-level maps remain as empty husks (Yjs cannot delete them) but stop growing. Old clients keep reading their own map until upgraded — acceptable because preferences are per-device anyway.
3. **localStorage stores:** keep persist `name`s and bump `version` with `migrate` functions (the `tts-storage` v1→v3 chain shows the established pattern). Splitting `useTTSStore` means the new settings store reads `tts-storage` once under the old name (or a one-time copy to `tts-settings`), preserving keys/profiles.
4. **Quarantine compatibility:** v5 clients must lock when v6 data arrives — guaranteed by bumping `library.__schemaVersion` to 6 in the v6 migration (their per-map check fires). Test this path explicitly with two doc snapshots.
5. **Behavioral safety net:** before refactoring `useLibraryStore`, lift its five race tests + `restoreBook`/`addBook` tests into service-level tests asserting the same invariants (no zombie resurrection, no stale-read clobber, offload revert), so the new keyed-mutex implementation is verified against the exact historical bugs.
6. **No IndexedDB schema change** is required for any of this; the Y.Doc store (`versicle-yjs`) is content-addressed by map names, all changes above are in-band CRDT edits. Checkpoint/backup services (`CheckpointService`) should take a checkpoint automatically before the v6 migration runs — wire the coordinator to the existing pre-migration checkpoint flow used by workspace migration.
