import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn(),
        getContentAnalysis: vi.fn(),
        getBookMetadata: vi.fn(),
        saveContentClassifications: vi.fn(),
        getBookStructure: vi.fn(),
        getTableImages: vi.fn().mockResolvedValue([]), // Added mock
    }
}));

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
            contentFilterSkipTypes: [],
            isContentAnalysisEnabled: false,
            isEnabled: true, // Default enabled
            apiKey: null
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

// Mock TextSegmenter explicitly
vi.mock('./TextSegmenter', () => ({
    TextSegmenter: {
        refineSegments: vi.fn((segments) => segments)
    }
}));

describe('AudioContentPipeline', () => {
    let pipeline: AudioContentPipeline;

    beforeEach(() => {
        pipeline = new AudioContentPipeline();
        vi.clearAllMocks();
    });

    describe('loadSection', () => {
        it('should load and process TTS content successfully', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;
            const mockSentences = [{ text: 'Hello world', cfi: 'cfi1' }];
            const mockMetadata = { title: 'Test Book', author: 'Test Author' };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: mockSentences });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue(mockMetadata);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getContentAnalysis as any).mockResolvedValue(null);

            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0);

            expect(result).toHaveLength(1);
            expect(result![0].text).toBe('Hello world');
            expect(result![0].title).toBe('Section 1');
        });

        it('should handle empty chapters gracefully', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mockSection = { sectionId: 's1', characterCount: 0 } as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: [] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({});

            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0);

            // If the chapter is empty, the pipeline should return a single queue item
            // which is a "Preroll" (informational message) stating the chapter is empty.
            expect(result).toHaveLength(1);
            expect(result![0].isPreroll).toBe(true);
        });

        it('should generate preroll when enabled', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;
            const mockSentences = [{ text: 'Hello', cfi: 'cfi1' }];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: mockSentences });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({});

            const result = await pipeline.loadSection('book1', mockSection, 0, true, 1.0);

            expect(result).toHaveLength(2);
            expect(result![0].isPreroll).toBe(true);
            expect(result![0].text).toContain('Estimated reading time');
            expect(result![1].text).toBe('Hello');
        });
    });

    describe('Content Filtering', () => {
        it('should trigger onMaskFound with skipped indices when filtering is enabled', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;

            // Setup two sentences that will be treated as separate groups by groupSentencesByRoot.
            // s1 is the content we want to keep.
            // s2 is the content we want to filter out (e.g. a table).
            // We use distinct paths (/2/2/2 vs /2/2/4) to ensure they don't get merged into a single group.
            const s1 = { text: 'Keep me', cfi: 'epubcfi(/2/2/2:0)', sourceIndices: [0] };
            const s2 = { text: 'Skip me', cfi: 'epubcfi(/2/2/4:0)', sourceIndices: [1] };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1, s2] });

            // Mock content analysis results to classify s2 as a 'table'.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getContentAnalysis as any).mockResolvedValue({
                contentTypes: [
                    { rootCfi: 'epubcfi(/2/2/4:0,,)', type: 'table' } // Matching s2 group
                ]
            });

            // Mock store settings to enable filtering
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (useGenAIStore.getState as any).mockReturnValue({
                contentFilterSkipTypes: ['table'],
                isContentAnalysisEnabled: true,
                isEnabled: true,
                apiKey: 'test-key'
            });

            const onMaskFound = vi.fn();

            // Execute loadSection
            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0, undefined, onMaskFound);

            // Queue should contain BOTH items initially (non-blocking load)
            expect(result).toHaveLength(2);
            expect(result![0].text).toBe('Keep me');
            expect(result![1].text).toBe('Skip me');

            // Wait for async background task
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify callback was called with mask containing index 1
            expect(onMaskFound).toHaveBeenCalled();
            const mask = onMaskFound.mock.calls[0][0];
            expect(mask.has(1)).toBe(true);
            expect(mask.has(0)).toBe(false);
        });
    });
});
