
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { genAIService } from '../genai/GenAIService';

// Mock DB Service
vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn(),
        getContentAnalysis: vi.fn(),
        getBookMetadata: vi.fn(),
        saveContentClassifications: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        getBookStructure: vi.fn(),
        getTableImages: vi.fn().mockResolvedValue([]),
    }
}));

// Mock Stores
vi.mock('../../store/useTTSStore', () => ({
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
            contentFilterSkipTypes: ['table'], // Enable filtering to trigger analysis
            isContentAnalysisEnabled: true,
            isEnabled: true,
            apiKey: 'test-key'
        }))
    }
}));

// Mock GenAI Service
vi.mock('../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn(() => true), // Mock configured
        configure: vi.fn(),
        detectContentTypes: vi.fn()
    }
}));

// Mock TextSegmenter
vi.mock('./TextSegmenter', () => ({
    TextSegmenter: {
        refineSegments: vi.fn((segments) => segments)
    }
}));

describe('AudioContentPipeline Reproduction: Swallowed Errors & Retry Logic', () => {
    let pipeline: AudioContentPipeline;

    beforeEach(() => {
        pipeline = new AudioContentPipeline();
        vi.clearAllMocks();
    });

    it('should persist failure state when analysis fails', async () => {
        // 1. Setup Data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockSection = { sectionId: 's1', characterCount: 500 } as any;
        const s1 = { text: 'Sentence 1', cfi: 'epubcfi(/2/2/2:0)', sourceIndices: [0] };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBookMetadata as any).mockResolvedValue({});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getContentAnalysis as any).mockResolvedValue(null); // No existing analysis

        // 2. Mock GenAI Failure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (genAIService.detectContentTypes as any).mockRejectedValue(new Error('Network Error'));

        // 3. Spy on console.warn
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onMaskFound = vi.fn();

        // 4. Trigger Analysis
        await pipeline.loadSection('book1', mockSection, 0, false, 1.0, undefined, onMaskFound);

        // Wait for async background task
        await new Promise(resolve => setTimeout(resolve, 50));

        // 5. Assertions

        // A. Verify GenAI was called
        expect(genAIService.detectContentTypes).toHaveBeenCalled();

        // B. Verify Error was logged
        expect(consoleSpy).toHaveBeenCalledWith("Content detection failed", expect.any(Error));

        // C. CRITICAL: Verify failure state WAS saved to DB
        expect(dbService.markAnalysisError).toHaveBeenCalledWith('book1', 's1', 'Network Error');
        expect(dbService.markAnalysisLoading).toHaveBeenCalledWith('book1', 's1');
    });

    it('should skip retry if error occurred recently (Time Throttling)', async () => {
        // 1. Setup Data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockSection = { sectionId: 's1', characterCount: 500 } as any;
        const s1 = { text: 'Sentence 1', cfi: 'epubcfi(/2/2/2:0)', sourceIndices: [0] };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1] });

        // Mock existing analysis with RECENT error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getContentAnalysis as any).mockResolvedValue({
            status: 'error',
            lastAttempt: Date.now() - 1000, // 1 second ago (well within 5 min limit)
            lastError: 'Old Error'
        });

        const onMaskFound = vi.fn();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // 4. Trigger Analysis
        await pipeline.loadSection('book1', mockSection, 0, false, 1.0, undefined, onMaskFound);
        await new Promise(resolve => setTimeout(resolve, 50));

        // 5. Assertions
        // Should NOT call GenAI
        expect(genAIService.detectContentTypes).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping analysis'));
    });
});
