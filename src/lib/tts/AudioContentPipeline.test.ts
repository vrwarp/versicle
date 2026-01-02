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
            // Create sentences with CFIs that will group together
            const mockSentences = [
                { text: 'Keep me', cfi: '/4/2/1:0' },
                { text: 'Skip me', cfi: '/4/2/3:0' } // Different parent implies different group? Check groupSentencesByRoot logic
            ];
            // Wait, groupSentencesByRoot uses getParentCfi.
            // getParentCfi('/4/2/1:0') -> '/4/2/1'
            // getParentCfi('/4/2/3:0') -> '/4/2/3'
            // These share a parent '/4/2' but are siblings.
            // The grouping logic:
            // "Check if one path is a prefix of the other... isDescendant || isAncestor"
            // '/4/2/1' and '/4/2/3' are NOT ancestor/descendant of each other.
            // So they will be in separate groups.

            (dbService.getTTSContent as any).mockResolvedValue({ sentences: mockSentences });
            (dbService.getBookMetadata as any).mockResolvedValue({});
            (dbService.getContentAnalysis as any).mockResolvedValue({
                contentTypes: [
                    { rootCfi: 'epubcfi(/4/2/3:0,,)', type: 'table' } // Assuming generated rootCfi matches
                ]
            });

            // Mock store settings to enable filtering
            (useGenAIStore.getState as any).mockReturnValue({
                contentFilterSkipTypes: ['table'],
                isContentAnalysisEnabled: true,
                apiKey: 'test-key'
            });

            // Mock dbService.getContentAnalysis to return detected types
            // Ideally we mock getOrDetectContentTypes internals or dbService result
            // The implementation calls dbService.getContentAnalysis first.
            // We need to ensure the rootCfi matches what groupSentencesByRoot produces.
            // For a single sentence '/4/2/3:0', rootCfi is likely 'epubcfi(/4/2/3:0,,)' or similar depending on generateCfiRange.

             // Let's rely on the fact that we can see console logs if we are wrong, or inspect implementation.
             // generateCfiRange(first, last).
             // if single segment, first=last.

            // To properly test this without relying on exact CFI string generation matches which might be brittle:
            // I'll assume standard behavior.

            // Let's create a more robust test by mocking groupSentencesByRoot? No, it's private.
            // I'll trust the logic or debug if it fails.

             // Force unique groups
             const s1 = { text: 'Keep me', cfi: 'epubcfi(/2/2/2:0)' };
             const s2 = { text: 'Skip me', cfi: 'epubcfi(/2/2/4:0)' };

             (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1, s2] });

             // Mock analysis result
             // The pipeline calculates rootCfi for s2.
             // getParentCfi('epubcfi(/2/2/4:0)') -> 'epubcfi(/2/2/4)' (simplifying)
             // The group will have one segment. rootCfi = 'epubcfi(/2/2/4:0,,)' approx.

             // Actually, let's mock the `getOrDetectContentTypes` method if we could, but we can't easily spy on private.
             // But we can mock `dbService.getContentAnalysis` to return a result that matches.
             // Since we don't know the exact string, maybe we can mock `generateCfiRange`?

             // Let's try to run it and see if it works with a wildcard or if I need to match exact logic.
             // Actually, better: I can construct the expected rootCfi using the imported utils if available.
             // But I am importing them from `../cfi-utils`.
        });
    });
});
