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
| 2 | `AudioPlayerService.predictability.test.ts` | unsubscribed-listener never fires; playlist no-clobber on double `setBookId`; loadSection race | P17/P18 + sequencer invariants | 5b-PR3 | ⏳ |
| 3 | `AudioPlayerService_Predictability_Fix.test.ts` | loadSectionBySectionId stale-book no-op | P18 — `describe('regression: AudioPlayerService_Predictability_Fix')` | **gate PR** | ✅ this commit |
| 4 | `AudioPlayerService_Concurrency.test.ts` | rapid play executes once; stop-after-play wins | `TaskSequencer` invariant suite (epoch tests) | 5b-PR3 | ⏳ |
| 5 | `AudioPlayerService_Critical.test.ts` | setQueue not aborted by immediate play | same | 5b-PR3 | ⏳ |
| 6 | `AudioPlayerService_AnalysisUpdate.test.ts` | duplicate-analysis single-enqueue | P16 — `describe('regression: AudioPlayerService_AnalysisUpdate')` | **gate PR** | ✅ this commit |
| 7 | `AudioPlayerService_ReactiveSubscription.test.ts` | mask/adaptation on store success; ignore non-success/foreign-section | P14/P15/P16 + `AnalysisApplier` unit suite | 5b-PR4 | ⏳ |
| 8 | `AudioPlayerService_RestoreAnalysis.test.ts` | analysis re-trigger on restore | P12 — `describe('regression: AudioPlayerService_RestoreAnalysis')` | **gate PR** | ✅ this commit |
| 9 | `AudioPlayerService_Resume.test.ts` | paused speed-change restart | P22 — `describe('regression: AudioPlayerService_Resume')` | **gate PR** | ✅ this commit |
| 10 | `AudioPlayerService_LanguageSync.test.ts` | proactive language sync + lexicon invalidation on book change | parity rider on P12 + `PlaybackController` unit suite | 5b-PR4 | ⏳ |
| 11 | `AudioPlayerService_MediaSession.test.ts` | all handlers registered incl. seekto; position state during cloud playback | `MediaMetadataPublisher` unit suite | 5b-PR4 | ⏳ |
| 12 | `AudioPlayerService_StateProtection.test.ts` | no reading-state writes when sectionIndex === −1 | `PlaybackController` unit suite + P12 rider | 5b-PR4 | ⏳ |
| 13 | `engine/AudioPlayerService.isolated.test.ts` | fake-driven smoke incl. dragnet | superseded by P19/P20 (same fakes) | 5b-PR4 | ⏳ |
| 14 | `PlaybackStateManager_Masking.test.ts` / `PlaybackStateManager_Adaptation.test.ts` | mask semantics, adaptation anchor/sibling rules | `QueueModel` unit suite (immutable snapshots) + P14/P15 | 5b-PR2 | ⏳ |
| 15 | `TaskSequencer_Predictability.test.ts`, `TaskSequencer.test.ts` | FIFO, error isolation | extended sequencer suite (cancellation added; merge, not delete-without-absorb) | 5b-PR3 | ⏳ |
| 16 | `TTSProviderManager.test.ts` | event normalization, fallback observable outcome | `describeProviderContract` + new manager suite | 5a-PR3 | ⏳ |
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
| P14 identity (post-mask queue is a fresh array) | `engineParityScenarios.ts`, in-process leg | 5b-PR2 (immutable `QueueModel`) |
| P21 single-replay (fallback replays the failed sentence exactly once) | both legs | 5a-PR2/5a-PR3 (single failure path) |

## vi.mock allowlist (phase5 doc N3)

`src/lib/tts/engine/**` may mock exactly `{@db/DBService, ../LexiconService,
../PlatformIntegration}` plus `@app/tts/createWorkerEngineClient` (enforced by
`no-restricted-syntax` in `eslint.config.js`). The fourth entry is the N1 inverted
lib→app edge, mocked only by `WorkerEngineHandle.test.ts` — it leaves the directory
(and the allowlist) at **5b-PR1** when `WorkerEngineHandle` moves to `src/app/tts/`.
The doc's three-module core shrinks to **∅ at 5b-PR5** when the `SessionStore`/lexicon
ports land. `vi.mock` in `src/lib/tts/providers/**` is banned from 5a-PR2.
