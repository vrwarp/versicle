# Subsystem analysis: TTS providers & voice management (`tts-providers`)

Scope: `src/lib/tts/providers/*`, `src/lib/tts/TTSProviderManager.ts`, `src/lib/tts/providerFactory.ts`, `src/store/useTTSStore.ts`, `src/hooks/useTTS.ts`, plus the piper-wasm patching pipeline (`package.json` postinstall, `scripts/patch_piper_worker.js`, `patches/`). Adjacent files (`TTSCache.ts`, `CostEstimator.ts`, `AudioElementPlayer.ts`, `engine/*`) are covered only where the provider layer touches them.

---

## What it is

The synthesis layer of Versicle's audiobook feature. Five production providers behind one `ITTSProvider` interface: device speech engines (`WebSpeechProvider` for browsers, `CapacitorTTSProvider` for Android), a local WASM neural engine (`PiperProvider`, models downloaded from HuggingFace), and three cloud HTTP APIs (`GoogleTTSProvider`, `OpenAIProvider`, `LemonFoxProvider`). `TTSProviderManager` selects/holds the active provider, normalizes events, and implements cloud→local error fallback; it is the production implementation of the engine's `PlaybackBackend` port. `providerFactory.buildProviderById()` is the single construction point (provider ids cross the worker boundary as plain strings; live providers exist only on the main thread). `useTTSStore` is the persisted settings + playback-mirror Zustand store (provider id, API keys, per-language voice profiles, download state). `useTTS` is a small mount hook that loads voices and syncs the queue with the visible reader section.

## File inventory

| File | Role |
|---|---|
| `src/lib/tts/providers/types.ts` (113) | `ITTSProvider` interface, `TTSVoice`, `TTSOptions`, `TTSEvent`, `SpeechSegment`, `Timepoint` |
| `src/lib/tts/providers/BaseCloudProvider.ts` (168) | Abstract base: cache check → in-flight request registry → `fetchAudioData()` → IndexedDB cache → `AudioSink.playBlob` |
| `src/lib/tts/providers/WebSpeechProvider.ts` (185) | `window.speechSynthesis` wrapper, voiceschanged race handling, id `'local'` |
| `src/lib/tts/providers/CapacitorTTSProvider.ts` (249) | Android native TTS via `@capacitor-community/text-to-speech`; "Smart Handoff" gapless preload; id also `'local'` |
| `src/lib/tts/providers/PiperProvider.ts` (281) | Piper WASM provider; HF voice catalog fetch, transactional model download, CJK-aware text chunking, WAV stitching |
| `src/lib/tts/providers/piper-utils.ts` (379) | Module-singleton Piper worker lifecycle, Cache API model persistence, retry fetch, WAV concat, `piperGenerate()` |
| `src/lib/tts/providers/GoogleTTSProvider.ts` (136) | Google Cloud TTS REST (API key header), dynamic voice list, base64 MP3 decode |
| `src/lib/tts/providers/OpenAIProvider.ts` (71) | OpenAI `/v1/audio/speech`, 6 hardcoded voices, model hardcoded `tts-1` |
| `src/lib/tts/providers/LemonFoxProvider.ts` (93) | OpenAI-compatible LemonFox API, 28 hardcoded voices |
| `src/lib/tts/providers/MockCloudProvider.ts` (48) | Test double returning a dummy WAV |
| `src/lib/tts/TTSProviderManager.ts` (274) | Active-provider holder, event normalization, cloud→local fallback, piper download proxying via `as any` |
| `src/lib/tts/providerFactory.ts` (31) | `buildProviderById(id)` — reads API keys + active language from `useTTSStore` at construction |
| `src/store/useTTSStore.ts` (528) | Persisted settings (provider, keys, per-language profiles, segmentation) + live playback mirror + voice management actions |
| `src/hooks/useTTS.ts` (67) | Mount hook: `loadVoices()`, pause-gesture invalidation, idle queue sync to visible section |
| `scripts/patch_piper_worker.js` (287) | Postinstall string-replacement patcher for the copied `piper_worker.js` (6 patches) |
| `patches/@capgo+capacitor-social-login+7.20.0.patch` | patch-package patch (unrelated to TTS; shows two parallel patching mechanisms exist) |
| Supporting (adjacent): `TTSCache.ts` (SHA-256 keyed IndexedDB audio cache), `CostEstimator.ts` (char-count tracker + dead estimator), `AudioElementPlayer.ts` (production `AudioSink`), `earcons.ts`, `TTSFlightRecorder.ts` |

Tests in scope: `WebSpeechProvider.test.ts`, `CapacitorTTSProvider.test.ts` (416 lines, behavioral, good), `PiperProvider.test.ts`, `GoogleTTSProvider.test.ts`, `OpenAIProvider.test.ts`, `LemonFoxProvider.test.ts`, `BaseCloudProvider.registry.test.ts`, `TTSProviderManager.test.ts`.

## How it works (data & control flow)

1. **Construction.** `useTTSStore.loadVoices()` (`useTTSStore.ts:375-418`) calls `player.setProviderById(providerId)` → engine (`AudioPlayerService.setProviderById`, `AudioPlayerService.ts:510-515`) → backend `TTSProviderManager.setProviderById` (`TTSProviderManager.ts:202-204`) → `buildProviderById()` (`providerFactory.ts:21-31`), which reads `apiKeys` + `activeLanguage` from `useTTSStore.getState()` and `new`s the provider. In the worker topology the id travels as a string over Comlink (`WorkerTtsEngine.ts:128`, `createWorkerEngineClient.ts:163`); the live provider always lives on the main thread.
2. **Playback.** Engine (`AudioPlayerService.playInternal`, `AudioPlayerService.ts:771-795`) applies the lexicon, then `providerManager.play(processedText, { voiceId, speed })` and `preload()`s the next sentence. Cloud path: `BaseCloudProvider.play` → `getOrFetch` (cache → registry → `fetchAudioData`) → `audioPlayer.setRate(speed)`; `playBlob` → emits `start` (`BaseCloudProvider.ts:43-64`). Device path: native engine speaks directly. Events flow `ITTSProvider.on(TTSEvent)` → `TTSProviderManager.setupProviderListeners` (normalizes to `TTSProviderEvents` callbacks, maps `Timepoint`→`AlignmentData`) → engine; in worker mode, additionally `dispatchBackendEvent(BackendEvent)` over Comlink (`createWorkerEngineClient.ts:124-137`, `WorkerTtsEngine.ts:170-184`).
3. **Voices.** `getVoices()` returns plain `TTSVoice[]`; store keeps them plus a per-language `profiles` map (`{voiceId, rate, pitch, volume, minSentenceLength}`) and selects fallback voices in `loadVoices` (4-step) and `setActiveLanguage` (different 2-step) logic.
4. **Piper specifics.** `init()` fetches `voices.json` from HuggingFace and filters to single-speaker `en_US`/`zh_CN` voices (`PiperProvider.ts:85-118`). `downloadVoice` stages both files in memory, commits to Cache API, then does a verification load (`PiperProvider.ts:158-197`). Synthesis chunks text (500 chars / 100 for CJK), calls `piperGenerate()` per chunk — a module-level promise chain that owns one `Worker` running the *patched* `public/piper/piper_worker.js` — then stitches WAVs (`piper-utils.ts:199-269`).
5. **Patching pipeline.** `postinstall` → `patch-package` (capgo only) → `prepare-piper` copies four artifacts from `node_modules/piper-wasm/build/` into gitignored `public/piper/` (`.gitignore:34`) and runs `scripts/patch_piper_worker.js`, which string-replaces 6 patches into the worker (config-passing fix, phoneme-id clamp, global error handlers, JSDoc, two try/catch wraps). ONNX Runtime itself is loaded *at runtime from cdnjs* (`piper-utils.ts:281`).

---

## Technical debt

### D1. Speed is applied twice (or not at all) — synthesis-time AND playback-time
**Severity: critical — Category: correctness**
Evidence:
- Engine always passes the user rate as `options.speed` (`AudioPlayerService.ts:783-786`).
- Cloud providers bake it into synthesis: `speakingRate: options.speed` (`GoogleTTSProvider.ts:88`), `speed: options.speed` (`OpenAIProvider.ts:58`, `LemonFoxProvider.ts:79`).
- `BaseCloudProvider.play` then *also* sets the sink playback rate to the same value: `this.audioPlayer.setRate(options.speed)` before `playBlob` (`BaseCloudProvider.ts:53-56`).
- `AudioElementPlayer.playBlob` assigns a new `src` after `setRate` (`AudioElementPlayer.ts:71-77`); the HTML media load algorithm resets `playbackRate` to `defaultPlaybackRate` (1.0) on resource load, so the `setRate` call is silently wiped in browsers that follow spec.
- `PiperProvider.fetchAudioData` never passes speed to `piperGenerate` (`PiperProvider.ts:247-262`), so Piper depends entirely on the (wiped) sink rate.
- Cache key includes speed (`BaseCloudProvider.ts:75`), so every rate change forces full re-synthesis (`AudioPlayerService.setSpeed` stops and replays, `AudioPlayerService.ts:887-896`).
- All provider tests use `speed: 1.0` only (`GoogleTTSProvider.test.ts:108,145`; `OpenAIProvider.test.ts:60,90`; `LemonFoxProvider.test.ts:60,89`), so nothing pins the intended behavior.

Net effect: at 1.5× the user gets either 2.25× (if `playbackRate` survives) or 1.5× cloud / **1.0× Piper** (if reset) — and a Piper speed change does nothing except bust the audio cache and re-run WASM inference. Speed semantics are undefined at the most important seam in the subsystem.
Impact: wrong audible speed, wasted cloud spend and WASM compute on every rate change, cache fragmentation (same text cached once per speed value).
Fix: pick one policy — synthesize at 1.0 always; apply rate at the sink **after** `src` assignment (or via `ratechange`/`defaultPlaybackRate`); drop speed from the cache key; delete `speakingRate`/`speed` from cloud request bodies (or make it an explicit provider capability). Add a non-1.0-speed test per provider.

### D2. Cloud-failure fallback double-fires and races the task sequencer
**Severity: critical — Category: correctness**
Evidence: `BaseCloudProvider.play` both **emits** an error event and **rethrows** (`BaseCloudProvider.ts:60-63`). `TTSProviderManager` handles the same failure in two places: the event listener (`TTSProviderManager.ts:78-93`: `events.onError({type:'fallback'})` + un-awaited `switchToLocalProvider()`) and the `play()` catch (`TTSProviderManager.ts:142-163`: `events.onError({type:'fallback'})` again + awaited switch). The engine's `onError` fallback handler calls `this.playInternal(true)` **directly, outside the TaskSequencer** (`AudioPlayerService.ts:143-147`), so two un-sequenced `playInternal(true)` invocations can run concurrently with each other and with the in-flight `switchToLocalProvider()` — meaning the retry can hit the *old, failing cloud provider* before the swap lands, re-triggering fallback.
Impact: duplicate/overlapping audio, fallback retry loops, lost sentences; the exact class of race the TaskSequencer was built to prevent.
Fix: make providers signal failure exactly once (reject; no error event for the same failure). Move the fallback decision into the engine: one sequenced task = stop → swap provider (awaited) → replay current item. Delete the duplicated interrupted/canceled filtering (`TTSProviderManager.ts:83,151`).

### D3. No provider registry — adding a provider means editing six hand-maintained sites
**Severity: high — Category: architecture**
Evidence of the touch list for a hypothetical new provider:
1. `providers/types.ts:12` — `TTSVoice.provider` string-literal union.
2. `providerFactory.ts:23-30` — construction switch.
3. `useTTSStore.ts:59` and `:100` — `providerId` union (twice); `:60-64`, `:101`, `:156-160`, `:494` — `apiKeys` record shape, setter union, defaults, partialize.
4. `TTSSettingsTab.tsx:17-18` — re-declared `TTSProviderId`/`TTSApiKeyProvider` aliases; `:121-127` — hardcoded `<SelectItem>` list; `:239-268` — three copy-pasted per-provider API-key blocks.
5. `CostEstimator.ts:71-84` — provider union in `estimateCost`.
6. `TTSProviderManager.ts:88,153` — fallback logic keyed on the magic id `'local'`; `:236-263` — piper-only special cases.
There is no descriptor anywhere stating "this provider needs an API key / has downloadable voices / supports alignment."
Impact: every provider addition is a shotgun edit; the unions already drift (settings tab redeclares them instead of importing). Capability checks degrade into id string comparisons.
Fix: a `ProviderDescriptor` registry (`{ id, displayName, kind: 'device'|'wasm'|'cloud', requiresApiKey, capabilities: { downloadableVoices, alignment, synthesisSpeed, pitch }, build(ctx) }`) as the single source of truth; derive `providerId` unions via `as const`; render the settings Select and API-key fields from the registry; factory iterates the registry.

### D4. `useTTSStore` is a god store with a dual representation of voice settings
**Severity: high — Category: architecture**
Evidence: one store mixes (a) persisted user settings (provider, keys, segmentation lists, background audio), (b) per-language `profiles` map, (c) **duplicated flat fields** `rate`/`pitch`/`voice`/`minSentenceLength` that mirror the active profile, (d) ephemeral engine mirror (`status`, `queue`, `currentIndex`, `activeCfi`, download state), and (e) imperative side effects — every setter both writes state and calls `getAudioPlayer()` (`useTTSStore.ts:269-284, 297-312, 367-374`). Flat-vs-profile sync is hand-rolled in four setters with three different inline profile-default literals (`:281, :293, :309, :347`). Voice fallback selection exists twice with different rules (`setActiveLanguage` `:183-199` vs `loadVoices` `:392-417`). `partialize` persists both `voice` (full object) and `profiles[lang].voiceId` (`:487-505`). `onRehydrateStorage` performs engine side effects during store creation (`:506-525`).
Impact: any change to voice-selection behavior must be made in two places; flat/profile divergence is a standing bug source (migrations v2/v3 at `:461-484` exist purely to repair this duplication); the engine mirror forces UI re-renders into the same store as settings.
Fix: split into `useTTSSettingsStore` (persisted; profiles as the only representation, flat values via selectors) and `useTTSPlaybackStore` (ephemeral mirror fed by the engine subscription). Extract one `selectVoiceForLanguage(voices, profile, lang)` function. Side effects move to a thin controller that subscribes to settings changes.

### D5. Typing an API key rebuilds the provider and hits the network per keystroke
**Severity: high — Category: performance**
Evidence: `TTSSettingsTab.tsx:245,255,265` wires `PasswordInput.onChange` → `setApiKey`. `useTTSStore.setApiKey` (`useTTSStore.ts:318-328`) calls `setProviderId(providerId)` whenever the edited provider is active, which triggers `loadVoices()` → `player.setProviderById()` → engine `stopInternal()` (`AudioPlayerService.ts:510-515`) → new provider instance → `player.init()` → e.g. Google `fetchVoices()` HTTP call (`GoogleTTSProvider.ts:54-74`). All per keystroke.
Impact: API spam against Google (each partial key is an invalid-key request), any active playback is stopped the moment the user focuses the field and types, and dozens of provider instances are constructed and abandoned (their `AudioElementPlayer`s and event listeners are never destroyed — see D8).
Fix: store keystrokes only; re-init on blur/explicit "Save & test" with debounce; surface a key-validity check as a deliberate action.

### D6. Piper is not actually offline-capable: catalog and ONNX runtime require the network
**Severity: high — Category: correctness**
Evidence: `PiperProvider.init()` fetches `https://huggingface.co/.../voices.json` on every session (`PiperProvider.ts:85-87`); on failure it logs and leaves `voices`/`voiceMap` empty, so `fetchAudioData` throws `Voice not found` (`PiperProvider.ts:201-204`) **even when the model is fully downloaded in the Cache API**. The phonemize worker loads ONNX Runtime from `https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/` at runtime (`piper-utils.ts:281`). The service worker precaches only the build manifest and has no runtime caching for either host (`src/sw.ts` — no `cdnjs`/`huggingface` rules).
Impact: the flagship "High Quality Local" offline voice fails offline; a privacy-centric app silently calls a third-party CDN during synthesis. Airplane-mode users with downloaded voices get a dead player.
Fix: persist `voices.json` (Cache API stale-while-revalidate, or derive locally-available voices from cached models so downloaded voices always appear); vendor `onnxruntime-web` into `public/piper/` alongside the other artifacts (it's already an npm-installable package) and pass the local URL; remove the CDN default.

### D7. `piper-utils` is a module-global mutable singleton with an ever-growing promise chain
**Severity: high — Category: architecture**
Evidence: module-level `blobs: Record<string, Blob>`, `worker`, `currentWorkerUrl`, `pendingPromise` (`piper-utils.ts:2-7`). Model + config blobs (tens of MB) are pinned in `blobs` for the life of the page; only `deleteCachedModel` removes entries (`:163-175`), so switching among several voices accumulates all of them. Every call appends to the single `pendingPromise` chain (`:122, :288`) — one FIFO queue shared by all `PiperProvider` instances, never reset, with errors swallowed via `.catch(() => {})` (`:377`). Per-call `worker.onmessage`/`onerror` reassignment (`:312-355`) instead of request-ids means a stray late message from a crashed task can be consumed by the wrong logic. The entire `blobs` map is posted to the worker on every synthesis call (`:357-369`).
Impact: unbounded memory growth, untestable global state (tests must monkey-patch module internals), multi-instance hazards (`PiperProvider` is reconstructed on every provider switch but the worker/queue are shared), subtle cross-talk between requests.
Fix: encapsulate in a `PiperRuntime` class owned by the provider (or by the registry as a singleton with explicit lifecycle): request-id-correlated messages, LRU eviction of in-memory model blobs, queue that resets after errors, `dispose()`.

### D8. `TTSProviderManager`: stale-provider event leaks, throwaway construction, magic `'local'` id, `as any` piper API
**Severity: high — Category: architecture**
Evidence:
- `setProvider` replaces `this.provider` but never detaches the manager's listener from the old provider (`TTSProviderManager.ts:211-215`; providers only support `on()`, no `off()` — `types.ts:102`). An old cloud provider with an in-flight `getOrFetch` resolves later, calls `playBlob` on its own `AudioElementPlayer`, and emits `start`/`end` into the live event pipeline. Audible ghost playback + state corruption.
- Constructor always builds a device provider even though the persisted `providerId` may be `'google'` (`:62-70`); the real provider arrives only when `loadVoices()` runs. Platform detection is duplicated three times (`:64-68`, `:118-122`, `providerFactory.ts:29`).
- Both `WebSpeechProvider` and `CapacitorTTSProvider` claim `id = 'local'` (`WebSpeechProvider.ts:8`, `CapacitorTTSProvider.ts:8`); fallback logic and the store's `providerId` key off that magic string (`TTSProviderManager.ts:88,153`).
- Voice download/delete/check is piper-only duck typing: `const piper = this.provider as any` guarded by `id === 'piper'` (`:235-264`); `isVoiceDownloaded` returns `true` for every non-piper provider (`:263`), so the UI can claim a voice is "Ready" that was never downloaded if provider/UI state desyncs.
- Old providers are never `destroy()`ed — each `BaseCloudProvider` constructs its own `AudioElementPlayer` (+`AudioContext` on first earcon), which leaks (`BaseCloudProvider.ts:19-23`, `AudioElementPlayer.destroy` exists but is never called from this path).
Impact: provider switching — a core flow — is the least safe operation in the subsystem.
Fix: give `ITTSProvider` a `dispose()` and an unsubscribe handle; manager detaches + disposes the outgoing provider; share one `AudioSink` injected by the manager instead of one per provider instance; replace `as any` with an optional `VoiceDownloadable` capability interface from the registry (D3); give device providers distinct ids (`'webspeech'`, `'capacitor'`) with `'local'` as a UI alias.

### D9. `ITTSProvider` contract is inconsistent and partly dead
**Severity: medium — Category: architecture**
Evidence:
- `resume()` is required (`types.ts:99`) but nothing ever calls it: `PlaybackBackend` has no resume (`engine/PlaybackBackend.ts:28-51`), `TTSProviderManager` doesn't expose it, and the engine resumes via `playInternal(true)` (`AudioPlayerService.ts:807-810`). Three dead implementations, two of which (`WebSpeechProvider.ts:150-154`, `CapacitorTTSProvider.ts:214-219`) restart the whole utterance — divergent semantics that would surprise any future caller.
- `play()` resolution semantics differ: docs say "resolves when playback starts" (`types.ts:86-91`); WebSpeech resolves on `onstart` (`WebSpeechProvider.ts:111-114`); cloud resolves after `playBlob` then emits `start` (`BaseCloudProvider.ts:54-58`); Capacitor emits `start` and returns **before** native playback begins (`CapacitorTTSProvider.ts:134,136-153`).
- `SpeechSegment.isNative` is set by every implementation, read by none (grep: only assignments).
- `TTSOptions.volume` (`types.ts:43`) is never used by any provider; `TTSEvent` error payload is `any` (`types.ts:50`).
Impact: the "plugin interface" is wider than reality, so new implementations copy dead conventions; differing `play()` semantics make the engine's status machine provider-dependent.
Fix: shrink the interface to what's called (drop `resume`, `isNative`, `volume`); specify and test `play()` semantics in one shared provider-contract test suite; type the error event.

### D10. Dead settings and dead cost machinery
**Severity: medium — Category: dead-code**
Evidence (all verified by grep over non-test sources):
- `pitch`: stored, persisted, migrated, device-synced (`useTTSStore.ts:37,98,285-296`; `GlobalSettingsDialog.tsx:610`; `DeviceManager.tsx:29`) — but `TTSOptions` has no pitch and no provider applies it. No UI control sets it either.
- `profiles[].volume` — written everywhere, applied nowhere.
- `enableCostWarning` (`useTTSStore.ts:76,106,161,353-355,499`) — zero readers.
- `CostEstimator.estimateCost`, `getSessionUsage`, `useCostStore` (`CostEstimator.ts:18-22,60-84`) — zero consumers; only `track()` is called (`BaseCloudProvider.ts:95`), feeding a store nobody reads. And it counts **Piper** (free, local) characters because Piper extends `BaseCloudProvider`.
- `isModelLoadedInWorker` (`piper-utils.ts:120-156`) — exported, never imported.
- `GoogleTTSProvider` requests `enableTimePointing: ["SSML_MARK"]` while sending plain text with no `<mark>` tags (`GoogleTTSProvider.ts:83-91`), then maps any timepoints to `charIndex: 0` (`:120-128`) — alignment data is structurally meaningless; the engine's `onBoundary` is a no-op anyway (`AudioPlayerService.ts:157-159`).
Impact: phantom features mislead both users-of-code and UI work (the cost-warning toggle suggests a feature that does not exist); every dead field must still be migrated and replicated.
Fix: delete or implement. If cost warnings are wanted, wire `enableCostWarning` + `estimateCost` into the play path; otherwise remove the toggle, store fields, and `CostEstimator` beyond a plain counter (or remove tracking entirely and stop counting Piper).

### D11. Cloud fetches have no cancellation and no timeout; cache writes race `stop()`
**Severity: medium — Category: correctness**
Evidence: `BaseCloudProvider.fetchAudio` accepts an `AbortSignal` (`BaseCloudProvider.ts:151`) that no subclass ever passes (`GoogleTTSProvider.ts:93-100` uses raw `fetch` without signal; `OpenAIProvider.ts:54-62`, `LemonFoxProvider.ts:83-85` omit it). `stop()` only stops the sink (`BaseCloudProvider.ts:126-128`); in-flight `getOrFetch` promises keep running, get cached, and remain in the registry. No request timeout exists anywhere in the provider layer (the only 15s guard is the worker-boot guard, `createWorkerEngineClient.ts:114-121`).
Impact: skipping rapidly through sentences keeps paying for abandoned synthesis; a hung fetch hangs `play()` forever (engine status stuck on `loading`); preloads for sections the user left are unstoppable.
Fix: per-request `AbortController` keyed by the registry entry; `stop()` aborts non-preload requests; add a sane timeout in `fetchAudio` and use it everywhere (including Google's hand-rolled fetches).

### D12. TTS audio cache grows forever — no eviction anywhere
**Severity: medium — Category: correctness**
Evidence: `TTSCache.put` → `dbService.cacheSegment` stamps `createdAt`/`lastAccessed` (`DBService.ts:568-580`) and `get` refreshes `lastAccessed` (`:558-561`), but no code deletes from `cache_audio_blobs`: `MaintenanceService.pruneOrphans` covers only `static_resources`, `cache_render_metrics`, `cache_tts_preparation` (`MaintenanceService.ts:72-75`). Keys are content hashes including speed (D1), multiplying entries.
Impact: unbounded IndexedDB growth on every cloud/Piper listening session (an hour of audio is tens of MB); eventual quota pressure evicts the whole origin's storage on Safari — which would take the user's *library* with it.
Fix: LRU eviction by `lastAccessed` with a size budget, run from MaintenanceService; the timestamps it needs already exist.

### D13. Piper worker patching: brittle string surgery on a gitignored artifact, warn-and-continue failure mode
**Severity: medium — Category: hygiene**
Evidence: `package.json:14-15` — postinstall copies `piper-wasm` build output into gitignored `public/piper/` (`.gitignore:34`) and runs `scripts/patch_piper_worker.js`, which applies 6 exact-string replacements. Two of the six are functional (config-file passing, `scripts/patch_piper_worker.js:25-63`; phoneme-id clamping `:72-94` — both prevent WASM crashes); the rest are error-reporting hardening, and one literally injects JSDoc comments into a build artifact (`:139-176`). On anchor mismatch most patches `console.warn` and the install **succeeds** (`:61, :91, :174`), shipping an unpatched worker that fails at runtime with OOB memory crashes. `piper-wasm` is specified as `^0.1.4` (`package.json:57`), so any upstream patch release can silently invalidate the anchors. Meanwhile the project already uses patch-package for capgo (`patches/`), i.e. two divergent patching mechanisms. (Also: `scripts/README.md` describes only a nonexistent `generate_pwa_icons.py` — drifted.)
Impact: a classic "works until npm install on a new machine" trap; the most fragile correctness-relevant code in the subsystem lives outside version control and outside CI's view.
Fix: vendor the patched `piper_worker.js` (and the other three artifacts) into the repo (`src/vendor/piper/` served via Vite static copy) with a recorded upstream version + the two functional patches applied; or pin `piper-wasm` exactly and convert to patch-package against `node_modules` before the copy step. Either way: make patch failure fail the install, and add a smoke test that the served worker contains the clamp patch.

### D14. Import cycle: store → engine → backend → factory → store, with side effects at module init
**Severity: medium — Category: architecture**
Evidence: `useTTSStore.ts:4` imports `mainThreadAudioPlayer` → imports `TTSProviderManager` (`mainThreadAudioPlayer.ts:17`) → imports `providerFactory` (`TTSProviderManager.ts:7`) → imports `useTTSStore` (`providerFactory.ts:12`). The cycle is "safe" only because all cross-calls are deferred to runtime — except `onRehydrateStorage`, which runs during `create()` and immediately calls `getAudioPlayer()` plus `LexiconService.getInstance()` (`useTTSStore.ts:506-525`), and `setActiveLanguage`, which lazy-imports `useToastStore` (`:196-198`) to dodge another cycle.
Impact: module-evaluation order is load-bearing; innocuous import reshuffling can produce TDZ crashes; bundlers can't tree-shake across the loop; the lazy toast import is a smell flagging the structural problem.
Fix: invert the one bad edge — `buildProviderById` should receive `{apiKeys, activeLanguage}` as parameters (the backend host already has store access at the call site in `createWorkerEngineClient.ts`); store side effects on rehydrate move to an explicit `initialize()` call from `App`.

### D15. Hardcoded voice catalogs and policy buried in providers
**Severity: medium — Category: architecture**
Evidence: Piper's catalog filter admits only single-speaker `en_US`/`zh_CN` voices (`PiperProvider.ts:94-95`) — en_GB/de/fr Piper voices exist upstream but can never appear; HF URL + version pinned in a constant (`:7`). LemonFox's 28 voices (`LemonFoxProvider.ts:16-47`) and OpenAI's 6 voices/`tts-1` model (`OpenAIProvider.ts:16-23,55`) are frozen in code (no `tts-1-hd`, none of the newer voices). The settings UI hardcodes the language list to en/zh (`TTSSettingsTab.tsx:108-110`).
Impact: supporting a third book language (the EPUB library is arbitrary-language) requires code changes in N providers + UI; voice/model freshness depends on hand edits.
Fix: voice catalogs as data (static JSON per provider, or remote-with-cache), language list derived from available voices + library languages; model choice (`tts-1` vs `tts-1-hd`) becomes provider config in the registry descriptor.

### D16. API keys persisted as plaintext in localStorage
**Severity: low — Category: security**
Evidence: `partialize` persists `apiKeys` into the `tts-storage` localStorage entry (`useTTSStore.ts:494`); keys are also readable synchronously by any XSS via `useTTSStore.getState()`. (Same pattern as the GenAI key store; for a local-first web app options are limited, but worth a deliberate decision.)
Impact: XSS or shared-device exposure of paid API keys; users may not expect keys to live in plain site data.
Fix: document the tradeoff; at minimum exclude keys from any export/sync surfaces and consider IndexedDB + non-extractable wrapping or session-scoped entry on shared devices.

### D17. Assorted small defects
**Severity: low — Category: hygiene**
- `CapacitorTTSProvider.play` logs `promiseSettled: wasFinished` read **after** the flag was reset to `false` two lines earlier — always logs `false` (`CapacitorTTSProvider.ts:75-86`).
- In the handoff branch, `start` is emitted before checking whether the adopted promise already rejected (`:89-106`).
- `MockCloudProvider` voices claim `provider: 'google'/'openai'` while its id is `mock-cloud` (`MockCloudProvider.ts:14-17`).
- `providers/README.md` documents only 4 of 8 files — no Piper, Capacitor, LemonFox, piper-utils.
- `WebSpeechProvider.getVoices` re-implements `init()`'s voice-loading retry inline (`WebSpeechProvider.ts:70-93`).
- `deleteCachedModel` fires `removeFromCache` without awaiting (`piper-utils.ts:163-175`), so `deleteVoice` resolves while Cache API deletion is pending — an immediate `isVoiceDownloaded` can still return true.
- `TTSCache.generateKey`'s `pitch`/`lexiconHash` params are always defaulted (`BaseCloudProvider.ts:75`) — vestigial.

---

## Problematic couplings

- **`providerFactory` → `useTTSStore`** (`providerFactory.ts:12,22`): the provider layer reaches up into a UI-facing Zustand store for keys/language, creating the D14 import cycle. Construction context should be passed down.
- **`BaseCloudProvider` → `TTSCache` → `dbService`** (`TTSCache.ts:1`, `BaseCloudProvider.ts:4`): providers write IndexedDB directly via the global `dbService` singleton; cache policy (eviction, key shape) is split between provider layer and DB layer with neither owning it.
- **`BaseCloudProvider` → `CostEstimator` → `useCostStore`** (`BaseCloudProvider.ts:5,95`): synthesis layer writes into a Zustand store nobody reads; also fires inside the Web-Worker-adjacent path purely on the main thread by accident of architecture.
- **`useTTSStore` ↔ engine** (`useTTSStore.ts:4,217-222,233-258`): the settings store imperatively drives `getAudioPlayer()` in six setters and in `onRehydrateStorage`; meanwhile the engine writes back into the store via host command `setActiveLanguage` (`createWorkerEngineClient.ts:56`) which immediately calls back into the engine (`useTTSStore.ts:216-222`) — a write loop terminated only by idempotence checks on the engine side.
- **`useTTSStore.setActiveLanguage` → dynamic `import('./useToastStore')`** (`useTTSStore.ts:196`): UI concern (toasts) inside a settings store action, lazy-imported to dodge the cycle.
- **Boundary events cross the worker channel to feed a no-op**: WebSpeech/Capacitor word-boundary events are forwarded per-word main→worker (`createWorkerEngineClient.ts:132`, `WorkerTtsEngine.ts:178`) into `onBoundary: () => {}` (`AudioPlayerService.ts:157-159`) — pure cross-thread noise until highlighting is actually implemented.
- **`TTSProviderManager` → `@capacitor/core`** (`TTSProviderManager.ts:4`): platform detection in the backend forces the type-only-import dance documented in `engine/PlaybackBackend.ts:18-20` to keep Capacitor out of the worker bundle.

## What's good (keep)

- **The `PlaybackBackend` seam and "provider id as plain data" rule** (`engine/PlaybackBackend.ts`, `providerFactory.ts` header comment): live providers never cross the worker boundary; the engine depends only on the port. This is the right shape — the registry refactor should slot beneath it, not replace it.
- **`BaseCloudProvider.getOrFetch`**: permanent cache → in-flight request registry → owner-only cost tracking, with registry cleanup in `finally` (`BaseCloudProvider.ts:74-116`), well covered by `BaseCloudProvider.registry.test.ts`. Keep the pattern; fix only the speed key and abort support.
- **`AudioSink` abstraction + injectable sink in every provider constructor** (`engine/AudioSink.ts`, `BaseCloudProvider.ts:19`): providers are testable without jsdom media shims (`FakeAudioSink`).
- **Capacitor "Smart Handoff"** — preload via native queue + promise adoption with utterance-id guards against stray events (`CapacitorTTSProvider.ts:65-153`) is a genuinely clever gapless-playback solution and has thorough behavioral tests (`CapacitorTTSProvider.test.ts`: handoff, flush fallback, stale-event races, listener-leak prevention).
- **Transactional Piper voice download** — stage to memory, commit to cache, verification load, rollback on failure (`PiperProvider.ts:158-197`).
- **CJK-aware chunking with clause-boundary → lexical → hard-split fallback** (`PiperProvider.ts:26-67, 209-231`) and the WAV-stitching implementation that parses real chunk offsets instead of assuming 44-byte headers (`piper-utils.ts:199-268`).
- **`TTSCache` SHA-256 content keying** into IndexedDB — the right cache identity model (modulo speed).
- **WebSpeech `voiceschanged` handling** with timeout + addEventListener/onvoiceschanged fallback (`WebSpeechProvider.ts:24-68`) — encodes years of browser quirks; keep behavior, deduplicate with `getVoices`.
- **Provider unit tests are behavioral, not bug-shaped** — unusually for this codebase, the provider test suite (8 files) tests contracts (queue strategies, fallback, dedup) rather than single regressions.
- **`flightRecorder` instrumentation** in the Capacitor provider and engine — cheap and valuable for diagnosing field issues.

## Target design

1. **Provider registry as single source of truth.** `src/lib/tts/providers/registry.ts` exporting `PROVIDERS: readonly ProviderDescriptor[]` where `ProviderDescriptor = { id, displayName, kind: 'device'|'wasm'|'cloud', requiresApiKey: boolean, capabilities: { downloadableVoices, alignment, synthesisSpeed, pitch }, build(ctx: ProviderBuildContext): ITTSProvider }`. `ProviderBuildContext = { apiKey?, language, sink }` is **passed in** (breaks the store cycle). `TTSProviderId = typeof PROVIDERS[number]['id']` replaces all hand-written unions; `TTSSettingsTab` renders the Select and key inputs from the registry.
2. **Narrow, specified `ITTSProvider`.** `{ id, init, getVoices, play, preload, pause, stop, dispose, events (typed emitter with unsubscribe) }`; optional capability interfaces `VoiceDownloadable { downloadVoice, deleteVoice, isVoiceDownloaded }` and `LocaleAware { setLocale }` reached via type guards driven by descriptor capabilities — no `as any`, no required-but-dead members. One shared **provider contract test suite** (parameterized over all providers with fakes) pins `play()` resolution semantics and single-shot error signaling.
3. **One failure path.** Providers reject `play()`; they never also emit an error for the same failure. `TTSProviderManager` becomes a dumb holder (construct via registry, detach + `dispose()` the outgoing provider, share a single `AudioSink`). Fallback policy moves into the engine as a sequenced task: stop → swap → replay-current, with a max-retry counter.
4. **Defined speed/pitch policy.** Synthesize at 1.0; rate applied by the sink after source load; cache key = `hash(text|voiceId|providerId)`; `synthesisSpeed`/`pitch` become opt-in capabilities for providers where baking it in is genuinely better (none today). Pitch and volume either get implemented end-to-end or removed from `TTSProfile`.
5. **Store split.** `useTTSSettingsStore` (persisted: providerId, apiKeys, profiles map only, segmentation, background audio) and `useTTSPlaybackStore` (ephemeral mirror of engine state incl. download progress). Flat `rate/pitch/voice` fields die; selectors derive them from `profiles[activeLanguage]`. Engine synchronization happens in one controller module (subscribe → engine calls), not in setters. API-key edits are buffered; provider re-init happens on commit.
6. **Piper self-containment.** `PiperRuntime` class (worker lifecycle, request-id protocol, model-blob LRU); voices catalog cached with stale-while-revalidate + "downloaded voices always listed offline"; `onnxruntime-web` and the patched worker vendored in-repo and precached by the SW; postinstall patching deleted.
7. **Cache stewardship.** Audio-cache LRU eviction in MaintenanceService with a configurable byte budget.

## Migration notes

Ordered to stay shippable at each step; user-visible persisted data is touched only in steps 5–6.

1. **Behavior pins first.** Add the cross-provider contract test suite plus non-1.0-speed tests for each provider (encoding *current* behavior where deliberate, marked expected-fail where buggy: double speed, double error emit). This is the safety net for everything below.
2. **Fix D1 (speed) + D11 (abort/timeout) inside the existing shapes.** Remove `speakingRate`/`speed` from cloud request bodies; move `setRate` after source load in `AudioElementPlayer.playBlob` (set both `defaultPlaybackRate` and `playbackRate` to survive the load algorithm); drop speed from `generateKey`. *Cache migration:* old speed-keyed entries simply miss and re-fetch; optionally clear `cache_audio_blobs` once via a DB version bump to reclaim space. Add the eviction job (D12) here.
3. **Fix the fallback race (D2).** Make `BaseCloudProvider.play` reject without emitting; collapse `TTSProviderManager`'s two handlers into one; move retry into a sequenced engine task. The existing `TTSProviderManager.test.ts` fallback test pins the observable outcome.
4. **Introduce the registry (D3) behind the current API.** `buildProviderById` becomes a thin wrapper over the registry that still reads the store (one release), then flip the call sites (`TTSProviderManager`, host backend in `createWorkerEngineClient`) to pass `ProviderBuildContext` explicitly and delete the store import — dissolving the D14 cycle. Derive all unions from the registry; update `TTSSettingsTab` to render from it (UI unchanged pixel-wise).
5. **Store split (D4/D5/D10).** New `tts-settings` persist entry with a migration that reads the existing `tts-storage` v3 blob: copy `providerId`, `apiKeys`, `profiles` (dropping flat `rate/pitch/voice`, dropping `volume`/`pitch`/`enableCostWarning` unless implemented), `customAbbreviations`, `alwaysMerge`, `sentenceStarters`, `backgroundAudioMode`, `whiteNoiseVolume`. Keep reading the old key for one release for rollback; never delete it in the same release. The worker replication spec (`replicationSpec.ts`) must be updated in lockstep — it replicates store slices by name and is deliberately loud on missing slices, so this cannot drift silently.
6. **Provider id rename (`'local'` → `'webspeech'`/`'capacitor'`)** folded into the same persist migration: map stored `providerId: 'local'` by platform at migration time. `TTSVoice.provider` values in persisted profiles only matter via `voiceId`, which is provider-native and unchanged.
7. **Piper runtime + vendoring (D6/D7/D13).** Vendor artifacts in-repo with the two functional patches applied; delete `prepare-piper`/`patch_piper_worker.js` from postinstall; add SW precache entries; ship `PiperRuntime`; add a CI smoke test asserting the served worker contains the phoneme-clamp code. The Cache API model store (`piper-voices-v1`) is unchanged, so existing downloaded voices keep working; only the catalog/init path changes (downloaded voices must enumerate offline — test this explicitly).
8. **Cleanup pass (D9/D10/D17).** Delete dead interface members, `CostEstimator` dead halves (or implement the cost-warning feature deliberately), `isModelLoadedInWorker`, Google's mark-less timepoint request; refresh `providers/README.md` and `scripts/README.md`.

No Yjs/Firestore data is involved anywhere in this subsystem (settings are localStorage-persisted, audio cache is rebuildable, Piper models are re-downloadable), so the worst-case failure mode of every step is "settings reset to defaults / cache refetch" — keep it that way by treating the step-5 persist migration as the only risky change and double-writing for one release.
