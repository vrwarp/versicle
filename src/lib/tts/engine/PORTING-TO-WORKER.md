# TTS engine in a Web Worker

The TTS orchestration engine **runs in a real Web Worker** today, verified end-to-end in a
browser. This documents how it's wired and the one remaining step to make the *whole app* use
it (vs. the smoke-tested path).

## Architecture

The engine core reaches the outside world only through injected ports, so the orchestration
("brain") can run in a Worker while everything browser-bound stays on the main thread:

| Port | Abstracts | Main-thread impl | Worker impl |
|------|-----------|------------------|-------------|
| `EngineContext` | Zustand stores + Capacitor detection | `createZustandEngineContext` | `WorkerEngineContext` (replicated state) |
| `PlaybackBackend` | synthesis + playback (providers, `AudioSink`) | `TTSProviderManager` | Comlink proxy → main thread |
| `MediaPlatform` | media session + background audio | `PlatformIntegration` | Comlink proxy → main thread |

`AudioPlayerService.ts` has **no worker-unsafe value imports** — the main-thread deps
(`createZustandEngineContext`, `TTSProviderManager`, `PlatformIntegration`) live only in the
composition root `mainThreadAudioPlayer.ts` and the worker bridge.

```
 main thread                                            worker (tts.worker.ts)
 ───────────                                            ──────────────────────
 createWorkerEngineClient                               Comlink.expose(WorkerTtsEngine)
   • real TTSProviderManager + PlatformIntegration        • AudioPlayerService (the brain)
   • store.subscribe → applyStateUpdate ───────────────▶  • WorkerEngineContext (cache)
   • backend events ── dispatchBackendEvent ───────────▶  • proxy PlaybackBackend / MediaPlatform
   • applyHostCommand ◀── post (writes) ◀──────────────   • engine API (play/pause/setQueue/…)
   • engine.play()/subscribe(proxy) ──────────────────▶
```

## Files

- `WorkerTtsEngine.ts` — worker-side host: runs `AudioPlayerService` with the proxy backend +
  platform + `WorkerEngineContext`; exposes the engine API. Defines the `EngineHost` contract.
- `src/workers/tts.worker.ts` — the Worker entry (`Comlink.expose(new WorkerTtsEngine())`).
- `createWorkerEngineClient.ts` — main-thread bridge: creates the Worker, hosts the real
  backend + platform, replicates store state in, applies write commands out, returns a client.
- `WorkerEngineContext.ts` — replicated-state `EngineContext` (solves sync-getter-over-async).

## Verification

- **`WorkerTtsEngine.test.ts`** (vitest) drives the engine over a `MessageChannel` Comlink
  boundary — the exact bridge code, minus OS-thread isolation. Round-trip: engine call →
  backend proxy → provider event → status callback.
- **`verification/test_tts_worker.spec.ts`** (Playwright) boots the engine in a **real** Worker
  in Chromium via `window.__ttsWorkerSmokeTest` (in `src/main.tsx`) and asserts a
  `setQueue → getQueue` round-trip + status propagation. This is what exercises real worker
  *import-safety* (it surfaced and fixed: `DOMPurify.addHook` at module-init in `sanitizer.ts`,
  and `getState()` action functions in pushed snapshots).

## Remaining step: route the whole app through the worker

`createWorkerEngineClient()` is *async* (the Worker boots + state replicates), whereas
`getAudioPlayer()` is the synchronous in-process engine that `useTTSStore` uses today. To make
the app run on the worker:

1. Boot the client once at startup (e.g. in `useTTSStore.initialize()`), `await` it, and hold
   the returned client.
2. Route the store's player calls through `client.engine.*` (fire-and-forget calls — play,
   pause, setSpeed, … — work unchanged) and use `client.subscribe(...)` (auto-proxies the
   listener) and `client.setBook(...)` (pre-replicates per-book language + progress).
3. `setProvider(ITTSProvider)` can't cross the boundary — switch to `backendSetProviderById`
   (the host owns provider construction).

Until then, production stays on the synchronous `getAudioPlayer()` path (unchanged), and the
worker path is exercised by the two verification tests above.
