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

`PlaybackController.ts` has **no worker-unsafe value imports** — the main-thread deps
(`createZustandEngineContext`, `TTSProviderManager`, `PlatformIntegration`) live only in the
composition root `src/app/tts/mainThreadAudioPlayer.ts` and the worker bridge (both in
`src/app/tts/`, the host-wiring layer).

```
 main thread                                            worker (tts.worker.ts)
 ───────────                                            ──────────────────────
 createWorkerEngineClient                               Comlink.expose(WorkerTtsEngine)
   • real TTSProviderManager + PlatformIntegration        • PlaybackController (the brain)
   • store.subscribe → applyStateUpdate ───────────────▶  • WorkerEngineContext (cache)
   • backend events ── dispatchBackendEvent ───────────▶  • proxy PlaybackBackend / MediaPlatform
   • applyHostCommand ◀── post (writes) ◀──────────────   • engine API (play/pause/setQueue/…)
   • engine.play()/subscribe(proxy) ──────────────────▶
```

## Files

- `WorkerTtsEngine.ts` — worker-side host: runs the `PlaybackController` with the proxy backend +
  platform + `WorkerEngineContext`; exposes the engine API. Defines the `EngineHost` contract.
- `src/workers/tts.worker.ts` — the Worker entry (`Comlink.expose(new WorkerTtsEngine())`).
- `src/app/tts/createWorkerEngineClient.ts` — main-thread bridge: creates the Worker, hosts the
  real backend + platform, replicates store state in, applies write commands out, returns a
  client.
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

## App runs on the worker (default)

`getAudioPlayer()` returns a `WorkerEngineHandle` on any platform that provides `Worker`
(browser / Capacitor webview — i.e. always, in production); it falls back to the in-process
engine only where `Worker` is undefined (jsdom unit tests, SSR). Both satisfy the `TtsEngine`
interface, so no `useTTSStore` / `ReaderView` call site changed.

- **`WorkerEngineHandle`** bridges the sync↔async gap: `createWorkerEngineClient()` boots
  asynchronously, so the handle queues fire-and-forget calls on the boot promise and keeps an
  internal subscription so `getQueue()` (sync) and listener fan-out behave like the in-process
  engine. `setProvider(ITTSProvider)` → `client.setProviderById(id)` (live objects can't cross
  the boundary). `TTSVoice.originalVoice` (a live `SpeechSynthesisVoice`) is stripped at the
  boundary.
- **`getInProcessAudioPlayer()`** builds the engine in-process; used by the jsdom fallback and
  by the engine-internals unit tests (which can't spawn a real Worker).
- **Verified (real Chromium):** `verification/test_tts_worker.spec.ts` › *"the app engine
  (getAudioPlayer) is worker-backed and routes through the Worker"* asserts `getAudioPlayer()`
  is the `WorkerEngineHandle` and round-trips `getVoices()` worker→host→worker→main.

Caveat: real audio playback in worker mode (lock-screen controls, background audio, provider
switching) can't be exercised headlessly and warrants on-device QA.
