import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { TextSegmenter } from './TextSegmenter';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn(),
        getContentAnalysis: vi.fn(),
        getBookMetadata: vi.fn(),
        saveContentClassifications: vi.fn(),
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
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;
            const mockSentences = [{ text: 'Hello world', cfi: 'cfi1' }];
            const mockMetadata = { title: 'Test Book', author: 'Test Author' };

            (dbService.getTTSContent as any).mockResolvedValue({ sentences: mockSentences });
            (dbService.getBookMetadata as any).mockResolvedValue(mockMetadata);
            (dbService.getContentAnalysis as any).mockResolvedValue(null);

            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0);

            expect(result).toHaveLength(1);
            expect(result![0].text).toBe('Hello world');
            expect(result![0].title).toBe('Section 1');
        });

        it('should handle empty chapters gracefully', async () => {
             const mockSection = { sectionId: 's1', characterCount: 0 } as any;
             (dbService.getTTSContent as any).mockResolvedValue({ sentences: [] });
             (dbService.getBookMetadata as any).mockResolvedValue({});

             const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0);

             expect(result).toHaveLength(1);
             expect(result![0].isPreroll).toBe(true);
        });

         it('should generate preroll when enabled', async () => {
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;
            const mockSentences = [{ text: 'Hello', cfi: 'cfi1' }];
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: mockSentences });
            (dbService.getBookMetadata as any).mockResolvedValue({});

            const result = await pipeline.loadSection('book1', mockSection, 0, true, 1.0);

            expect(result).toHaveLength(2);
            expect(result![0].isPreroll).toBe(true);
            expect(result![0].text).toContain('Estimated reading time');
            expect(result![1].text).toBe('Hello');
        });
    });

    describe('Content Filtering', () => {
         it('should skip filtered content types when enabled', async () => {
            const mockSection = { sectionId: 's1', characterCount: 500 } as any;

            // Setup two sentences that will be treated as separate groups by groupSentencesByRoot.
            // s1 is the content we want to keep.
            // s2 is the content we want to filter out (e.g. a table).
            // We use distinct paths (/2/2/2 vs /2/2/4) to ensure they don't get merged into a single group.
             const s1 = { text: 'Keep me', cfi: 'epubcfi(/2/2/2:0)' };
             const s2 = { text: 'Skip me', cfi: 'epubcfi(/2/2/4:0)' };

             (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1, s2] });

             // Mock content analysis results to classify s2 as a 'table'.
             // The pipeline uses `generateCfiRange` to create the rootCfi for grouping.
             // For a single-item group like s2, the range logic typically results in a self-referencing range.
             // We mock dbService to return a matching result so the pipeline sees 'table' for s2's group.
        });
    });
});
