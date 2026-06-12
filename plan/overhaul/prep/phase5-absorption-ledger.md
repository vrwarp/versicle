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
| 1 | `AudioPlayerService.test.ts` | preroll title in queue items, subscribe-snapshot semantics, restore/queue basics | P12/P17 + `QueueModel` unit suite | 5b-PR4 | ⏳ |
| 2 | `AudioPlayerService.predictability.test.ts` | unsubscribed-listener never fires; playlist no-clobber on double `setBookId`; loadSection race | P17/P18 + `describe('regression: AudioPlayerService.predictability')` in the parity scenarios (loadSection-by-index race, both transports) and in `engineParity.inprocess.test.ts` (unsubscribe-before-replay pin) + sequencer invariants | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 3 | `AudioPlayerService_Predictability_Fix.test.ts` | loadSectionBySectionId stale-book no-op | P18 — `describe('regression: AudioPlayerService_Predictability_Fix')` | **gate PR** | ✅ this commit |
| 4 | `AudioPlayerService_Concurrency.test.ts` | rapid play executes once; stop-after-play wins | `TaskSequencer.test.ts` — `describe('regression: AudioPlayerService_Concurrency')` (serialized FIFO last-wins; stop-after-play via epoch bump + checkpoint); engine-level routing pinned by parity P7 + the pause/stop scenarios | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 5 | `AudioPlayerService_Critical.test.ts` | setQueue not aborted by immediate play | `TaskSequencer.test.ts` — `describe('regression: AudioPlayerService_Critical')` (no preemption between tasks; second setQueue waits, last wins) | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 6 | `AudioPlayerService_AnalysisUpdate.test.ts` | duplicate-analysis single-enqueue | P16 — `describe('regression: AudioPlayerService_AnalysisUpdate')` | **gate PR** | ✅ this commit |
| 7 | `AudioPlayerService_ReactiveSubscription.test.ts` | mask/adaptation on store success; ignore non-success/foreign-section | P14/P15/P16 + `AnalysisApplier` unit suite | 5b-PR4 | ⏳ |
| 8 | `AudioPlayerService_RestoreAnalysis.test.ts` | analysis re-trigger on restore | P12 — `describe('regression: AudioPlayerService_RestoreAnalysis')` | **gate PR** | ✅ this commit |
| 9 | `AudioPlayerService_Resume.test.ts` | paused speed-change restart | P22 — `describe('regression: AudioPlayerService_Resume')` | **gate PR** | ✅ this commit |
| 10 | `AudioPlayerService_LanguageSync.test.ts` | proactive language sync + lexicon invalidation on book change | parity rider on P12 + `PlaybackController` unit suite | 5b-PR4 | ⏳ |
| 11 | `AudioPlayerService_MediaSession.test.ts` | all handlers registered incl. seekto; position state during cloud playback | `MediaMetadataPublisher` unit suite | 5b-PR4 | ⏳ |
| 12 | `AudioPlayerService_StateProtection.test.ts` | no reading-state writes when sectionIndex === −1 | `PlaybackController` unit suite + P12 rider | 5b-PR4 | ⏳ |
| 13 | `engine/AudioPlayerService.isolated.test.ts` | fake-driven smoke incl. dragnet | superseded by P19/P20 (same fakes) | 5b-PR4 | ⏳ |
| 14 | `PlaybackStateManager_Masking.test.ts` / `PlaybackStateManager_Adaptation.test.ts` | mask semantics, adaptation anchor/sibling rules | `QueueModel.test.ts` (the renamed PSM base suite) carries `describe('regression: PlaybackStateManager_Masking')` + `describe('regression: PlaybackStateManager_Adaptation')` verbatim, plus the new immutability/identity suite; behavior also pinned by P14/P15 | 5b-PR2 | ✅ 5b-PR2 |
| 15 | `TaskSequencer_Predictability.test.ts`, `TaskSequencer.test.ts` | FIFO, error isolation | extended `TaskSequencer.test.ts` (epoch/abort/checkpoint/watchdog/isInsideTask invariants added; `_Predictability` merged as `describe('regression: TaskSequencer_Predictability')`) | 5b-PR3 | ✅ 5b-PR3 (sequencer-epochs commit) |
| 16 | `TTSProviderManager.test.ts` | event normalization, fallback observable outcome | `describeProviderContract` (×5 at 5a-PR2; piper joins at 5a-PR3) + the new manager suite, which carries `describe('regression: TTSProviderManager.test (pre-5a)')`; the fallback double-fire case is superseded by the single-path manager tests + engine-level P21 (both transports) | 5a-PR2 (rewritten in place — landed one PR earlier than the row predicted, together with the contract suite it absorbs into) | ✅ 5a-PR2 |
| 17 | `AudioContentPipeline*.test.ts` ×7 | grouping, marker attribution, Bible, structural anomaly, table CFI, trigger analysis | `SectionQueueBuilder` / `ReferenceSectionDetector` / `CfiGrouper` suites | 5c-PR2/3 | ⏳ |
| 18 | `LexiconService*.test.ts` ×7 | assembly order, initialisms, Bible injection, sort | `LexiconEngine` suite (fuzz/perf survive as `.fuzz`/`.perf` companions) | 5c-PR4 | ⏳ |
| 19 | `TextSegmenter*.test.ts` ×9 | segmentation/refinement/merge behavior | consolidated `TextSegmenter` spec (3 files: spec/fuzz/perf) | 5c-PR2 | ⏳ |
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

`src/lib/tts/engine/**` may mock exactly `{@data/repos/bookContent,
@data/repos/playbackCache, ../LexiconService, ../PlatformIntegration}` (enforced by
`no-restricted-syntax` in `eslint.config.js`). The former fifth entry
(`@app/tts/createWorkerEngineClient`, the N1 inverted lib→app edge mocked only by
`WorkerEngineHandle.test.ts`) **left the directory and the allowlist at 5b-PR1** —
`WorkerEngineHandle` (+ its test) now lives in `src/app/tts/` and the engine dir no
longer references `app/` at all. The four-module core shrinks to **∅ when the
`SessionStore`/lexicon ports land** — the doc scheduled that with the store-split PR,
but the split (5b-PR3 as landed) shipped without the ports, so the shrink deadline
rides the remaining 5b engine work (sequencer/decomposition half). `vi.mock` in
`src/lib/tts/providers/**` is banned from 5a-PR2.

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
