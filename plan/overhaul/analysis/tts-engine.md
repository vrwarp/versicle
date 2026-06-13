# TTS playback engine & audio runtime (`tts-engine`)

Analysis date: 2026-06-09. All paths relative to repo root. Line numbers from the current
worktree (branch `claude/amazing-davinci-d7336e`).

## What it is

The orchestration and audio-runtime layer of Versicle's audiobook feature: the "brain" that
turns a per-section sentence queue into sequential synthesized playback, with lock-screen /
media-session integration, background keep-alive audio, session persistence/restore, GenAI
skip-mask + table-adaptation application, and a pause→play "Dragnet" audio-bookmark gesture.

It has **two execution topologies for the same engine class**:

1. **In-process** — `AudioPlayerService` constructed on the main thread (today: tests only).
2. **Worker** — the same `AudioPlayerService` running inside `src/workers/tts.worker.ts`,
   with state replicated in from Zustand and audio/platform commands proxied back out to the
   main thread over Comlink. This is the **only production path**
   (`mainThreadAudioPlayer.ts:29-34` returns a `WorkerEngineHandle` unconditionally).

The engine reaches the host world through three deliberately designed ports —
`EngineContext` (Zustand stores + Capacitor), `PlaybackBackend` (providers/synthesis),
`AudioSink` (audio device) — which is the strongest piece of architecture in the subsystem.

## File inventory

### Core orchestration (src/lib/tts/)
| File | Role |
|---|---|
| `AudioPlayerService.ts` (1242) | God object: playback FSM, queue lifecycle, restore, media metadata, progress %, dragnet capture, lexicon cache, analysis reapplication, language sync. |
| `PlaybackStateManager.ts` (487) | Queue + index + section index, skip masks, table adaptations, prefix-sum time estimates, persistence to `dbService`. |
| `TaskSequencer.ts` (49) | Serial promise chain; no cancellation/coalescing/timeout. |
| `SyncEngine.ts` (105) | Alignment→highlight mapper; **its output callback is a no-op** — dead feature on the hot path. |
| `AudioElementPlayer.ts` (247) | `AudioSink` impl: HTML5 `<audio>` + Web Audio earcon ducking. Used by cloud providers (main thread). |
| `BackgroundAudio.ts` (96) | Two looping `<audio>` elements (silence/white-noise) as background keep-alive. |
| `PlatformIntegration.ts` (200) | `MediaPlatform` impl: MediaSession + BackgroundAudio orchestration, metadata deadband. |
| `MediaSessionManager.ts` (371) | Native/web MediaSession wrapper; canvas artwork cropping + conic progress overlay. |
| `TTSFlightRecorder.ts` (245) | Ring-buffer tracer singleton + IDB snapshots + anomaly auto-detection. |
| `TTSProviderManager.ts` (274) | Production `PlaybackBackend`: provider selection, cloud→local fallback, voice download proxying. |

### Engine boundary (src/lib/tts/engine/)
| File | Role |
|---|---|
| `EngineContext.ts` (210) | The host-state port (10 sub-ports); types derived from store `typeof`s. |
| `createZustandEngineContext.ts` (120) | Production wiring → live stores + Capacitor. |
| `WorkerEngineContext.ts` (290) | Replicated-state `EngineContext` for the worker; throws on never-replicated reads. |
| `replicationSpec.ts` (147) | Declarative table of replicated slices; compile-time exhaustive. |
| `PlaybackBackend.ts` (59) | Synthesis/playback command interface. |
| `AudioSink.ts` (37) | Audio device interface. |
| `WorkerTtsEngine.ts` (224) | Worker-side host: builds APS with proxy backend/platform; `EngineHost` contract. |
| `createWorkerEngineClient.ts` (228) | Main-thread bridge: spawns worker, hosts real backend/platform, replicates state, applies host commands. |
| `WorkerEngineHandle.ts` (134) | Sync façade satisfying `TtsEngine`; queues calls on boot promise; caches snapshots. |
| `mainThreadAudioPlayer.ts` (56) | Composition root: `getAudioPlayer()` (worker) + `getInProcessAudioPlayer()` (tests). |
| `FakeEngineContext.ts` / `FakePlaybackBackend.ts` / `FakeAudioSink.ts` | Handwritten fakes (good). |
| `engineParityScenarios.ts` + `engineParity.{inprocess,worker}.test.ts` | Shared behavioral contract run on both transports. |
| `replication.test.ts`, `WorkerEngineContext.test.ts`, `WorkerTtsEngine.test.ts`, `WorkerEngineHandle.test.ts`, `createWorkerEngineClient.hostCommands.test.ts`, `EngineContext.test.ts`, `AudioPlayerService.isolated.test.ts` | Boundary tests (good quality). |
| `README.md`, `PORTING-TO-WORKER.md` | Architecture docs — partially stale. |

### Worker entry
| File | Role |
|---|---|
| `src/workers/tts.worker.ts` (14) | `Comlink.expose(new WorkerTtsEngine())`. |

### Consumers (outside the subsystem)
`useTTSStore` (settings + engine-state mirror + command proxy), `useTTS` hook (queue/visual
sync + dragnet invalidation), `ReaderView.tsx` (5 direct `getAudioPlayer()` call sites),
`LexiconManager.tsx` (preview), `DiagnosticsTab.tsx` (flight recorder), `main.tsx`
(`__ttsWorkerSmokeTest`), `src/types/db.ts` + `src/db/DBService.ts` (import `TTSQueueItem`).

## How it works (data & control flow)

**Command flow (production/worker):** UI → `useTTSStore` action → `getAudioPlayer()`
(`WorkerEngineHandle`) → fire-and-forget onto the boot promise → Comlink →
`WorkerTtsEngine` → `AudioPlayerService.enqueue(task)` → `TaskSequencer` serial chain.

**Audio flow:** APS → proxy `PlaybackBackend` (WorkerTtsEngine.ts:117-135) → Comlink →
`EngineHost.backendPlay` → real `TTSProviderManager` → provider (WebSpeech / Capacitor /
cloud via `AudioElementPlayer`) on the main thread. Provider events flow back via
`dispatchBackendEvent` (createWorkerEngineClient.ts:124-137 → WorkerTtsEngine.ts:170-184).

**State out:** `PlaybackStateManager` subscription + `setStatus` both call
`notifyListeners(status, cfi, index, queue, error, downloadInfo)` → Comlink-proxied
listener → `WorkerEngineHandle` cache → `useTTSStore.set(...)` (useTTSStore.ts:239-257).

**State in (replication):** `replicationSpec.ts` defines 6 slices (settings, activeLanguage,
genAI, analysis = boot; bookLanguage, progress = per-book). `createWorkerEngineClient`
pushes boot snapshots (awaited), subscribes for live pushes, gates readiness on
`hasReplicated`. `WorkerEngineContext` serves the engine's synchronous getters from the
replicated cache and throws loudly on never-pushed boot slices.

**Writes out:** engine store writes (`updateTTSProgress`, `addCompletedRange`, annotations,
toasts, analysis persistence) leave the worker as `EngineHostCommand`s →
`applyHostCommand` (createWorkerEngineClient.ts:54-85) → real stores/repositories.

**Persistence:** queue → `dbService.saveTTSState` (PSM.persistQueue, fire-and-forget);
pause time → `dbService.updatePlaybackState` (deliberately detached because WebKit IDB
writes can hang — AudioPlayerService.ts:818-824); CFI position → Yjs via
`readingState.updatePlaybackPosition`. Restore: `setBookId` → `restoreQueue` (379-450)
reads dbService + Yjs progress, clears stale skip flags, re-triggers analysis.

**Sequencing/cancellation:** there is **no cancellation**. Staleness is handled by ad-hoc
re-checks of `this.currentBookId !== bookId` / section-index equality sprinkled through
async bodies and callbacks (e.g. 564, 573, 728, 757, 776, 1065-1067, 1146-1154).

## Technical debt

### D1. Provider-event and gesture paths bypass the TaskSequencer — CRITICAL / correctness
**Evidence:**
- `AudioPlayerService.ts:143-148` — `onError` with `type: 'fallback'` calls
  `this.playInternal(true)` **directly**, not via `enqueue`. Every other entry into
  `playInternal` is serialized; this one can interleave with an in-flight `loadSection`,
  `stop`, or `setQueue` task mid-await.
- `AudioPlayerService.ts:659-665` — `play()` runs `executeDragnetCapture()` (reads
  `stateManager.queue`/`currentIndex`, writes an annotation, plays an earcon) *before* the
  enqueue, racing whatever task is currently mutating the queue.
- `TTSProviderManager.ts:142-164` — the `play()` catch path fires
  `events.onError({type:'fallback'})` **and** `await switchToLocalProvider()` concurrently
  with APS's un-serialized `playInternal(true)` retry → possible double synthesis or play
  against a half-switched provider.

**Impact:** this is the exact class of interleaving bug that produced the flight recorder,
the anomaly auto-snapshots, and a dozen regression test files. The serialization invariant
("all state mutation passes through the sequencer") is unenforced and currently false.

**Fix:** route *every* externally-triggered transition through the sequencer (fallback =
enqueue a `recoverWithLocalProvider` task; dragnet = enqueue, with the timestamp check
inside). Make `setStatus`/state mutation private to the task context; assert (dev-mode)
that mutations only happen inside a running task.

### D2. `applySkippedMask` mutates the queue array in place — broken dirty-check + transport-divergent UI — CRITICAL / correctness
**Evidence:** `PlaybackStateManager.ts:100-114` replaces items inside the **same** array
(`this._queue[i] = {...item}`), while `applyTableAdaptations` (137-191) correctly clones and
swaps the array. Consequences:
1. `persistQueue` (439-447) dedupes on `lastPersistedQueue !== this._queue` — after an
   in-place mask the reference is unchanged, so **skip-mask changes are never persisted**
   (then `restoreQueue` at AudioPlayerService.ts:393-419 has special "stale isSkipped flag"
   cleanup that papers over the inconsistent persisted shapes).
2. Listeners receive `queue: this._queue` (478-485) — the same reference every notify. On
   the in-process engine, Zustand/React selectors on `state.queue` see an identical
   reference and **skip re-render**; on the worker engine every broadcast is
   structured-cloned, so it *does* re-render. The two transports observably differ and the
   parity suite never applies masks, so nothing catches it.

**Impact:** skipped-sentence UI desync, divergent transport behavior, misleading persisted
state; cost already paid once in the restore-cleanup workaround.

**Fix:** make `PlaybackStateManager` immutable-by-construction (every mutation produces a
new array; freeze in dev), and emit a single immutable snapshot object. Add a parity
scenario that applies a skip mask and asserts a fresh queue identity on both transports.

### D3. `AudioPlayerService` is a god object — HIGH / architecture
**Evidence:** 1242 lines; 197 commits touch this one file. The constructor alone wires six
reactive flows (107-268): content-analysis subscription, platform callbacks, provider
events, PSM subscription, book-store language sync, genAI-settings sync, flight-recorder
context + anomaly hooks. The class also owns: session restore (379-450), media metadata
duplication (345-364 vs 452-469 — two near-identical metadata builders), book progress
calculation (471-494), dragnet capture (672-715), lexicon-rule caching with ad-hoc
invalidation (`activeLexiconRules = null` at 210, 297, 340, 1010-1012), analysis
reapplication (1042-1103), preview mode (637-657), preroll, battery checks.

Duplicated reading-history side effects: `playNext` (958-967) and `setStatus` (992-1005)
both call `addCompletedRange` with subtly different conditions.

**Impact:** every fix is made "wherever it fits", inviting the next regression; the 12
single-bug `AudioPlayerService_*.test.ts` files are the fossil record of this instability.
Unsafe to modify — this is the structural core of the subsystem's debt.

**Fix:** decompose along the seams that already exist informally:
`PlaybackController` (FSM + sequencer), `SessionRestoreService`, `MediaMetadataPublisher`
(single metadata builder + progress calc), `AnalysisApplier` (mask/adaptation
subscription + reapply), `DragnetGesture`, `LexiconCache`. APS becomes a thin façade
composing them. See Target design.

### D4. Two notification paths emit inconsistent snapshots — HIGH / correctness
**Evidence:** listeners are notified from `setStatus` (1020, computing `currentCfi = null`
when stopped, 1016-1018) *and* from the PSM subscription (177-188, using
`snapshot.currentItem?.cfi` regardless of status), plus `notifyError` (1105-1107) and
`notifyDownloadProgress` (1109-1111) build their own argument tuples. There is no single
`PlaybackSnapshot`; status and queue/index updates arrive in separate callbacks, and an
error notification implicitly carries `downloadInfo: undefined`, clobber-resetting download
state in any listener that spreads it.

**Impact:** UI flicker classes of bugs ("Treat 'loading' as playing to prevent UI flicker"
— useTTSStore.ts:242-245 is a workaround); ordering-dependent listener behavior; the
positional 6-argument `PlaybackListener` (AudioPlayerService.ts:48) is fragile to extend.

**Fix:** one immutable `PlaybackSnapshot { status, queue, index, sectionIndex, activeCfi,
error?, download? }` emitted from exactly one place, versioned with a monotonic sequence
number (cheap staleness detection across the worker boundary).

### D5. Replication echo loop and per-sentence O(queue) serialization — HIGH / performance + architecture
**Evidence:** `useTTSStore` mixes engine **output** (status, queue, currentIndex —
useTTSStore.ts:44-50) with engine **input** settings in one store. The `settings`
replication slice pushes `plain(useTTSStore.getState())` on **every** store change
(replicationSpec.ts:55-61), and `plain` is a JSON round-trip (28-30). So each per-sentence
engine broadcast → handle → `useTTSStore.set` → settings-slice push → **the entire store
including the full queue is JSON-stringified and structured-cloned back into the worker**
— twice-serialized echo of data the worker itself produced. Similarly the `genAI` slice
fires on every `addLog` host command the engine writes during analysis; the engine's
`genAI.subscribe` handler (AudioPlayerService.ts:220-235) then resets analysis timestamps
and re-enqueues mask application — a write→push→reapply loop terminated only by
"no change" checks in PSM.

Each status broadcast also clones the entire queue main-ward (Comlink listener proxy), per
sentence.

**Impact:** several full-queue serializations per spoken sentence; latent feedback loops;
hard-to-reason data flow. Bounded today, but it scales with chapter size and will be the
first thing to fall over on low-end Android.

**Fix:** split `useTTSStore` into `useTTSSettingsStore` (persisted, replicated) and
`useTTSPlaybackStore` (engine mirror, never replicated). Replicate a hand-picked settings
subset (the engine reads ~8 fields). Replace full-queue broadcasts with
`{queueId, changedIndices}` deltas or broadcast the queue only on queue-identity change.

### D6. The dual-transport contract is unowned; parity suite covers a fraction of behavior — HIGH / architecture + testing
**Evidence:**
- `TtsEngine` is defined as `Pick<AudioPlayerService, ...>` (AudioPlayerService.ts:55-64) —
  the public contract is derived *from the implementation*, so the concrete class can never
  be retired and signature drift is invisible.
- Promise semantics differ: in-process `loadSection`/`jumpTo`/`setSpeed` resolve when the
  sequenced task completes; `WorkerEngineHandle` returns `Promise.resolve()` immediately
  (WorkerEngineHandle.ts:96-113). `skipToNextSection` is awaited on both. Untested.
- Handle command failures are swallowed (`run()` logs only, 80-83): a worker-side throw on
  `play()` surfaces nowhere in the UI.
- `setQueue`/`getQueue` exist on `WorkerTtsEngine` (206-207) but not on `TtsEngine`/handle —
  kept alive only for `main.tsx`'s smoke test and the parity suite.
- `engineParityScenarios.ts` has 11 scenarios (play/pause/stop/jump/error/voices/speed/
  provider-id) — none for restore, skip masks, table adaptations, dragnet, section
  navigation, media metadata, or promise semantics — exactly the behaviors that have
  regression-test files on the in-process path only.

**Impact:** behavioral drift between test topology (in-process) and production topology
(worker) is structurally likely and has already happened (D2).

**Fix:** define `TtsEngine` as a standalone interface both classes implement; spec
resolution semantics ("commands are acks, not completions") explicitly; move the
regression-test behaviors into the shared parity scenarios; surface handle errors into the
snapshot error channel.

### D7. Flight recorder is split-brained across threads — HIGH / correctness (diagnostics)
**Evidence:** `TTSFlightRecorder.ts:240` is a module singleton. In production the recording
calls (`APS`, `PSM`, `TSQ` sources) execute **inside the worker** instance, but
`DiagnosticsTab.tsx:22-59` reads `flightRecorder.getStats()` and triggers
`flightRecorder.snapshot('manual')` on the **main-thread** instance → live stats show an
empty buffer and manual snapshots capture nothing. Only worker-side *automatic* anomaly
snapshots land in IDB (workers can use IDB) and appear in `listSnapshots()`. The
`window.__ttsFlightRecorder` debug hook (242-245) never registers in the worker.

**Impact:** the subsystem's primary debugging tool silently doesn't work in the production
topology — precisely where the hard bugs live.

**Fix:** add a `snapshot`/`exportBuffer` method to `WorkerTtsEngine` and route the
diagnostics UI through the engine handle; or forward flight events as host commands with
sampling. Keep IDB snapshot storage shared.

### D8. No cancellation in the sequencing model; staleness handled by scattered guards — MEDIUM→HIGH / architecture
**Evidence:** `TaskSequencer.ts` is a bare serial chain (19-41) with a one-way `destroy()`.
Long tasks (e.g. `loadSectionInternal` → content pipeline → GenAI analysis triggers) block
subsequent `pause`/`stop` behind them. Staleness is re-checked ad hoc:
`this.currentBookId !== originalBookId` (564, 573), `currentBookId !== initialBookId`
(728, 757, 776), section-index guards in async callbacks (1146-1154, 434-443), analysis
re-validation (1065-1067). The WebKit IDB-hang workaround (818-824, 851-853, 1167-1169)
detaches persistence writes specifically because one hung await wedges the entire engine —
a symptom of the missing timeout/cancellation layer.

**Impact:** sluggish controls during slow synthesis; every new async feature must remember
to hand-roll guards; missed guards become the next `AudioPlayerService_*` regression file.

**Fix:** epoch-based cancellation: the sequencer issues a `TaskContext { signal, epoch }`;
`stop`/`setBookId`/`loadSection` bump the epoch, aborting the signal of in-flight tasks;
helpers (`ctx.checkStale()`) replace the hand-rolled book/section comparisons. Add a
per-task watchdog timeout that records to the flight recorder.

### D9. Dead code and dead features on the hot path — MEDIUM / dead-code
**Evidence:**
- `SyncEngine` runs on every `timeupdate` tick (AudioPlayerService.ts:154-157,
  `loadAlignment` at 161-165) but its only output is a no-op:
  `setOnHighlight(() => { /* No action currently */ })` (172-174). The karaoke/highlight
  feature it exists for is unimplemented; `onBoundary` is likewise empty (158-160).
- `checkBatteryOptimization()` (1113-1125): zero callers anywhere.
- `resume()` (803-805): public, zero external callers.
- `useTTSStore.syncState` (useTTSStore.ts:447-454): called only by its own test.
- PSM: dead validation stub (92-95), duplicated doc comment (431-438).
- `setBackgroundAudioMode(mode: any)` (496-498) — `any` on a public engine method.

**Impact:** wasted hot-path work crossing the worker boundary (alignment arrays shipped
worker-ward per utterance, then discarded); misleading surface area for maintainers.

**Fix:** delete `SyncEngine` + `onMeta`/`onBoundary` plumbing (or actually implement the
highlight feature against the snapshot channel); delete the other dead members; type the
background-audio mode.

### D10. Position/seek heuristics are fiction; seek-past-end rewinds to the start — MEDIUM / correctness
**Evidence:** `calculateCharsPerSecond()` returns a constant 15, ignoring `this.speed`
(PlaybackStateManager.ts:397-401); `getCurrentPosition`/`getTotalDuration` build on it.
`seekToTime` (341-365): when `targetChars` exceeds the final prefix sum the scan never
matches, `newIndex` stays `0`, so a lock-screen scrub past the end of the section jumps to
the **first** sentence. `updateSectionMediaPosition` fires `setPositionState` on every
provider `timeupdate` (AudioPlayerService.ts:154-157, 366-377) with no deadband —
`PlatformIntegration` deadbands metadata (145-174) but not position — meaning native-bridge
chatter on Capacitor at timeupdate frequency.

**Fix:** clamp `seekToTime` to the last visible index; incorporate `speed` into the
chars/sec estimate; throttle position-state pushes (e.g. 1 Hz or 2% movement).

### D11. `TTSProviderManager` fallback: duplicated logic, store divergence, listener accumulation — MEDIUM / architecture + correctness
**Evidence:**
- Cloud→local fallback implemented twice with different shapes: event-listener path
  (TTSProviderManager.ts:86-93) and `play()` catch path (145-163).
- `switchToLocalProvider` (114-125) silently replaces the provider; `useTTSStore.providerId`
  still claims the cloud provider → settings UI and engine state diverge until the next
  `loadVoices`.
- `ITTSProvider.on(callback)` (providers/types.ts:102) has no `off`; `setProvider`
  (211-215) registers on the new provider but old providers keep their listener — a stopped
  provider that later emits (e.g. a stray `onend`) still drives engine events.
- Voice download methods type-switch on `provider.id === 'piper'` with `as any` casts
  (235-263) instead of an optional capability interface.

**Fix:** single fallback routine, surfaced as an engine-visible event so the store/UI can
reflect the actual provider; capability interface (`VoiceDownloadCapable`) instead of id
checks; listener disposal on provider swap.

### D12. Test sprawl: 15 overlapping AudioPlayerService suites with copy-pasted mock scaffolds — MEDIUM / testing
**Evidence:** root-level `AudioPlayerService*.test.ts` ×12 (`.test`, `.predictability`,
`_AnalysisUpdate`, `_Concurrency`, `_Critical`, `_LanguageSync`, `_MediaSession`,
`_Predictability_Fix`, `_ReactiveSubscription`, `_RestoreAnalysis`, `_Resume`,
`_StateProtection`) + `engine/AudioPlayerService.isolated.test.ts` + 2 parity suites. The
`vi.mock` blocks for `DBService`/`LexiconService`/`TTSCache`/`useTTSStore` are duplicated
nearly verbatim across files (e.g. `AudioPlayerService_Critical.test.ts:7-50` ≈
`AudioPlayerService_Concurrency.test.ts:7-50`). Many assert privates
(`service['status']`, `service['stateManager']` — `_Concurrency:111-112`, `_Critical:103`).
Two files exist for the same bug ("predictability" and "Predictability_Fix"). Meanwhile the
clean fake-based path (`FakeEngineContext`/`FakePlaybackBackend`) exists but legacy suites
weren't migrated.

**Impact:** slow suites, brittle module-mocks that pin implementation details (the
`dbService` mock shape must be re-stated in every file), and a false sense of coverage —
none of these run against the production (worker) topology.

**Fix:** consolidate into behavior-grouped suites built on the fakes (playback FSM,
restore, masks/adaptations, navigation, media session), promote durable behaviors into
`engineParityScenarios`, delete the per-bug files once covered.

### D13. `BackgroundAudio` dual staggered looping elements — undocumented, doubles noise amplitude — MEDIUM / correctness (hygiene)
**Evidence:** `BackgroundAudio.ts:53-65` — `audio1` plays immediately, `audio2` starts the
**same looping src** 5 s later; both loop forever. No comment explains the second element
(presumably masking loop-boundary gaps that let Android kill the WebView's audio focus).
In `noise` mode both are audible simultaneously → doubled amplitude with phasing; the
perceptual volume curve (14-16, pow 3) is then applied to both.

**Fix:** document the keep-alive rationale; if gap-masking is the goal, use a single
`AudioContext` source with seamless looping, or stagger only for `silence`.

### D14. Boundary type leaks — `TTSQueueItem` in the DB layer; snapshot types that lie — MEDIUM / type-safety
**Evidence:**
- `src/types/db.ts:11` and `src/db/DBService.ts:18` import `TTSQueueItem` from
  `AudioPlayerService.ts` — the persisted DB schema depends on the engine module (and on a
  file whose main export is a 1242-line class).
- `TTSSettingsSnapshot = ReturnType<typeof useTTSStore.getState>`
  (EngineContext.ts:42-45) includes ~30 action **functions**. On the worker path `plain()`
  strips them at runtime (replicationSpec.ts:28-30), so `ctx.config.getSettings()` returns
  an object whose static type includes methods that do not exist — code calling them
  compiles and crashes only in the worker.

**Fix:** move `TTSQueueItem`/`TTSStatus` to `src/types/tts.ts`; define an explicit
`TTSSettingsData` (data-only) interface as the replication payload and have the store
satisfy it (`satisfies`), severing the engine-boundary types from store implementation.

### D15. Documentation drift — LOW / hygiene
**Evidence:** `engine/README.md` documents `AudioPlayerService.getInstance()` as the
production composition root (the method no longer exists; grep confirms) and describes an
in-process fallback ("falls back to the in-process engine" in PORTING-TO-WORKER.md) whereas
`WorkerEngineHandle` actually degrades to a **no-op stub** (WorkerEngineHandle.ts:44-54).
`src/lib/tts/README.md` references `AudioPlayerService_SmartResume.test.ts` (deleted) and
describes `AudioPlayerService` as managing "buffering/pre-fetching, error recovery" without
mentioning the worker topology at all.

**Fix:** regenerate both READMEs from the post-refactor reality; delete
`PORTING-TO-WORKER.md`'s "one remaining step" framing (the step shipped).

## Problematic couplings

1. **DB layer → engine module**: `src/types/db.ts:11`, `src/db/DBService.ts:18` import
   `TTSQueueItem` from `AudioPlayerService.ts` (persisted schema depends on the god file).
2. **Engine boundary types → store implementations**: `EngineContext.ts:26-60` derives
   payload types from `typeof useTTSStore/useGenAIStore/...` getState — including action
   functions that don't survive replication (see D14).
3. **UI → engine internals**: `ReaderView.tsx` calls `getAudioPlayer()` at 5 sites,
   including the `clearPauseGesture()` dragnet hack (ReaderView.tsx:1297, useTTS.ts:31-33)
   — the reader must know about the engine's gesture-detection internals to avoid spurious
   bookmarks.
4. **Two parallel host wirings**: `createZustandEngineContext.ts` and
   `createWorkerEngineClient.ts` (`applyHostCommand` + `EngineHost`) duplicate the
   store/repository wiring (LexiconService, bookRepository, contentAnalysisRepository,
   genAIService); a write added to one and not the other drifts silently (the
   hostCommands test mitigates but doesn't eliminate this).
5. **Engine → dbService direct** (`AudioPlayerService.ts:4`, `PlaybackStateManager.ts:2`):
   deliberate (worker-safe) but unported — persistence policy is baked into the
   orchestrator instead of a `SessionPersistencePort`, making the WebKit-hang workaround
   APS's problem.
6. **DiagnosticsTab → main-thread flightRecorder singleton** while recording happens in
   the worker instance (D7).
7. **useTTSStore ↔ engine bidirectional**: the store proxies commands to the engine AND
   mirrors engine state AND is replicated back into the engine as "settings" (D5).

## What's good (keep)

- **The three-port boundary** (`EngineContext` / `PlaybackBackend` / `AudioSink`) with its
  explicit worker-safety rationale and per-port docs (EngineContext.ts header) — this is
  genuinely well-designed and well-documented; the refactor should build on it, not replace it.
- **`replicationSpec.ts`**: declarative slice table, compile-time exhaustiveness via the
  `Record<kind, builder>`, boot-readiness gate, and `WorkerEngineContext`'s
  throw-on-unreplicated reads ("loud failure beats silent default") — plus
  `replication.test.ts` pinning both sides. Exemplary.
- **Handwritten fakes** (`FakeEngineContext`, `FakePlaybackBackend`, `FakeAudioSink`)
  enabling mock-free engine tests (`AudioPlayerService.isolated.test.ts`).
- **Shared parity scenarios run on both transports** — the right idea; needs expansion, not
  removal.
- **`WorkerEngineHandle` boot-queue + `whenReady` + `engineReady` gating** in the store.
- **`TaskSequencer` as a concept** (serialize all engine mutations) — sound; needs
  cancellation, not deletion.
- **Flight recorder design** (ring buffer, anomaly auto-snapshot with pre-freeze diagnostics
  callback, IDB snapshot retention) — fix its topology (D7), keep the tool.
- **`PlatformIntegration` metadata deadband** (5% progress threshold) for Bluetooth
  head-unit flicker; the perceptual-palette conic progress overlay in
  `MediaSessionManager` is a polished, working feature.
- **WebKit IDB-hang detachment** (pause/stop persistence) — the workaround is correct given
  the constraint; preserve the behavior when persistence moves behind a port.

## Target design

**One topology.** The worker engine is the only production path already — drop the
pretense of a runtime-selectable engine. `TtsEngine` becomes a standalone interface
(commands are acks; results flow through the snapshot stream), implemented by
`WorkerEngineHandle` (production) and the in-process service (tests).

**Decomposed core.** Inside the worker:
- `PlaybackController` — the FSM + `TaskSequencer` (now with epoch/AbortSignal
  cancellation and per-task watchdog). The *only* component allowed to change status.
- `QueueModel` (今 PlaybackStateManager) — immutable snapshots, no persistence calls.
- `SessionStore` (port) — wraps dbService TTS state + Yjs position writes; owns the
  WebKit-detach policy.
- `AnalysisApplier` — subscribes to analysis/genAI replication, computes masks/adaptations,
  submits them as sequenced commands.
- `MediaMetadataPublisher` — single metadata/position builder with deadbands, fed by
  snapshots.
- `DragnetGesture` — pause→play detection as a sequenced command, with the
  section-navigation invalidation handled inside the engine (kills the
  `clearPauseGesture()` UI coupling).

**One snapshot channel.** A monotonic, immutable `PlaybackSnapshot` is the only outbound
state; errors and download progress are fields, not parallel callbacks. The handle mirrors
it into a dedicated `useTTSPlaybackStore`.

**Replication diet.** `useTTSSettingsStore` (persisted user settings, replicated as an
explicit `TTSSettingsData` payload) split from playback state (never replicated). Keep the
replicationSpec machinery exactly as designed — fewer, data-only slices.

**Contract tests as the spine.** `engineParityScenarios` grows to cover restore, masks,
adaptations, navigation, dragnet, provider fallback; the per-bug
`AudioPlayerService_*.test.ts` files are absorbed and deleted. Fakes remain the test
substrate; module-level `vi.mock` is banned inside the engine directory.

**Provider runtime.** `TTSProviderManager` keeps the `PlaybackBackend` role but: one
fallback path emitting a `providerChanged` engine event (store reflects reality),
capability interfaces for voice download, listener disposal on swap.

**Diagnostics.** Flight recorder gets a worker-side export surface on `WorkerTtsEngine`;
DiagnosticsTab talks to the engine handle, never the singleton.

## Migration notes

No user-data migrations are required: `cache_session_state` (TTS queue), Yjs progress
fields, and `tts-storage` (persisted Zustand) shapes are unchanged. Sequence the work to
keep the app shippable at every step:

1. **Stop the bleeding (small, independent):** enqueue the fallback `playInternal` (D1);
   make `applySkippedMask` copy-on-write (D2); clamp `seekToTime` (D10); delete dead code
   (D9) and fix docs (D15). Each is a one-file change with an accompanying parity/PSM test.
2. **Types first:** move `TTSQueueItem`/`TTSStatus` to `src/types/tts.ts` (re-export from
   the old path temporarily); introduce `TTSSettingsData` and switch `EngineContext` +
   replicationSpec to it (D14). Pure-type change, zero runtime risk.
3. **Snapshot channel:** introduce `PlaybackSnapshot` alongside the positional listener;
   migrate `useTTSStore`/handle to it; delete the positional `PlaybackListener` once
   ReaderView/queue UI read from the store only.
4. **Store split (D5):** create `useTTSPlaybackStore`; `useTTSStore` keeps settings +
   persistence (`tts-storage` key and version untouched). Update replicationSpec to push
   the settings subset. Verify with the existing replication tests + a new "no echo" test
   (engine broadcast must not trigger a settings push).
5. **Sequencer cancellation (D8):** add epochs/AbortSignal behind the existing `enqueue`
   API; convert the hand-rolled staleness guards incrementally (each conversion covered by
   the regression behavior it replaced, now expressed as a parity scenario).
6. **Decompose APS (D3/D4):** extract in dependency order — MediaMetadataPublisher →
   SessionRestoreService → AnalysisApplier → DragnetGesture — keeping APS as the façade so
   `WorkerTtsEngine` and tests are untouched until the end. Migrate/absorb the regression
   test files as each behavior moves (D12).
7. **Provider runtime cleanup (D11)** and **flight-recorder rerouting (D7)** — independent
   of the decomposition; D7 needs a small `WorkerTtsEngine` API addition and a
   DiagnosticsTab change.
8. **On-device QA gate:** lock-screen controls, background keep-alive, provider fallback,
   and dragnet capture cannot be exercised headlessly (per PORTING-TO-WORKER.md's caveat);
   require an Android + iOS-Safari manual pass before and after steps 3-6.
