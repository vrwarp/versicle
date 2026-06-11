# TTS Engine Boundary (`engine/`)

This directory holds the **isolation boundary** for the TTS engine core. The goal is an
engine that is hardened, easy to unit-test without jsdom/Zustand, and ultimately portable
into a Web Worker.

## The core / host split

The engine core (`AudioPlayerService`, `AudioContentPipeline`, `TableAdaptationProcessor`,
`PlaybackStateManager`, `TextSegmenter`, `LexiconService`, …) must reach the outside world
**only** through the `EngineContext` interface. It is allowed to import `dbService`
(IndexedDB) and `genAIService` (`fetch`) directly because both are available in a Worker.
What it must *not* import are the things that are **not** worker-safe:

- the main-thread Zustand stores (`useTTSStore`, `useGenAIStore`, `useReadingStateStore`,
  `useContentAnalysisStore`, `useBookStore`, `useAnnotationStore`, `useToastStore`,
  `useReaderUIStore`), and
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
- **`PlaybackBackend.ts`** — the synthesis+playback interface `AudioPlayerService` commands;
  `TTSProviderManager` implements it, `FakePlaybackBackend` fakes it. Injected via
  `AudioPlayerService.createWithContext(ctx, backendFactory)`.
- **`PORTING-TO-WORKER.md`** — the completion guide for the actual worker flip.

## Composition roots (who builds the engine)

The engine is a plain dependency-injected class. There are two construction paths:

| Host | How it builds the engine | Context |
|------|--------------------------|---------|
| **Production (main thread)** | `AudioPlayerService.getInstance()` — one lazily-created, shared instance (there is one audio output device, so one instance is correct) | `createZustandEngineContext()` |
| **Tests / Worker shell** | `AudioPlayerService.createWithContext(ctx)` — a fresh, isolated instance | `FakeEngineContext` (tests) or a port-backed context (worker) |

`getInstance()` is deliberately retained as the production composition root; it is no longer
the *only* way to construct the engine, which is what previously made the core hard to test.
The worker shell (a later phase) will use `createWithContext` with a context whose ports are
backed by a message channel to the main thread — the core code does not change, because it
only ever sees the `EngineContext` interface.
