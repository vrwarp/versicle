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

## App adoption (wired, flag-gated)

The app can run entirely on the worker, gated by a flag (off by default). `getAudioPlayer()`
returns the in-process engine normally, or a `WorkerEngineHandle` when worker mode is enabled —
both satisfy the `TtsEngine` interface, so no `useTTSStore` / `ReaderView` call site changes.

- **Enable:** `localStorage['tts:worker'] = '1'` (runtime) or `VITE_TTS_WORKER=true` (build).
- **`WorkerEngineHandle`** bridges the sync↔async gap: `createWorkerEngineClient()` boots
  asynchronously, so the handle queues fire-and-forget calls on the boot promise and keeps an
  internal subscription so `getQueue()` (sync) and listener fan-out behave like the in-process
  engine. `setProvider(ITTSProvider)` → `client.setProviderById(id)` (live objects can't cross
  the boundary). `TTSVoice.originalVoice` (a live `SpeechSynthesisVoice`) is stripped at the
  boundary.
- **Verified:** `verification/test_tts_worker.spec.ts` › *"worker mode: getAudioPlayer() routes
  the app through the Worker"* enables the flag, asserts `getAudioPlayer()` is the
  `WorkerEngineHandle`, and round-trips `getVoices()` worker→host→worker→main.

Default production remains the synchronous in-process path. Flipping the default to worker mode
is now a one-line flag flip after on-device QA of real playback (lock-screen controls, background
audio, provider switching) which can't be exercised headlessly.
