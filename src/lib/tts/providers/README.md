# TTS Providers

The Text-to-Speech engines Versicle can speak through. Everything in this directory is
**main-thread** code (speech APIs, audio elements, fetch); the worker-resident engine
routes provider ids across the boundary as plain strings.

## The registry — single source of truth

*   **`registry.ts`**: `ProviderDescriptor` registry (`PROVIDERS`). Provider id unions
    (`TTSProviderId`, `TTSApiKeyProviderId`), settings-UI options
    (`selectableProviders`), construction (`descriptor.build(ctx)` with an injected
    `ProviderBuildContext = {apiKey?, language, sink?}` — the store read lives in
    `@app/tts/providerBuildContext`, never here), and descriptor-driven capability
    guards (`asVoiceDownloadable`, `asLocaleAware`). There is deliberately NO
    speed/pitch capability: the P0 speed-at-sink policy is not opt-out.
    The persisted `'local'` id is a platform alias for the device pair
    (webspeech/capacitor) until the 5b settings migration splits it.

## Interface + contract

*   **`types.ts`**: The narrowed `ITTSProvider` (`init/getVoices/play/preload/pause/
    stop/dispose/on→Unsubscribe`), `TTSVoice`, `TTSOptions`, the typed
    `TTSErrorPayload`, and `ProviderPlaybackError` (the manager's typed play-failure
    rethrow — identified by `name` so it survives Comlink).
    `play()` contract: resolves when audible playback starts; rejects exactly once on a
    start failure and never ALSO emits an error event for it (single-shot signaling);
    `error` events are reserved for mid-playback failures.
*   **`describeProviderContract.ts`**: The cross-provider behavioral contract — 7 cases
    (play/preload semantics, single-shot failure, unsubscribe, dispose hygiene, the
    speed-at-sink policy with a non-1.0 test, speed-free cache key) run against ALL SIX
    providers in `providerContract.test.ts` through injected fakes. `vi.mock` is banned
    in this directory (eslint) except the Capacitor native plugin.

## Implementations

*   **`WebSpeechProvider.ts`**: Browser `speechSynthesis` (device, id `'local'` on web).
*   **`CapacitorTTSProvider.ts`**: Native speech via the Capacitor plugin (device,
    id `'local'` on native) with the gapless Smart-Handoff preload path.
*   **`BaseCloudProvider.ts`**: Abstract base for providers that synthesize artifacts:
    speed-free caching (`TTSCache`), request dedup, abort/timeout threading from
    `stop()`/`dispose()`, playback through the injected shared `AudioSink`.
*   **`GoogleTTSProvider.ts` / `OpenAIProvider.ts` / `LemonFoxProvider.ts`**: REST cloud
    providers extending `BaseCloudProvider` (synthesis always at rate 1.0).
*   **`PiperProvider.ts`**: Local WASM synthesis over **`PiperRuntime.ts`** — the owned
    worker runtime for the VENDORED assets in `third-party/piper/` (request-id worker
    protocol, in-memory model LRU over the durable `piper-voices-v1` Cache API store,
    awaited commits/deletes, dispose). Voice catalog is cached stale-while-revalidate
    and downloaded voices are enumerated offline from the model cache.
    Provenance/licensing of the vendored worker + onnxruntime:
    `third-party/piper/PROVENANCE.md`; CI smoke: `piperVendoredAssets.test.ts`.
*   **`MockCloudProvider.ts`**: Dummy cloud provider for tests.
*   **`FakePiperRuntime.ts`**: Injected `PiperRuntime` double for the Piper suites.
