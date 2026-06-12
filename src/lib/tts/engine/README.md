# TTS Engine Boundary (`engine/`)

This directory holds the **isolation boundary** for the TTS engine core. The goal is an
engine that is hardened, easy to unit-test without jsdom/Zustand, and ultimately portable
into a Web Worker.

## The core / host split

The engine core (`PlaybackController` + its units `QueueModel`/`AnalysisApplier`/
`MediaMetadataPublisher`/`DragnetGesture`, plus `AudioContentPipeline`,
`TableAdaptationProcessor`, `TextSegmenter`, …) reaches the outside world **only**
through the `EngineContext` interface — including, since the 5b decomposition, its
storage: derived-content reads go through `ctx.content` (`BookContentPort`) and
playback-session persistence through `ctx.session` (`SessionStore`, the single
owner of `cache_session_state` traffic, carrying the WebKit-detach discipline).
Production wires the repo-backed implementations (`repoPorts.ts`); tests inject
in-memory fakes — which is why the engine-dir `vi.mock` allowlist is **empty**
(every `vi.mock` here is a lint error).

What the core must *not* import is anything that is **not** worker-safe:

- the main-thread Zustand stores, and
- the Capacitor native bridge.

Those are exactly the surface captured by `EngineContext`.

## The three ports

The engine core touches the outside world through exactly three interfaces:

| Port | Abstracts (the non-worker-safe thing) | Production | Tests | Worker |
|------|----------------------------------------|------------|-------|--------|
| **`EngineContext`** | main-thread Zustand stores + Capacitor detection | `createZustandEngineContext()` | `FakeEngineContext` | `WorkerEngineContext` |
| **`PlaybackBackend`** | audio synthesis + playback (providers) | `TTSProviderManager` | `FakePlaybackBackend` | Comlink proxy → main thread |
| **`AudioSink`** | the audio device (`HTMLAudioElement`, Web Audio) | `AudioElementPlayer` | `FakeAudioSink` | stays main-thread |

## Files

- **`EngineContext.ts`** — host-state interface, grouped into ports (`config`, `genAI`,
  `readingState`, `contentAnalysis`, `book`, `annotations`, `notifications`, `readerUI`,
  `platform`). Payload types are derived from the existing store signatures, so the contract
  can't silently drift.
- **`src/app/tts/createZustandEngineContext.ts`** — production wiring (host side, so it lives
  in the `src/app/` composition layer, not here); forwards to the live stores + Capacitor.
  Forwarding to the same store *modules* the code used before means existing
  `vi.mock('…/store/…')` mocks keep working unchanged.
- **`FakeEngineContext.ts`** — deterministic in-memory `EngineContext` for tests.
- **`WorkerEngineContext.ts`** — replicated-state `EngineContext` for running the engine in a
  Worker; serves the synchronous getters from a cache the main thread pushes into. Solves the
  "sync getter over async boundary" problem. See `PORTING-TO-WORKER.md`.
- **`AudioSink.ts`** — the audio-output device interface; `AudioElementPlayer` implements it,
  `FakeAudioSink` fakes it. Injected into `BaseCloudProvider`.
- **`PlaybackBackend.ts`** — the synthesis+playback interface the `PlaybackController`
  commands; `TTSProviderManager` implements it, `FakePlaybackBackend` fakes it. Injected via
  `PlaybackController.createWithContext(ctx, backendFactory, platformFactory)`.
- **`PlaybackController.ts`** — the orchestration core (FSM + sequencer; the SOLE status
  writer) composing the decomposed units below. The 1,300-line `AudioPlayerService` god
  class died here (5b-PR4).
- **`AnalysisApplier.ts`** / **`MediaMetadataPublisher.ts`** / **`DragnetGesture.ts`** —
  the extracted units: GenAI mask/adaptation application (timestamp dedup, sequenced
  commands), the unified media-session metadata builder + deadbanded position pushes, and
  the pause→play audio-bookmark capture with engine-internal section-change invalidation.
- **`repoPorts.ts`** — production `BookContentPort`/`SessionStore` implementations over the
  `src/data` repos (both threads use the same modules; the worker reads IndexedDB directly).
- **`parityHostDb.ts`** — the shared in-memory port implementations both parity transports
  inject.
- **`PORTING-TO-WORKER.md`** — the completion guide for the actual worker flip.

## Composition roots (who builds the engine)

The engine is a plain dependency-injected class. There are two construction paths:

| Host | How it builds the engine | Context |
|------|--------------------------|---------|
| **Production (worker)** | `WorkerTtsEngine.connect()` constructs `PlaybackController.createWithContext(...)` directly inside the worker (`tts.worker.ts`); the main thread talks to it through `WorkerEngineHandle` | `WorkerEngineContext` (replicated state + repo-backed storage ports) |
| **Tests / in-process** | `PlaybackController.createWithContext(ctx, backendFactory, platformFactory)` — a fresh, isolated instance (`getInProcessAudioPlayer()` in `src/app/tts/` for store-wired unit tests) | `FakeEngineContext` (tests) or `createZustandEngineContext()` |
