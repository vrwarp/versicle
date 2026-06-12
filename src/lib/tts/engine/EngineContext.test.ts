import { describe, it, expect, vi } from 'vitest';
import { FakeEngineContext } from './FakeEngineContext';
import { SectionAnalysisDriver } from '../SectionAnalysisDriver';
import { TableAdaptationProcessor } from '../TableAdaptationProcessor';
import type { SectionAnalysis } from './EngineContext';

describe('FakeEngineContext', () => {
    it('round-trips the active language through config', () => {
        const ctx = new FakeEngineContext();
        expect(ctx.config.getActiveLanguage()).toBe('en');
        ctx.config.setActiveLanguage('zh');
        expect(ctx.config.getActiveLanguage()).toBe('zh');
    });

    it('applies locale-aware default minimum sentence length', () => {
        const ctx = new FakeEngineContext();
        expect(ctx.config.getDefaultMinSentenceLength('en-US')).toBe(36);
        expect(ctx.config.getDefaultMinSentenceLength('zh-CN')).toBe(6);
    });

    it('records reading-state writes instead of mutating global stores', () => {
        const ctx = new FakeEngineContext();
        ctx.readingState.updateTTSProgress('book-1', 3, 1);
        ctx.readingState.addCompletedRange('book-1', 'cfi(/4)', 'tts');
        ctx.readingState.updatePlaybackPosition('book-1', 'cfi(/6)');

        expect(ctx.ttsProgressWrites).toEqual([{ bookId: 'book-1', queueIndex: 3, sectionIndex: 1 }]);
        expect(ctx.completedRanges).toEqual([{ bookId: 'book-1', cfiRange: 'cfi(/4)', type: 'tts' }]);
        expect(ctx.playbackPositions).toEqual([{ bookId: 'book-1', lastPlayedCfi: 'cfi(/6)' }]);
    });

    it('reads progress that was seeded on the fake', () => {
        const ctx = new FakeEngineContext();
        ctx.progress['book-1'] = { currentQueueIndex: 2, currentSectionIndex: 1 } as never;
        expect(ctx.readingState.getProgress('book-1')).toEqual({ currentQueueIndex: 2, currentSectionIndex: 1 });
        expect(ctx.readingState.getProgress('missing')).toBeNull();
    });

    it('records annotations and toasts', () => {
        const ctx = new FakeEngineContext();
        ctx.annotations.add({ bookId: 'b', cfiRange: 'r', type: 'audio-bookmark', text: 't', color: '#fff' } as never);
        ctx.notifications.showToast('hello', 'info');
        expect(ctx.addedAnnotations).toHaveLength(1);
        expect(ctx.toasts).toEqual([{ message: 'hello', type: 'info' }]);
    });

    it('serves content analysis by key and snapshot', () => {
        const ctx = new FakeEngineContext();
        const analysis = { status: 'success', generatedAt: 1 } as SectionAnalysis;
        ctx.analyses['book-1/sec-1'] = analysis;
        expect(ctx.contentAnalysis.getAnalysis('book-1', 'sec-1')).toBe(analysis);
        expect(ctx.contentAnalysis.getAnalysis('book-1', 'missing')).toBeUndefined();
        expect(ctx.contentAnalysis.getSnapshot().sections['book-1/sec-1']).toBe(analysis);
    });

    it('notifies subscribers via the emit helpers and supports unsubscribe', () => {
        const ctx = new FakeEngineContext();
        const analysisListener = vi.fn();
        const genAIListener = vi.fn();
        const bookListener = vi.fn();

        const unsubAnalysis = ctx.contentAnalysis.subscribe(analysisListener);
        ctx.genAI.subscribe(genAIListener);
        ctx.book.subscribe(bookListener);

        ctx.emitAnalysisChange();
        ctx.emitGenAIChange();
        ctx.emitBookChange();

        expect(analysisListener).toHaveBeenCalledWith({ sections: ctx.analyses });
        expect(genAIListener).toHaveBeenCalledTimes(1);
        expect(bookListener).toHaveBeenCalledTimes(1);

        unsubAnalysis();
        ctx.emitAnalysisChange();
        expect(analysisListener).toHaveBeenCalledTimes(1);
    });

    it('reports platform info from the fake', async () => {
        const ctx = new FakeEngineContext();
        expect(ctx.platform.getPlatform()).toBe('web');
        expect(ctx.platform.isNativePlatform()).toBe(false);

        ctx.platformName = 'android';
        ctx.batteryOptimizationEnabled = true;
        expect(ctx.platform.isNativePlatform()).toBe(true);
        expect(await ctx.platform.isBatteryOptimizationEnabled()).toBe(true);
        await ctx.platform.openBatteryOptimizationSettings();
        expect(ctx.openedBatterySettings).toHaveLength(1);
    });
});

describe('Engine core reads through the injected context', () => {
    it('SectionAnalysisDriver and TableAdaptationProcessor accept an injected context', () => {
        const ctx = new FakeEngineContext();
        expect(() => new SectionAnalysisDriver(ctx)).not.toThrow();
        expect(() => new TableAdaptationProcessor(ctx)).not.toThrow();
    });

    it('the analysis driver reads GenAI settings from the injected context (not the global store)', async () => {
        const ctx = new FakeEngineContext();
        ctx.genAISettings = { isEnabled: false } as never;
        const getSettingsSpy = vi.spyOn(ctx.genAI, 'getSettings');

        const driver = new SectionAnalysisDriver(ctx);
        // isEnabled=false → method consults the context then early-returns without DB access.
        await driver.prewarmNextSection('book-1', 0, [
            { sectionId: 's0' },
            { sectionId: 's1' },
        ] as never);

        expect(getSettingsSpy).toHaveBeenCalled();
    });
});
