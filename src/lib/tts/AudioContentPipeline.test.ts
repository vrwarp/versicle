import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import * as cfiUtils from '../cfi-utils';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn(),
        getContentAnalysis: vi.fn(),
        getBookMetadata: vi.fn(),
        saveContentClassifications: vi.fn(),
        getBookStructure: vi.fn(),
        getTableImages: vi.fn().mockResolvedValue([]),
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

            const s1 = { text: 'Keep me', cfi: 'epubcfi(/2/2/2:0)', sourceIndices: [0] };
            const s2 = { text: 'Skip me', cfi: 'epubcfi(/2/2/4:0)', sourceIndices: [1] };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getTTSContent as any).mockResolvedValue({ sentences: [s1, s2] });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getContentAnalysis as any).mockResolvedValue({
                contentTypes: [
                    { rootCfi: 'epubcfi(/2/2/4:0,,)', type: 'table' }
                ]
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (useGenAIStore.getState as any).mockReturnValue({
                contentFilterSkipTypes: ['table'],
                isContentAnalysisEnabled: true,
                isEnabled: true,
                apiKey: 'test-key'
            });

            const onMaskFound = vi.fn();

            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0, undefined, onMaskFound);

            expect(result).toHaveLength(2);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(onMaskFound).toHaveBeenCalled();
            const mask = onMaskFound.mock.calls[0][0];
            expect(mask.has(1)).toBe(true);
            expect(mask.has(0)).toBe(false);
        });
    });

    describe('Grouping Logic', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let castPipeline: any;

        beforeEach(() => {
            castPipeline = pipeline;
            // Spy on cfi utils
            vi.spyOn(cfiUtils, 'getParentCfi');
            vi.spyOn(cfiUtils, 'generateCfiRange');
        });

        it('groups sentences by parent and generates Range CFIs for rootCfi', () => {
            const sentences = [
                { text: "A", cfi: "epubcfi(/6/14!/4/2/1:0)" },
                { text: "B", cfi: "epubcfi(/6/14!/4/2/3:0)" }, // Same parent /4/2
                { text: "C", cfi: "epubcfi(/6/14!/4/4/1:0)" }, // New parent /4/4
            ];

            const groups = castPipeline.groupSentencesByRoot(sentences);

            expect(groups).toHaveLength(2);

            expect(groups[0].segments).toHaveLength(2);
            const expectedRange1 = cfiUtils.generateCfiRange("epubcfi(/6/14!/4/2/1:0)", "epubcfi(/6/14!/4/2/3:0)");
            expect(groups[0].rootCfi).toBe(expectedRange1);

            expect(groups[1].segments).toHaveLength(1);
            const expectedRange2 = cfiUtils.generateCfiRange("epubcfi(/6/14!/4/4/1:0)", "epubcfi(/6/14!/4/4/1:0)");
            expect(groups[1].rootCfi).toBe(expectedRange2);
        });

        it('generates unique rootCfi for adjacent groups sharing same parent (Map Collision Fix)', () => {
            const sentences = [
                { text: "A1", cfi: "epubcfi(/6/14!/4/2/1:0)" }, // Parent A
                { text: "B1", cfi: "epubcfi(/6/14!/4/4/1:0)" }, // Parent B
                { text: "A2", cfi: "epubcfi(/6/14!/4/2/3:0)" }, // Parent A again
            ];

            const groups = castPipeline.groupSentencesByRoot(sentences);

            expect(groups).toHaveLength(3);

            const root1 = groups[0].rootCfi;
            const root3 = groups[2].rootCfi;

            expect(root1).not.toBe(root3);
            expect(groups[0].rootCfi).toContain('1:0');
            expect(groups[2].rootCfi).toContain('3:0');
        });

        it('detectContentSkipMask handles colliding parents correctly', async () => {
            const sentences = [
                { text: "Narrative", cfi: "epubcfi(/6/14!/4/2/1:0)", sourceIndices: [0] },
                { text: "Interruption", cfi: "epubcfi(/6/14!/4/4/1:0)", sourceIndices: [1] },
                { text: "Footnote", cfi: "epubcfi(/6/14!/4/2/3:0)", sourceIndices: [2] },
            ];

            // Manually compute/mock the root CFIs to match what groupSentencesByRoot produces.
            // But easier: rely on the fact that groupSentencesByRoot creates 3 groups here.
            // We just need getOrDetectContentTypes to return a type for the 3rd group.

            // Mock getOrDetectContentTypes to verify masking logic directly
            // This avoids GenAI service mock complexity
            const mockDetection = vi.spyOn(castPipeline, 'getOrDetectContentTypes');
            mockDetection.mockImplementation(async (bookId, sectionId, groups) => {
                // Return 'footnote' for the 3rd group (index 2)
                if (groups.length > 2) {
                    return [{
                        rootCfi: groups[2].rootCfi,
                        type: 'footnote'
                    }];
                }
                return [];
            });

            // @ts-expect-error casting for test compatibility
            const mask = await castPipeline.detectContentSkipMask('book1', 'sec1', ['footnote'], sentences);

            expect(mask.has(2)).toBe(true);
            expect(mask.has(0)).toBe(false);
            expect(mask.has(1)).toBe(false);
        });
    });
});
