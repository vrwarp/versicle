# Phase 5 test-absorption ledger

The reviewer checklist for constitution rule 8 (`plan/overhaul/README.md` §4): **a per-bug
test file is deleted only in the same commit that lands its surviving assertions as a named
`describe('regression: <file stem>')` block in the owning suite**, and the Phase 0 coverage
baseline (`coverage-baseline.json`) never decreases.

Source of truth for the rows: `plan/overhaul/prep/phase5-tts-strangler.md` §0.3. This file is
the *live* copy — each deletion PR flips its row's Status to ✅ with the commit hash. P9
verifies the ledger is closed.

Owning suites:

- **Parity** = `src/lib/tts/engine/engineParityScenarios.ts` (P1–P23), run over both
  transports by `engineParity.{inprocess,worker}.test.ts`.
- Unit suites named below (QueueModel, sequencer invariants, …) are created by the 5a/5b/5c
  PRs that own them.

| # | Legacy file (`src/lib/tts/`) | Durable behavior | Absorbed into | Deleted in | Status |
|---|---|---|---|---|---|
| 1 | `AudioPlayerService.test.ts` | preroll title in queue items, subscribe-snapshot semantics, restore/queue basics | P12/P17 + `describe('regression: AudioPlayerService.test')` in `engine/PlaybackController.test.ts` (preroll/subscribe/book-switch/completed) and `engine/MediaMetadataPublisher.test.ts` (calculateBookProgress); grouping-logic cases were already duplicated in `AudioContentPipeline_Grouping.test.ts` | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 2 | `AudioPlayerService.predictability.test.ts` | unsubscribed-listener never fires; playlist no-clobber on double `setBookId`; loadSection race | P17/P18 + `describe('regression: AudioPlayerService.predictability')` in the parity scenarios (loadSection-by-index race, both transports) and in `engineParity.inprocess.test.ts` (unsubscribe-before-replay pin) + sequencer invariants | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 3 | `AudioPlayerService_Predictability_Fix.test.ts` | loadSectionBySectionId stale-book no-op | P18 — `describe('regression: AudioPlayerService_Predictability_Fix')` | **gate PR** | ✅ this commit |
| 4 | `AudioPlayerService_Concurrency.test.ts` | rapid play executes once; stop-after-play wins | `TaskSequencer.test.ts` — `describe('regression: AudioPlayerService_Concurrency')` (serialized FIFO last-wins; stop-after-play via epoch bump + checkpoint); engine-level routing pinned by parity P7 + the pause/stop scenarios | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 5 | `AudioPlayerService_Critical.test.ts` | setQueue not aborted by immediate play | `TaskSequencer.test.ts` — `describe('regression: AudioPlayerService_Critical')` (no preemption between tasks; second setQueue waits, last wins) | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 6 | `AudioPlayerService_AnalysisUpdate.test.ts` | duplicate-analysis single-enqueue | P16 — `describe('regression: AudioPlayerService_AnalysisUpdate')` | **gate PR** | ✅ this commit |
| 7 | `AudioPlayerService_ReactiveSubscription.test.ts` | mask/adaptation on store success; ignore non-success/foreign-section | P14/P15/P16 + `describe('regression: AudioPlayerService_ReactiveSubscription')` in `engine/AnalysisApplier.test.ts` | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 8 | `AudioPlayerService_RestoreAnalysis.test.ts` | analysis re-trigger on restore | P12 — `describe('regression: AudioPlayerService_RestoreAnalysis')` | **gate PR** | ✅ this commit |
| 9 | `AudioPlayerService_Resume.test.ts` | paused speed-change restart | P22 — `describe('regression: AudioPlayerService_Resume')` | **gate PR** | ✅ this commit |
| 10 | `AudioPlayerService_LanguageSync.test.ts` | proactive language sync + lexicon invalidation on book change | `describe('regression: AudioPlayerService_LanguageSync')` in `engine/PlaybackController.test.ts` | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 11 | `AudioPlayerService_MediaSession.test.ts` | all handlers registered incl. seekto; position state during cloud playback | `describe('regression: AudioPlayerService_MediaSession')` in `engine/MediaMetadataPublisher.test.ts` (position state, unified builder) + the all-seven-platform-callbacks pin in `engine/PlaybackController.test.ts`; the navigator.mediaSession handler registration itself is PlatformIntegration's own suite | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 12 | `AudioPlayerService_StateProtection.test.ts` | no reading-state writes when sectionIndex === −1 | `describe('regression: AudioPlayerService_StateProtection')` in `engine/PlaybackController.test.ts` | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 13 | `engine/AudioPlayerService.isolated.test.ts` | fake-driven smoke incl. dragnet | superseded by P19/P20 (same fakes) + the fake-driven `engine/PlaybackController.test.ts` | 5b-PR4 | ✅ 5b-PR4 (decomposition commit) |
| 14 | `PlaybackStateManager_Masking.test.ts` / `PlaybackStateManager_Adaptation.test.ts` | mask semantics, adaptation anchor/sibling rules | `QueueModel.test.ts` (the renamed PSM base suite) carries `describe('regression: PlaybackStateManager_Masking')` + `describe('regression: PlaybackStateManager_Adaptation')` verbatim, plus the new immutability/identity suite; behavior also pinned by P14/P15 | 5b-PR2 | ✅ 5b-PR2 |
| 15 | `TaskSequencer_Predictability.test.ts`, `TaskSequencer.test.ts` | FIFO, error isolation | extended `TaskSequencer.test.ts` (epoch/abort/checkpoint/watchdog/isInsideTask invariants added; `_Predictability` merged as `describe('regression: TaskSequencer_Predictability')`) | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 16 | `TTSProviderManager.test.ts` | event normalization, fallback observable outcome | `describeProviderContract` (×5 at 5a-PR2; piper joins at 5a-PR3) + the new manager suite, which carries `describe('regression: TTSProviderManager.test (pre-5a)')`; the fallback double-fire case is superseded by the single-path manager tests + engine-level P21 (both transports) | 5a-PR2 (rewritten in place — landed one PR earlier than the row predicted, together with the contract suite it absorbs into) | ✅ 5a-PR2 |
| 17 | `AudioContentPipeline*.test.ts` ×7 | grouping, marker attribution, Bible, structural anomaly, table CFI, trigger analysis | `src/kernel/cfi/group.test.ts` (`regression: AudioContentPipeline_Grouping` / `_StructuralAnomaly` / `_MarkerAttribution`), `SectionQueueBuilder.test.ts` (`regression: AudioContentPipeline.test` loadSection + `_Bible`), `SectionAnalysisDriver.test.ts` (`regression: _TriggerAnalysis` + content filtering), `TableAdaptationProcessor.test.ts` (`regression: _TableCfi`) — plus the NEW D4 marker-on-primary-path pin and `ReferenceSectionDetector.test.ts` (retry/timeout machine, strategy, dedup, telemetry) | 5c-PR2 | ✅ 5c-PR2 (`refactor(tts): SectionQueueBuilder + detector strategy; pipeline dies`) |
| 18 | `LexiconService*.test.ts` ×7 | assembly order, initialisms, Bible injection, sort | `LexiconEngine.test.ts` (`regression: LexiconService.test` / `LexiconServiceSort` / `LexiconServiceBible` / `LexiconServiceInitialisms` over the injected-deps assembler, plus the memo/invalidation + golden cache-key suites); fuzz/perf/trace survive as `LexiconEngine.{fuzz,perf,trace}.test.ts` companions over the yjs-free applier | 5c-PR3 (one PR earlier than the row predicted — absorbed together with the assembler it tests) | ✅ 5c-PR3 (`feat(tts): LexiconEngine + lazy Bible JSON`) |
| 19 | `TextSegmenter*.test.ts` ×9 | segmentation/refinement/merge behavior | consolidated `TextSegmenter.test.ts` (six per-area suites carried as `describe('regression: TextSegmenter.<stem>')` blocks) + `.fuzz`/`.perf` companions — 3 files | 5c-PR2 | ✅ 5c-PR2 (`refactor(tts): SectionQueueBuilder + detector strategy; pipeline dies`) |
| 20 | `citation-skipping.integration.test.ts` | three publisher markup styles | **kept as-is** (real-EPUB integration; explicit keeper) | never | n/a |

Also keepers (never absorbed): `BaseCloudProvider.registry.test.ts`, the 6 per-provider
suites, and the `CapacitorTTSProvider.test.ts` Smart-Handoff suite — the cross-provider
`describeProviderContract` (5a-PR2) lands *beside* them.

## Gate-PR riders (executable spec, `it.fails` until their fix PR)

| Rider | Where | Flips green in |
|---|---|---|
| P14 identity (post-mask queue is a fresh array) | `engineParityScenarios.ts`, in-process leg | ✅ FLIPPED at 5b-PR2 (immutable `QueueModel`: copy-on-write mask/adaptation, fresh `queueId` per content change, DEV-frozen arrays) — un-marked `it.fails` in the same commit. The same PR replaced the positional listener with the single `PlaybackSnapshot{seq, queueId}` channel, and the P23 worker pin was updated from fresh-clone-per-broadcast to identity-preserving broadcasts (queue attached only on queueId change) |
| P21 single-replay (fallback replays the failed sentence exactly once) | both legs | ✅ FLIPPED at 5a-PR2 (single failure path: providers reject once, manager rethrows `ProviderPlaybackError` without self-swap, engine recovers via one sequenced task) — un-marked `it.fails` in the same commit |

## vi.mock allowlist (phase5 doc N3, rewritten post-P3)

**ZERO since 5b-PR4** (the decomposition commit): every `vi.mock`/`vi.doMock` in
`src/lib/tts/engine/**` is a lint error (`no-restricted-syntax` in
`eslint.config.js`). The four-module core ({@data/repos/bookContent,
@data/repos/playbackCache, ../LexiconService, ../PlatformIntegration}) was replaced
by EngineContext ports: `BookContentPort` + `SessionStore` (injected in-memory fakes
from `engine/parityHostDb.ts` / `FakeEngineContext`; the worker leg injects through
the `WorkerTtsEngine` constructor ports; production defaults to the repo-backed
implementations in `engine/repoPorts.ts`). The `../LexiconService` and
`../PlatformIntegration` entries were already vestigial — nothing in the engine
graph imports either module (lexicon reads go through `ctx.lexicon`, the platform
through the injected `MediaPlatformFactory`). The former fifth entry
(`@app/tts/createWorkerEngineClient`, the N1 inverted lib→app edge mocked only by
`WorkerEngineHandle.test.ts`) **left the directory and the allowlist at 5b-PR1**.
`vi.mock` in `src/lib/tts/providers/**` is banned from 5a-PR2.

**5a-PR2 note**: the providers-dir ban is live in `eslint.config.js` with exactly two
allowlisted modules — `@capacitor-community/text-to-speech` (a registered native plugin
with no injection seam; the providers-dir analogue of the engine-dir PlatformIntegration
entry) and `./piper-utils` (PiperProvider's module-global synthesis path, leaves the
allowlist at 5a-PR3 when the injectable `PiperRuntime` replaces it). The cloud-provider
suites were converted from `vi.mock('../AudioElementPlayer'/'../TTSCache')` to injected
fakes (`FakeAudioSink` + constructor-injected caches) in the same commit.

**Post-P3 rewrite note** (merge of the gate branch into the post-Phase-3 tree): the
doc's N3 inventory and the gate branch as authored froze `@db/DBService` — but Phase 3
(P3-12) deleted `src/db` entirely and the engine graph now imports the `src/data`
repos directly (`bookContent.getSections/getTTSPreparation/getTableImages/
getBookStructure`, `playbackCache.getSession/saveQueue/savePauseTime`). The single
`@db/DBService` allowlist entry was therefore rewritten at merge time into the two
repo modules that replaced it; the shared parity seam
(`src/lib/tts/engine/parityHostDb.ts`) now fabricates `bookContent`/`playbackCache`
repo surfaces instead of a `dbService` object. The freeze discipline and all shrink
deadlines above are unchanged — the entries were renamed, not widened (one module
became the two that P3 split it into; no new mockable surface was added).

## Ledger closed — Phase 5 exit (5c-PR4, 2026-06-11)

All 19 absorbable rows are ✅ (row 20, `citation-skipping.integration.test.ts`,
is the explicit keeper — n/a by design). Both gate-PR `it.fails` riders flipped
green (P14 at 5b-PR2, P21 at 5a-PR2). The engine-dir and providers-dir
`vi.mock` bans hold (engine allowlist ∅ since 5b-PR4). Net vitest file count
at Phase 5 exit: 274 (vs the Phase 0 baseline of 246) — and that 274
*includes* every contract/parity/kernel/fixture suite Phases 2–5 added; the
TTS tree itself retired the ~31 ledger files (5c alone: 286→274 across its
four commits) while keeping every surviving assertion under a named
`describe('regression: …')` block.
P9 re-verifies this document and retires it.
