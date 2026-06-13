/**
 * AnalysisApplier unit suite (Phase 5b decomposition) — fake-driven, ZERO
 * vi.mock. Carries the named regression block for the deleted
 * AudioPlayerService_ReactiveSubscription.test.ts (absorption ledger row 7):
 * the reactive contentAnalysis subscription applies masks/adaptations on
 * success rows for the ACTIVE section only, deduplicated on the analysis
 * timestamp; parity P14/P15/P16 pin the same behavior end-to-end on both
 * transports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalysisApplier } from './AnalysisApplier';
import { FakeEngineContext } from './FakeEngineContext';
import { QueueModel } from '../QueueModel';
import { TaskSequencer } from '../TaskSequencer';
import type { SectionAnalysisDriver } from '../SectionAnalysisDriver';
import type { SectionAnalysis } from './EngineContext';
import type { SectionMetadata } from '~types/book';

function makeApplier() {
    const ctx = new FakeEngineContext();
    const queue = new QueueModel();
    const sequencer = new TaskSequencer();
    const detectContentSkipMask = vi.fn(async () => new Set<number>());
    const mapSentencesToAdaptations = vi.fn(() => [] as { indices: number[]; text: string }[]);
    const driver = {
        detectContentSkipMask,
        tableProcessor: { mapSentencesToAdaptations },
    } as unknown as SectionAnalysisDriver;

    let bookId: string | null = 'book-1';
    const playlist: SectionMetadata[] = [
        { sectionId: 'section-1', characterCount: 100 } as SectionMetadata,
    ];

    const applier = new AnalysisApplier({
        ctx,
        driver,
        queue,
        enqueue: (label, task) => sequencer.enqueue(label, task),
        getBookId: () => bookId,
        getSection: (i) => playlist[i],
    });
    applier.start();

    return {
        ctx, queue, sequencer, applier,
        detectContentSkipMask, mapSentencesToAdaptations,
        setBookId: (id: string | null) => { bookId = id; },
        seedActiveSection: () => {
            queue.setQueue([{ text: 'foo', cfi: 'cfi1', sourceIndices: [0] }], 0, 0);
        },
        pushAnalysis: (analysis: Partial<SectionAnalysis>) => {
            ctx.analyses['book-1/section-1'] = analysis as SectionAnalysis;
            ctx.emitAnalysisChange();
        },
        settle: () => new Promise((r) => setTimeout(r, 25)),
    };
}

const GENAI_ON = {
    isEnabled: true,
    isContentAnalysisEnabled: true,
    isTableAdaptationEnabled: true,
    contentFilterSkipTypes: ['reference'],
};

describe('AnalysisApplier', () => {
    describe('regression: AudioPlayerService_ReactiveSubscription', () => {
        let h: ReturnType<typeof makeApplier>;

        beforeEach(() => {
            h = makeApplier();
            h.ctx.genAISettings = GENAI_ON as never;
            h.ctx.ttsContent['book-1/section-1'] = { sentences: [{ text: 'foo', cfi: 'cfi1', sourceIndices: [0] }] };
            h.seedActiveSection();
        });

        it('applies skip mask and table adaptations when the store updates with success', async () => {
            const applyMaskSpy = vi.spyOn(h.queue, 'applySkippedMask');
            const applyAdaptSpy = vi.spyOn(h.queue, 'applyTableAdaptations');
            h.detectContentSkipMask.mockResolvedValue(new Set([0]));
            h.mapSentencesToAdaptations.mockReturnValue([{ indices: [0], text: 'Adapted table' }]);

            h.pushAnalysis({
                status: 'success',
                generatedAt: Date.now(),
                tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted table' }],
            });
            await h.settle();

            expect(h.detectContentSkipMask).toHaveBeenCalledWith('book-1', 'section-1', ['reference']);
            expect(applyMaskSpy).toHaveBeenCalled();
            expect(h.mapSentencesToAdaptations).toHaveBeenCalled();
            expect(applyAdaptSpy).toHaveBeenCalled();
        });

        it('does NOT process when the analysis status is not success', async () => {
            h.pushAnalysis({ status: 'loading', generatedAt: Date.now() });
            await h.settle();
            expect(h.detectContentSkipMask).not.toHaveBeenCalled();
        });

        it('does NOT process when the analysis is for a different section', async () => {
            h.ctx.analyses['book-1/section-DIFFERENT'] = {
                status: 'success',
                generatedAt: Date.now(),
                tableAdaptations: [{ rootCfi: 'cfi1', text: 'X' }],
            } as SectionAnalysis;
            h.ctx.emitAnalysisChange();
            await h.settle();
            expect(h.detectContentSkipMask).not.toHaveBeenCalled();
        });

        it('deduplicates updates with the same timestamp; a newer timestamp re-applies', async () => {
            const timestamp = Date.now();
            const analysis = {
                status: 'success' as const,
                generatedAt: timestamp,
                tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted' }],
            };

            h.pushAnalysis(analysis);
            await h.settle();
            expect(h.detectContentSkipMask).toHaveBeenCalledTimes(1);

            // Same timestamp — dropped synchronously, before any enqueue.
            h.pushAnalysis(analysis);
            await h.settle();
            expect(h.detectContentSkipMask).toHaveBeenCalledTimes(1);

            // Newer timestamp — processed.
            h.pushAnalysis({ ...analysis, generatedAt: timestamp + 1000 });
            await h.settle();
            expect(h.detectContentSkipMask).toHaveBeenCalledTimes(2);
        });

        it('does NOT process when no book is set', async () => {
            h.setBookId(null);
            h.pushAnalysis({ status: 'success', generatedAt: Date.now(), tableAdaptations: [] });
            await h.settle();
            expect(h.detectContentSkipMask).not.toHaveBeenCalled();
        });

        it('a genAI settings change resets the dedup and re-applies the cached analysis', async () => {
            const timestamp = Date.now();
            h.pushAnalysis({ status: 'success', generatedAt: timestamp, tableAdaptations: [] });
            await h.settle();
            expect(h.detectContentSkipMask).toHaveBeenCalledTimes(1);

            // Same timestamp, but a settings change must force re-application.
            h.ctx.emitGenAIChange();
            await h.settle();
            expect(h.detectContentSkipMask).toHaveBeenCalledTimes(2);
        });
    });
});
