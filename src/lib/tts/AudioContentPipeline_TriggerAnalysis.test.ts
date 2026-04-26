import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn().mockResolvedValue({ sentences: [] }),
        getContentAnalysis: vi.fn().mockResolvedValue(null),
        getBookMetadata: vi.fn().mockResolvedValue({}),
        getBookStructure: vi.fn().mockResolvedValue(null),
        saveReferenceStartCfi: vi.fn(),
        getTableImages: vi.fn().mockResolvedValue([]),
        saveTableAdaptations: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
    }
}));

vi.mock('../../store/useTTSStore', () => ({
    getDefaultMinSentenceLength: () => 36,
    useTTSStore: {
        getState: vi.fn(() => ({
            customAbbreviations: [],
            alwaysMerge: false,
            sentenceStarters: [],
            minSentenceLength: 0
        }))
    }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn(() => ({
            contentFilterSkipTypes: ['reference'],
            isContentAnalysisEnabled: true,
            isEnabled: true,
            isTableAdaptationEnabled: true,
            apiKey: 'test-key'
        }))
    }
}));

vi.mock('../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn(() => false),
        configure: vi.fn(),
        detectContentTypes: vi.fn()
    }
}));

vi.mock('./TextSegmenter', () => ({
    TextSegmenter: {
        refineSegments: vi.fn((segments) => segments)
    }
}));

describe('AudioContentPipeline - triggerAnalysis', () => {
    let pipeline: AudioContentPipeline;

    beforeEach(() => {
        pipeline = new AudioContentPipeline();
        vi.clearAllMocks();
    });

    describe('Vulnerability 2 Regression: Callbacks are optional', () => {
        it('should call detectContentSkipMask even without onMaskFound callback', async () => {
            const detectSpy = vi.spyOn(pipeline, 'detectContentSkipMask').mockResolvedValue(new Set([1]));

            // Call triggerAnalysis WITHOUT providing any callbacks
            await pipeline.triggerAnalysis('book1', 'section1', [{ text: 'test', cfi: 'cfi1' }]);

            // Wait for background tasks
            await new Promise(r => setTimeout(r, 20));

            expect(detectSpy).toHaveBeenCalledWith('book1', 'section1', ['reference'], expect.anything());
        });

        it('should call processTableAdaptations even without onAdaptationsFound callback', async () => {
            const processSpy = vi.spyOn(pipeline.tableProcessor, 'processTableAdaptations').mockResolvedValue(undefined);

            // Call triggerAnalysis WITHOUT providing any callbacks
            await pipeline.triggerAnalysis('book1', 'section1', [{ text: 'test', cfi: 'cfi1' }]);

            // Wait for background tasks
            await new Promise(r => setTimeout(r, 20));

            expect(processSpy).toHaveBeenCalledWith('book1', 'section1', expect.anything(), expect.any(Function));
        });

        it('should still invoke onMaskFound callback when provided and mask is non-empty', async () => {
            vi.spyOn(pipeline, 'detectContentSkipMask').mockResolvedValue(new Set([1, 2]));
            const onMaskFound = vi.fn();

            await pipeline.triggerAnalysis('book1', 'section1', [{ text: 'test', cfi: 'cfi1' }], onMaskFound);

            // Wait for background tasks
            await new Promise(r => setTimeout(r, 20));

            expect(onMaskFound).toHaveBeenCalledWith(new Set([1, 2]));
        });

        it('should NOT invoke onMaskFound callback when mask is empty', async () => {
            vi.spyOn(pipeline, 'detectContentSkipMask').mockResolvedValue(new Set());
            const onMaskFound = vi.fn();

            await pipeline.triggerAnalysis('book1', 'section1', [{ text: 'test', cfi: 'cfi1' }], onMaskFound);

            // Wait for background tasks
            await new Promise(r => setTimeout(r, 20));

            expect(onMaskFound).not.toHaveBeenCalled();
        });
    });

    describe('Vulnerability 1: triggerNextChapterAnalysis pre-warming', () => {
        it('should call both getOrDetectContentTypes and processTableAdaptations for the next chapter', async () => {
            const sentences = [{ text: 'Next chapter', cfi: 'cfi-next' }];
            vi.mocked(dbService.getTTSContent).mockResolvedValue({ sentences } as never);
            vi.mocked(dbService.getContentAnalysis).mockResolvedValue(null);

            const detectSpy = vi.spyOn(pipeline, 'getOrDetectContentTypes').mockResolvedValue(undefined);
            const tableSpy = vi.spyOn(pipeline.tableProcessor, 'processTableAdaptations').mockResolvedValue(undefined);

            const playlist = [
                { sectionId: 'current', characterCount: 100 },
                { sectionId: 'next', characterCount: 200 },
            ];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pipeline.triggerNextChapterAnalysis('book1', 0, playlist as any);

            // Wait for the fire-and-forget async
            await new Promise(r => setTimeout(r, 50));

            expect(detectSpy).toHaveBeenCalled();
            expect(tableSpy).toHaveBeenCalledWith('book1', 'next', sentences, expect.any(Function));
        });

        it('should not crash if already at the last chapter', async () => {
            const playlist = [{ sectionId: 'only', characterCount: 100 }];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pipeline.triggerNextChapterAnalysis('book1', 0, playlist as any);
            // No assertions needed — just verifying no exception is thrown
        });

        it('should not fire analysis when GenAI is disabled', async () => {
            vi.mocked(useGenAIStore.getState).mockReturnValue({
                isEnabled: false,
                isContentAnalysisEnabled: true,
                isTableAdaptationEnabled: true,
                contentFilterSkipTypes: ['reference'],
                apiKey: 'test-key',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            const detectSpy = vi.spyOn(pipeline, 'getOrDetectContentTypes');
            const tableSpy = vi.spyOn(pipeline.tableProcessor, 'processTableAdaptations');

            const playlist = [
                { sectionId: 'current', characterCount: 100 },
                { sectionId: 'next', characterCount: 200 },
            ];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pipeline.triggerNextChapterAnalysis('book1', 0, playlist as any);
            await new Promise(r => setTimeout(r, 50));

            expect(detectSpy).not.toHaveBeenCalled();
            expect(tableSpy).not.toHaveBeenCalled();
        });
    });
});
