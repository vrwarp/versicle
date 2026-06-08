import { describe, it, expect, vi } from 'vitest';
import { WorkerEngineContext, type EngineHostCommand } from './WorkerEngineContext';
import type { SectionAnalysis, TTSSettingsSnapshot, GenAISettingsSnapshot } from './EngineContext';

function makeCtx() {
    const commands: EngineHostCommand[] = [];
    const ctx = new WorkerEngineContext({ post: (c) => commands.push(c), platformName: 'web' });
    return { ctx, commands };
}

describe('WorkerEngineContext (replicated-state context for the worker)', () => {
    it('serves synchronous getters from pushed snapshots', () => {
        const { ctx } = makeCtx();

        ctx.applyUpdate({ kind: 'settings', settings: { customAbbreviations: ['Dr.'] } as TTSSettingsSnapshot });
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
        expect(() => ctx.config.getSettings()).toThrow(/not yet replicated/);
    });

    it('serves content analysis from the pushed snapshot', () => {
        const { ctx } = makeCtx();
        const analysis = { status: 'success', generatedAt: 1 } as SectionAnalysis;
        ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: { 'b1/s1': analysis } } });
        expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBe(analysis);
        expect(ctx.contentAnalysis.getSnapshot().sections['b1/s1']).toBe(analysis);
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
