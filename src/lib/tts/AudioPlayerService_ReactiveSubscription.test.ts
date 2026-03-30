import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { useContentAnalysisStore } from '../../store/useContentAnalysisStore';
import type { SectionAnalysis } from '../../store/useContentAnalysisStore';

// --- Mocks Setup ---

// Capture the subscribe callback so we can invoke it manually
let storeSubscribeCallback: ((state: { sections: Record<string, SectionAnalysis> }) => void) | null = null;

vi.mock('../../store/useContentAnalysisStore', () => ({
    useContentAnalysisStore: {
        subscribe: vi.fn((cb: (state: { sections: Record<string, SectionAnalysis> }) => void) => {
            storeSubscribeCallback = cb;
            return vi.fn(); // unsubscribe
        }),
        getState: vi.fn(() => ({
            sections: {},
            getAnalysis: vi.fn(() => null),
        })),
    }
}));

vi.mock('../../db/DBService', () => ({
    dbService: {
        getBookMetadata: vi.fn().mockResolvedValue({}),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
        getTTSState: vi.fn().mockResolvedValue(null),
        saveTTSState: vi.fn(),
        getSections: vi.fn().mockResolvedValue([]),
        getContentAnalysis: vi.fn().mockResolvedValue({}),
        getTTSContent: vi.fn().mockResolvedValue({ sentences: [{ text: 'foo', cfi: 'cfi1' }] }),
        getTableImages: vi.fn().mockResolvedValue([]),
        saveTableAdaptations: vi.fn(),
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
    }
}));

vi.mock('./TTSProviderManager', () => ({
    TTSProviderManager: vi.fn(function () {
        return {
            init: vi.fn(),
            stop: vi.fn(),
            setProvider: vi.fn(),
            getVoices: vi.fn().mockResolvedValue([]),
        };
    })
}));

vi.mock('./PlatformIntegration', () => ({
    PlatformIntegration: vi.fn(function () {
        return {
            updateMetadata: vi.fn(),
            updatePlaybackState: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
            setBackgroundAudioMode: vi.fn(),
            setPositionState: vi.fn(),
        };
    })
}));

vi.mock('./SyncEngine', () => ({
    SyncEngine: vi.fn(function () {
        return {
            setOnHighlight: vi.fn(),
        };
    })
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn(() => ({
            getRules: vi.fn(),
            applyLexicon: vi.fn((t: string) => t),
        }))
    }
}));

vi.mock('./providers/WebSpeechProvider', () => ({
    WebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
    }
}));

vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            lastPauseTime: null,
            setLastPauseTime: vi.fn(),
            isBibleLexiconEnabled: false,
            customAbbreviations: [],
            alwaysMerge: false,
            sentenceStarters: [],
            minSentenceLength: 10
        }))
    }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn(() => ({
            isEnabled: true,
            isContentAnalysisEnabled: true,
            isTableAdaptationEnabled: true,
            contentFilterSkipTypes: ['reference'],
            apiKey: 'mock-key'
        }))
    }
}));

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            getProgress: vi.fn(() => ({ currentQueueIndex: 0, currentSectionIndex: 0 })),
            updateTTSProgress: vi.fn(),
            updatePlaybackPosition: vi.fn(),
        }))
    }
}));

vi.mock('./CostEstimator');

describe('AudioPlayerService - Reactive Store Subscription (Vulnerability 2)', () => {
    let service: AudioPlayerService;
    let skipMaskSpy: MockInstance;
    let adaptationsSpy: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        storeSubscribeCallback = null;

        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        // expect subscribe was called in the constructor
        expect(useContentAnalysisStore.subscribe).toHaveBeenCalled();

        // @ts-expect-error Accessing private property
        const pipeline = service.contentPipeline;

        skipMaskSpy = vi.spyOn(pipeline, 'detectContentSkipMask').mockResolvedValue(new Set());
        adaptationsSpy = vi.spyOn(pipeline.tableProcessor, 'mapSentencesToAdaptations').mockReturnValue([]);

        // Set up internal state so handleContentAnalysisUpdate has a valid context
        // @ts-expect-error Accessing private property
        service.currentBookId = 'book-1';
        // @ts-expect-error Accessing private property
        service.playlist = [{ sectionId: 'section-1', characterCount: 100 }];
        // @ts-expect-error Accessing private property
        service.stateManager._currentSectionIndex = 0;
        // @ts-expect-error Accessing private property
        service.stateManager._queue = [{ text: 'foo', cfi: 'cfi1', sourceIndices: [0] }];
    });

    it('should apply skip mask and table adaptations when store updates with success', async () => {
        // @ts-expect-error Accessing private property
        const applyMaskSpy = vi.spyOn(service.stateManager, 'applySkippedMask');
        // @ts-expect-error Accessing private property
        const applyAdaptSpy = vi.spyOn(service.stateManager, 'applyTableAdaptations');

        skipMaskSpy.mockResolvedValue(new Set([0]));
        adaptationsSpy.mockReturnValue([{ indices: [0], text: 'Adapted table' }]);

        // Simulate a store update
        expect(storeSubscribeCallback).not.toBeNull();
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'success',
                    generatedAt: Date.now(),
                    tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted table' }],
                }
            }
        });

        // Wait for the enqueued tasks to process
        await new Promise(r => setTimeout(r, 50));

        expect(skipMaskSpy).toHaveBeenCalledWith('book-1', 'section-1', ['reference']);
        expect(applyMaskSpy).toHaveBeenCalled();
        expect(adaptationsSpy).toHaveBeenCalled();
        expect(applyAdaptSpy).toHaveBeenCalled();
    });

    it('should NOT process if analysis status is not success', async () => {
        expect(storeSubscribeCallback).not.toBeNull();
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'loading',
                    generatedAt: Date.now(),
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));

        expect(skipMaskSpy).not.toHaveBeenCalled();
    });

    it('should NOT process if the analysis is for a different section', async () => {
        expect(storeSubscribeCallback).not.toBeNull();
        storeSubscribeCallback!({
            sections: {
                'book-1/section-DIFFERENT': {
                    status: 'success',
                    generatedAt: Date.now(),
                    tableAdaptations: [{ rootCfi: 'cfi1', text: 'X' }],
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));

        expect(skipMaskSpy).not.toHaveBeenCalled();
    });

    it('should deduplicate updates with same timestamp via lastAppliedAnalysisTimestamp', async () => {
        const timestamp = Date.now();

        expect(storeSubscribeCallback).not.toBeNull();

        // First update
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'success',
                    generatedAt: timestamp,
                    tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted' }],
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));
        expect(skipMaskSpy).toHaveBeenCalledTimes(1);

        // Second update with SAME timestamp — should be skipped
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'success',
                    generatedAt: timestamp,
                    tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted' }],
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));
        expect(skipMaskSpy).toHaveBeenCalledTimes(1); // still 1, no duplicate

        // Third update with NEWER timestamp — should be processed
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'success',
                    generatedAt: timestamp + 1000,
                    tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted v2' }],
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));
        expect(skipMaskSpy).toHaveBeenCalledTimes(2);
    });

    it('should NOT process if no bookId is set', async () => {
        // @ts-expect-error Accessing private property
        service.currentBookId = null;

        expect(storeSubscribeCallback).not.toBeNull();
        storeSubscribeCallback!({
            sections: {
                'book-1/section-1': {
                    status: 'success',
                    generatedAt: Date.now(),
                    tableAdaptations: [],
                }
            }
        });

        await new Promise(r => setTimeout(r, 50));
        expect(skipMaskSpy).not.toHaveBeenCalled();
    });
});
