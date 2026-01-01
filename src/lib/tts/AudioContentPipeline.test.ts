import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { getParentCfi } from '../cfi-utils';

// Mock dependencies
vi.mock('../../db/DBService', () => ({
  dbService: {
    getTTSContent: vi.fn(),
    getBookMetadata: vi.fn(),
    getContentAnalysis: vi.fn(),
    saveContentClassifications: vi.fn(),
  }
}));

vi.mock('./TextSegmenter', () => ({
  TextSegmenter: {
    refineSegments: vi.fn(),
  }
}));

vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../../store/useGenAIStore', () => ({
  useGenAIStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../genai/GenAIService', () => ({
  genAIService: {
    isConfigured: vi.fn(),
    configure: vi.fn(),
    detectContentTypes: vi.fn(),
  }
}));

vi.mock('../cfi-utils', () => ({
  getParentCfi: vi.fn(cfi => cfi.split('!')[0]), // Simple mock behavior
}));

describe('AudioContentPipeline', () => {
    let pipeline: AudioContentPipeline;
    const mockBookId = 'book1';
    const mockSection = {
        sectionId: 'sec1',
        id: '1',
        href: 'chap1.html',
        index: 0,
        characterCount: 1000
    };

    beforeEach(() => {
        pipeline = new AudioContentPipeline();
        vi.resetAllMocks();

        // Default mock returns
        (useTTSStore.getState as any).mockReturnValue({
            customAbbreviations: [],
            alwaysMerge: false,
            sentenceStarters: [],
            minSentenceLength: 20
        });

        (useGenAIStore.getState as any).mockReturnValue({
            contentFilterSkipTypes: [],
            isContentAnalysisEnabled: false,
            apiKey: 'mock-key'
        });

        (dbService.getBookMetadata as any).mockResolvedValue({
            title: 'Test Book',
            author: 'Test Author'
        });

        (TextSegmenter.refineSegments as any).mockImplementation((sentences: any) => sentences);
    });

    it('should load section and refine segments', async () => {
        const sentences = [{ text: 'Hello world.', cfi: 'cfi1' }];
        (dbService.getTTSContent as any).mockResolvedValue({ sentences });

        const queue = await pipeline.loadSection(mockBookId, mockSection);

        expect(queue).toHaveLength(1);
        expect(queue[0].text).toBe('Hello world.');
        expect(queue[0].cfi).toBe('cfi1');
    });

    it('should handle empty sections', async () => {
        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [] });

        const queue = await pipeline.loadSection(mockBookId, mockSection);

        expect(queue).toHaveLength(1);
        expect(queue[0].isPreroll).toBe(true);
        expect(queue[0].cfi).toBeNull();
    });

    it('should add preroll if enabled', async () => {
        const sentences = [{ text: 'Hello.', cfi: 'cfi1' }];
        (dbService.getTTSContent as any).mockResolvedValue({ sentences });

        const queue = await pipeline.loadSection(mockBookId, mockSection, 'Chapter 1', true);

        expect(queue).toHaveLength(2);
        expect(queue[0].isPreroll).toBe(true);
        expect(queue[1].text).toBe('Hello.');
    });

    it('should filter content based on GenAI types', async () => {
        const sentences = [
            { text: 'Keep me.', cfi: 'root1!/1' },
            { text: 'Skip me.', cfi: 'root2!/1' }
        ];
        (dbService.getTTSContent as any).mockResolvedValue({ sentences });
        (useGenAIStore.getState as any).mockReturnValue({
            contentFilterSkipTypes: ['citation'],
            isContentAnalysisEnabled: true,
            apiKey: 'mock-key'
        });
        (getParentCfi as any).mockImplementation((c: string) => c.split('!')[0]);

        (dbService.getContentAnalysis as any).mockResolvedValue({
            structure: { title: 'Chapter 1' },
            contentTypes: [
                { rootCfi: 'root2', type: 'citation' } // Should skip root2
            ]
        });

        const queue = await pipeline.loadSection(mockBookId, mockSection);

        expect(queue).toHaveLength(1);
        expect(queue[0].text).toBe('Keep me.');
    });

    it('should trigger next chapter analysis', async () => {
        (useGenAIStore.getState as any).mockReturnValue({
            contentFilterSkipTypes: ['citation'],
            isContentAnalysisEnabled: true,
            apiKey: 'mock-key'
        });
        const nextSection = { ...mockSection, sectionId: 'sec2' };

        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [{text: 'Next', cfi: 'root!1'}] });
        (genAIService.isConfigured as any).mockReturnValue(true);
        (genAIService.detectContentTypes as any).mockResolvedValue([{ id: '0', type: 'text' }]);

        await pipeline.triggerNextChapterAnalysis(mockBookId, nextSection);

        expect(genAIService.detectContentTypes).toHaveBeenCalled();
    });
});
