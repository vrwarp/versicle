# Text-to-Speech (TTS) Engine

This directory contains the implementation of the Text-to-Speech system, handling
everything from text segmentation to audio playback and caching. It is mid-strangler
(Phase 5 of the overhaul, `plan/overhaul/prep/phase5-tts-strangler.md`): 5a (providers)
is landed; 5b (engine decomposition) and 5c (content pipeline) follow.

## Directories

*   **`engine/`**: The engine isolation boundary — ports (`EngineContext`,
    `PlaybackBackend`, `AudioSink`), fakes, the worker host (`WorkerTtsEngine`), and the
    **behavioral parity suite** (`engineParityScenarios.ts`, 23 scenarios run over BOTH
    transports). See `engine/README.md`.
*   **`providers/`**: The TTS providers, the `ProviderDescriptor` registry (single source
    of truth for ids/capabilities/construction), the cross-provider contract suite, and
    the Piper WASM runtime. See `providers/README.md`.
*   **`processors/`**: Text processing logic (sanitizer, regex patterns).

## Core services

*   **`engine/PlaybackController.ts`**: The orchestration "brain" — queue management, playback
    FSM, provider routing (incl. the single sequenced local-provider fallback task),
    section navigation, restore, media-session updates. Runs inside the TTS worker in
    production (`WorkerTtsEngine`); decomposed and ultimately deleted at 5b.
    *   Behavioral pins live in `engine/engineParityScenarios.ts`. Per-bug suites are
        being absorbed into its named `describe('regression: …')` blocks — see
        `plan/overhaul/prep/phase5-absorption-ledger.md` before adding a new one-off file.
*   **`TTSProviderManager.ts`**: The `PlaybackBackend` — a dumb provider holder. Detaches
    and disposes outgoing providers on swap, injects the ONE shared `AudioSink`,
    normalizes events (interruption filtering), and rethrows play failures as typed
    `ProviderPlaybackError`s. It performs NO fallback itself — recovery policy is the
    engine's (`PlaybackController.recoverWithLocalProvider`).
*   **`TaskSequencer.ts`**: Serializes engine commands (cancellation/epochs arrive at 5b).
*   **`PlaybackStateManager.ts`**: Queue + index state (becomes the immutable `QueueModel`
    at 5b).
*   **`SectionQueueBuilder.ts`** (pure `{queue, title}` builder; the host orchestrates),
    **`SectionAnalysisDriver.ts`** + **`ReferenceSectionDetector.ts`** (strategy:
    deterministic | GenAI with deterministic shadow; injected `DetectionTelemetry`):
    the 5c-PR2 split of the deleted `AudioContentPipeline.ts`. CFI grouping lives in
    the kernel (`src/kernel/cfi/group.ts`).
*   **`TTSCache.ts`**: Synthesized-audio cache over `@data/repos/audioCache`. Keys are
    SHA-256 of `text|voiceId` — deliberately speed-free (P0 speed policy: synthesis at
    1.0, playback rate applied at the sink) and pinned by a golden-key test.
*   **`LexiconService.ts` / `LexiconEngine.ts` / `systemLexicon.ts`** (5c-PR3):
    main-thread CRUD facade over the `LexiconAssembler`, which compiles stable
    `CompiledLexicon` value objects keyed by (bookId, language, store version);
    the Bible rules lazy-load from `bible-lexicon.json` behind
    `SystemLexiconProvider` (the eager 2,899-line data file is gone — the
    build check asserts the ruleset stays out of the entry chunk). Application
    stays in the yjs-free `LexiconApplier` (the worker-safe half).
*   **`MediaSessionManager.ts` / `PlatformIntegration.ts` / `BackgroundAudio.ts`**:
    lock-screen metadata, hardware keys, background keep-alive (main-thread side).
*   **`TTSFlightRecorder.ts`**: Ring-buffer diagnostics (worker export surface at 5b).

## Utilities

*   **`TextSegmenter.ts`**: Splits paragraph text into speakable sentences (abbreviations,
    URLs, CJK, configurable merge rules).
*   Ingest-time sentence/CFI extraction lives at `src/lib/ingestion/sentence-extraction.ts`
    since 5c-PR4 (raw-at-rest extraction v3; consumption types in `~types/tts-content`).
*   **`AudioElementPlayer.ts`**: The production `AudioSink` (HTML5 `Audio` + Web Audio
    earcon ducking). ONE instance is owned by `TTSProviderManager` and shared across
    provider swaps.
*   **`CsvUtils.ts` / `lexiconSample.ts`**: Lexicon CSV import/export helpers.
*   **`earcons.ts`**: Oscillator-based UI earcons.
