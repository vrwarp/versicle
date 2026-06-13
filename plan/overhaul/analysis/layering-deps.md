# Cross-cutting analysis: module layering & dependency graph

Subsystem key: `layering-deps`
Analyzed: 2026-06-10. Tooling: `madge 8.0.0` (full graph + a second pass with `detectiveOptions.ts.skipTypeImports=true` for the runtime-only graph), plus manual reads of every hub file cited below. All paths relative to repo root; all line numbers verified against the working tree at commit `3b0cfcff`.

---

## What it is

This is not a directory but the *shape* of `src/` itself: 266 non-test TS/TSX modules (~46.5k lines, 509 files including tests) arranged in nominal layers — `types/`, `lib/`, `db/`, `store/`, `hooks/`, `components/`+`layouts/`, `workers/`, `data/` — with `main.tsx`/`App.tsx` as the composition root and `sw.ts` as the service-worker entry. The question answered here: do the nominal layers correspond to real dependency direction, where are the cycles, what loads when, and what ruleset the overhaul should enforce.

**Headline numbers**

| Metric | Value |
|---|---|
| Circular dependency chains (full graph, incl. `import type`) | **65** |
| Circular dependency chains (runtime graph, type imports stripped) | **16** |
| `lib/ → store/` edges | **54** (runtime ≈ 30) |
| `db/ → store/` edges | 3 (all runtime) |
| `db/ → lib/` edges | 7 (2 runtime-meaningful: `idb-write-lock`, `logger`) |
| `types/ → lib/` edges | 2 (type-only, but poisons the whole graph) |
| `getState()` calls inside `lib/` (service-locator usage) | **97** |
| Module-scope singletons (`export const x = new C()`) | 13 |
| `getInstance()` singletons | 4 |
| Eager startup closure of `main.tsx` | **229 of 266** runtime modules (no route-level code splitting) |
| TTS worker runtime closure | 25 modules (healthy) — but **100 modules** in the type-level graph, guarded only by `import type` discipline with no lint rule |

---

## File inventory

The cross-cutting hubs (files whose position in the graph defines the architecture):

| File | Role in the graph |
|---|---|
| `src/types/db.ts` (934 lines) | God type hub. 40+ interfaces spanning every domain (static manifests, user data, TTS cache, sync checkpoints, flight recorder). Fan-in **59**. Imports *upward* into `lib/tts` (lines 2, 11) — the root of ~50 of the 65 madge cycles. |
| `src/store/yjs-provider.ts` (245 lines) | Yjs composition root masquerading as a module. Module-scope side effects: creates the singleton `Y.Doc` (line 17), boots IndexedDB persistence at import time (lines 28–46), attaches `window.__YJS_DOC__`/`__DISCONNECT_YJS__` globals (20–23, 241–244). Contains schema migrations (83–172) executed via dynamic imports of stores to dodge cycles. Fan-in 17. |
| `src/db/DBService.ts` (670 lines) | "Lean worker-safe" IndexedDB facade; singleton `dbService` (line 670). Imports `lib/ingestion`, `lib/tts/AudioPlayerService` types (16, 18) — db→lib layering inversion (type-only). |
| `src/db/db.ts` | `idb` schema + `getDB()`/`initDB()`. Clean except `lib/logger` import. |
| `src/db/BookRepository.ts` (90 lines) | Merges IDB static rows with Yjs inventory. Imports two stores at runtime (lines 11–12) — db→store inversion, deliberately (docstring lines 1–9 explains worker-bundle motivation). |
| `src/db/ContentAnalysisRepository.ts` | Same pattern: db→store runtime import (line 9). |
| `src/db/index.ts` | Barrel with **zero non-test importers** (dead). |
| `src/store/index.ts` | Empty stub (`// Store export`) — dead barrel. |
| `src/store/useTTSStore.ts` (528 lines) | Store that *drives a service*: 18 call sites of `getAudioPlayer()` (lib/tts engine) from inside actions. Runtime cycle store↔engine. Fan-in 23. |
| `src/store/useLibraryStore.ts` (798 lines) | Orchestration store; imports `db/BookRepository`, `db/DBService`, three lib services, and re-exports `useBookStore` (line 798) creating dual import paths. |
| `src/lib/tts/engine/EngineContext.ts` (210 lines) | **The good boundary**: port interfaces (`TTSConfigPort`, `GenAIPort`, …) isolating the engine core from stores/Capacitor. All store imports type-only (lines 26–31). |
| `src/lib/tts/engine/createZustandEngineContext.ts` (120 lines) | Host-side adapter: imports 8 stores + 2 repos + GenAI (lines 16–27). Legitimately main-thread, but lives inside `lib/`. |
| `src/lib/tts/engine/createWorkerEngineClient.ts` (228 lines) | Main-thread worker client; imports 6 stores + 2 repos. Same placement problem. |
| `src/lib/tts/engine/replicationSpec.ts` (147 lines) | Declarative store→worker state replication table with compile-time completeness (lines 51–122). Excellent design; main-thread-only by convention (docstring line 14). |
| `src/lib/tts/engine/mainThreadAudioPlayer.ts` (56 lines) | Lazy singleton accessor `getAudioPlayer()`. The pivot of the store↔engine runtime cycle. |
| `src/lib/tts/AudioPlayerService.ts` (1242 lines) | Engine core; imports `db/DBService` at runtime (line 4) — allowed by its own docs (worker-safe), but exports `TTSQueueItem` consumed by `types/db.ts`, creating the type cycle. |
| `src/lib/sync/FirestoreSyncManager.ts` (993 lines) | `getInstance()` singleton (line 97); imports 3 stores + `yjs-provider` at runtime; mutual runtime cycle with `CheckpointService` (CheckpointService.ts line 7 / 87 / 150). |
| `src/lib/sync/hooks/useSyncStore.ts` (119 lines) | A **Zustand store defined inside `lib/`** (line 65), imported by `store/yjs-provider.ts` — layer-inverted state. |
| `src/lib/sync/hooks/useSyncToasts.ts` | A **React hook inside `lib/`** importing three stores and subscribing to them (lines 1–18). |
| `src/lib/google/GoogleIntegrationManager.ts` (52 lines) | Module-scope singleton (line 52) that picks Web/Android strategy in its constructor at import time (lines 10–16) and writes to stores. |
| `src/lib/ingestion.ts` (559 lines) | Ingestion pipeline; imports `store/useBookStore` at runtime (madge runtime graph) — lib→store inversion in the *write* path. |
| `src/main.tsx` (143 lines) | Composition root + **~80 lines of verification-test harness shipped to production** (lines 33–112), stores attached to `window`, module-scope `SocialLogin.initialize` (line 126) and store subscription (line 128). |
| `src/App.tsx` (372 lines) | Router + boot orchestration (DB init, SW wait, sync manager, drive scanner, migration confirm). All routes imported eagerly — no `React.lazy` anywhere in `src/`. |
| `src/lib/logger.ts`, `src/lib/utils.ts`, `src/lib/device-id.ts`, `src/lib/crypto.ts` | Clean leaf utilities (fan-in 44/39/13) — correct dependency direction, no side effects beyond a lazy localStorage read. |
| `src/workers/tts.worker.ts`, `src/workers/search.worker.ts` | Worker entries, properly thin (Comlink expose). |
| Component barrels: `components/settings/index.ts`, `components/reader/panels/index.ts` | Real but tiny barrels (used by 1 consumer each). `components/reader/index.ts`, `components/library/index.ts` are comment-only dead files. |

---

## How it works (data & control flow)

**Intended layering** (per directory names and `src/*/README.md`s): `types` ← `lib` ← `db` ← `store` ← `hooks` ← `components`, with `workers` as separate entries and `main/App` composing everything.

**Actual graph**: a single strongly-connected tangle in the middle. The measured layer-edge matrix (non-test, full graph):

```
ui    → ui 223, lib 127, store 126, types 30, hooks 17, db 7
lib   → lib 185, store 54(!), types 29, db 18, data 2
store → store 26, lib 22, types 13, db 2
db    → lib 7(!), types 6, store 3(!), db 3
hooks → store 17, lib 11, types 5, db 4(!)
types → lib 2(!)
workers → lib 2
```

Arrows marked `(!)` are inversions of the nominal layering.

**The two giant cycles:**

1. **The type cycle (tooling-level, ~50 of 65 chains).** `types/db.ts:2,11` imports `Timepoint` and `TTSQueueItem` from `lib/tts`. Since `types/db.ts` has fan-in 59, *every* module that touches a DB type is transitively coupled to the TTS engine in the type graph, and madge reports e.g. `db/db.ts > types/db.ts > lib/tts/AudioPlayerService.ts > db/DBService.ts`. TypeScript erases these, so there is no runtime hazard — but every static-analysis tool, IDE rename, and any future bundler that resolves type imports sees one inseparable blob.

2. **The store↔engine runtime cycle (16 chains).** `store/useTTSStore.ts:4` imports `getAudioPlayer` from `lib/tts/engine/mainThreadAudioPlayer.ts`, which imports `createZustandEngineContext`/`WorkerEngineHandle`/`createWorkerEngineClient`, which import `useTTSStore` (and 5 more stores) back. Similarly `store/useLibraryStore.ts → lib/ingestion.ts → store/useBookStore.ts`, `store/useLibraryStore → db/BookRepository → store/useContentAnalysisStore`, `useTTSStore → lib/tts/LexiconService → store/useLexiconStore`, and `lib/sync/CheckpointService ↔ lib/sync/FirestoreSyncManager`. These resolve at runtime only because JS module hoisting + lazy `getState()` calls happen after init; the order-sensitivity is real (see `store/yjs-provider.ts:64–72` and `83–171`, where the authors resort to dynamic `import()` *specifically* "to avoid circular deps at module init").

**Boot sequence (control flow):** importing `main.tsx` eagerly executes 229 of 266 runtime modules. Importing *any* yjs-backed store module executes `store/yjs-provider.ts`, which instantiates `Y.Doc` and begins IndexedDB persistence immediately (lines 17, 28–46) — i.e., persistence starts as an import side effect, before React renders. `App.tsx` then runs DB init/SW wait/sync-manager wiring in effects. The TTS worker is created lazily by `WorkerEngineHandle` on first `getAudioPlayer()` call; its runtime closure is a clean 25 modules (`workers/tts.worker.ts → WorkerTtsEngine → AudioPlayerService → DBService → db/db`), kept clean *only* by `import type` discipline in `EngineContext.ts` and friends.

**State replication topology (good):** main thread pushes store snapshots into the worker through `replicationSpec.ts`'s declarative table; the worker reads via `WorkerEngineContext`, and worker engine state flows back through `WorkerEngineHandle` to stores. The engine core sees only `EngineContext` ports.

---

## Technical debt

### LD-1. `types/db.ts` is a god type hub that imports upward into `lib/tts` — poisoning the whole graph

- **Severity:** high
- **Category:** architecture
- **Evidence:** `src/types/db.ts:2` (`import type { Timepoint } from '../lib/tts/providers/types'`), `:11` (`import type { TTSQueueItem } from '../lib/tts/AudioPlayerService'` — used at lines 311, 593 for `CacheSessionState.playbackQueue` and `TTSState.queue`). 934 lines defining 40+ interfaces across every domain (`grep '^export interface'` lists `StaticBookManifest` through `FlightSnapshot`). Fan-in 59 (highest in the repo). Madge full-graph: ~50 of 65 cycles route through `types/db.ts > lib/tts/AudioPlayerService.ts`.
- **Impact:** Every consumer of any DB type is statically coupled to the deepest TTS service file. madge/dependency-cruiser/knip output is unusable noise (65 "cycles") so real cycles hide among false ones; IDE find-references and renames in `types/db.ts` touch the entire app; module-graph-based tools (e.g., Vite plugin analysis, future isolatedDeclarations) choke. It also makes the nominal `types` layer a lie — nothing can be said to be "below" anything.
- **Fix:** Split `types/db.ts` into per-domain type modules (`types/book.ts`, `types/user-data.ts`, `types/tts-cache.ts`, `types/sync.ts`, `types/flight-recorder.ts`) with **zero imports from `lib/`**. Move `TTSQueueItem` and `Timepoint` definitions *into* a `types/tts.ts` (or `lib/tts/types.ts` re-exported downward) and have `AudioPlayerService`/providers import them from there. Enforce "types layer imports nothing but types" with `eslint no-restricted-imports` or dependency-cruiser.

### LD-2. Store ↔ TTS-engine runtime cycle: `useTTSStore` drives the engine, the engine writes the store

- **Severity:** critical
- **Category:** architecture
- **Evidence:** `src/store/useTTSStore.ts:4` imports `getAudioPlayer` from `lib/tts/engine/mainThreadAudioPlayer.ts`; 18 call sites inside store actions (lines 217–514). `mainThreadAudioPlayer.ts:15–19` imports `createZustandEngineContext`, `WorkerEngineHandle`; `createZustandEngineContext.ts:16–27` and `createWorkerEngineClient.ts` import `useTTSStore` + 7 other stores back. Madge runtime cycles 7–14 all pivot on this edge. Also `useTTSStore → lib/tts/LexiconService → store/useLexiconStore` (runtime cycle 5–6) and `store/useReadingStateStore → store/useLibraryStore → store/useTTSStore` extending the cycle across three stores.
- **Impact:** This is the structural reason TTS work is risky: initialization order between stores and engine is implicit (works only because all calls are deferred into actions); tests must mock whole store modules; you cannot load TTS settings state without statically linking the entire engine client, nor instantiate the engine wiring without every store. Any new store the engine needs grows the cycle. It also means hot-reload/HMR of any file in the cycle reloads all of them.
- **Fix:** Make stores pure state + actions that *emit commands*; introduce a `TtsController` at the composition root that owns `getAudioPlayer()`, subscribes to store actions (or exposes imperative methods the UI calls), and writes results back. Concretely: move the 18 `getAudioPlayer()` calls out of `useTTSStore` actions into a `src/app/tts-controller.ts` wired in `App.tsx`; `createZustandEngineContext`/`createWorkerEngineClient`/`replicationSpec` move to `src/app/` (host wiring layer) since they are by their own docstrings main-thread-only adapters. After this, `lib/tts/**` has zero store imports and the cycle is gone.

### LD-3. `lib/` services reach into `store/` everywhere (54 edges, 97 `getState()` calls) — service-locator architecture

- **Severity:** high
- **Category:** architecture
- **Evidence:** Full violation list (from madge layer scan): `lib/sync/FirestoreSyncManager.ts` → `useBookStore`/`useToastStore`/`yjs-provider` (18 `getState()` calls); `lib/sync/semantic-tree.ts` → 6 stores; `lib/drive/DriveScannerService.ts` → 4 stores (8 `getState()`); `lib/google/GoogleIntegrationManager.ts` → `useGoogleServicesStore` + `useSyncStore` (lines 4–5); `lib/ingestion.ts` → `useBookStore` (runtime); `lib/BackupService.ts` → `useLibraryStore` + `yjs-provider`; `lib/MaintenanceService.ts` → `useBookStore`/`useTTSStore`; `lib/sync/auth-helper.ts`, `lib/sync/firebase-config.ts`, `lib/sync/CheckpointService.ts`, `lib/sync/CheckpointInspector.ts`, `lib/tts/LexiconService.ts`, `lib/tts/providerFactory.ts` similarly. Total: 97 `getState()` call sites under `lib/` (grep count, tests excluded).
- **Impact:** `lib/` is not a library — it's the app inside-out. Nothing under `lib/sync`, `lib/drive`, `lib/google` can be unit-tested without constructing the global store world; none of it is reusable in a worker or Node context; refactoring a store shape requires grepping all of `lib/`. The direction of knowledge is inverted: low-level services know about UI-state modules.
- **Fix:** Apply the `EngineContext` pattern (already proven in `lib/tts/engine/`) to sync/drive/google: each service declares a port interface for what it reads/writes; the composition root injects adapters backed by stores. Services that are *fundamentally* app-orchestration (e.g., `semantic-tree`, `DriveScannerService`'s auto-sync policy) should move to a new `src/app/` (or `src/features/<x>/controller.ts`) layer where store imports are legal.

### LD-4. `db/` imports `store/` and `lib/` — repositories depend on UI state

- **Severity:** high
- **Category:** architecture
- **Evidence:** `src/db/BookRepository.ts:11–12` (runtime imports of `useBookStore`, `useContentAnalysisStore`; used at lines 52, 61, 71, 85); `src/db/ContentAnalysisRepository.ts:9`; `src/db/DBService.ts:16,18` (type imports from `lib/ingestion` and `lib/tts/AudioPlayerService`); `src/db/validators.ts:1` ties to `lib/sanitizer`. Runtime cycle 3: `store/useLibraryStore → db/BookRepository → store/useContentAnalysisStore`.
- **Impact:** The "db layer" cannot be reasoned about independently; `DBService`'s record types are defined by a lib service's export. The store↔repo cycle means store module init order matters. Note the *motivation* is sound (BookRepository's docstring, lines 1–9: keep yjs out of the worker-safe DBService) — the placement is what's wrong.
- **Fix:** Recast `BookRepository`/`ContentAnalysisRepository` as what they are: app-layer read-model mergers. Move them to `src/app/repositories/` (or `src/features/library/`); keep `db/` strictly `idb`-schema + `DBService` with types imported only from `types/`. `BookExtractionData` and `TTSQueueItem` type definitions move to `types/` per LD-1.

### LD-5. Zustand store and React hooks living inside `lib/` (`lib/sync/hooks/`)

- **Severity:** medium
- **Category:** architecture
- **Evidence:** `src/lib/sync/hooks/useSyncStore.ts:65` (`export const useSyncStore = create<SyncStore>()(persist(...))` — a persisted Zustand store in `lib/`); `src/lib/sync/hooks/useSyncToasts.ts:1–18` (React `useEffect` hook importing `useReadingStateStore`, `useToastStore`, `useBookStore` — the latter via the `useLibraryStore` alias path). `store/yjs-provider.ts:65` dynamically imports `useSyncStore` from `lib/`, creating the store→lib→store loop (madge cycles 61–64).
- **Impact:** The state layer is split across two directories with opposite nominal roles; discovering "all app state" requires knowing this exception. The `yjs-provider → lib/sync/hooks/useSyncStore → FirestoreSyncManager → yjs-provider` loop is one of the dynamic-import hacks.
- **Fix:** Move `useSyncStore` to `src/store/useSyncStore.ts` (it is persisted UI/config state like its siblings); move `useSyncToasts` to `src/hooks/`. This is mechanical (3 non-test importers).

### LD-6. Module-scope side effects: importing a module boots persistence, auth, globals

- **Severity:** critical
- **Category:** correctness
- **Evidence:**
  - `src/store/yjs-provider.ts:17` (`export const yDoc = new Y.Doc()`), `:28–46` (IndexedDB persistence starts at import), `:20–23, 241–244` (window globals).
  - `src/main.tsx:126` (`initializeSocialLogin().catch(console.error)` at module scope), `:128–132` (module-scope store subscription), `:34–38` (4 stores attached to `window` unconditionally in prod).
  - `src/store/useReadingStateStore.ts:491` (`window.useReadingStateStore = useReadingStateStore;` — **unguarded**; would throw `ReferenceError` in any worker that ever value-imports this module; only `@ts-expect-error`'d).
  - 13 module-scope singletons (`dbService` `src/db/DBService.ts:670`, `bookRepository` `src/db/BookRepository.ts:90`, `googleIntegrationManager` `src/lib/google/GoogleIntegrationManager.ts:52` — whose constructor performs platform detection at import time, `searchClient` `src/lib/search.ts:213`, `backupService`, `maintenanceService`, `bookImportService`, `flightRecorder`, `lexiconApplier`, `mockDriveService`, `Logger`, plus 4 `getInstance()` singletons: `FirestoreSyncManager.ts:97`, `GenAIService.ts:43`, `LexiconService.ts:30`, `CostEstimator.ts:37`).
- **Impact:** "Import = execute" is why the cycles bite: module evaluation order becomes program behavior. Tests must carefully mock before import; tree-shaking can't drop singletons; a future second entry point (widget, share-target, worker) inherits Yjs persistence and Google auth boot whether it wants them or not. The unguarded `window.` write is a latent worker crash one `import type`→`import` typo away (the type-level worker closure *already* reaches `useReadingStateStore.ts`).
- **Fix:** Introduce an explicit boot module (`src/app/bootstrap.ts`) called from `main.tsx` that constructs Y.Doc, persistence, social login, sync manager, TTS controller in a defined order and hands instances down (or registers them in a tiny app-container). Module scope of every other file must be side-effect-free (enforceable with `"sideEffects": false` + eslint `no-restricted-syntax` on top-level calls). Guard or delete all `window.*` debug hooks.

### LD-7. Worker import-safety is one typo away from breaking, with no static guard

- **Severity:** high
- **Category:** correctness
- **Evidence:** Worker runtime closure is 25 modules (clean), but the type-level closure from `workers/tts.worker.ts` reaches **100 modules** including all 20 stores and `store/yjs-provider.ts` (madge full graph BFS; e.g. `WorkerTtsEngine → EngineContext.ts →(type) useReadingStateStore`). Safety rests entirely on `import type` keywords in `EngineContext.ts:26–31`, `DBService.ts:14,16,18`, `types/db.ts:2,11`. `eslint.config.js` has **no** `consistent-type-imports`, no `import/no-cycle`, no `no-restricted-imports`, no boundary plugin (verified: full config is 30 lines, only react-hooks/react-refresh rules). No test asserts the worker bundle excludes yjs/zustand (there are behavioral worker tests — `engineParity.worker.test.ts`, `main.tsx:46 __ttsWorkerSmokeTest` — but none fail on a value-import regression; a store accidentally bundled would still pass them unless it crashes).
- **Impact:** Changing `import type { X }` to `import { X }` anywhere along those paths silently pulls Zustand+Yjs+IndexedDB persistence into the worker — second Y.Doc, double persistence writes (the exact data-corruption scenario `BookRepository`'s docstring warns about), or an immediate crash on `useReadingStateStore.ts:491`. Today nothing would catch it until manual testing on a device.
- **Fix:** (a) eslint `@typescript-eslint/consistent-type-imports` + `import/no-cycle` on the runtime graph; (b) dependency-cruiser rule: `workers/**` and `lib/tts/{engine-core}/**` may not reach `store/**`, `zustand`, `yjs` at runtime; (c) a CI test that builds the worker chunk and asserts the absence of `zustand`/`yjs` module ids (the `ANALYZE=true` visualizer wiring in `vite.config.ts:14–16,25–28` shows the data is already obtainable).

### LD-8. Zero route/feature-level code splitting: 229 of 266 modules load eagerly

- **Severity:** high
- **Category:** performance
- **Evidence:** No `React.lazy`/`lazy(` anywhere in `src/` (grep). `src/App.tsx:1–31` eagerly imports `LibraryView`, `ReaderView`, sync manager, drive scanner, migration services; `GlobalSettingsDialog.tsx` (718 lines, fan-out 30) and all 7 settings tabs are eager via `components/settings/index.ts`. `vite.config.ts:18–20` has no `manualChunks`. Madge runtime closure of `main.tsx` = 229/266 modules; the only excluded runtime code is the two workers, dead files, and Fake* test doubles.
- **Impact:** First paint pays for the reader, settings, sync UI, drive import, lexicon manager, Chinese tooling — everything — on a PWA whose core first-screen need is the library grid. Also couples HMR and rebuild scope to the world.
- **Fix:** `React.lazy` the route elements (`ReaderView`, settings dialog, notes/drive panels) and dynamic-import heavy services at first use (`FirestoreSyncManager`, `DriveScannerService`, GenAI SDK). This only becomes *safe* after LD-6 (no import side effects) — today, lazy-loading a store-importing chunk would still boot everything, so sequence it after the boot-module refactor.

### LD-9. Schema migrations and quarantine logic live in `yjs-provider` behind nested dynamic imports with swallowed errors

- **Severity:** high
- **Category:** correctness
- **Evidence:** `src/store/yjs-provider.ts:83–171` — `runMigrationsImpl` chains `import('./useBookStore').then(...)` → nested `import('./useReadingStateStore').then(...)` with `.catch(() => {})` at lines 136–138, 163, 169–171 ("Silently ignore if … can't be imported (test env)"). Version bump to v2 happens (line 134) *inside* the inner promise while `currentVersion = 2` is set synchronously outside it (line 140), so v2→v4 (line 143) can run before the v1→v2 transform commits. The double-`queueMicrotask` at line 183 documents reliance on `zustand-middleware-yjs` internal microtask timing. The cycles forcing the dynamic imports are madge runtime cycles 1, 2, 15.
- **Impact:** Migration of user data is the most correctness-critical code in a CRDT app, and here it is timing-dependent, error-swallowing, and unobservable. A failed inner import or a re-entrant `onLoaded` produces partially-migrated state with the version already bumped.
- **Fix:** Extract migrations into `src/app/migrations.ts` with *static* imports (legal once it lives above the stores), run them as an explicit awaited boot step after `waitForYjsSync()` and before React render, with sequential `await`, real error propagation, and a written invariant test. The `handleObsoleteClient` lazy imports (lines 64–72) likewise become static once the store→lib/sync cycle (LD-5) is broken.

### LD-10. Dead barrels, dual import paths, and duplicate modules confuse the graph

- **Severity:** medium
- **Category:** dead-code / duplication
- **Evidence:**
  - `src/store/index.ts` = `// Store export` (1 line, nothing); `src/components/reader/index.ts` and `src/components/library/index.ts` are comment-only; `src/db/index.ts` re-exports `db.ts` but has zero non-test importers.
  - `src/store/useLibraryStore.ts:798` re-exports `useBookStore`, so the same store is imported via two paths (`App.tsx:13`, `lib/sync/hooks/useSyncToasts.ts:5` use the alias; 16 other files import `store/useBookStore` directly).
  - **Two different `useBookProgress`**: `src/hooks/useBookProgress.ts` (imports `bookRepository`; reachable only from tests) vs the live one at `src/store/useReadingStateStore.ts:449`. The hooks one is dead.
  - Dead components: `src/components/audio/AudioReaderHUD.tsx` + `SatelliteFAB.tsx` (only import each other and tests); `src/hooks/use-local-storage.ts` has 7 test files at `src/hooks/` and 3 more at repo root but **no production importer** (madge: absent from main closure).
  - Naming collision: `src/lib/tts.ts` (sentence-extraction utils) alongside `src/lib/tts/` (the engine) — `lib/tts.ts:1` even imports from `./tts/TextSegmenter` (madge cycle 5 is `lib/tts.ts > lib/tts/TextSegmenter.ts`, a false cycle caused by the name overlap in madge's resolution, but a genuine human-confusion hazard).
- **Impact:** Dual paths defeat "find all references"; dead files inflate the graph, the test suite, and every future analysis; the `tts.ts`/`tts/` collision invites edits to the wrong file.
- **Fix:** Delete dead barrels/components/hooks (verify with knip); pick one canonical import path per store and codemod the alias away; rename `lib/tts.ts` → `lib/tts/sentence-extraction.ts`.

### LD-11. No path aliases; 3-deep relative imports everywhere

- **Severity:** low
- **Category:** hygiene
- **Evidence:** Zero `@/` imports (grep); no `paths` in `tsconfig.app.json`/`tsconfig.json`, no `resolve.alias` in `vite.config.ts`. Typical: `import { useTTSStore } from '../../../store/useTTSStore'` (`createZustandEngineContext.ts:16`).
- **Impact:** Moves/renames churn dozens of files; layer violations are visually indistinguishable from legal imports (`../../../store` looks the same everywhere), making review-time enforcement of layering nearly impossible.
- **Fix:** Add `@app/`, `@lib/`, `@db/`, `@store/`, `@components/`, `@types/` aliases; codemod. Aliases also make lint-based boundary rules trivial to express.

### LD-12. `main.tsx` ships a verification harness and debug globals to production

- **Severity:** medium
- **Category:** hygiene
- **Evidence:** `src/main.tsx:33–112`: 4 stores on `window`, `__ttsWorkerSmokeTest` (46–96) and `__ttsWorkerHandleTest` (101–111) defined unconditionally (`if (typeof window !== 'undefined')` is always true in the browser). Same pattern at `store/useReadingStateStore.ts:491`, `store/yjs-provider.ts:20–23,241–244`, `db/db.ts:202`, `lib/tts/TTSFlightRecorder.ts:242`.
- **Impact:** Production bundle exposes store mutation and a worker-boot harness to any injected script; bundle bloat; blurs the test/prod boundary that the rest of the worker work tries hard to keep crisp.
- **Fix:** Gate behind `import.meta.env.DEV || import.meta.env.VITE_E2E` and centralize in one `src/app/debug-hooks.ts` so the exposure surface is auditable.

### LD-13. `lib/sync` internal tangle: manager ↔ checkpoint mutual runtime imports plus store writes

- **Severity:** medium
- **Category:** architecture
- **Evidence:** `lib/sync/CheckpointService.ts:7` imports `getFirestoreSyncManager` (calls `.destroy()` at 87, 150) while `FirestoreSyncManager.ts` imports `CheckpointService` (runtime cycle 16). `FirestoreSyncManager.ts:97` `getInstance(config?)` — a singleton with optional config on every call (config respected only on first call, a classic latent-misconfiguration API). `firebase-config.ts` reads `useSyncStore` and toasts directly.
- **Impact:** Recovery flows (checkpoint restore destroying the live manager that's invoking it) are hard to reason about; the singleton API permits silently ignored configuration.
- **Fix:** Invert: `CheckpointService` should not know the manager; give it a `onBeforeRestore`/`shutdown` callback injected by the sync controller. Replace `getInstance(config?)` with explicit `createSyncManager(config)` owned by the boot module.

---

## Problematic couplings

(dependencies on other subsystems, with direction — these overlap the debt items but are listed per the cross-cutting brief)

1. `types/db.ts` → `lib/tts/AudioPlayerService.ts` + `lib/tts/providers/types.ts` (`src/types/db.ts:2,11`) — types layer reaching into the deepest service.
2. `store/useTTSStore.ts` → `lib/tts/engine/mainThreadAudioPlayer.ts` (`:4`, 18 call sites) — store as engine remote-control; runtime cycle back via `createWorkerEngineClient.ts`/`createZustandEngineContext.ts` (each importing 6–8 stores).
3. `db/BookRepository.ts` → `store/useBookStore`/`useContentAnalysisStore` (`:11–12`); `db/ContentAnalysisRepository.ts` → `store/useContentAnalysisStore` (`:9`).
4. `lib/sync/*` → `store/*` + `store/yjs-provider` (FirestoreSyncManager.ts, semantic-tree.ts ×6 stores, CheckpointService.ts, auth-helper.ts, firebase-config.ts) and back: `store/yjs-provider.ts:65` → `lib/sync/hooks/useSyncStore`.
5. `lib/drive/DriveScannerService.ts` → 4 stores; `lib/google/GoogleIntegrationManager.ts` → `useGoogleServicesStore` + `lib/sync/hooks/useSyncStore` (`:4–5`).
6. `lib/ingestion.ts` → `store/useBookStore` (runtime) and `db/db.ts`/`db/validators.ts` — ingestion writes both IDB and Yjs stores directly.
7. `components/`+`hooks/` → `db/` directly, bypassing stores: `GlobalSettingsDialog.tsx:18,21,22`, `reader/ContentAnalysisLegend.tsx:10`, `reader/ReaderView.tsx:23`, `hooks/useEpubReader.ts:3`, `hooks/useSmartTOC.ts:5–6`, `hooks/useBookProgress.ts:3`.
8. `main.tsx` → store internals + `lib/tts/engine` test harness (`:46–111`).

## What's good (keep)

- **`EngineContext` ports** (`src/lib/tts/engine/EngineContext.ts`) — a real hexagonal boundary with type-only store coupling, two implementations (Zustand host adapter + `FakeEngineContext`), and explicit documentation of *why* dbService/genAI are not abstracted (worker-safe). This is the template the rest of `lib/` should copy.
- **`replicationSpec.ts`** — declarative, compile-time-complete store→worker replication table (`SLICE_BUILDERS` typed as `Record<EngineStateUpdate['kind'], …>`, lines 51–122) with parity tests (`replication.test.ts`, `engineParity.*.test.ts`). Keep the design; only its directory placement changes.
- **Thin worker entries** (`workers/tts.worker.ts`, `workers/search.worker.ts` — Comlink expose, one import) and the clean 25-module runtime worker closure.
- **Leaf utilities with correct direction**: `lib/logger.ts` (fan-in 44, zero deps beyond console), `lib/utils.ts`, `lib/crypto.ts`, `lib/device-id.ts`, `lib/idb-write-lock.ts`.
- **`BookRepository`'s documented rationale** (lines 1–9): the *constraint* (yjs must never enter the worker's DB path) is right and must survive the move; only the file's layer placement is wrong.
- **`getYjsOptions()` centralization** (`store/yjs-provider.ts:191–199`) — one place wiring schema version/obsolete/migration hooks into every store's middleware.
- **Build awareness**: ES-module workers + per-chunk bundle visualizers already wired (`vite.config.ts:14–28`).
- **`db/DBService` lean-facade discipline** — single IDB write-lock (`runExclusiveIdbWrite`), no yjs, no UI knowledge at runtime.

## Target design

**Layer stack (strict, enforceable):**

```
L0 types/        pure types; imports: nothing (not even lib)
L1 lib/          pure logic & services; imports: types, lib; NO store/db/react/window side effects
L2 db/           idb schema + DBService; imports: types, lib(logger, idb-write-lock only)
L3 store/        Zustand+Yjs state; imports: types, lib, db(DBService only); stores never import engines/managers
L4 app/          NEW — composition & orchestration: bootstrap, migrations, controllers
                 (tts-controller, sync-controller, drive-controller), repositories
                 (BookRepository), host adapters (createZustandEngineContext,
                 createWorkerEngineClient, replicationSpec), debug-hooks;
                 imports: anything below
L5 hooks/        React hooks; imports: store, app(read-only facades), lib, types
L6 components/, layouts/   imports: hooks, store, app facades, lib, types — NEVER db directly
entries: main.tsx (→ app/bootstrap), workers/* (→ lib only), sw.ts (→ lib only)
```

**Rules** (encode in dependency-cruiser + eslint `no-restricted-imports`, CI-blocking):
1. No module below L4 may import from `store/` except L3 itself; `getState()` outside `store/`+`app/` is forbidden.
2. `types/` imports nothing.
3. `workers/**` runtime closure must not contain `zustand`, `yjs`, `store/**` — asserted by a build-time test on the worker chunk.
4. No import cycles in the runtime graph (`import/no-cycle` with `skipTypeImports`); `consistent-type-imports` everywhere.
5. No module-level side effects outside `app/bootstrap.ts` and entry files (no top-level `new` of stateful services, no `window.*`, no subscriptions). Singletons become instances constructed in bootstrap and passed/injected; where ergonomics demand globals, a single `app/container.ts` with explicit `init()`.
6. Route-level `React.lazy` for ReaderView/Settings/Notes/Drive; services behind first-use dynamic import from `app/` controllers only.
7. One canonical import path per module (no re-export aliases like `useLibraryStore`'s `useBookStore`); path aliases `@types/@lib/@db/@store/@app/@components`.

The existing `EngineContext` port pattern generalizes: `SyncPorts`, `DrivePorts`, `GooglePorts` interfaces in `lib/`, adapters in `app/`. Stores shrink to state+pure actions; controllers in `app/` own cross-domain workflows (import → ingest → store write; sync lifecycle; TTS command routing).

## Migration notes

No user-data migrations required — this is a pure code-motion/boundary refactor. Sequencing to stay shippable:

1. **Instrument first**: add dependency-cruiser with the target ruleset in *warn* mode + the worker-chunk content test (LD-7c). This freezes the violation count and catches regressions during the refactor itself.
2. **Break the type cycle (LD-1)**: move `TTSQueueItem`/`Timepoint`/`BookExtractionData` definitions into `types/`; split `types/db.ts` by domain with a temporary re-export shim at the old path so 59 importers migrate gradually. Zero runtime behavior change.
3. **Create `src/app/`** and relocate, in order: `createZustandEngineContext`, `createWorkerEngineClient`, `replicationSpec`, `mainThreadAudioPlayer` (becomes `app/tts/engine-host.ts`); `BookRepository`/`ContentAnalysisRepository`; migrations out of `yjs-provider` (LD-9) — make them statically imported, awaited boot steps; `useSyncStore`→`store/`, `useSyncToasts`→`hooks/` (LD-5). Each move is independently green.
4. **De-cycle stores (LD-2)**: extract the 18 `getAudioPlayer()` calls from `useTTSStore` into `app/tts-controller.ts`; UI keeps calling store actions, which now set state that the controller observes (or components call the controller directly via a hook facade). Run the existing `engineParity.*`/`replication` tests as the safety net — they already encode the engine's observable behavior.
5. **De-singleton via bootstrap (LD-6)**: introduce `app/bootstrap.ts` constructing Y.Doc/persistence/sync/google/tts in explicit order; convert module-scope singletons one at a time, keeping a deprecated `export const x = container.get(...)` shim until importers are migrated. Guard all `window.*` hooks behind `import.meta.env.DEV` (LD-12) — verify Playwright E2E still passes with `VITE_E2E=true`.
6. **Ports for sync/drive/google (LD-3)**: mechanical extraction following the EngineContext template; highest-value first (`FirestoreSyncManager` — also fixes LD-13 by injecting the shutdown callback into `CheckpointService`).
7. **Then code-split (LD-8)**: only after step 5, add `React.lazy` routes and first-use service loading; verify with the existing `ANALYZE=true` visualizer that the entry chunk drops (~target: library view + store hydration only).
8. **Cleanup (LD-10/11)**: knip-verified deletion of dead barrels/components/`hooks/useBookProgress`/`use-local-storage`; rename `lib/tts.ts`; codemod to path aliases; flip dependency-cruiser to *error* mode and delete the shims.

Risks: step 4 changes initialization timing of the TTS engine (currently lazy on first `getAudioPlayer()`; keep it lazy in the controller). Step 5 changes when Yjs persistence starts — it must still begin before `waitForYjsSync()` is awaited in `App.tsx`'s boot path (move the await into bootstrap to make the ordering explicit). The double-`queueMicrotask` migration timing (`yjs-provider.ts:182–184`) must be replaced by an explicit awaited hook from the middleware's `onLoaded`, not merely relocated — coordinate with the state-stores subsystem work.
