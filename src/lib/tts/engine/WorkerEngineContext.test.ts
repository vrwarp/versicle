import { describe, it, expect, vi } from 'vitest';
import { WorkerEngineContext, type EngineHostCommand } from './WorkerEngineContext';
import type { SectionAnalysis, TTSSettingsData, GenAISettingsSnapshot } from './EngineContext';

function makeCtx() {
    const commands: EngineHostCommand[] = [];
    const ctx = new WorkerEngineContext({ post: (c) => commands.push(c), platformName: 'web' });
    return { ctx, commands };
}

describe('WorkerEngineContext (replicated-state context for the worker)', () => {
    it('serves synchronous getters from pushed snapshots', () => {
        const { ctx } = makeCtx();

        ctx.applyUpdate({ kind: 'settings', settings: { customAbbreviations: ['Dr.'] } as TTSSettingsData });
        ctx.applyUpdate({ kind: 'genAI', settings: { isEnabled: true } as GenAISettingsSnapshot });
        ctx.applyUpdate({ kind: 'activeLanguage', lang: 'fr' });
        ctx.applyUpdate({ kind: 'bookLanguage', bookId: 'b1', lang: 'de' });
        ctx.applyUpdate({ kind: 'progress', bookId: 'b1', progress: { currentQueueIndex: 4 } as never });

        expect(ctx.config.getSettings().customAbbreviations).toEqual(['Dr.']);
        expect(ctx.genAI.getSettings().isEnabled).toBe(true);
        expect(ctx.config.getActiveLanguage()).toBe('fr');
        expect(ctx.book.getBookLanguage('b1')).toBe('de');
        expect(ctx.book.getBookLanguage('unknown')).toBe('en');
        expect(ctx.readingState.getProgress('b1')).toEqual({ currentQueueIndex: 4 });
        expect(ctx.config.getDefaultMinSentenceLength('zh-CN')).toBe(6);
    });

    it('throws a clear error if a snapshot is read before replication', () => {
        const { ctx } = makeCtx();
        expect(() => ctx.config.getSettings()).toThrow(/never replicated/);
    });

    it('serves content analysis from the pushed snapshot', () => {
        const { ctx } = makeCtx();
        const analysis = { status: 'success', generatedAt: 1 } as SectionAnalysis;
        ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: { 'b1/s1': analysis } } });
        expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBe(analysis);
        expect(ctx.contentAnalysis.getSnapshot().sections['b1/s1']).toBe(analysis);
    });

    describe('regression: a single-entry analysis delta merges into the cached snapshot', () => {
        // The host pushes a DELTA when one section's analysis changed, instead of deep-cloning
        // and structured-cloning the whole cross-book `sections` map on every content-analysis
        // write (including the worker's own markAnalysisLoading / saveTableAdaptations echoes).
        it('replaces the keyed entry, keeps the others, and fires listeners once', () => {
            const { ctx } = makeCtx();
            const s1 = { status: 'success', generatedAt: 1 } as SectionAnalysis;
            const s2 = { status: 'success', generatedAt: 1 } as SectionAnalysis;
            ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: { 'b1/s1': s1, 'b1/s2': s2 } } });

            const listener = vi.fn();
            ctx.contentAnalysis.subscribe(listener);

            const s1b = { status: 'success', generatedAt: 2 } as SectionAnalysis;
            ctx.applyUpdate({ kind: 'analysis', key: 'b1/s1', analysis: s1b });

            expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBe(s1b);
            // The untouched entry survives — a delta merges, it does not replace the cache.
            expect(ctx.contentAnalysis.getAnalysis('b1', 's2')).toBe(s2);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].sections['b1/s2']).toBe(s2);
            expect(listener.mock.calls[0][0]).toBe(ctx.contentAnalysis.getSnapshot());
        });

        it('serves a delta that arrives before any full snapshot', () => {
            const { ctx } = makeCtx();
            const s1 = { status: 'success', generatedAt: 1 } as SectionAnalysis;
            ctx.applyUpdate({ kind: 'analysis', key: 'b1/s1', analysis: s1 });
            expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBe(s1);
        });
    });

    describe('regression: a book-scoped analysis map replaces only that book', () => {
        // The host's live subscription is scoped to the OPEN book, so its multi-change
        // fallback carries that book's map — but the map form used to replace the WHOLE
        // cache. Every other book's boot-replicated entries went with it, and a book switch
        // pushes language + progress only (never analysis), so they never came back: the
        // AnalysisApplier then found nothing on section load and neither applied nor cleared
        // the skip mask and table adaptations.
        const boot = () => {
            const { ctx } = makeCtx();
            const entries = {
                s1: { status: 'success', generatedAt: 1 } as SectionAnalysis,
                s2: { status: 'success', generatedAt: 1 } as SectionAnalysis,
                other: { status: 'success', generatedAt: 1 } as SectionAnalysis,
            };
            ctx.applyUpdate({
                kind: 'analysis',
                snapshot: { sections: { 'b1/s1': entries.s1, 'b1/s2': entries.s2, 'b2/s9': entries.other } },
            });
            return { ctx, entries };
        };

        it('keeps the other books while replacing the named book, deletions included', () => {
            const { ctx, entries } = boot();
            const s1b = { status: 'success', generatedAt: 2 } as SectionAnalysis;

            // Two of b1's entries changed in one store write and b1/s2 went away.
            ctx.applyUpdate({ kind: 'analysis', bookId: 'b1', snapshot: { sections: { 'b1/s1': s1b } } });

            expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBe(s1b);
            expect(ctx.contentAnalysis.getAnalysis('b1', 's2'), 'the scoped map is authoritative for its own prefix').toBeUndefined();
            expect(ctx.contentAnalysis.getAnalysis('b2', 's9'), "another book's entries survive").toBe(entries.other);
        });

        it('clearing the open book empties only that book', () => {
            const { ctx, entries } = boot();
            ctx.applyUpdate({ kind: 'analysis', bookId: 'b1', snapshot: { sections: {} } });

            expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBeUndefined();
            expect(ctx.contentAnalysis.getAnalysis('b2', 's9')).toBe(entries.other);
        });

        it('an UNSCOPED map is still the cross-book boot snapshot — a full replace', () => {
            const { ctx } = makeCtx();
            const s1 = { status: 'success', generatedAt: 1 } as SectionAnalysis;
            ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: { 'b1/s1': s1 } } });
            ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: {} } });
            expect(ctx.contentAnalysis.getSnapshot()).toEqual({ sections: {} });
        });
    });

    it('routes writes and side effects outbound as host commands', () => {
        const { ctx, commands } = makeCtx();

        ctx.readingState.updateTTSProgress('b1', 2, 1);
        ctx.readingState.addCompletedRange('b1', 'cfi(/4)', 'tts');
        ctx.readingState.updatePlaybackPosition('b1', 'cfi(/6)');
        ctx.annotations.add({ bookId: 'b1', cfiRange: 'r', type: 'audio-bookmark', text: 't', color: '#fff' } as never);
        ctx.notifications.showToast('hi', 'info');
        ctx.readerUI.setCurrentSection('Chapter 1', 's1');
        ctx.config.setActiveLanguage('ja');

        expect(commands).toEqual([
            { kind: 'updateTTSProgress', bookId: 'b1', queueIndex: 2, sectionIndex: 1 },
            { kind: 'addCompletedRange', bookId: 'b1', cfiRange: 'cfi(/4)', type: 'tts' },
            { kind: 'updatePlaybackPosition', bookId: 'b1', lastPlayedCfi: 'cfi(/6)' },
            { kind: 'addAnnotation', annotation: { bookId: 'b1', cfiRange: 'r', type: 'audio-bookmark', text: 't', color: '#fff' } },
            { kind: 'showToast', message: 'hi', type: 'info' },
            { kind: 'setCurrentSection', title: 'Chapter 1', sectionId: 's1' },
            { kind: 'setActiveLanguage', lang: 'ja' },
        ]);
        // setActiveLanguage also optimistically updates the local cache.
        expect(ctx.config.getActiveLanguage()).toBe('ja');
    });

    it('fires subscribers when the matching slice is replicated', () => {
        const { ctx } = makeCtx();
        const genAI = vi.fn();
        const book = vi.fn();
        const analysis = vi.fn();
        ctx.genAI.subscribe(genAI);
        ctx.book.subscribe(book);
        ctx.contentAnalysis.subscribe(analysis);

        ctx.applyUpdate({ kind: 'genAI', settings: {} as GenAISettingsSnapshot });
        ctx.applyUpdate({ kind: 'bookLanguage', bookId: 'b1', lang: 'de' });
        ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: {} } });
        // activeLanguage update must NOT spuriously fire the others.
        ctx.applyUpdate({ kind: 'activeLanguage', lang: 'fr' });

        expect(genAI).toHaveBeenCalledTimes(1);
        expect(book).toHaveBeenCalledTimes(1);
        expect(analysis).toHaveBeenCalledTimes(1);
    });

    it('reports platform identity and proxies async battery checks', async () => {
        const commands: EngineHostCommand[] = [];
        const ctx = new WorkerEngineContext({
            post: (c) => commands.push(c),
            platformName: 'android',
            isBatteryOptimizationEnabled: async () => true,
        });
        expect(ctx.platform.getPlatform()).toBe('android');
        expect(ctx.platform.isNativePlatform()).toBe(true);
        expect(await ctx.platform.isBatteryOptimizationEnabled()).toBe(true);
    });
});
