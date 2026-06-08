# Porting the TTS engine into a Web Worker

This document is the completion guide for moving the engine core into a Worker. The hard,
de-risked parts are done and tested; what remains is wiring + a browser smoke test.

## What's already in place (tested, green)

The engine core reaches the host through three interfaces and nothing else:

| Port | Abstracts | Production impl | Test impl | Worker impl |
|------|-----------|-----------------|-----------|-------------|
| `EngineContext` | main-thread Zustand stores + Capacitor detection | `createZustandEngineContext()` | `FakeEngineContext` | **`WorkerEngineContext`** (replicated state) |
| `PlaybackBackend` | audio synthesis + playback (providers, `AudioSink`) | `TTSProviderManager` | `FakePlaybackBackend` | a Comlink proxy to a main-thread `TTSProviderManager` |
| `AudioSink` | the audio device (`HTMLAudioElement`, Web Audio) | `AudioElementPlayer` | `FakeAudioSink` | stays main-thread, behind `PlaybackBackend` |

`AudioPlayerService.createWithContext(ctx, backendFactory)` constructs the engine with both
injected — this is the entry point a worker uses.

De-risked facts:
- **`EpubCFI` is worker-safe** — it imports, constructs, parses, and compares with no DOM
  (verified empirically). The content pipeline's CFI usage works in a Worker.
- **The synchronous-getter problem is solved.** `EngineContext` has sync getters
  (`getSettings`, `getActiveLanguage`, `getProgress`, …) that cannot be satisfied by an
  on-demand async postMessage. `WorkerEngineContext` solves this with **state replication**:
  the main thread pushes `EngineStateUpdate` snapshots in; the worker serves the sync getters
  from cache; writes flow out as `EngineHostCommand`s. This is fully unit-tested in
  `WorkerEngineContext.test.ts`.

## The one remaining code change in the engine

`AudioPlayerService`'s constructor has two **default** arguments that are only meant for the
main thread but are statically imported, so they load even in a worker bundle:

```ts
private constructor(
  ctx = createZustandEngineContext(),                       // ⟵ pulls in the Zustand stores
  backendFactory = (events) => new TTSProviderManager(events) // ⟵ pulls in Capacitor
) { … }
```

`createZustandEngineContext` transitively imports `useTTSStore` (zustand `persist` +
`localStorage`, which doesn't exist in a Worker) and `TTSProviderManager` imports
`@capacitor/core`. A worker always injects its own `ctx`/`backendFactory`, so these defaults
are never *invoked* there — but they're still *imported* at module load.

**To make `AudioPlayerService.ts` cleanly importable in a worker, move the main-thread
defaults out of the module.** Recommended: relocate the production composition root
(`getInstance()` + its `createZustandEngineContext()` / `new TTSProviderManager()` wiring)
into a new `engine/mainThreadEngine.ts`, make the `AudioPlayerService` constructor's `ctx`
and `backendFactory` **required**, and update the ~37 `AudioPlayerService.getInstance()` call
sites (mostly in `useTTSStore.ts`, plus the singleton-reset pattern in ~8 test files) to use
the new root. This is mechanical but touches tests, which is why it was deferred until the
worker is actually being wired (it has no benefit before then).

## Remaining wiring (needs a browser to verify)

1. **`src/workers/tts.worker.ts`** — mirror `src/workers/search.worker.ts`:
   ```ts
   import * as Comlink from 'comlink';
   import { AudioPlayerService } from '../lib/tts/AudioPlayerService';
   import { WorkerEngineContext } from '../lib/tts/engine/WorkerEngineContext';
   // build ctx with post() → Comlink callback; build a proxy PlaybackBackendFactory whose
   // methods call Comlink-exposed host functions; expose the engine's public API.
   ```
2. **Main-thread host/bridge** — owns the real `TTSProviderManager`, subscribes to the
   stores and pushes `EngineStateUpdate`s into the worker, applies inbound
   `EngineHostCommand`s to the real stores, and forwards `TTSProviderEvents` into the worker.
   `useTTSStore` then talks to the Comlink-wrapped engine instead of the in-process singleton.
3. **`setProvider` wrinkle** — `PlaybackBackend.setProvider(ITTSProvider)` can't pass a live
   object across the boundary. Expose a `setProviderById(id)` on the host instead (the host
   already owns provider construction).
4. **Smoke test in the browser** — load a book, play, pause, skip, lock-screen controls,
   audio-bookmark; confirm parity with the main-thread engine.

Until step 1–2 land, production keeps using the in-process `getInstance()` path, which is
unchanged.
