import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

// --- Mocks Setup ---

// Mock DBService
vi.mock('../../db/DBService', () => ({
    dbService: {
        getBookMetadata: vi.fn().mockResolvedValue({}),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
        getTTSState: vi.fn(),
        saveTTSState: vi.fn(),
        getSections: vi.fn(),
        getContentAnalysis: vi.fn().mockResolvedValue({}),
        getTTSContent: vi.fn().mockResolvedValue({ sentences: [] }),
        getTableImages: vi.fn().mockResolvedValue([]),
        saveTableAdaptations: vi.fn(),
        saveContentClassifications: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
    }
}));

// Mock other dependencies that do IO or hardware
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
            applyLexicon: vi.fn((t) => t),
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
            contentFilterSkipTypes: ['table', 'footnote'],
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


describe('AudioPlayerService - Restore Analysis', () => {
    let service: AudioPlayerService;
    let pipelineSpy: {
        detectContentSkipMask: MockInstance;
        processTableAdaptations: MockInstance;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        try {
            service = AudioPlayerService.getInstance();
        } catch (e) {
            console.error("Constructor Error:", e);
            throw e;
        }

        // Access the real pipeline instance
        // @ts-expect-error Accessing private property for testing
        const pipeline = service.contentPipeline;

        // Spy on the methods we want to check
        // Note: We need to spy on the instance methods
        pipelineSpy = {
            detectContentSkipMask: vi.spyOn(pipeline, 'detectContentSkipMask').mockResolvedValue(new Set()),
            processTableAdaptations: vi.spyOn(pipeline, 'processTableAdaptations').mockResolvedValue(undefined),
        };
    });

    it('should trigger content analysis when restoring queue', async () => {
        const bookId = 'book-123';
        const sectionId = 'section-1';

        vi.mocked(dbService.getTTSState).mockResolvedValue({
            queue: [
                { text: 'Sentence 1', cfi: 'cfi1', sourceIndices: [0] }
            ],
            currentIndex: 0
        });

        vi.mocked(dbService.getSections).mockResolvedValue([
            { sectionId: sectionId, title: 'Chapter 1', characterCount: 100 }
        ]);

        // IMPORTANT: The real pipeline calls dbService. getContentAnalysis, getTableImages, etc.
        // We mocked dbService, so it returns empty defaults which is fine.

        service.setBookId(bookId);

        // Wait for async operations
        await new Promise(r => setTimeout(r, 100));

        // Expectation:
        // Currently (BUG): Not called
        // Fixed: Called
        expect(pipelineSpy.detectContentSkipMask).toHaveBeenCalled();
        expect(pipelineSpy.processTableAdaptations).toHaveBeenCalled();
    });
});
