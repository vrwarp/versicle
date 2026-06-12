# Phase 5 prep — TTS strangler (5a providers / 5b engine / 5c content)

| | |
|---|---|
| **HEAD at reading time** | `fb3dcd3f09e5fb749abb42cf3359d11014cde590` |
| **Date** | 2026-06-10 |
| **Author** | Phase 5 design-prep agent (read-only pass) |
| **Inputs** | `plan/overhaul/README.md`, `proposals/strangler-incremental.md` §Phase 5, `proposals/contract-first.md` rows C4/C5 (+ Themes C/5), `analysis/tts-engine.md`, `analysis/tts-providers.md`, `analysis/tts-content.md`, `prep/phase1-deletions.md` §1.18, current source |
| **Tree-motion caveat** | A Phase 2 implementation chain is committing to this branch *while this was written* (migration coordinator, `src/app/migrations.ts`, `src/store/syncedStores.ts` in flight). Phase 2 will further touch `src/store/**` (registry, synced-store declarations) and `packages/` (currently only `packages/zustand-middleware-yjs`). **Every file:line below is pinned to the HEAD SHA above — re-verify line numbers against the tree at Phase 5 start; file paths are expected to be stable except `src/store/useTTSStore.ts` (P2 may wrap it in the store registry, not move it).** |

Phase 5 lands replacement code at its modular-monolith address (`src/domains/audio/`),
per the geography migration rule (README §2). Legacy stays at `src/lib/tts/` until the
sub-phase that deletes it.

---

## Reality check

The three analyses were written against the pre-P0 tree (analysis date 2026-06-09 but the
working tree predated the hotfix wave). Since then: 11 Phase 0 hotfix PRs, Phase 1 motion
(type split, host adapters to `src/app/tts/`, path aliases, dead-code deletion, boot
sequencer), and the `2e975a3f` TTS dead-plumbing deletion. Every claim below was re-verified
against HEAD.

### Already fixed at HEAD (do NOT redo; verify the pins exist)

| # | Analysis claim | HEAD reality | Evidence |
|---|---|---|---|
| R1 | tts-providers **D1 (critical)**: speed applied twice / wiped / cache-key fragmentation | **FIXED** (P0, commit `7b96b27d`). Synthesis always at 1.0; rate applied at sink *after* `playBlob` | `BaseCloudProvider.ts:42-62` (comment + ordering), `AudioElementPlayer.ts:128-138` (`defaultPlaybackRate` + `playbackRate` pinned), cloud bodies carry no rate (`GoogleTTSProvider.ts:84-85`, `OpenAIProvider.ts:55-56`, `LemonFoxProvider.ts:77-78`), cache key speed-independent (`BaseCloudProvider.ts:73-75`, `TTSCache.ts:24`) |
| R2 | tts-engine "alignmentData vs alignment drift"; dead `lexiconHash` cache param | **FIXED** (`7b96b27d`): one canonical `alignment` field; `TTSCache.generateKey(text, voiceId, pitch=1.0)` — `lexiconHash` param gone. Residual: vestigial `pitch` param (always defaulted) | `TTSCache.ts:24,51-52`; `providers/types.ts:33` |
| R3 | tts-engine **D9**: `SyncEngine` no-op on hot path, `onMeta`/`onBoundary` per-word Comlink noise; tts-providers/content: `CostEstimator`/`useCostStore` dead machinery | **DELETED** (commit `2e975a3f`). `providerEvents` is now 5 callbacks (`AudioPlayerService.ts:120-149`); no SyncEngine/CostEstimator anywhere in `src/` | grep clean; `useTTSStore.syncState` also gone |
| R4 | tts-content **D2**: `preprocessTableRoots` escaped-template-literal bug | **DELETED** (commit `0b6c1545`); TAP uses `cfi-utils` `preprocessBlockRoots`/`getParentCfi` | `cfi-utils.ts:29,98`; no `preprocessTableRoots` in `TableAdaptationProcessor.ts` |
| R5 | tts-content **D1**: NFKD-after-offsets corrupts CFIs | **FIXED FORWARD** (commit `4197dcab`): raw-text segmentation; `TTS_EXTRACTION_VERSION = 2` stamped on new `cache_tts_preparation` rows | `sentence-extraction.ts:25-35`. **Data half is NOT done**: implicit-v1 rows persist; background re-ingestion driver is Phase 7 scope. 5c must preserve the version stamp and the old-rows-retained rule |
| R6 | tts-content **D7**: `src/lib/tts.ts` name-collision grab-bag | **RENAMED** (commit `929b1884`) to `src/lib/tts/sentence-extraction.ts`; `SentenceNode` consumers now import `'./sentence-extraction'` (`TextSegmenter.ts:2`, `AudioContentPipeline.ts:11`, `TableAdaptationProcessor.ts:4`, `offscreen-renderer.ts:3`). The *relocation to `lib/ingestion/`* and raw-at-rest persistence remain 5c work |
| R7 | tts-engine **D14** (first half): `types/db.ts`/`DBService` import `TTSQueueItem` *from* the engine | **ARROW REVERSED** (commit `b1cc815d`): canonical home `src/types/tts.ts`; APS re-exports type-only (`AudioPlayerService.ts:24-31`); `Timepoint` likewise (`providers/types.ts:1-9`) |
| R8 | Engine host adapters live in `src/lib/tts/engine/` | **MOVED** (commit `7556f342`): `createZustandEngineContext.ts`, `createWorkerEngineClient.ts`, `replicationSpec.ts`, `mainThreadAudioPlayer.ts` now in **`src/app/tts/`**. All analysis paths for these four are stale |
| R9 | `useTTSStore` wires its engine subscription at module scope | **Partially restructured** (P1 boot work): subscription moved into an explicit `initialize()` action (`useTTSStore.ts:227-252`) invoked from the boot task (`src/app/boot/deviceRegistration.ts:23`). `onRehydrateStorage` **still** performs engine + LexiconService side effects during `create()` (`useTTSStore.ts:491-510`) — that part of the debt is alive |
| R10 | `AudioPlayerService.getInstance()` / runtime engine selection docs | Composition is `getAudioPlayer() → new WorkerEngineHandle()` singleton, worker-only production path with jsdom no-op degrade (`src/app/tts/mainThreadAudioPlayer.ts:29-34`, `WorkerEngineHandle.ts:43-53`) |

### Still true at HEAD (the Phase 5 backlog, with refreshed line numbers)

| # | Debt | HEAD evidence |
|---|---|---|
| S1 | Fallback bypasses the sequencer (engine D1) | `AudioPlayerService.ts:132-137` — `onError` `type:'fallback'` calls `this.playInternal(true)` directly. Language-sync subscription also calls it un-enqueued (`:189-191`) |
| S2 | Fallback double-fires in the backend (providers D2) | `TTSProviderManager.ts:76-82` (event path) **and** `:123-141` (play-catch path) both emit `{type:'fallback'}` + `switchToLocalProvider()`; `BaseCloudProvider.play` still emits error *and* rethrows (`BaseCloudProvider.ts:58-61`) |
| S3 | Dragnet capture runs outside the sequencer (engine D1) | `AudioPlayerService.ts:635-646` (`play()` awaits `executeDragnetCapture()` *before* `enqueue`); capture body `:648-691`; UI coupling `clearPauseGesture()` alive (`ReaderView.tsx:1291`, `useTTS.ts:31-33`, APS `:812-817`) |
| S4 | `applySkippedMask` mutates in place; masks never persisted; transport-divergent identity (engine D2) | `PlaybackStateManager.ts:100-114` in-place vs clone in `applyTableAdaptations` (`:139`); `persistQueue` reference-dedupe defeats it (`:443`); restore-time stale-flag cleanup workaround (`AudioPlayerService.ts:369-394`) |
| S5 | Dual+ notification paths, no `PlaybackSnapshot` (engine D4) | PSM subscription notify (`AudioPlayerService.ts:153-164`), `setStatus` notify (`:968-997`), `notifyError` (`:1081-1083`), `notifyDownloadProgress` (`:1085-1087`); positional 6-arg `PlaybackListener` (`:39`); "treat loading as playing" workaround now in `useTTSStore.initialize()` (`useTTSStore.ts:236-239`) |
| S6 | Replication echo loop (engine D5) | `replicationSpec.ts:55-61` — settings slice pushes `plain(useTTSStore.getState())` (full store incl. queue mirror) on **every** store change; `genAI` slice on every `addGenAILog` host command (`:78-84` + `createWorkerEngineClient.ts:68`); engine broadcast → `initialize()` `set` → settings push → worker echo. One mitigation landed: the store spreads `downloadInfo` conditionally (`useTTSStore.ts:244-249`), so error broadcasts no longer clobber download state *in the store* — the channel itself is still positional and lossy |
| S7 | No cancellation; staleness via scattered guards (engine D8) | `TaskSequencer.ts` (49 lines, bare chain, one-way `destroy()`); hand-rolled guards at `AudioPlayerService.ts:540,549,704,733,752,1041-1043,1050,1060,1122,1127` |
| S8 | `TtsEngine = Pick<AudioPlayerService,…>`; promise-semantics divergence; swallowed handle errors (engine D6) | `AudioPlayerService.ts:46-55`; `WorkerEngineHandle.ts:80-83` (`run()` logs only), fire-and-forget `Promise.resolve()` returns (`:96-113`); `setQueue`/`getQueue` exist on `WorkerTtsEngine` (`:201-202`) but not on the app contract |
| S9 | Flight recorder split-brained (engine D7) | `TTSFlightRecorder.ts` module singleton; `DiagnosticsTab.tsx:2,22-41` reads the main-thread instance; `WorkerTtsEngine` has **no** snapshot/export surface (grep) |
| S10 | God store with dual voice-settings representation (providers D4); per-keystroke provider rebuild (D5) | `useTTSStore.ts` (513 lines): flat `rate/pitch/voice` + `profiles` dual representation (`:36-40,163-165`), three inline profile-default literals (`:275,287,303,341`), two divergent voice-fallback algorithms (`setActiveLanguage :167-217` vs `loadVoices :369-412`), `setApiKey → setProviderId → loadVoices → stopInternal` per keystroke (`:312-322`); engine mirror + settings in one persisted store (`partialize :472-490`, `tts-storage` **v3**, migrations `:446-469`) |
| S11 | No provider registry; six hand-maintained sites (providers D3) | union re-declared `useTTSStore.ts:59,100-101`; construction switch `providerFactory.ts:21-31` (still reads `useTTSStore.getState()` — the D14 cycle edge); `TTSSettingsTab.tsx` re-declared aliases + hardcoded items; fallback keyed on magic `'local'` (`TTSProviderManager.ts:77,131`); both device providers claim `id = 'local'` (`WebSpeechProvider.ts:8`, `CapacitorTTSProvider.ts:8`) |
| S12 | Stale-provider listener leaks, no dispose, `as any` piper (providers D8/D9) | `TTSProviderManager.ts:189-193` (no detach), `:213-242` (`as any` + `isVoiceDownloaded` returns `true` for non-piper); `ITTSProvider.on` has no `off`, dead `resume`/`isNative`/`volume` members (`providers/types.ts`) |
| S13 | Piper not offline; module-global runtime; postinstall string-patching (providers D6/D7/D13) | `piper-utils.ts:1-6` module globals (`blobs`, `worker`, `pendingPromise`); ONNX from cdnjs (`:281`); HF `voices.json` fetched every `init()` (`PiperProvider.ts:85-87`), en_US/zh_CN filter (`:92-94`); postinstall `prepare-piper` + `scripts/patch_piper_worker.js` (287 lines, warn-and-continue at `:61,133,174,277`) **vetoed for deletion by the P1 audit** (`prep/phase1-deletions.md:112-117,203`) — blocked on this phase's vendoring |
| S14 | Pipeline god class; UI-store write; citation markers path-dependent (content D3/D4) | `AudioContentPipeline.ts` still 891 lines; `ctx.readerUI.setCurrentSection` at `:104`; `detectContentSkipMask` fetches markers only when sentences are absent (`:365-374`) while `loadSection → triggerAnalysis` always passes sentences (`:216`); prewarm path passes markers (`:331`) |
| S15 | Lexicon cache never populated for books; 403 rules rebuilt per call; mid-playback edits ignored (content D5) | `LexiconService.ts:114` (book path returns before the `:141-146` cache write); Bible rules re-mapped per miss (`:94-108` and duplicated `:125-137`); `activeLexiconRules` invalidated only on stop/pause/book/lang (`AudioPlayerService.ts:186,273,316,987`) |
| S16 | Bible lexicon three-sources-of-truth, 2899-line static import (content D6) | `src/data/bible-lexicon.ts` (2,899 lines) statically imported by `LexiconService.ts:3` + `AudioContentPipeline.ts:12`; imperative push `useTTSStore.ts:359,508`; duplicate preference computation `AudioContentPipeline.ts:128-129` vs `LexiconService.ts:91` |
| S17 | Divergent CFI separator sets (content D9) — now 2 copies, not 3 | `AudioContentPipeline.ts:856,859` use `['/', '!', ':']` (missing `[`, `,`); `cfi-utils.ts:98-129` `getParentCfi` owns the canonical set; TAP retains its own wrapper-strip + prefix check (`TableAdaptationProcessor.ts:186-223`) |
| S18 | mockGenAI prod seam + stale model fallback (content D8) | `AudioContentPipeline.ts:473,506`, `TableAdaptationProcessor.ts:77,82` (also on the P1 veto list — alive by design until P5c/P7) |
| S19 | Seek heuristics fiction; seek-past-end rewinds (engine D10) | `PlaybackStateManager.ts:341-365` (`newIndex` stays 0), `:397-401` (constant 15 chars/s ignoring speed); position pushed per `timeupdate` with no deadband (`AudioPlayerService.ts:342-353`) |
| S20 | Test sprawl (engine D12) | 12 root per-bug/per-area `AudioPlayerService*.test.ts` + `engine/AudioPlayerService.isolated.test.ts` + 2 parity suites = 15 APS suites; copy-pasted `vi.mock` scaffolds |

### New facts the analyses don't reflect (drift created by P0/P1)

| # | Fact | Implication for Phase 5 |
|---|---|---|
| N1 | **`WorkerEngineHandle` (in `src/lib/tts/engine/`) imports `@app/tts/createWorkerEngineClient`** (`WorkerEngineHandle.ts:24`) — an inverted lib→app runtime edge created when P1 moved the client to `app/` but left the handle in `lib/` | 5b must finish the motion: `WorkerEngineHandle` (and the `TtsEngine` interface it implements) move to their final addresses (`src/domains/audio/engine/` + interface in `src/domains/audio/index.ts` surface); the depcruise "lib must not import app" exception dies with it |
| N2 | The parity suite at HEAD has **11 scenarios** (`engineParityScenarios.ts:70-195`): play-synthesizes, start→playing, end→advance, last-item→completed, pause, stop, jumpTo, error-stops+surfaces, getVoices round-trip, voice+speed shaping, providerId routing. The worker side runs over **real Comlink + MessageChannel** (`engineParity.worker.test.ts:34-39`) — exactly the production wiring | The entry gate *extends* this file; it does not need new infrastructure |
| N3 | **`vi.mock` is already used inside `src/lib/tts/engine/`**: both parity tests mock `LexiconService` + `@db/DBService` (and inprocess also `PlatformIntegration`) because APS imports `dbService` directly (`AudioPlayerService.ts:4`) | The "ban `vi.mock` in the engine dir" gate cannot be absolute on day one. Design: entry gate freezes the allowlist at exactly `{@db/DBService, ../LexiconService, ../PlatformIntegration}`; the ban flips to zero-allowlist when 5b's `SessionStore`/lexicon ports land |
| N4 | `useTTSStore.initialize()` exists and is boot-registered (R9). The strangler text "complete `useAudioCommands` facade" is aspirational — **no `useAudioCommands` exists anywhere at HEAD** (grep) | 5b creates it fresh; nothing to "complete" |
| N5 | `enableCostWarning` is still a persisted setting with zero readers (`useTTSStore.ts:76,155,347-349,484`) after CostEstimator's deletion; `checkBatteryOptimization` (`AudioPlayerService.ts:1089-1101`) and `resume()` (`:779-781`) are public but outside the `TtsEngine` Pick and have no external callers | All three are 5b deletions; `enableCostWarning` is dropped (not migrated) in the settings-store split |
| N6 | The licensing inventory (`third-party/inventory.json`) already carries the piper provenance debt: espeak-ng GPL-3 embedded in `piper_phonemize.wasm/.data` with **UNKNOWN upstream commits**, "long-term fix is rebuilding the WASM from pinned commits in CI" | 5a's vendoring PR must update these entries (path changes from gitignored `public/piper/` to checked-in vendor dir) and add `PROVENANCE.md`; the license CI gate (P0) will fail the PR if inventory and tree disagree |
| N7 | Strangler doc says the flight-recorder ring-buffer core is "extracted to `kernel/`" in 5b. At HEAD there is no `src/kernel/`; P2-P4 will not create the TTS slice of it | 5b extracts the generic ring-buffer/anomaly core to `src/kernel/diagnostics/` (new dir, kernel admission rule satisfied: zero internal deps; ≥2 consumers arrive in P6/P7) — but keeps the TTS-named wrapper in the audio domain |
| N8 | `AudioContentPipeline.loadSection` already takes `onMaskFound`/`onAdaptations` callbacks and returns the queue (`AudioPlayerService.ts:1114-1131`) — the analysis's "two different invocation paths" is now three call sites with consistent shape (loadSection, restoreQueue `:405-419`, reactive update `:1039-1070`) | The 5b `AnalysisApplier` absorbs all three call sites; the design below names them |

---

## Design

### 0. Entry gate — the expanded `engineParityScenarios` suite (lands before ANY engine internals change)

Constitution rule 7 (characterization before change) + the C4 pinning row. The gate is one
PR that only adds tests + the minimal *test-visible* seams they need, plus the absorption
ledger document. **Green on both transports (in-process fakes; worker over real
Comlink/MessageChannel) is the precondition for every 5a/5b/5c PR that follows.**

#### 0.1 Harness extensions (additive to `ParityHarness`, `engineParityScenarios.ts:23-49`)

```ts
export interface ParityHarness {
    engine: {
        // existing …
        setBookId(bookId: string | null): Promise<void> | void;     // worker: client.setBook()
        loadSection(i: number, autoPlay?: boolean): Promise<void> | void;
        skipToNextSection(): Promise<boolean>;
        skipToPreviousSection(): Promise<boolean>;
        clearPauseGesture(): void;
    };
    backend: {
        // existing …
        /** Next play() rejects once with this error (drives the fallback scenario). */
        failNextPlay(error: { message: string }): void;
        /** Provider id the backend reports after a fallback swap. */
        activeProviderId(): string;
        earcons(): string[];                                        // playEarcon capture
    };
    /** Host-state seams (fakes in-process; replicated updates on the worker). */
    host: {
        seedTTSState(bookId: string, queue: TTSQueueItem[]): void;  // dbService.getTTSState source
        seedProgress(bookId: string, queueIndex: number, sectionIndex: number): void;
        seedSections(bookId: string, sections: SectionMetadata[]): void;
        seedTTSContent(bookId: string, sectionId: string, sentences: SentenceNode[]): void;
        pushAnalysisSuccess(bookId: string, sectionId: string, analysis: Partial<SectionAnalysis>): Promise<void>;
        annotations(): AnnotationInput[];                            // dragnet capture sink
    };
    /** Queue references per broadcast, for identity assertions. */
    queueRefs(): ReadonlyArray<ReadonlyArray<TTSQueueItem>>;
    advanceTime(ms: number): void;                                   // vi.useFakeTimers control
}
```

In-process: `host.*` writes into `FakeEngineContext` + the (allowlisted) `dbService` mock.
Worker: `host.*` sends `applyStateUpdate`/host-command traffic through the same
MessageChannel the production client uses — `pushAnalysisSuccess` is
`remote.applyStateUpdate({kind:'analysis', …})`, exactly what `replicationSpec.ts:86-95`
emits. Queue identity on the worker transport is asserted on the *structured-clone output*
(every broadcast is a fresh clone — the scenario asserts content-level change markers
instead of reference equality there; see scenario P14 note).

#### 0.2 Scenario list (existing 11 kept verbatim; 12 added)

| ID | Scenario | What it pins (current behavior, not desired) | Source absorbed |
|---|---|---|---|
| P1–P11 | the 11 at HEAD (`engineParityScenarios.ts:70-195`) | play routing, status transitions, advance, completion, pause/stop, jumpTo, error surfacing, voices, voice/speed shaping, providerId | — |
| **P12 restore** | `setBookId` with seeded sections + persisted TTS state + progress ⇒ queue restored at saved index/section; **stale `isSkipped` flags cleared** (`AudioPlayerService.ts:369-394`); analysis re-trigger fires | `AudioPlayerService_RestoreAnalysis.test.ts`; restore parts of `AudioPlayerService.test.ts` |
| **P13 restore-resume** | restored book with `lastPlayedCfi` + `lastPauseTime` ⇒ first `play()` resumes at the saved CFI index (`playInternal` restore branch `:700-716`) | `AudioPlayerService_Resume.test.ts` (paused-speed-change case → P22) |
| **P14 skip mask** | `pushAnalysisSuccess` + genAI-enabled settings ⇒ mask applied; **skipped items excluded from advance**; a broadcast occurs. *Identity rider:* in-process asserts the post-mask queue is a **fresh array** — written `it.fails` until 5b-PR2 lands copy-on-write (the in-place mutation at `PlaybackStateManager.ts:100-114` is the bug being strangled); worker side asserts re-broadcast happened | `PlaybackStateManager_Masking.test.ts`, `AudioPlayerService_ReactiveSubscription.test.ts` (mask cases) |
| **P15 table adaptations** | adaptation set ⇒ anchor item text replaced, siblings skipped (`PlaybackStateManager.ts:135-196`); clearing genAI settings clears adaptations (`AudioPlayerService.ts:1058-1068`) | `PlaybackStateManager_Adaptation.test.ts`, `_ReactiveSubscription` (adaptation cases) |
| **P16 analysis dedup** | rapid duplicate analysis pushes enqueue **one** reapplication task (timestamp guard `AudioPlayerService.ts:1033-1037`) | `AudioPlayerService_AnalysisUpdate.test.ts` |
| **P17 section navigation** | `skipToNextSection`/`skipToPreviousSection` traverse seeded sections, skip empty ones, return false at the ends (`:574-587,1167-1202`); `loadSection(i, autoPlay=false)` does not start playback | navigation cases of `AudioPlayerService.test.ts`; `AudioPlayerService.predictability.test.ts` loadSection-race case |
| **P18 book-switch staleness** | `loadSectionBySectionId` enqueued for book A is a no-op after `setBookId(B)` lands first (guards `:540,549`) | `AudioPlayerService_Predictability_Fix.test.ts`, `AudioPlayerService.predictability.test.ts` |
| **P19 dragnet capture** | pause → `play()` within 5 s ⇒ one annotation with merged CFI + `bookmark_captured` earcon (`:635-691`); pause → >5 s (fake timers) ⇒ no capture | `AudioPlayerService.isolated.test.ts` dragnet case |
| **P20 dragnet invalidation** | pause → `clearPauseGesture()` → play ⇒ **no** annotation (the `useTTS.ts:31-33` contract) | new (pins the ReaderView coupling so 5b's `DragnetGesture` internalization can't silently drop it) |
| **P21 provider fallback** | `failNextPlay` on a cloud provider id ⇒ engine ends **playing via the local provider**, `activeProviderId()` flipped, exactly **one** replay (assert `backend.played()` count). *Written to pin the post-5a-PR3 single-path semantics; until then the worker leg documents the double-fire with `it.fails` on the single-replay assertion* | `TTSProviderManager.test.ts` fallback case (stays, backend-level); new at engine level |
| **P22 speed-change-while-paused** | `setSpeed` while paused ⇒ next play restarts current sentence with the new rate reaching the backend | `AudioPlayerService_Resume.test.ts` |
| **P23 queue identity & no-echo** | after `setQueue`, repeated status broadcasts deliver the same queue identity (in-process: same ref until mutation; worker: handle cache `WorkerEngineHandle.ts:34` reused between broadcasts of unchanged queues — pinned via `queueRefs()`); a settings write **after 5b's split** must produce zero engine-bound queue traffic (the no-echo half lives in the 5b store-split PR as a unit test on the new replication slices; the parity half pins broadcast identity) | new |

Rapid-command interleaving (`_Concurrency`, `_Critical`) is deliberately **not** a parity
scenario: those tests assert sequencer internals (`service['status']` etc.) that are
meaningless over Comlink. They are absorbed into a sequencer-level invariant suite instead
(see ledger).

#### 0.3 Absorption ledger (constitution rule 8 — the doc the reviewers check per deletion PR)

A file may be deleted **only** in the PR whose "absorbed into" suite carries a
`describe('regression: <file stem>')` block containing its surviving assertions.

| Legacy file (at HEAD, `src/lib/tts/`) | Durable behavior | Absorbed into | Deleted in |
|---|---|---|---|
| `AudioPlayerService.test.ts` (520 ln) | preroll title in queue items, subscribe-snapshot semantics, restore/queue basics | P12/P17 + `QueueModel` unit suite | 5b-PR4 |
| `AudioPlayerService.predictability.test.ts` | unsubscribed-listener never fires; playlist no-clobber on double `setBookId`; loadSection race | P17/P18 + sequencer invariants | 5b-PR3 |
| `AudioPlayerService_Predictability_Fix.test.ts` | loadSectionBySectionId stale-book no-op | P18 | gate PR (after P18 green on both transports) |
| `AudioPlayerService_Concurrency.test.ts` | rapid play executes once; stop-after-play wins | `TaskSequencer` invariant suite (epoch tests, 5b-PR3) | 5b-PR3 |
| `AudioPlayerService_Critical.test.ts` | setQueue not aborted by immediate play | same | 5b-PR3 |
| `AudioPlayerService_AnalysisUpdate.test.ts` | duplicate-analysis single-enqueue | P16 | gate PR |
| `AudioPlayerService_ReactiveSubscription.test.ts` | mask/adaptation on store success; ignore non-success/foreign-section | P14/P15/P16 + `AnalysisApplier` unit suite | 5b-PR4 |
| `AudioPlayerService_RestoreAnalysis.test.ts` | analysis re-trigger on restore | P12 | gate PR |
| `AudioPlayerService_Resume.test.ts` | paused speed-change restart | P22 | gate PR |
| `AudioPlayerService_LanguageSync.test.ts` | proactive language sync + lexicon invalidation on book change | parity rider on P12 + `PlaybackController` unit suite | 5b-PR4 |
| `AudioPlayerService_MediaSession.test.ts` | all handlers registered incl. seekto; position state during cloud playback | `MediaMetadataPublisher` unit suite (fed by snapshots) | 5b-PR4 |
| `AudioPlayerService_StateProtection.test.ts` | no reading-state writes when sectionIndex === −1 | `PlaybackController` unit suite + P12 rider | 5b-PR4 |
| `engine/AudioPlayerService.isolated.test.ts` | fake-driven smoke incl. dragnet | superseded by P19/P20 (same fakes) | 5b-PR4 |
| `PlaybackStateManager_Masking.test.ts` / `_Adaptation.test.ts` | mask semantics, adaptation anchor/sibling rules | `QueueModel` unit suite (immutable snapshots) + P14/P15 | 5b-PR2 |
| `TaskSequencer_Predictability.test.ts`, `TaskSequencer.test.ts` | FIFO, error isolation | extended sequencer suite (cancellation added) | 5b-PR3 (merge, not delete-without-absorb) |
| `TTSProviderManager.test.ts` | event normalization, fallback observable outcome | `describeProviderContract` + new manager suite | 5a-PR3 |
| `AudioContentPipeline*.test.ts` ×7 | grouping, marker attribution, Bible, structural anomaly, table CFI, trigger analysis | `SectionQueueBuilder` / `ReferenceSectionDetector` / `CfiGrouper` suites | 5c-PR2/3 |
| `LexiconService*.test.ts` ×7 (+ trace/fuzz/perf kept as suffixed companions) | assembly order, initialisms, Bible injection, sort | `LexiconEngine` suite (fuzz/perf survive as `.fuzz`/`.perf`) | 5c-PR4 |
| `TextSegmenter*.test.ts` ×9 | segmentation/refinement/merge behavior | consolidated `TextSegmenter` spec (3 files: spec/fuzz/perf) | 5c-PR2 |
| `citation-skipping.integration.test.ts` | three publisher markup styles | **kept as-is** (real-EPUB integration; explicitly a keeper) | never |
| `BaseCloudProvider.registry.test.ts`, 6 provider tests, `CapacitorTTSProvider.test.ts` Smart-Handoff suite | request dedup, handoff races | **kept**; cross-provider `describeProviderContract` added beside them; per-provider files merge only where redundant | 5a-PR2 |

Count check: the ledger retires ~31 of `src/lib/tts/`'s 61 test files across the phase,
matching the README's 246→~110 trajectory contribution for TTS (~30 net).

Gate PR exit: 23 scenarios × 2 transports green (minus the two documented `it.fails`
riders); ledger committed; engine-dir `vi.mock` allowlist lint rule active (N3); 4 ledger
rows marked "gate PR" deleted with their `describe('regression: …')` blocks landed.

### 5a — Providers

> **STATUS: 5a COMPLETE** (implementation chain `feat(tts): ProviderDescriptor registry…`,
> `…shared provider contract suite…`, `…vendor piper runtime…`). The P21 single-replay
> rider flipped green on both transports at 5a-PR2. Deviations from this design, recorded
> per the README header rule:
>
> 1. **Registry address**: landed at `src/lib/tts/providers/registry.ts` (the current home
>    of the provider tree), not the final `src/domains/audio/` address — the geography move
>    belongs to the sub-phase that deletes the legacy path (README §2 rule), i.e. later in
>    Phase 5.
> 2. **Ledger row 16** (`TTSProviderManager.test.ts`) closed at 5a-PR2 instead of 5a-PR3:
>    the suite was rewritten in place alongside the contract suite it absorbs into (named
>    regression block carried).
> 3. **Capacitor failure mode**: the contract suite encodes `failureMode: 'event'` for
>    CapacitorTTSProvider — the native speak promise settles on COMPLETION (that is what
>    makes Smart Handoff possible), so a rejection channel for start failures does not
>    exist; a failure still surfaces exactly once (one error event after the optimistic
>    start). All five other providers are reject-only.
> 4. **providers/ vi.mock ban** ("verify, then flip"): verification found the suites did
>    NOT all use injected fakes — they were converted at 5a-PR2 (FakeAudioSink +
>    constructor-injected caches + FakePiperRuntime). One permanent allowlist entry
>    remains: `@capacitor-community/text-to-speech` (registered native plugin, no
>    injection seam — the providers-dir analogue of the engine-dir PlatformIntegration
>    entry).
> 5. **PiperRuntime surface**: model accessors are keyed by model/config URL pairs rather
>    than bare voiceId — the durable Cache API store keys ARE the legacy HuggingFace URLs
>    (the compatibility constraint below), and only `PiperProvider` owns the voiceId→URL
>    mapping. Intent (LRU, awaited deletes, dispose, request-id protocol) is unchanged.
> 6. **SW precache**: the vendored `dist/piper/onnxruntime/*.wasm` files (~10 MB each)
>    are excluded from the PWA precache manifest (4 MB budget) — same effective offline
>    behavior as the cdnjs era; full piper-asset offline caching is P8 (PWA runtime
>    caching) scope.

#### 5a.1 `ProviderDescriptor` registry (final address `src/domains/audio/providers/registry.ts`)

```ts
export interface ProviderBuildContext {
    apiKey?: string;
    language: string;          // normalized (language-utils)
    sink: AudioSink;           // ONE shared sink, injected by the manager (kills per-provider AudioElementPlayer)
}

export interface ProviderDescriptor {
    readonly id: string;                       // 'webspeech' | 'capacitor' | 'piper' | 'google' | 'openai' | 'lemonfox'
    readonly displayName: string;
    readonly kind: 'device' | 'wasm' | 'cloud';
    readonly requiresApiKey: boolean;
    readonly platforms?: ReadonlyArray<'web' | 'native'>;   // settings UI filters on this
    readonly capabilities: {
        downloadableVoices: boolean;           // gates VoiceDownloadable guard
        localeAware: boolean;                  // gates LocaleAware guard
    };
    build(ctx: ProviderBuildContext): ITTSProvider;
}

export const PROVIDERS = [ /* …six descriptors… */ ] as const satisfies readonly ProviderDescriptor[];
export type TTSProviderId = (typeof PROVIDERS)[number]['id'];
```

- **Speed/pitch are NOT capabilities.** The R1 policy (synthesize at 1.0, rate at sink,
  speed-free cache key) is already the law of the tree; the registry hard-codes it — no
  `synthesisSpeed` capability is introduced, because no current provider benefits and the
  contract row C5 names the policy as part of the pinning suite. The vestigial `pitch`
  param on `TTSCache.generateKey` (`TTSCache.ts:24`) is deleted here (keys unchanged —
  it was always defaulted; golden-key test proves it).
- **Narrowed `ITTSProvider`** (in `providers/types.ts`, breaking):
  `{ id, init, getVoices, play, preload, pause, stop, dispose(), on(cb): Unsubscribe }` —
  `resume`, `SpeechSegment.isNative`, `TTSOptions.volume` deleted (S12); `TTSEvent` error
  payload typed `AppError | {message: string}` (C10 alignment). `play()` semantics
  specified: *resolves when audible playback has started; rejects exactly once on failure;
  never emits an `error` event for a failure it rejects* (fixes the
  `BaseCloudProvider.ts:58-61` emit+rethrow).
- **`'local'` id split**: `'webspeech'` / `'capacitor'` with `'local'` retained as a
  *persisted alias* mapped at the 5b store-split migration (per platform); until 5b,
  `buildProviderById` keeps accepting `'local'` (alias table in the registry) so 5a ships
  without a persistence change (one-format-in-flight rule: P2's CRDT v6 / P3 v25 may still
  be in their straggler window).
- **Factory inversion**: `providerFactory.buildProviderById(id)` becomes a thin wrapper
  `(id) => descriptor.build(ctxFromStore())` for one release, then the two real call sites —
  `TTSProviderManager.setProviderById` (`TTSProviderManager.ts:180-182`) and the host
  backend in `createWorkerEngineClient.ts:124-135` — pass `ProviderBuildContext` explicitly
  and the `useTTSStore` import dies (S11's cycle edge `providerFactory.ts:12,22`).
- **Manager**: `TTSProviderManager` keeps the `PlaybackBackend` role but becomes a dumb
  holder: on swap it `off()`s its listener, `dispose()`s the outgoing provider, injects the
  shared sink; voice download routes via `VoiceDownloadable` type guard driven by
  `descriptor.capabilities.downloadableVoices` (deletes `:213-242` `as any`);
  `isVoiceDownloaded` returns `false` for non-capable providers (current `true` at `:241`
  is a UI lie — settings UI reads capability instead).
- **Single failure path**: providers reject only; the manager's event-listener fallback
  branch (`:76-82`) is deleted; its `play()` catch rethrows a typed
  `ProviderPlaybackError{providerId, cause}` and performs **no** self-swap. Fallback policy
  moves into the engine as one sequenced task (5b-PR3 consumes it; in the 5a window the
  existing APS `onError` fallback handler at `AudioPlayerService.ts:132-137` is retargeted
  to enqueue — a 5-line bridge: `this.enqueue(() => this.recoverWithLocalProvider())` —
  so the double-fire dies in 5a even before the sequencer rework).
- **Settings UI** renders provider select + API-key fields from the registry
  (`TTSSettingsTab` re-declared unions die). API-key edits buffer locally; provider re-init
  happens on blur/Save (S10's per-keystroke rebuild dies in the UI without waiting for the
  5b store split).

#### 5a.2 `PiperRuntime` + vendoring (kills the postinstall patcher — the P1 veto unblocks)

**Vendoring layout** (new top-level vendor dir, served as static assets):

```
third-party/piper/                      # checked into git
  PROVENANCE.md                         # upstream repo+version, recipe, patch list, GPL-3 notice
  piper_phonemize.js                    # verbatim from piper-wasm@0.1.4 build/
  piper_phonemize.wasm                  # verbatim (GPL-3-governed: embedded espeak-ng)
  piper_phonemize.data                  # verbatim (espeak-ng-data FS image)
  piper_worker.js                       # PATCHED SOURCE, committed — the 2 functional patches
                                        # (config passing, phoneme-id clamp) + error-reporting
                                        # patches applied once, by hand, from scripts/patch_piper_worker.js
  onnxruntime/                          # onnxruntime-web 1.17.1 dist (ort-wasm*.wasm + ort.min.js)
```

- Build: a `vite-plugin-static-copy` rule (or `public/` symlink-free copy step in
  `vite.config.ts`) ships `third-party/piper/**` → `dist/piper/` — same runtime URL layout
  as today (`/piper/piper_worker.js`), so `piper-utils`' worker URL only changes if we
  choose to; the Cache-API model store `piper-voices-v1` (`piper-utils.ts:2`) is untouched
  and **existing downloaded voices keep working**.
- `piper-utils.ts:281`'s `onnxruntimeUrl` cdnjs default → `'/piper/onnxruntime/'`. CDN
  fallback deleted (privacy finding: no third-party egress during synthesis).
- `package.json`: `prepare-piper` script + `postinstall`'s `npm run prepare-piper` deleted;
  `scripts/patch_piper_worker.js` deleted; `piper-wasm` dependency **removed** (artifacts
  are vendored; the npm package served no other purpose — verify with knip before merge).
  `.gitignore:34`'s `public/piper/` entry deleted.
- **License gate is part of this PR**: `third-party/inventory.json` piper entries re-point
  from `public/piper/ (gitignored)` to `third-party/piper/`; `PROVENANCE.md` records the
  DavidCks/piper-wasm 0.1.4 provenance, the unknown-espeak-commit caveat verbatim from the
  inventory, and the applied patch list; THIRD-PARTY-NOTICES regenerated. CI license gate
  (P0) must pass.
- **CI smoke test** (replaces the patcher's silent-warn failure mode): a vitest node test
  reads the *served* `piper_worker.js` and asserts the phoneme-clamp marker string and the
  config-passing patch are present (anchors from `scripts/patch_piper_worker.js:25-94`,
  frozen as fixtures before the script is deleted).

**`PiperRuntime`** (class, owned by `PiperProvider`; replaces `piper-utils` module globals
`piper-utils.ts:1-6`):

```ts
export class PiperRuntime {
    constructor(opts: { workerUrl: string; onnxBaseUrl: string; cacheName?: string });
    /** request-id-correlated; queue resets on error instead of poisoning the chain */
    generate(req: { text: string; voiceId: string; modelBlob: Blob; configBlob: Blob }): Promise<Blob>;
    /** LRU over in-memory model blobs (budget ~2 models); Cache API remains the durable tier */
    getModel(voiceId: string): Promise<{ model: Blob; config: Blob }>;
    deleteModel(voiceId: string): Promise<void>;       // awaits Cache API delete (fixes D17 race)
    dispose(): void;                                    // terminates worker, clears queue + blobs
}
```

- Message protocol: `{requestId, kind}` envelopes; a late message with a stale `requestId`
  is dropped (fixes the cross-talk hazard of per-call `onmessage` reassignment,
  `piper-utils.ts:312-355`).
- **Offline catalog**: `voices.json` cached in Cache API stale-while-revalidate; on fetch
  failure, locally downloaded voices are enumerated from the model cache so
  `fetchAudioData` never throws `Voice not found` for a downloaded voice
  (`PiperProvider.ts:85-87,201-204` today). Explicit test: init with network failure +
  cached model ⇒ voice listed and synthesizable.
- Keepers preserved verbatim: transactional download (stage→commit→verify,
  `PiperProvider.ts:148-197`), CJK chunking, real-offset WAV stitching.

### 5b — Engine

> **STATUS: 5b COMPLETE.** Second half landed as two commits — `feat(tts): sequencer
> epochs + dev-assert; events, dragnet, fallback sequenced` (the doc's 5b-PR3) and
> `refactor(tts): decompose the engine; AudioPlayerService dies` (the doc's 5b-PR4).
> `AudioPlayerService.ts` is GONE (exit criterion met); the engine-dir `vi.mock`
> allowlist is **∅** (N3 deadline met); parity 23 scenarios × 2 transports green with
> zero `it.fails` riders; ledger rows 1/2/4/5/7/10–13/15 closed. Deviations of the
> second half, recorded per the README header rule:
>
> 7. **Guard conversion scope (§5b.3)**: the loadSection/loadSectionBySectionId/play
>    book-id guards converted to `ctx.checkpoint()`; `restoreQueue`'s guard is
>    deliberately NOT converted — `stop()` also bumps the epoch, and a user stop
>    between `setBookId` and the playlist resolving must not cancel the restore. The
>    `playInternal`/`handleContentAnalysisUpdate` book/section guards remain hand-rolled
>    (behavior-identical; candidates for 5c-or-later conversion under their own riders).
> 8. **setBookId semantics**: the context switch (epoch bump, `currentBookId`, load
>    kickoffs) stays synchronous; only the stop/reset is sequenced. The in-process
>    engine returns the reset-task promise; `WorkerTtsEngine.setBookId` stays
>    fire-and-forget — awaiting the reset across Comlink can deadlock the sequencer
>    against a task parked on the old book's still-loading playlist (found by the
>    worker parity leg).
> 9. **Storage ports beyond the doc's SessionStore**: reaching the zero-vi.mock
>    deadline also required a `BookContentPort` on EngineContext (the pipeline's
>    getTTSPreparation/getTableImages/getBookStructure reads + the controller's
>    getSections), with repo-backed production impls in `engine/repoPorts.ts` and
>    injection seams on `WorkerTtsEngine`'s constructor. The repo-backed SessionStore
>    also closes playbackCache's documented P13a cold-start clobber (every persist
>    chains behind a one-time session seed read) — the P3 dual-owner fix.
> 10. **Dragnet invalidation timing**: per the design, section-change invalidation is
>    engine-internal (DragnetGesture watches the QueueModel section index) and the
>    `clearPauseGesture` API + ReaderView/useTTS call sites are deleted. Recorded
>    tradeoff: the ReaderView TOC handler used to clear on navigation INTENT, ahead of
>    WebKit's slow relocation; the engine now disarms when its own section actually
>    changes (P20 rewritten to pin the new trigger).
> 11. **Diagnostics surface**: `exportDiagnostics()` + `triggerDiagnosticsSnapshot()`
>    landed on `TtsEngine`/`WorkerTtsEngine`/`WorkerEngineHandle`; DiagnosticsTab reads
>    live stats/buffer through `useAudioCommands` (worker data), persisted snapshots
>    through the diagnostics repo via TtsController. The ring-buffer core moved to
>    `src/kernel/diagnostics/ringRecorder.ts` (N7; generic, zero internal deps);
>    `TTSFlightRecorder` is the audio-domain wrapper keeping the anomaly heuristic and
>    IDB persistence.
> 12. **Addresses**: the decomposed units live at `src/lib/tts/engine/` (the established
>    5a geography deviation — the `domains/audio/` move belongs to the sub-phase that
>    deletes the legacy path). The 5b.1 lexicon-cache row stayed a `PlaybackController`
>    field (the `CompiledLexicon` handle arrives with 5c's LexiconEngine); the N5
>    deletions (`checkBatteryOptimization`, public `resume()`, `setBackgroundAudioMode`
>    typed) landed.
>
> First-half status (5b-PR1/2 + store split), kept for the record: the P14 identity
> rider flipped green at the QueueModel commit. Deviations from this design, recorded
> per the README header rule:
>
> 1. **PR regrouping**: landed as three commits cutting across the doc's PR map —
>    (i) the command facade (`TtsController` + `useAudioCommands` + the
>    `mainThreadAudioPlayer` import ban, from 5b-PR5) together with the N1
>    `WorkerEngineHandle` move (from 5b-PR1); (ii) the snapshot channel (5b-PR1) merged
>    with the immutable `QueueModel` (5b-PR2); (iii) the store split + migration
>    (5b-PR5), sequenced BEFORE the sequencer-epochs/decomposition work (5b-PR3/PR4),
>    which remains open.
> 2. **QueueModel address + scope**: landed at `src/lib/tts/QueueModel.ts` (the renamed
>    PlaybackStateManager, in the legacy home per the 5a geography deviation); its
>    persistence methods are RETAINED — the `SessionStore` port carve-out rides the
>    open decomposition half, so the engine-dir `vi.mock` allowlist is still the
>    4-module core (see the ledger note).
> 3. **`'local'` id split**: persisted ids + settings-UI option values split to
>    webspeech/capacitor ('local' migration-mapped per platform and still accepted as
>    an alias on the engine command path / `recoverWithLocalProvider`); the device
>    provider INSTANCE ids still report `'local'` — the instance-id rename rides the
>    decomposition half.
> 4. **Dropped fields**: profile `pitch`/`volume` and `enableCostWarning` dropped per
>    the design decision (recorded in the migration acceptance suite). The SYNCED
>    `DeviceProfile.ttsPitch` field is kept at the neutral 1.0 (changing the device-mesh
>    CRDT shape is not a Phase 5 format change).
> 5. **`TTSSettingsData` only**: the GenAI/Progress/Annotation sibling snapshot types in
>    `EngineContext.ts` stay store-derived for now — the parallel P7 track owns the
>    genAI store surface; the genAI replication slice received the engine-view equality
>    guard (the second echo path) without a type change.
> 6. **Verification-spec shim**: `window.useTTSStore` survives as a typed shim in
>    `main.tsx` (playback reads + play/pause commands) because the Playwright
>    verification specs drive it; P9 retires it with their migration.

#### 5b.1 Decomposition map (current APS responsibilities → new units, all inside the worker)

`AudioPlayerService.ts` at HEAD = 1,218 lines. Target: APS becomes a façade (≤~150 lines)
composing the units below, then is deleted when `WorkerTtsEngine` constructs the
`PlaybackController` directly (exit criterion: `AudioPlayerService.ts` gone).

| New unit (final address `src/domains/audio/engine/`) | Absorbs (HEAD line ranges in `AudioPlayerService.ts` unless noted) | Notes |
|---|---|---|
| **`PlaybackController`** | FSM + sequencing: `play/pause/stop/next/prev/seek/jumpTo/setSpeed/setVoice` (`:604-929`), `playInternal` (`:693-777`), `playNext` (`:931-966`), `setStatus` (`:968-997`), provider-event handling (`:120-149`), language-sync subscription (`:166-193`), fallback recovery task | The ONLY unit allowed to change status. Dev-assert: see 5b.3 |
| **`QueueModel`** | all of `PlaybackStateManager.ts` minus persistence (`persistQueue :439-448`, `savePlaybackState :455-469`) | Immutable: every mutation returns a new frozen array; the in-place mask (`PSM:100-114`) dies; P14's identity rider flips from `it.fails` to green here |
| **`SessionStore`** (port) | `restoreQueue` (`:355-426`), `savePlaybackState` (`:1204-1217`), PSM persistence methods, the WebKit-detach policy comments (`:794-799,827-829,1143-1145`) | Interface `{loadSession(bookId), persistQueue(bookId, queue), persistPauseState(bookId, status)}`; worker-side impl wraps `dbService` (P3's `playbackCache` repo when it exists); **detached-write discipline preserved verbatim and documented on the port** |
| **`AnalysisApplier`** | contentAnalysis subscription (`:106-108`), `handleContentAnalysisUpdate` (`:1018-1072`), `applyCachedAnalysis` (`:1074-1079`), genAI subscription (`:196-211`), the three mask/adaptation callback sites (`:405-419`, `:1121-1130`, restore path) | Submits masks/adaptations as sequenced commands to `PlaybackController`; owns the timestamp dedup (`:1033-1037`) |
| **`MediaMetadataPublisher`** | `engageBackgroundMode` (`:321-340`), `updateMediaSessionMetadata` (`:428-445`) — the two near-identical builders merge into one — `calculateBookProgress` (`:447-470`), `updateSectionMediaPosition` (`:342-353`) with a position deadband (S19) | Fed exclusively by `PlaybackSnapshot`; keeps the Bluetooth metadata-deadband keeper in `PlatformIntegration` |
| **`DragnetGesture`** | `lastUserPauseTimestamp` (`:90,638-642,789`), `executeDragnetCapture` (`:648-691`), `clearPauseGesture` (`:812-817`) | Becomes a sequenced command; **section-change invalidation moves inside the engine** (subscribe to section index changes in the snapshot), deleting `ReaderView.tsx:1291` + `useTTS.ts:31-33` call sites; P20 pins the behavior across the move |
| **lexicon cache** | `activeLexiconRules` field + invalidations (`:79,186,273,316,749-756,987`) | Folded into `PlaybackController` as a `CompiledLexicon` handle (5c provides the type); invalidation also subscribes to lexicon-store changes (fixes mid-playback-edit staleness, S15) |
| **deletions** | `checkBatteryOptimization` (`:1089-1101`), `resume()` (`:779-786`, internal `resumeInternal` kept), `setBackgroundAudioMode(mode: any)` typed (`:472-475`) | N5 |

#### 5b.2 The single `PlaybackSnapshot{seq}` channel (C4)

Replaces the four outbound paths (S5: PSM-subscription notify `:153-164`, `setStatus`
notify `:968-997`, `notifyError` `:1081-1083`, `notifyDownloadProgress` `:1085-1087`) and
the positional 6-arg `PlaybackListener` (`:39`).

```ts
export interface PlaybackSnapshot {
    readonly seq: number;                 // monotonic, worker-side; staleness detection across the boundary
    readonly status: TTSStatus;
    readonly queueId: string;             // changes iff queue identity changes (P23's broadcast diet)
    readonly queue: ReadonlyArray<TTSQueueItem>;   // included only when queueId changed; else omitted
    readonly index: number;
    readonly sectionIndex: number;
    readonly activeCfi: string | null;
    readonly error: { code: string; message: string } | null;   // C10 codes (TTS_*)
    readonly download: DownloadInfo | null;
}

export interface TtsEngine {                       // STANDALONE interface — no Pick<APS> (S8)
    // commands are ACKS: the promise resolves when the command is accepted, not completed;
    // results flow exclusively through the snapshot stream
    play(): Promise<void>; pause(): Promise<void>; stop(): Promise<void>;
    /* …same surface as the current Pick (AudioPlayerService.ts:46-55), minus
       setBackgroundAudioMode-any, plus: */
    subscribe(listener: (snap: PlaybackSnapshot) => void): () => void;
    snapshot(): PlaybackSnapshot;                  // latest, sync (handle cache)
    exportDiagnostics(): Promise<FlightRecorderExport>;   // S9 fix — DiagnosticsTab reads via the handle
}
```

- Emitted from exactly one place (`PlaybackController.publish()`); handle mirrors into the
  new `useTTSPlaybackStore`; `seq` lets the handle drop out-of-order Comlink deliveries.
- Migration is additive: snapshot channel ships alongside the positional listener for one
  PR; `useTTSStore.initialize()` + `WorkerEngineHandle` cut over; positional path deleted
  in the same PR that deletes APS's notify methods (ledger rule: the
  "loading-as-playing" flicker workaround `useTTSStore.ts:236-239` gets a named regression
  block — snapshot consumers derive `isPlaying` from `status ∈ {playing, loading, completed}`
  as an explicit, tested selector instead of an inline comment).
- `WorkerEngineHandle.run()` error swallowing (`WorkerEngineHandle.ts:80-83`): a rejected
  command surfaces as a snapshot with `error.code = 'TTS_COMMAND_FAILED'` rather than a
  log line. The handle moves to `src/app/tts/` (N1), dissolving the lib→app import.

#### 5b.3 `TaskSequencer` cancellation + the dev-assert

```ts
export interface TaskContext {
    readonly signal: AbortSignal;       // aborted when the epoch advances
    readonly epoch: number;
    stale(): boolean;                   // epoch !== current
    checkpoint(): void;                 // throws TaskCancelledError if stale — replaces hand-rolled guards
}
export class TaskSequencer {
    enqueue<T>(label: string, task: (ctx: TaskContext) => Promise<T>): Promise<T | void>;
    bumpEpoch(reason: string): void;    // stop / setBookId / loadSection call this
    destroy(): void;
}
```

- `stop`, `setBookId`, `loadSection` bump the epoch before enqueueing themselves; the ~10
  hand-rolled `currentBookId !== …` guards (S7 list) convert to `ctx.checkpoint()` one PR
  at a time, each conversion covered by the parity scenario that owns the behavior (P17/P18).
- Per-task watchdog: tasks exceeding 30 s record a flight-recorder anomaly (`TSQ` source —
  the recorder already tags task lifecycle, `TaskSequencer.ts:20-33`).
- **Dev-assert (the C4 invariant)**: `PlaybackController.setStatus` and every `QueueModel`
  mutation method assert `sequencer.isInsideTask()` when `import.meta.env.DEV` — making
  "only sequenced tasks mutate state" a crashing invariant in dev/test instead of a
  convention. The fallback path (S1) and dragnet (S3) are the two known violators; the
  assert lands in the same PR that fixes them (5b-PR3) so it is born green.

#### 5b.4 `useTTSStore` split + the captured tts-storage v3 blob test

Split (final names per contract row C4/state-stores):

- **`useTTSSettingsStore`** — persisted (`persist` name **`tts-settings`**, version 1):
  `providerId` (registry union; `'local'` mapped by platform at migration), `apiKeys`,
  `activeLanguage`, `profiles` (sole representation — flat `rate/pitch/voice/minSentenceLength`
  die; selectors derive), `customAbbreviations`, `alwaysMerge`, `sentenceStarters`,
  `sanitizationEnabled`, `isBibleLexiconEnabled`, `prerollEnabled`, `backgroundAudioMode`,
  `whiteNoiseVolume`. Dropped: `enableCostWarning` (N5), `pitch`/`volume` inside profiles
  **unless** 5a implements them (decision: drop — nothing applies them; record in the
  migration test). `voices` (runtime list) moves to playback store.
- **`useTTSPlaybackStore`** — ephemeral, never persisted, never replicated: mirror of
  `PlaybackSnapshot` + `engineReady` + download state + `voices`.
- Setters become pure state writes; engine synchronization moves to
  **`src/app/tts/TtsController.ts`**: subscribes to settings changes → engine calls
  (`setSpeed`/`setVoice`/`setProviderById`…), owns `initialize()` boot wiring, and the
  `onRehydrateStorage` side effects (`useTTSStore.ts:491-510`) move into its boot task
  (R9 completes). UI components call `useAudioCommands()` (new hook over the controller)
  instead of store actions that wrap `getAudioPlayer()`; `no-restricted-imports` bans
  `@app/tts/mainThreadAudioPlayer` outside `src/app/tts/` (the 14 `getAudioPlayer()` sites
  in `useTTSStore.ts` and 6 in `ReaderView.tsx`/`useTTS.ts`/`LexiconManager.tsx` migrate).

**Migration** (`tts-storage` v3 → `tts-settings` v1) — the only user-data format change in
Phase 5; sequenced after P3's IDB v25 straggler window per constitution rule 4:

1. Read `localStorage['tts-storage']`; if present and `version === 3` (or 1/2 — run the
   existing chain `useTTSStore.ts:446-469` first), map → new shape; `providerId: 'local'`
   → `'capacitor'` on native / `'webspeech'` on web.
2. Write `tts-settings`; **do not delete `tts-storage`** for one release (rollback path);
   a later cleanup (P9) removes it.
3. **Captured-blob test design (the fixture comes FIRST)**: before any split code lands,
   a gate-PR script (`scripts/capture-tts-storage.ts`, mirroring the P2 Y.Doc fixture
   capture) runs the *current* app in vitest-jsdom, drives `useTTSStore` through:
   set Google API key, download-flag a piper voice profile, set zh profile
   `{voiceId, rate:1.25, minSentenceLength:6}`, set custom abbreviations — then dumps
   `localStorage['tts-storage']` verbatim into
   `src/store/__fixtures__/tts-storage.v3.json` (plus a hand-edited v1-era and v2-era
   variant exercising the legacy migration chain). The split PR's regression suite loads
   each fixture into a fresh `localStorage`, boots both new stores, and asserts: API keys
   survive, per-language profiles survive (incl. zh minSentenceLength), provider id maps
   correctly, dropped fields are absent, and `tts-storage` still exists untouched.
4. `replicationSpec` is updated **in lockstep** (it's loud on missing slices —
   `replication.test.ts` + the boot-readiness gate `createWorkerEngineClient.ts:198-202`
   make drift impossible).

#### 5b.5 Killing the replication echo loop (S6)

- The `settings` slice (`replicationSpec.ts:55-61`) re-targets `useTTSSettingsStore` and
  pushes an explicit **`TTSSettingsData`** payload — a hand-written data-only interface
  (the ~10 fields the engine actually reads: profiles/activeLanguage view, segmentation
  lists, sanitization, bible flag, preroll, background audio) — replacing
  `plain(getState())`. The `TTSSettingsSnapshot = ReturnType<typeof useTTSStore.getState>`
  type and its siblings (`EngineContext.ts:42-60`) are replaced by explicit payload types;
  the store `satisfies` them (engine D14 second half).
- Because playback state lives in `useTTSPlaybackStore` (never replicated), the
  per-sentence echo (engine broadcast → settings push) dies structurally. A unit test pins
  it: subscribe a spy to the worker push channel, drive a playback-store update, assert
  zero pushes; drive a settings change, assert exactly one (the P23 companion).
- The `genAI` slice gets an equality guard on the fields the engine reads (or the
  `addGenAILog` host command stops round-tripping through the store — decision: keep the
  store write, add the guard; logs are not engine inputs). The engine-side genAI
  subscription reset (`AudioPlayerService.ts:196-211`) moves into `AnalysisApplier` with
  the same dedup.

#### 5b.6 Flight recorder (S9)

- Ring-buffer + anomaly-snapshot core extracted to `src/kernel/diagnostics/ringRecorder.ts`
  (N7); `TTSFlightRecorder` becomes the audio domain's named instance.
- `WorkerTtsEngine` gains `exportDiagnostics(): {stats, buffer, snapshots}` and
  `triggerSnapshot(reason)`; `DiagnosticsTab.tsx` reads through the engine handle
  (`TtsEngine.exportDiagnostics`), never the singleton. IDB snapshot persistence stays
  (workers can use IDB; P3 repo when available).

### 5c — Content

#### 5c.1 `SentenceExtractor` relocation (R6 finishes)

- `src/lib/tts/sentence-extraction.ts` → `src/lib/ingestion/sentence-extraction.ts`
  (final address `src/domains/library/ingestion/` arrives with P7; one move only — go
  directly to `lib/ingestion/` now since `domains/library/` doesn't exist yet and P7 owns
  that move as part of its own strangler; the README's "nothing moves twice" rule is
  satisfied because P7 *rewrites* extraction, not relocates it).
- Types: `SentenceNode`/`ExtractionResult`/`CitationMarker` consumption types move to
  `src/types/tts-content.ts` (types layer imports nothing — rule already enforced);
  `TextSegmenter.ts:2`, `AudioContentPipeline.ts:11`, `TableAdaptationProcessor.ts:4`
  re-point downward. The engine→extractor reverse type-import dies.
- **Raw-at-rest**: the ingest-time `refineSegments` pass with empty abbreviations
  (`sentence-extraction.ts` flush path) is removed; v3 of `TTS_EXTRACTION_VERSION` stores
  unrefined sentences. Playback already refines (`AudioContentPipeline.ts:133-140` →
  `SectionQueueBuilder`), so v1/v2 rows keep working (they just refine less). Graft
  honored: old `cache_tts_preparation` rows are retained; CI compares old-vs-new sentence
  CFIs on composed-accent/CJK fixtures before the version constant bumps (the NFKD
  fixtures from commit `4197dcab`'s test are reused and extended with a ligature + zh case).

#### 5c.2 `SectionQueueBuilder` purification + `ReferenceSectionDetector` strategy

- **`SectionQueueBuilder`** (pure): `(sentences, settings, {preroll, sectionTitle}) →
  {queue: TTSQueueItem[], title: string}` — absorbs `AudioContentPipeline.ts:53-186` minus
  side effects. The `ctx.readerUI.setCurrentSection` write (`:104`) moves to the host:
  `PlaybackController.loadSection` returns the title; the worker emits it inside
  `PlaybackSnapshot`-adjacent host command (existing `setCurrentSection` command,
  `createWorkerEngineClient.ts:69-71`, now called from the controller — the pipeline never
  touches UI ports again). English-only randomized filler (`NO_TEXT_MESSAGES`) becomes
  deterministic + keyed by book language (i18n ADR: worker-importable catalog).
- **`ReferenceSectionDetector`** (strategy interface): `Deterministic` (always available,
  the enumerator detector `:570-594`) | `GeminiDetector` (with deterministic shadow run);
  owns the persisted retry/timeout state machine (`:421-459`) and promise dedup; telemetry
  (`:688-810`, ~125 lines) becomes an injected `DetectionTelemetry` observer.
  **D4 fix folded in**: the detector's input is `{sentences, citationMarkers}` always
  fetched together — the path-dependence between `loadSection` (`:216`, markers dropped)
  and prewarm (`:331`, markers passed) dies by construction; a test asserts marker hints
  reach the prompt from the primary path.
- **`CfiGrouper`**: `groupSentencesByRoot`/`attributeMarkersToGroups` (`:816-877` + marker
  attribution `:630-680`) move beside the CFI kernel with named types (the inline
  `{rootCfi; segments; fullText}` shape, re-declared at `:421,691,816`, becomes
  `interface CfiGroup`).
- GenAI plumbing: one `ensureGenAIReady(ctx)` (replaces duplicated `canUseGenAI` +
  `gemini-1.5-flash` fallback at ACP `:473,506` / TAP `:77,82`); the `mockGenAIResponse`
  localStorage seam is gated behind `import.meta.env.DEV || VITE_E2E` here (full
  `MockGenAIClient`-at-composition-root replacement is P7; the strangler text "GenAI mock
  seam removed (replaced by the Phase 7 GenAIClient, stubbed behind the port meanwhile)").

#### 5c.3 `LexiconEngine` with lazy Bible JSON

```ts
export interface SystemLexiconProvider {
    readonly id: string;                                  // 'bible'
    appliesTo(pref: BiblePreference, lang?: string): boolean;
    load(): Promise<CompiledRules>;                       // dynamic import — leaves the main bundle
}
export interface CompiledLexicon {
    readonly rules: ReadonlyArray<LexiconRule>;           // frozen, stable identity
    readonly version: number;                             // bumps on store change
    readonly language?: string;
}
export class LexiconAssembler {
    getCompiled(bookId?: string, language?: string): Promise<CompiledLexicon>;
}
```

- `src/data/bible-lexicon.ts` (2,899 lines, statically imported — S16) splits into
  `src/data/bible-lexicon.json` (data) + a thin typed loader; `SystemLexiconProvider.load()`
  uses `import('…/bible-lexicon.json')` so the ruleset leaves the entry chunk (worker-safe:
  dynamic import works in module workers; verify the worker-chunk assertion stays green —
  the JSON lands in its own chunk for both threads). `BIBLE_ABBREVIATIONS` likewise lazy
  via the same module for `SectionQueueBuilder`'s memoized merge.
- The Bible rule array is compiled **once** into a frozen module-level `CompiledRules`
  (stable reference ⇒ `LexiconApplier.compiledRulesCache` WeakMap hits — S15's
  rebuild-per-call dies); the assembler memo writes before *every* return path (the
  `LexiconService.ts:114` early-return bug dies by restructuring into a single exit).
- One `resolveBiblePreference(perBook, globalSetting)` used by both the assembler and the
  queue builder; the imperative `setGlobalBibleLexiconEnabled` pushes
  (`useTTSStore.ts:359,508`) are deleted — the worker reads the flag through the settings
  replication payload (`TTSSettingsData.isBibleLexiconEnabled`), the main thread through
  the settings store.
- `processInitialisms` becomes a visible, toggleable system rule that appears in
  `applyLexiconWithTrace` (content D12); golden test pins that default output is
  byte-identical (audio cache keys must not shift — keys are SHA-256 of processed text).
- `getRulesHash` (`LexiconService.ts:205-214`, zero callers) deleted.

#### 5c.4 `lib/cfi/` canonical kernel

Scope at HEAD (`src/lib/cfi-utils.ts`, 596 lines — exports at `:29,44,74,98,188,232,363,463`):

- **Moves as the kernel** `src/lib/cfi/` (P6 consumes it; final `src/kernel/cfi/` admission
  happens when the kernel dir exists and the ≥2-consumer rule is met — TTS + reader):
  `parseCfiRange`, `mergeCfiSlow`, `generateCfiRange`, `mergeCfiRanges`, `generateEpubCfi`,
  `preprocessBlockRoots`, `getParentCfi`.
- **New canonical pair**: `cfiContains(parent, child)` + `stripCfiWrapper(cfi)` with THE
  separator set (`['/', '!', '[', ',', ':']` — the `getParentCfi` set at
  `cfi-utils.ts:127`); replaces the divergent inline copies:
  `AudioContentPipeline.ts:856,859` (missing `[`/`,` — a live mis-grouping bug for
  assertion-bracket children) and `TableAdaptationProcessor.ts:186-223`.
- **Fast paths that exist at HEAD and survive only behind equivalence tests**:
  - `tryFastMergeCfi` (`cfi-utils.ts:463`) with `mergeCfiSlow` (`:74`) as the oracle —
    a fast-check property test generates CFI pairs (from a structured CFI arbitrary, not
    random strings) asserting `tryFastMergeCfi(a,b) === null || tryFastMergeCfi(a,b) === mergeCfiSlow(a,b)`;
  - `getParentCfi`'s string-prefix containment vs a new parsed-`EpubCFI`-components oracle
    (epubjs `EpubCFI` compare — the `@ts-expect-error`'d internal import at
    `cfi-utils.ts:4` is wrapped in one typed shim inside the kernel, the only file allowed
    to import `epubjs/src/epubcfi`);
  - `cfiContains` fast string path vs the parsed oracle, same property suite.
  - Seeded-fuzz companions follow the existing `TextScanningTrie.fuzz` convention.
- The kernel threads `bookLanguage` into sentence-snapping segmenter use (i18n graft) —
  consumed by TTS now, reader in P6.

---

## Execution order

Sub-phase boundaries are shippable: each ends with full gates green and no half-cut seam.
"Gates" below = `tsc -b` (app+test+e2e), full vitest, depcruise ratchets, worker-chunk
purity check, coverage ratchet, license gate, lint.

### Gate PR (entry) — `test(tts): expand engine parity to 23 scenarios + absorption ledger`
- engineParityScenarios P12–P23 (+harness extensions); 4 ledger-row deletions
  (`_Predictability_Fix`, `_AnalysisUpdate`, `_RestoreAnalysis`, `_Resume`) with named
  regression blocks; tts-storage v1/v2/v3 fixture capture script + committed fixtures;
  engine-dir `vi.mock` allowlist lint (N3).
- **Exit**: 23×2 scenarios green (2 documented `it.fails` riders: P14 identity, P21
  single-replay); ledger committed; coverage not below baseline. **Proven by**: vitest,
  the lint rule, ledger review.

### 5a-PR1 — `feat(tts): ProviderDescriptor registry behind the existing factory`
- Registry + derived unions + narrowed `ITTSProvider` (dispose/unsubscribe; dead members
  deleted); `buildProviderById` wraps the registry (still store-reading); settings UI
  renders from registry; buffered API-key edits.
- **Exit**: provider unit suites green; `TTSSettingsTab` pixel-equivalent (existing
  component test); typing an API key no longer constructs providers (new test).

### 5a-PR2 — `feat(tts): shared provider contract suite + single failure path`
- `describeProviderContract(makeHarness)` run by all six providers (play-resolution
  semantics, reject-only failure, dispose, speed policy: synthesize-at-1.0 pinned with a
  non-1.0 test per provider, cache key = `hash(text|voiceId)`); `BaseCloudProvider.play`
  stops emitting on rethrow; manager detach+dispose+shared-sink; engine `onError` fallback
  bridged through `enqueue` (S1 dies); abort/timeout on cloud fetches threaded from `stop()`.
- **Exit**: contract suite ×6 green; P21 `it.fails` flips to green on both transports;
  `TTSProviderManager.test.ts` absorbed/deleted per ledger.

### 5a-PR3 — `feat(tts): vendor piper runtime; delete postinstall patching`
- `third-party/piper/` vendored (+`PROVENANCE.md`, inventory update, notices regen);
  `PiperRuntime`; offline catalog; cdnjs default deleted; `prepare-piper`/patch script/
  `piper-wasm` dep removed; CI served-worker smoke test.
- **Exit (5a complete, shippable)**: clean `npm ci` on a fresh checkout produces a working
  Piper (CI smoke); license gate green; airplane-mode test (catalog from cache) green;
  existing `piper-voices-v1` cache fixtures still load. `ctx`-passing flip lands here too:
  `providerFactory` store import deleted (depcruise: `lib/tts/providers` → `store` edge
  count hits 0).

### 5b-PR1 — `feat(tts): PlaybackSnapshot channel with monotonic seq`
- Snapshot type + single publish point + handle/store consumption; positional listener
  deleted; `TtsEngine` becomes standalone interface; `WorkerEngineHandle` moves to
  `src/app/tts/` (N1); command failures surface as snapshot errors.
- **Exit**: parity suite green (scenarios now assert via snapshots); flicker-workaround
  regression block landed; depcruise lib→app exception removed.

### 5b-PR2 — `refactor(tts): immutable QueueModel`
- PSM → `QueueModel` (copy-on-write, frozen in dev, no persistence calls); `SessionStore`
  port carved (WebKit-detach preserved); persistence dedupe keyed on `queueId` not
  reference.
- **Exit**: P14 identity rider flips green both transports; masks persist across restart
  (new scenario rider on P12); PSM mask/adaptation test files absorbed.

### 5b-PR3 — `feat(tts): sequencer epochs + dev-assert; sequenced fallback & dragnet`
- `TaskContext{signal, epoch}`; guards converted; watchdog; dev-assert that only sequenced
  tasks mutate status/queue; fallback = one sequenced `recoverWithLocalProvider` task
  (replay-once, max-retry); dragnet enqueued with timestamp check inside;
  `_Concurrency`/`_Critical`/predictability files absorbed into sequencer invariants.
- **Exit**: dev-assert green across the whole suite (proves no unsequenced mutation
  remains); P19/P20/P21 green.

### 5b-PR4 — `refactor(tts): decompose APS behind the frozen contract`
- `PlaybackController`/`AnalysisApplier`/`MediaMetadataPublisher`/`DragnetGesture`
  extracted (order: publisher → session-restore → applier → dragnet, APS stays façade);
  then `WorkerTtsEngine` constructs the controller directly and **`AudioPlayerService.ts`
  is deleted**; flight-recorder kernel extraction + `exportDiagnostics` + DiagnosticsTab
  cutover; remaining ledger rows for `AudioPlayerService_*` deleted.
- **Exit**: APS file gone; parity green; DiagnosticsTab shows worker data (component test
  with fake handle); `clearPauseGesture` removed from `TtsEngine`, ReaderView, useTTS.

### 5b-PR5 — `feat(tts): settings/playback store split + tts-settings v1 migration`
- The split, `TtsController`, `useAudioCommands`, replication `TTSSettingsData` payload,
  echo-loop tests, captured-blob migration suite, `'local'` id mapping,
  `mainThreadAudioPlayer` import ban.
- **Pre-condition (rule 4)**: no other user-data format change in its straggler window —
  coordinate with P3/P4 status before merging.
- **Exit (5b complete, shippable)**: v3-blob fixtures migrate green; no-echo test green;
  `lib/tts` has **zero** store imports (depcruise error flip); `getState()` count in
  `lib/tts` = 0; engine-dir `vi.mock` allowlist shrinks to ∅ (ports replace the dbService/
  LexiconService mocks).

### 5c-PR1 — `feat(cfi): canonical kernel with property-based equivalence`
- `src/lib/cfi/` move + `cfiContains`/`stripCfiWrapper` + parsed-oracle + fast-check
  property suites; ACP/TAP inline copies replaced (the `['/', '!', ':']` bug dies).
- **Exit**: property suites green (≥10k cases seeded); a characterization test shows the
  ACP grouping change is strictly a fix (fixture with assertion-bracket child CFIs).

### 5c-PR2 — `refactor(tts): SectionQueueBuilder + detector strategy`
- Pipeline split per 5c.2; readerUI write moved to host; markers+sentences travel
  together; telemetry injected; `ensureGenAIReady`; DEV-gated mock seam; ACP test files
  absorbed.
- **Exit**: `AudioContentPipeline.ts` deleted (or reduced to a re-export shim with a named
  P6 deadline if ReaderTTSController still imports types); detector tests assert
  marker-present-on-primary-path.

### 5c-PR3 — `feat(tts): LexiconEngine + lazy Bible JSON`
- 5c.3 in full; bundle assertion: entry chunk no longer contains bible-lexicon (size
  check in the existing worker-chunk/bundle test harness); golden audio-cache-key test.
- **Exit**: lexicon suites consolidated; assembler memo hit-rate test; mid-playback rule
  edit takes effect (new behavioral test).

### 5c-PR4 — `refactor(ingestion): extractor relocation + raw-at-rest v3`
- 5c.1; extraction-version CI comparison on composed-accent/CJK fixtures; old-row
  retention test.
- **Exit (5c + Phase 5 complete)**: all strangler exit criteria from the proposal hold —
  expanded parity suite green on both transports over real Comlink; per-bug TTS files
  deleted with ledger closed; `AudioPlayerService.ts` deleted; `lib/tts` zero store
  imports (error-level); provider contract suite green ×6; worker-chunk assertion green.
  **On-device QA pass** (Android + iOS Safari: lock screen, background keep-alive,
  fallback, dragnet, gapless Capacitor handoff) before the phase is declared done —
  these cannot be exercised headlessly.

---

## Test plan

**Pins that exist and must stay green throughout** (characterization spine):
- `engineParity.{inprocess,worker}.test.ts` (the gate suite after expansion) — the
  worker leg is the production wiring minus OS threads.
- Provider behavioral suites (8 files, incl. the 416-line Capacitor Smart-Handoff suite —
  explicitly a keeper), `BaseCloudProvider.registry.test.ts`.
- `citation-skipping.integration.test.ts` (real EPUB, three publisher styles) — never
  consolidated.
- `replication.test.ts` + `createWorkerEngineClient.hostCommands.test.ts` — these two
  make replication/host-command drift impossible during 5b; they are updated in lockstep
  with `TTSSettingsData` (loud failure by design).
- NFKD regression tests from commit `4197dcab` (extended in 5c-PR4).
- Worker-chunk purity check (P0) — guards every 5b/5c PR against zustand/yjs leaking into
  the worker graph.

**New suites, in entry-gate-first order**:
1. Gate PR: parity P12–P23; harness `host.*` seams; tts-storage fixture capture.
2. 5a: `describeProviderContract` (shared, parameterized ×6 with `FakeAudioSink`);
   per-provider non-1.0 speed tests; piper served-worker smoke; offline-catalog test.
3. 5b: sequencer invariant suite (epoch/abort/watchdog + absorbed concurrency cases);
   `QueueModel` immutability suite (dev-freeze + identity); snapshot-channel ordering test
   (seq monotonicity over a flooded MessageChannel); no-echo replication test; captured
   v1/v2/v3 blob migration suite; DiagnosticsTab-reads-worker component test.
4. 5c: CFI property/equivalence suites (fast-check, seeded); detector
   marker-path test; lexicon golden cache-key test; extraction-version CFI-comparison CI
   job on composed-accent/ligature/CJK fixtures.

**Fixture needs** (all captured before the code that consumes them changes):
- `tts-storage` v1/v2/v3 localStorage blobs (gate PR; v3 captured from live store, v1/v2
  hand-derived from the migration chain `useTTSStore.ts:446-469`).
- A `cache_session_state` row with stale `isSkipped` flags (drives P12's cleanup pin).
- Composed-accent (`é` NFC), ligature (`ﬁ`), and zh sample sections for extraction
  comparison (extend the `4197dcab` fixtures).
- Patched-worker anchor strings frozen from `scripts/patch_piper_worker.js:25-94` before
  deletion (feeds the served-worker smoke test).
- A piper `voices.json` snapshot + one tiny ONNX model stub for the offline-catalog test
  (Cache API seeded, network blocked).
- Assertion-bracket/range-comma CFI fixtures for `cfiContains` (the ACP `['/', '!', ':']`
  bug's counterexamples).

**vi.mock policy**: allowlist `{@db/DBService, ../LexiconService, ../PlatformIntegration}`
inside `src/lib/tts/engine/` from the gate PR; shrinks to empty at 5b-PR5 (ports + fakes
replace them); `vi.mock` banned in `src/lib/tts/providers/` from 5a-PR2 (the suites
already use injected fakes — verify, then flip).

---

## Risks

| Risk | Specifics | Mitigation |
|---|---|---|
| **Decomposition regresses playback invisibly** (the 197-commit god file; register row 5) | The behaviors most at risk — restore, masks, dragnet, fallback — are exactly the per-bug-file fossil record | Hard entry gate (23×2 scenarios) before any internals change; per-PR ledger review; flight recorder gains worker export *early* in 5b-PR4 so field regressions are capturable; on-device QA pass at 5b-PR4 and phase exit |
| **tts-storage split loses settings** (paid API keys, downloaded-voice profiles) | partialize at `useTTSStore.ts:472-490` has 19 fields with three legacy migrations feeding it | Captured real-blob fixtures (v1/v2/v3) gate the migration; old key never deleted in the same release; `'local'`→platform mapping tested on both platforms; rule-4 sequencing vs P3/P4 format changes |
| **Vendoring breaks Piper on some platform** (worker URL/ONNX path assumptions; Android WebView asset serving) | `piper-utils` worker construction + cdnjs removal change load paths | Same runtime URL layout (`/piper/**`) preserved; served-worker CI smoke; Cache API store untouched (existing downloads keep working — explicit test); Android Docker E2E nightly includes a Piper synthesis smoke |
| **GPL/provenance gate blocks the vendoring PR** | espeak-ng commit unknown (inventory N6); checking blobs into git makes Versicle the distributor more visibly | PROVENANCE.md records the gap honestly (it already exists in inventory.json); GPL-3.0-or-later posture already covers it; rebuild-from-pinned-commits stays a recorded long-term item, not a Phase 5 blocker |
| **Snapshot channel changes UI timing** (flicker class) | `isPlaying` derivation + download-state merge move homes; Comlink reordering | `seq` monotonic drop rule; the flicker workaround pinned as a named regression selector test; P23 broadcast-identity scenario |
| **Echo-loop fix starves the worker of a setting it silently relied on** | `plain(getState())` today ships *everything*, incl. fields nobody declared | `WorkerEngineContext` already throws on never-replicated reads (loud-by-design); run the full parity + pipeline suites against `TTSSettingsData`; one grep-audit of `ctx.config.getSettings()` field accesses feeds the payload type (compiler enforces via `satisfies`) |
| **Sequencer epochs deadlock or over-cancel** (pause behind slow synthesis was the *point* of detached writes) | watchdog + `bumpEpoch` interplay with the WebKit detached persistence | Detached-write policy preserved verbatim on the `SessionStore` port (tested); epoch bumps only from the three named commands; sequencer invariant suite includes a hung-task watchdog case |
| **Phase-2/3/4 churn under this design** | P2 is mid-flight in this very tree; P3 renames dbService surfaces; P4 may move store files | All work expressed against ports (`SessionStore` wraps whatever `dbService`/repo exists); line pins re-verified at phase start (header rule); the only hard cross-phase coupling is rule-4 sequencing for 5b-PR5 |
| **Test absorption silently drops an assertion** | 31 files retired | Ledger is the merge checklist; coverage ratchet (P0 baseline) cannot decrease; deletions only co-landed with named regression blocks |

---

## Dependencies

**Phase 5 needs from earlier phases (all landed at HEAD unless noted):**
- P0: speed-at-sink + alignment unification (R1/R2 — 5a builds on, doesn't implement);
  NFKD fix-forward + `TTS_EXTRACTION_VERSION` (R5); worker-chunk purity check; license
  gate + inventory (gates 5a-PR3); coverage baseline; typed test harness.
- P1: types/tts.ts split (R7); host adapters in `src/app/tts/` (R8); path aliases; boot
  task registry (R9 — `TtsController.initialize` registers as a boot task); the §1.18
  veto record (5a-PR3 closes it).
- P2 (in flight): `whenHydrated()` — `LexiconService.getRules` awaits `waitForYjsSync()`
  (`LexiconService.ts:47`); 5c's `LexiconAssembler` must consume P2's final hydration
  signal. **Not otherwise coupled** — TTS settings are localStorage, not CRDT.
- P3 (storage gateway): *soft* dependency — `SessionStore`/`TTSCache`/flight-recorder IDB
  writes migrate to `data/` repos and the navigator.locks write-gate when P3 lands; 5b
  designs against ports so either order works. The audio-cache **LRU eviction job is P3
  scope** (C1), not Phase 5 — do not implement it here.
- P4: none (no sync surface in TTS).

**Later phases need from Phase 5:**
- **P6 (reader)** is *gated on 5c's CFI kernel* (roadmap edge): `lib/cfi/` canonical
  algebra + `cfiContains`/`stripCfiWrapper` + equivalence-test pattern; also the
  `MeasuredOverlay`-adjacent highlight expectations (TTS highlight layer moves under
  `HighlightLayerManager` in P6 — the snapshot channel's `activeCfi` is its input).
- **P7 (library/egress)**: `SentenceExtractor` at `lib/ingestion/` (5c-PR4) feeds the one
  `extractBook()`; the NFKD re-ingestion *driver* (extractionVersion-driven job queue) is
  P7's; cloud-fetch AbortController/timeouts hand over to C9 NetworkGateway destinations;
  `GenAIClient` replaces the 5c-PR2 stub seam; per-provider byte counters (CostEstimator's
  replacement) come from the gateway.
- **P8 (shell/settings)**: settings registry renders the provider panel from the 5a
  registry; `LiveAnnouncer` wires to `PlaybackSnapshot` status transitions; keyboard-arrow
  gating reads `useTTSPlaybackStore.status`.
- **P9 (deletion audit)**: retires the `tts-storage` legacy key, the `'local'` alias
  acceptance, and any 5c re-export shims; verifies the ledger closed and the engine-dir
  `vi.mock` allowlist is empty.
