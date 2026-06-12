/**
 * The engine behavioral contract, written once and run against BOTH transports:
 *   - in-process: AudioPlayerService driven directly (engineParity.inprocess.test.ts)
 *   - worker:     the same engine behind WorkerTtsEngine over a MessageChannel + Comlink
 *                 (engineParity.worker.test.ts) — the exact wiring of the production worker,
 *                 minus OS-thread isolation.
 *
 * Identical assertions on both sides are the parity guarantee for the bridge: any behavioral
 * drift between the transports fails one side of the suite. Scenarios poll with vi.waitFor so
 * the same code tolerates the worker transport's async message hops.
 *
 * ## Phase 5 entry gate (plan/overhaul/prep/phase5-tts-strangler.md §0)
 *
 * Scenarios P1–P11 are the original suite, kept verbatim. P12–P23 expand the contract to the
 * behaviors the 5a/5b/5c strangler touches: restore, skip masks, table adaptations, section
 * navigation, dragnet capture, provider fallback, analysis dedup, and queue identity. They pin
 * CURRENT behavior, not desired behavior — with one documented exception written as an
 * `it.fails` rider (the executable spec for the P5b fix; do NOT make it pass early):
 *
 *   - P14 identity rider (in-process): `applySkippedMask` mutates the queue array in place
 *     (PlaybackStateManager.ts applySkippedMask) — flips green at 5b-PR2 (immutable QueueModel).
 *
 * The P21 single-replay rider flipped green at 5a-PR2: providers signal a failure exactly
 * once (reject-only), the manager rethrows typed without self-swapping, and the engine
 * recovers through one sequenced `recoverWithLocalProvider` task — the S2 double-fire
 * (and its double replay) is structurally dead.
 *
 * Absorption (README §4 rule 8): the named `describe('regression: …')` blocks below carry the
 * surviving assertions of per-bug suites deleted in the same commit. See
 * plan/overhaul/prep/phase5-absorption-ledger.md for the full ledger.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TTSVoice } from '../providers/types';
import type { TTSQueueItem } from '../AudioPlayerService';
import { generateCfiRange, mergeCfiSlow } from '../../cfi-utils';

export interface ParitySnapshot {
    status: string;
    index: number;
    queueLen: number;
    error: string | null;
}

/** A seeded cache_tts_preparation sentence row (bookContent.getTTSPreparation). */
export interface ParitySentence {
    text: string;
    cfi: string;
    /** Raw extraction indices — the currency of skip masks (detectContentSkipMask). */
    sourceIndices?: number[];
}

/** A seeded section row (bookContent.getSections). */
export interface ParitySection {
    sectionId: string;
    title?: string;
    characterCount?: number;
}

/** The analysis payload pushed by host.pushAnalysisSuccess (snapshot + fetched row). */
export interface ParityAnalysisSeed {
    generatedAt: number;
    referenceStartCfi?: string;
    tableAdaptations?: Array<{ rootCfi: string; text: string }>;
}

/** The genAI settings slice the engine reads (subset of GenAISettingsSnapshot). */
export interface ParityGenAISeed {
    isEnabled: boolean;
    isContentAnalysisEnabled?: boolean;
    isTableAdaptationEnabled?: boolean;
    contentFilterSkipTypes?: string[];
}

/** Book metadata fields the engine reads on restore/resume. */
export interface ParityBookMetadataSeed {
    title?: string;
    author?: string;
    lastPlayedCfi?: string;
    lastPauseTime?: number;
}

export interface ParityAnnotation {
    bookId: string;
    cfiRange: string;
    type: string;
    text: string;
}

export interface ParityHarness {
    /** Which transport this harness drives — riders differ per transport (P14/P23). */
    transport: 'in-process' | 'worker';
    engine: {
        setQueue(items: TTSQueueItem[], startIndex: number): Promise<void> | void;
        play(): Promise<void>;
        pause(): Promise<void> | void;
        stop(): Promise<void> | void;
        jumpTo(index: number): Promise<void> | void;
        setVoice(voiceId: string): Promise<void> | void;
        setSpeed(speed: number): Promise<void> | void;
        setProviderById(providerId: string): Promise<void> | void;
        getVoices(): Promise<TTSVoice[]>;
        // --- Phase 5 gate extensions (§0.1) ---
        setBookId(bookId: string | null): Promise<void> | void;
        loadSection(index: number, autoPlay?: boolean): Promise<void> | void;
        /** Fire-and-forget on both transports — P18 depends on NOT awaiting completion. */
        loadSectionBySectionId(sectionId: string, autoPlay?: boolean): void;
        skipToNextSection(): Promise<boolean>;
        skipToPreviousSection(): Promise<boolean>;
        clearPauseGesture(): Promise<void> | void;
    };
    backend: {
        played(): Array<{ text: string; voiceId: string; speed: number }>;
        pauseCount(): number;
        stopCount(): number;
        providerIds(): string[];
        setVoices(voices: TTSVoice[]): void;
        // --- Phase 5 gate extensions (§0.1) ---
        /**
         * Arm the backend so the next play() on a non-'local' provider REJECTS once with a
         * `ProviderPlaybackError`-named error — TTSProviderManager's single failure path
         * (5a-PR2): no self-swap, no synthetic 'fallback' event; the engine recovers via
         * one sequenced task and swaps through setProviderById.
         */
        failNextPlay(error: { message: string }): void;
        /** Provider id the backend reports after a fallback swap ('local' initially). */
        activeProviderId(): string;
        /** playEarcon capture (dragnet feedback). */
        earcons(): string[];
    };
    /**
     * Host-state seams (§0.1): fakes in-process; replicated updates / host-port maps on the
     * worker. Async seams return promises the scenarios await so replication lands before the
     * engine reads it.
     */
    host: {
        seedTTSState(bookId: string, queue: TTSQueueItem[]): void;
        seedProgress(bookId: string, queueIndex: number, sectionIndex: number): Promise<void> | void;
        seedSections(bookId: string, sections: ParitySection[]): void;
        seedTTSContent(bookId: string, sectionId: string, sentences: ParitySentence[]): void;
        /** Make bookContent.getTTSPreparation REJECT for this section (an unloadable section). */
        failTTSContent(bookId: string, sectionId: string): void;
        /** Defer bookContent.getSections(bookId) until the returned release fn is called (P18). */
        gateSections(bookId: string): () => void;
        seedBookMetadata(bookId: string, metadata: ParityBookMetadataSeed): void;
        setGenAISettings(settings: ParityGenAISeed): Promise<void> | void;
        /** Publish a status:'success' analysis: snapshot subscription + fetched row together. */
        pushAnalysisSuccess(bookId: string, sectionId: string, analysis: ParityAnalysisSeed): Promise<void> | void;
        /** Annotations the engine wrote (dragnet capture sink). */
        annotations(): ParityAnnotation[];
        /** Calls to the contentAnalysis.getContentAnalysis host port (P16 dedup observable). */
        analysisFetchCount(bookId: string, sectionId: string): number;
        /** Calls to bookContent.getTTSPreparation for this section (P18 staleness observable). */
        contentFetchCount(bookId: string, sectionId: string): number;
    };
    /** Fire provider events into the engine (crosses the boundary on the worker transport). */
    fireStart(): Promise<void> | void;
    fireEnd(): Promise<void> | void;
    fireError(error: { message: string }): Promise<void> | void;
    /** All status broadcasts received so far. */
    snapshots(): ParitySnapshot[];
    /** The queue delivered with each broadcast, in order (identity assertions, P14/P23). */
    queueRefs(): ReadonlyArray<ReadonlyArray<TTSQueueItem>>;
    /** Advance the engine-visible wall clock (Date only; see advanceParityClock). */
    advanceTime(ms: number): void;
    dispose(): void | Promise<void>;
}

/**
 * Shared advanceTime implementation: fake ONLY `Date` (vi.waitFor keeps real timers) and move
 * the system clock forward. Harnesses call vi.useRealTimers() in dispose().
 */
export function advanceParityClock(ms: number): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + ms));
}

const QUEUE: TTSQueueItem[] = [
    { text: 'First sentence of the parity suite.', cfi: 'cfi-0', sourceIndices: [0] },
    { text: 'Second sentence of the parity suite.', cfi: 'cfi-1', sourceIndices: [1] },
];

// ---------------------------------------------------------------------------
// CFI fixtures for the analysis scenarios (P12/P14/P15/P16).
//
// groupSentencesByRoot (AudioContentPipeline) groups sentences by getParentCfi and emits a
// Range-CFI root per group via generateCfiRange(first, last) — so the seeded
// `referenceStartCfi` below is computed with the SAME exported helpers, keeping the fixture
// robust to CFI formatting. Parents: /4/2 (body), /4/4/2 (table), /4/6 (references) — none is
// a path-prefix of another, so each is its own group.
// ---------------------------------------------------------------------------
const CFI_BODY = 'epubcfi(/6/4!/4/2/1:0)';
const CFI_TABLE_A = 'epubcfi(/6/4!/4/4/2/1:0)';
const CFI_TABLE_B = 'epubcfi(/6/4!/4/4/4/1:0)';
const CFI_REF_HEAD = 'epubcfi(/6/4!/4/6/1:0)';
const CFI_REF_ITEM = 'epubcfi(/6/4!/4/6/1:32)';
/** A point CFI covering both table sentences by path prefix (mapSentencesToAdaptations). */
const TABLE_ROOT = 'epubcfi(/6/4!/4/4)';
/** The reference group's rootCfi exactly as groupSentencesByRoot finalizes it. */
const REF_GROUP_ROOT = generateCfiRange(CFI_REF_HEAD, CFI_REF_ITEM);

const SENT_BODY: ParitySentence = { text: 'Body paragraph of the chapter under test.', cfi: CFI_BODY };
const SENT_TABLE_A: ParitySentence = { text: 'Table cell alpha contents.', cfi: CFI_TABLE_A };
const SENT_TABLE_B: ParitySentence = { text: 'Table cell beta contents.', cfi: CFI_TABLE_B };
const SENT_REF_HEAD: ParitySentence = { text: 'References', cfi: CFI_REF_HEAD };
const SENT_REF_ITEM: ParitySentence = { text: '[1] A citation entry nobody wants narrated.', cfi: CFI_REF_ITEM };

const SECTION: ParitySection = { sectionId: 'sec-1', title: 'Chapter 1', characterCount: 240 };

const queueFromSentences = (sentences: ParitySentence[], staleSkipIndices: number[] = []): TTSQueueItem[] =>
    sentences.map((s, i) => ({
        text: s.text,
        cfi: s.cfi,
        sourceIndices: [i],
        isSkipped: staleSkipIndices.includes(i),
    }));

const GENAI_DISABLED: ParityGenAISeed = { isEnabled: false };
const GENAI_REFERENCE_FILTER: ParityGenAISeed = {
    isEnabled: true,
    isContentAnalysisEnabled: true,
    isTableAdaptationEnabled: false,
    contentFilterSkipTypes: ['reference'],
};

export function describeEngineParity(
    transport: string,
    makeHarness: () => Promise<ParityHarness>,
    kind: 'in-process' | 'worker',
): void {
    describe(`engine behavioral parity [${transport}]`, () => {
        async function withHarness(run: (h: ParityHarness) => Promise<void>) {
            const h = await makeHarness();
            try {
                await run(h);
            } finally {
                await h.dispose();
            }
        }

        /**
         * Seed everything a restorable book needs: sections, TTS content, a persisted queue
         * (cache_session_state) and reading progress. Returns the queue it seeded.
         */
        async function seedRestorableBook(
            h: ParityHarness,
            bookId: string,
            opts: {
                sentences?: ParitySentence[];
                staleSkipIndices?: number[];
                queueIndex?: number;
            } = {},
        ): Promise<TTSQueueItem[]> {
            const sentences = (opts.sentences ?? [SENT_BODY, SENT_REF_HEAD, SENT_REF_ITEM])
                .map((s, i) => ({ ...s, sourceIndices: [i] }));
            const queue = queueFromSentences(sentences, opts.staleSkipIndices ?? []);
            h.host.seedSections(bookId, [SECTION]);
            h.host.seedTTSContent(bookId, SECTION.sectionId, sentences);
            h.host.seedTTSState(bookId, queue);
            await h.host.seedProgress(bookId, opts.queueIndex ?? 0, 0);
            return queue;
        }

        /** Wait for a broadcast whose queue satisfies the predicate; returns that queue. */
        async function waitForQueue(
            h: ParityHarness,
            predicate: (q: ReadonlyArray<TTSQueueItem>) => boolean,
        ): Promise<ReadonlyArray<TTSQueueItem>> {
            let match: ReadonlyArray<TTSQueueItem> | undefined;
            await vi.waitFor(() => {
                match = [...h.queueRefs()].reverse().find(predicate);
                expect(match).toBeDefined();
            });
            return match!;
        }

        it('play() synthesizes the current queue item through the backend', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                expect(h.backend.played()[0].text).toContain('First sentence');
            }));

        it("the provider's start event drives the status to 'playing'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));

                await h.fireStart();
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'playing')).toBe(true));
            }));

        it("the provider's end event advances to the next item and synthesizes it", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));

                await h.fireStart();
                await h.fireEnd();

                await vi.waitFor(() => expect(h.backend.played().length).toBe(2));
                expect(h.backend.played()[1].text).toContain('Second sentence');
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.index === 1)).toBe(true));
            }));

        it("finishing the last item completes the queue (status 'completed')", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 1);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));

                await h.fireStart();
                await h.fireEnd();

                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'completed')).toBe(true));
            }));

        it("pause() reaches the backend and broadcasts 'paused'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.engine.pause();
                await vi.waitFor(() => expect(h.backend.pauseCount()).toBe(1));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
            }));

        it("stop() reaches the backend and broadcasts 'stopped'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.engine.stop();
                await vi.waitFor(() => expect(h.backend.stopCount()).toBeGreaterThan(0));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'stopped')).toBe(true));
            }));

        it('jumpTo() plays the selected item', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.jumpTo(1);

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                const last = h.backend.played()[h.backend.played().length - 1];
                expect(last.text).toContain('Second sentence');
            }));

        it('a provider error stops playback and surfaces the error to subscribers', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.fireError({ message: 'synthesis exploded' });

                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'stopped')).toBe(true));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.error?.includes('synthesis exploded'))).toBe(true));
            }));

        it('getVoices() round-trips the backend voice list', () =>
            withHarness(async (h) => {
                h.backend.setVoices([{ id: 'v1', name: 'Voice 1', lang: 'en-US', provider: 'local' }]);

                const voices = await h.engine.getVoices();
                expect(voices).toEqual([{ id: 'v1', name: 'Voice 1', lang: 'en-US', provider: 'local' }]);
            }));

        it('setVoice() + setSpeed() shape the next synthesis call', () =>
            withHarness(async (h) => {
                await h.engine.setVoice('voice-9');
                await h.engine.setSpeed(1.5);
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                const call = h.backend.played()[0];
                expect(call.voiceId).toBe('voice-9');
                expect(call.speed).toBe(1.5);
            }));

        it('setProviderById() routes the provider id (plain data) to the backend', () =>
            withHarness(async (h) => {
                await h.engine.setProviderById('google');
                await vi.waitFor(() => expect(h.backend.providerIds()).toContain('google'));
            }));

        // ===================================================================
        // P12 — restore: setBookId + persisted TTS state + progress
        // ===================================================================
        describe('P12 restore', () => {
            it('restores the persisted queue at the saved index and clears stale isSkipped flags', () =>
                withHarness(async (h) => {
                    const bookId = 'book-restore';
                    await h.host.setGenAISettings(GENAI_DISABLED);
                    const seeded = await seedRestorableBook(h, bookId, {
                        staleSkipIndices: [0],
                        queueIndex: 1,
                    });

                    await h.engine.setBookId(bookId);

                    // Queue restored with the persisted length, at the saved queue index.
                    const restored = await waitForQueue(h, (q) => q.length === seeded.length);
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.index === 1 && s.queueLen === seeded.length)).toBe(true));

                    // Stale flags persisted by a prior session are cleared on restore
                    // (AudioPlayerService.restoreQueue stale-isSkipped cleanup) — with genAI
                    // disabled nothing re-applies them, so the end state is fully unskipped.
                    expect(restored.map((q) => q.isSkipped ?? false)).toEqual(seeded.map(() => false));
                }));

            describe('regression: AudioPlayerService_RestoreAnalysis', () => {
                it('re-triggers content analysis on restore: skip mask and table adaptations land asynchronously', () =>
                    withHarness(async (h) => {
                        const bookId = 'book-restore-analysis';
                        // Order matters: genAI must be enabled before setBookId so the
                        // restore-time triggerAnalysis sees the enabled settings.
                        await h.host.setGenAISettings({
                            isEnabled: true,
                            isContentAnalysisEnabled: true,
                            isTableAdaptationEnabled: true,
                            contentFilterSkipTypes: ['reference'],
                        });
                        const sentences = [SENT_BODY, SENT_TABLE_A, SENT_REF_HEAD, SENT_REF_ITEM];
                        await seedRestorableBook(h, bookId, { sentences, staleSkipIndices: [0] });
                        // The persisted analysis row the pipeline fetches (NOT the snapshot):
                        // a reference start at the references group + one table adaptation.
                        await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, {
                            generatedAt: Date.now(),
                            referenceStartCfi: REF_GROUP_ROOT,
                            tableAdaptations: [{ rootCfi: TABLE_ROOT, text: 'Adapted table summary.' }],
                        });

                        await h.engine.setBookId(bookId);

                        // The restore-time analysis re-trigger (restoreQueue → triggerAnalysis)
                        // must asynchronously apply BOTH the reference skip mask and the cached
                        // table adaptation — this absorbs the deleted suite's
                        // detectContentSkipMask/processTableAdaptations spy assertions as
                        // observable behavior.
                        const final = await waitForQueue(h, (q) =>
                            q.length === 4 &&
                            q[2].isSkipped === true &&
                            q[3].isSkipped === true &&
                            q[1].text === 'Adapted table summary.');
                        expect(final[0].isSkipped ?? false).toBe(false); // stale flag stays cleared
                        expect(final[1].isSkipped ?? false).toBe(false); // adaptation anchor is audible
                    }));
            });
        });

        // ===================================================================
        // P13 — restore-resume: lastPlayedCfi + lastPauseTime
        // ===================================================================
        it('P13 restore-resume: first play() resumes at the saved lastPlayedCfi index', () =>
            withHarness(async (h) => {
                const bookId = 'book-resume';
                await h.host.setGenAISettings(GENAI_DISABLED);
                const seeded = await seedRestorableBook(h, bookId, { queueIndex: 0 });
                h.host.seedBookMetadata(bookId, {
                    title: 'Resumable Book',
                    lastPlayedCfi: seeded[2].cfi!,
                    lastPauseTime: Date.now() - 60_000,
                });

                await h.engine.setBookId(bookId);
                await waitForQueue(h, (q) => q.length === seeded.length);

                await h.engine.play();

                // playInternal's restore branch jumps to the saved CFI's index and (because
                // lastPauseTime is set) resumes there instead of starting at index 0.
                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                expect(h.backend.played()[0].text).toBe(seeded[2].text);
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.index === 2)).toBe(true));
            }));

        // ===================================================================
        // P14 — skip mask: analysis push ⇒ mask ⇒ advance exclusion
        // ===================================================================
        describe('P14 skip mask', () => {
            async function pushReferenceMask(h: ParityHarness, bookId: string): Promise<void> {
                await h.host.setGenAISettings(GENAI_REFERENCE_FILTER);
                await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, {
                    generatedAt: Date.now(),
                    referenceStartCfi: REF_GROUP_ROOT,
                });
            }

            it('applies the pushed mask, broadcasts it, and excludes skipped items from advance', () =>
                withHarness(async (h) => {
                    const bookId = 'book-mask';
                    await h.host.setGenAISettings(GENAI_DISABLED);
                    await seedRestorableBook(h, bookId);
                    await h.engine.setBookId(bookId);
                    await waitForQueue(h, (q) => q.length === 3);

                    await pushReferenceMask(h, bookId);

                    // Mask applied + re-broadcast: the references group (indices 1,2) is
                    // skipped, the body sentence stays audible.
                    const masked = await waitForQueue(h, (q) =>
                        q.length === 3 && q[1].isSkipped === true && q[2].isSkipped === true);
                    expect(masked[0].isSkipped ?? false).toBe(false);

                    // Skipped items are excluded from advance: after the body sentence ends,
                    // there is no next visible item and no next section, so the queue
                    // completes without ever synthesizing the masked items.
                    await h.engine.play();
                    await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                    expect(h.backend.played()[0].text).toBe(SENT_BODY.text);
                    await h.fireStart();
                    await h.fireEnd();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'completed')).toBe(true));
                    expect(h.backend.played().length).toBe(1);
                }));

            if (kind === 'in-process') {
                // DOCUMENTED it.fails RIDER (5b-PR2 executable spec): applySkippedMask mutates
                // the live queue array in place (PlaybackStateManager.applySkippedMask), so the
                // post-mask broadcast delivers the SAME array reference. The immutable
                // QueueModel (copy-on-write) flips this rider green in 5b-PR2.
                it.fails('identity rider: the post-mask queue is a fresh array (copy-on-write)', () =>
                    withHarness(async (h) => {
                        const bookId = 'book-mask-identity';
                        await h.host.setGenAISettings(GENAI_DISABLED);
                        await seedRestorableBook(h, bookId);
                        await h.engine.setBookId(bookId);
                        const restored = await waitForQueue(h, (q) => q.length === 3);

                        await pushReferenceMask(h, bookId);
                        const masked = await waitForQueue(h, (q) => q[1]?.isSkipped === true);

                        expect(masked).not.toBe(restored);
                    }));
            } else {
                it('worker rider: the mask triggers a re-broadcast across the boundary', () =>
                    withHarness(async (h) => {
                        const bookId = 'book-mask-rebroadcast';
                        await h.host.setGenAISettings(GENAI_DISABLED);
                        await seedRestorableBook(h, bookId);
                        await h.engine.setBookId(bookId);
                        await waitForQueue(h, (q) => q.length === 3);
                        const broadcastsBeforeMask = h.snapshots().length;

                        await pushReferenceMask(h, bookId);

                        // A NEW broadcast (fresh structured clone) carries the mask — the
                        // worker transport cannot mutate the main thread's arrays in place.
                        await waitForQueue(h, (q) => q[1]?.isSkipped === true);
                        expect(h.snapshots().length).toBeGreaterThan(broadcastsBeforeMask);
                    }));
            }
        });

        // ===================================================================
        // P15 — table adaptations: anchor replaced, siblings skipped
        // ===================================================================
        describe('P15 table adaptations', () => {
            const SENTENCES = [SENT_BODY, SENT_TABLE_A, SENT_TABLE_B];
            const ADAPTATION_SETTINGS: ParityGenAISeed = {
                isEnabled: true,
                isContentAnalysisEnabled: false,
                isTableAdaptationEnabled: true,
                contentFilterSkipTypes: [],
            };

            async function applyAdaptation(h: ParityHarness, bookId: string): Promise<ReadonlyArray<TTSQueueItem>> {
                await h.host.setGenAISettings(GENAI_DISABLED);
                await seedRestorableBook(h, bookId, { sentences: SENTENCES });
                await h.engine.setBookId(bookId);
                await waitForQueue(h, (q) => q.length === 3);

                await h.host.setGenAISettings(ADAPTATION_SETTINGS);
                await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, {
                    generatedAt: Date.now(),
                    tableAdaptations: [{ rootCfi: TABLE_ROOT, text: 'Adapted table summary.' }],
                });

                return waitForQueue(h, (q) => q[1]?.text === 'Adapted table summary.');
            }

            it('replaces the anchor item text and skips the sibling items of the table', () =>
                withHarness(async (h) => {
                    const adapted = await applyAdaptation(h, 'book-adapt');
                    expect(adapted[1].isSkipped ?? false).toBe(false); // anchor audible
                    expect(adapted[2].isSkipped).toBe(true);           // sibling collapsed into anchor
                    expect(adapted[0].text).toBe(SENT_BODY.text);      // body untouched
                }));

            it('disabling genAI clears the skip flags but keeps the adapted text (current behavior)', () =>
                withHarness(async (h) => {
                    const bookId = 'book-adapt-clear';
                    await applyAdaptation(h, bookId);

                    await h.host.setGenAISettings(GENAI_DISABLED);

                    // PINS CURRENT BEHAVIOR: the disable path re-applies an empty skip mask
                    // (which unskips the adaptation sibling) but applyTableAdaptations([])
                    // cannot restore the original anchor text — the replacement is permanent
                    // until the section reloads. 5b's immutable QueueModel revisits this.
                    // (The predicate requires the adapted text so it cannot match a stale
                    // pre-adaptation broadcast on the worker transport.)
                    const cleared = await waitForQueue(h, (q) =>
                        q.length === 3 &&
                        q[1].text === 'Adapted table summary.' &&
                        q[2].isSkipped === false);
                    expect(cleared[1].isSkipped ?? false).toBe(false);
                }));
        });

        // ===================================================================
        // P16 — analysis dedup: rapid duplicate pushes enqueue ONE reapplication
        // ===================================================================
        describe('regression: AudioPlayerService_AnalysisUpdate', () => {
            it('P16: rapid duplicate analysis pushes enqueue exactly one reapplication task', () =>
                withHarness(async (h) => {
                    const bookId = 'book-dedup';
                    await h.host.setGenAISettings(GENAI_DISABLED);
                    await seedRestorableBook(h, bookId);
                    await h.engine.setBookId(bookId);
                    await waitForQueue(h, (q) => q.length === 3);

                    await h.host.setGenAISettings(GENAI_REFERENCE_FILTER);
                    expect(h.host.analysisFetchCount(bookId, SECTION.sectionId)).toBe(0);

                    // Identical generatedAt on every push — the synchronous timestamp guard
                    // (handleContentAnalysisUpdate) must drop the duplicates before enqueueing.
                    const analysis: ParityAnalysisSeed = {
                        generatedAt: Date.now(),
                        referenceStartCfi: REF_GROUP_ROOT,
                    };
                    await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, analysis);
                    await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, analysis);
                    await h.host.pushAnalysisSuccess(bookId, SECTION.sectionId, analysis);

                    // The single reapplication lands (mask visible) …
                    await waitForQueue(h, (q) => q[1]?.isSkipped === true);
                    // … and the analysis host port was consulted exactly once.
                    expect(h.host.analysisFetchCount(bookId, SECTION.sectionId)).toBe(1);
                }));
        });

        // ===================================================================
        // P17 — section navigation
        // ===================================================================
        describe('P17 section navigation', () => {
            const NAV_BOOK = 'book-nav';
            async function seedNavBook(h: ParityHarness): Promise<void> {
                await h.host.setGenAISettings(GENAI_DISABLED);
                h.host.seedSections(NAV_BOOK, [
                    { sectionId: 'sec-a', title: 'Alpha', characterCount: 120 },
                    { sectionId: 'sec-b', title: 'Broken', characterCount: 120 },
                    { sectionId: 'sec-c', title: 'Charlie', characterCount: 120 },
                ]);
                h.host.seedTTSContent(NAV_BOOK, 'sec-a', [
                    { text: 'Alpha section sentence.', cfi: CFI_BODY },
                ]);
                // sec-b is unloadable (content read rejects): loadSectionInternal returns
                // false for it, so navigation must skip OVER it.
                h.host.failTTSContent(NAV_BOOK, 'sec-b');
                h.host.seedTTSContent(NAV_BOOK, 'sec-c', [
                    { text: 'Charlie section sentence.', cfi: CFI_BODY },
                ]);
                await h.engine.setBookId(NAV_BOOK);
            }

            it('loadSection(i, autoPlay=false) loads the queue without starting playback', () =>
                withHarness(async (h) => {
                    await seedNavBook(h);
                    await h.engine.loadSection(0, false);

                    await waitForQueue(h, (q) => q.some((i) => i.text.includes('Alpha section')));
                    expect(h.backend.played().length).toBe(0);
                    expect(h.snapshots().some((s) => s.status === 'playing' || s.status === 'loading')).toBe(false);
                }));

            it('skipToNext/PreviousSection traverse sections, skip unloadable ones, and report the ends', () =>
                withHarness(async (h) => {
                    await seedNavBook(h);
                    await h.engine.loadSection(0, false);
                    await waitForQueue(h, (q) => q.some((i) => i.text.includes('Alpha section')));

                    // Forward: skips the broken middle section straight to Charlie.
                    await expect(h.engine.skipToNextSection()).resolves.toBe(true);
                    await waitForQueue(h, (q) => q.some((i) => i.text.includes('Charlie section')));

                    // Forward past the last section: reports false.
                    await expect(h.engine.skipToNextSection()).resolves.toBe(false);

                    // Backward: skips the broken section back to Alpha.
                    await expect(h.engine.skipToPreviousSection()).resolves.toBe(true);
                    await waitForQueue(h, (q) => q.some((i) => i.text.includes('Alpha section')));

                    // Backward past the first section: reports false.
                    await expect(h.engine.skipToPreviousSection()).resolves.toBe(false);
                }));
        });

        // ===================================================================
        // P18 — book-switch staleness
        // ===================================================================
        describe('regression: AudioPlayerService_Predictability_Fix', () => {
            it('P18: loadSectionBySectionId enqueued for book A is a no-op after setBookId(B) lands first', () =>
                withHarness(async (h) => {
                    await h.host.setGenAISettings(GENAI_DISABLED);
                    h.host.seedSections('book-A', [{ sectionId: 'sec-a1', title: 'A1' }]);
                    h.host.seedTTSContent('book-A', 'sec-a1', [{ text: 'Book A only sentence.', cfi: CFI_BODY }]);
                    h.host.seedSections('book-B', [{ sectionId: 'sec-b1', title: 'B1' }]);
                    h.host.seedTTSContent('book-B', 'sec-b1', [{ text: 'Book B sentence.', cfi: CFI_BODY }]);

                    // Hold book A's playlist load so the enqueued loadSectionBySectionId task
                    // is still parked on it when book B takes over.
                    const releaseA = h.host.gateSections('book-A');
                    await h.engine.setBookId('book-A');
                    h.engine.loadSectionBySectionId('sec-a1', false); // deliberately NOT awaited
                    await h.engine.setBookId('book-B');
                    releaseA();

                    // The stale task must bail on the originalBookId guard without touching the
                    // DB or the queue; book B keeps working normally afterwards.
                    await h.engine.loadSection(0, false);
                    await waitForQueue(h, (q) => q.some((i) => i.text.includes('Book B sentence')));
                    expect(h.host.contentFetchCount('book-A', 'sec-a1')).toBe(0);
                    expect(h.queueRefs().some((q) => q.some((i) => i.text.includes('Book A only')))).toBe(false);
                }));
        });

        // ===================================================================
        // P19 / P20 — dragnet capture
        // ===================================================================
        describe('P19 dragnet capture', () => {
            const DRAGNET_BOOK = 'book-dragnet';
            const DRAGNET_QUEUE: TTSQueueItem[] = [
                { text: 'First dragnet sentence.', cfi: CFI_BODY, sourceIndices: [0] },
                { text: 'Second dragnet sentence.', cfi: 'epubcfi(/6/4!/4/2/1:50)', sourceIndices: [1] },
            ];

            async function startDragnetPlayback(h: ParityHarness): Promise<void> {
                await h.host.setGenAISettings(GENAI_DISABLED);
                h.host.seedSections(DRAGNET_BOOK, []);
                await h.engine.setBookId(DRAGNET_BOOK);
                await h.engine.setQueue(DRAGNET_QUEUE, 0);
                await h.engine.jumpTo(1);
                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                await h.fireStart();
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'playing')).toBe(true));
            }

            it('pause → play within 5s captures ONE audio-bookmark with the merged CFI + earcon', () =>
                withHarness(async (h) => {
                    await startDragnetPlayback(h);

                    await h.engine.pause();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
                    await h.engine.play();

                    await vi.waitFor(() => expect(h.host.annotations().length).toBe(1));
                    const annotation = h.host.annotations()[0];
                    expect(annotation.bookId).toBe(DRAGNET_BOOK);
                    expect(annotation.type).toBe('audio-bookmark');
                    // The capture spans the previous + current sentence, with their CFIs merged.
                    expect(annotation.text).toBe('First dragnet sentence. Second dragnet sentence.');
                    expect(annotation.cfiRange).toBe(mergeCfiSlow(DRAGNET_QUEUE[0].cfi!, DRAGNET_QUEUE[1].cfi!));
                    await vi.waitFor(() =>
                        expect(h.backend.earcons()).toContain('bookmark_captured'));
                }));

            it('pause → more than 5s → play does NOT capture', () =>
                withHarness(async (h) => {
                    await startDragnetPlayback(h);

                    await h.engine.pause();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
                    h.advanceTime(5001 + 1000);
                    await h.engine.play();

                    // Playback resumes (a second synthesis happens) but no capture fires.
                    await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(1));
                    expect(h.host.annotations().length).toBe(0);
                    expect(h.backend.earcons()).not.toContain('bookmark_captured');
                }));

            it('P20 dragnet invalidation: clearPauseGesture between pause and play suppresses the capture', () =>
                withHarness(async (h) => {
                    await startDragnetPlayback(h);

                    await h.engine.pause();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
                    // The reader calls this synchronously on section navigation (useTTS):
                    // a chapter change between pause and play is navigation, not a resume
                    // gesture. Pinned here so 5b's DragnetGesture internalization (which
                    // deletes the ReaderView/useTTS call sites) cannot silently drop it.
                    await h.engine.clearPauseGesture();
                    await h.engine.play();

                    await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(1));
                    expect(h.host.annotations().length).toBe(0);
                    expect(h.backend.earcons()).not.toContain('bookmark_captured');
                }));
        });

        // ===================================================================
        // P21 — provider fallback
        // ===================================================================
        describe('P21 provider fallback', () => {
            async function driveFallback(h: ParityHarness): Promise<void> {
                await h.engine.setProviderById('google');
                await vi.waitFor(() => expect(h.backend.activeProviderId()).toBe('google'));
                await h.engine.setQueue(QUEUE, 0);
                h.backend.failNextPlay({ message: 'cloud synthesis quota exceeded' });
                await h.engine.play();
            }

            it('a failing cloud play falls back to the local provider and ends up playing', () =>
                withHarness(async (h) => {
                    await driveFallback(h);

                    // The engine replays the failed sentence via the swapped-in local provider.
                    await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThanOrEqual(2));
                    expect(h.backend.activeProviderId()).toBe('local');
                    const replay = h.backend.played()[h.backend.played().length - 1];
                    expect(replay.text).toContain('First sentence');

                    await h.fireStart();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'playing')).toBe(true));
                    // The fallback is recovery, not an error: nothing surfaced to subscribers.
                    expect(h.snapshots().some((s) => s.error !== null)).toBe(false);
                }));

            // Flipped green at 5a-PR2 (was the documented it.fails rider for the S2
            // double-fire): providers reject exactly once, the manager rethrows typed
            // without self-swapping, and the engine recovers through ONE sequenced
            // recoverWithLocalProvider task — so the failed sentence replays exactly
            // once (2 synthesis calls total, not the legacy 3).
            it('single-replay rider: the failed sentence is replayed exactly once', () =>
                withHarness(async (h) => {
                    await driveFallback(h);

                    await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThanOrEqual(2));
                    // Drain any trailing duplicate replay before counting.
                    await new Promise((r) => setTimeout(r, 50));
                    expect(h.backend.played().length).toBe(2);
                }));
        });

        // ===================================================================
        // P22 — speed change while paused
        // ===================================================================
        describe('regression: AudioPlayerService_Resume', () => {
            it('P22: setSpeed while paused restarts the current sentence at the new rate on the next play', () =>
                withHarness(async (h) => {
                    await h.engine.setQueue(QUEUE, 0);
                    await h.engine.play();
                    await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                    expect(h.backend.played()[0].speed).toBe(1.0);
                    await h.fireStart();

                    await h.engine.pause();
                    await vi.waitFor(() =>
                        expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));

                    await h.engine.setSpeed(2.0);
                    // Changing speed while paused must NOT restart playback by itself …
                    expect(h.backend.played().length).toBe(1);

                    // … but the next play resumes the SAME sentence with the new rate.
                    await h.engine.clearPauseGesture(); // keep the dragnet path out of this pin
                    await h.engine.play();
                    await vi.waitFor(() => expect(h.backend.played().length).toBe(2));
                    const replay = h.backend.played()[1];
                    expect(replay.text).toBe(h.backend.played()[0].text);
                    expect(replay.speed).toBe(2.0);
                }));
        });

        // ===================================================================
        // P23 — queue identity across broadcasts
        // ===================================================================
        describe('P23 queue identity across broadcasts', () => {
            async function driveStatusChurn(h: ParityHarness): Promise<void> {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'playing')).toBe(true));
                await h.engine.pause();
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
            }

            if (kind === 'in-process') {
                it('repeated status broadcasts deliver the SAME queue reference until a queue mutation', () =>
                    withHarness(async (h) => {
                        await driveStatusChurn(h);

                        const refs = h.queueRefs().filter((q) => q.length === QUEUE.length);
                        expect(refs.length).toBeGreaterThanOrEqual(3); // setQueue + status churn
                        for (const ref of refs) {
                            expect(ref).toBe(refs[0]);
                        }
                    }));
            } else {
                it('every broadcast re-delivers a content-equal queue (fresh clone per broadcast — the 5b-PR1 broadcast-diet target)', () =>
                    withHarness(async (h) => {
                        await driveStatusChurn(h);

                        const refs = h.queueRefs().filter((q) => q.length === QUEUE.length);
                        expect(refs.length).toBeGreaterThanOrEqual(3);
                        for (const ref of refs) {
                            // Content parity holds on every broadcast …
                            expect(ref.map((i) => ({ text: i.text, cfi: i.cfi }))).toEqual(
                                QUEUE.map((i) => ({ text: i.text, cfi: i.cfi })));
                        }
                        // … but the worker transport structured-clones a FRESH array each
                        // time (no cross-broadcast identity). PINS CURRENT BEHAVIOR: 5b-PR1's
                        // PlaybackSnapshot{queueId} introduces identity-preserving broadcasts
                        // and updates this pin.
                        expect(refs[1]).not.toBe(refs[0]);
                    }));
            }
        });
    });
}
