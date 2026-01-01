import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { genAIService } from '../genai/GenAIService';

// Mock Dependencies
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
    getState: vi.fn().mockReturnValue({
        customAbbreviations: [],
        alwaysMerge: [],
        sentenceStarters: [],
        minSentenceLength: 20
    })
  }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn().mockReturnValue({
            isContentAnalysisEnabled: true,
            contentFilterSkipTypes: ['footnote'],
            apiKey: 'test-key'
        })
    }
}));

vi.mock('../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn().mockReturnValue(true),
        configure: vi.fn(),
        detectContentTypes: vi.fn().mockResolvedValue([])
    }
}));

describe('AudioContentPipeline', () => {
    let pipeline: AudioContentPipeline;

    beforeEach(() => {
        pipeline = new AudioContentPipeline();
        vi.clearAllMocks();
    });

    it('should process section and build queue', async () => {
        vi.mocked(dbService.getTTSContent).mockResolvedValue({
            sentences: [{ text: 'Sentence 1.', cfi: '/2/4/1' }]
        });
        vi.mocked(dbService.getBookMetadata).mockResolvedValue({
            title: 'Book', author: 'Author'
        });

        const result = await pipeline.processSectionWithCover(
            'book1',
            { sectionId: 's1', characterCount: 100 } as any,
            [{ sectionId: 's1' }] as any,
            'cover.jpg'
        );

        expect(result).not.toBeNull();
        expect(result?.queue.length).toBe(1);
        expect(result?.queue[0].text).toBe('Sentence 1.');
        expect(result?.queue[0].coverUrl).toBe('cover.jpg');
    });

    it('should filter skipped content types', async () => {
        vi.mocked(dbService.getTTSContent).mockResolvedValue({
            sentences: [
                { text: 'Normal text.', cfi: '/2/4/1' },
                { text: 'Footnote text.', cfi: '/2/6/1' } // Different root
            ]
        });

        // Mock detection to say the second one is a footnote
        vi.mocked(genAIService.detectContentTypes).mockResolvedValue([
            { id: '1', type: 'footnote' } // Index 1 is the footnote group
        ]);

        // Note: groupSentencesByRoot groups based on parent cfi.
        // However, TextSegmenter.refineSegments might merge them if they are short!
        // The mock store sets minSentenceLength: 20.
        // "Normal text." is 12 chars. "Footnote text." is 14 chars.
        // They will likely be merged by TextSegmenter.refineSegments before content analysis runs.
        // Merged sentence will have CFI of the first one.
        // So they become one group.

        // To prevent merge, we need to make them longer or mock refineSegments.

        // Let's assume we want to test content analysis filtering, so we should ensure they are not merged.
        const sentences = [
             { text: 'Normal text. This is a very long sentence that should not be merged.', cfi: '/2/4/1' },
             { text: 'Footnote text. This is also a very long sentence to avoid merging.', cfi: '/2/6/1' }
        ];

        vi.mocked(dbService.getTTSContent).mockResolvedValue({
            sentences: sentences
        });

        const result = await pipeline.processSectionWithCover(
            'book1',
            { sectionId: 's1', characterCount: 100 } as any,
            [{ sectionId: 's1' }] as any,
            undefined
        );

        expect(result?.queue.length).toBe(1);
        expect(result?.queue[0].text).toBe(sentences[0].text);
    });

    it('should handle empty sections', async () => {
         vi.mocked(dbService.getTTSContent).mockResolvedValue({ sentences: [] });

         const result = await pipeline.processSectionWithCover(
            'book1',
            { sectionId: 's1', characterCount: 0 } as any,
            [{ sectionId: 's1' }] as any,
            undefined
        );

        expect(result?.queue.length).toBe(1);
        expect(result?.queue[0].isPreroll).toBe(true);
    });
});
