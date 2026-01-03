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

             // If the chapter is empty, the pipeline should return a single queue item
             // which is a "Preroll" (informational message) stating the chapter is empty.
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
             (dbService.getContentAnalysis as any).mockResolvedValue({
                contentTypes: [
                    { rootCfi: 'epubcfi(/2/2/4:0,,)', type: 'table' } // Matching s2 group
                ]
            });

            // Mock store settings to enable filtering
            (useGenAIStore.getState as any).mockReturnValue({
                contentFilterSkipTypes: ['table'],
                isContentAnalysisEnabled: true,
                apiKey: 'test-key'
            });

            // Execute loadSection
            // The pipeline calls detectAndFilterContent internally
            const result = await pipeline.loadSection('book1', mockSection, 0, false, 1.0);

            // Expect result to contain only s1 ('Keep me'), s2 should be filtered out
            expect(result).toHaveLength(1);
            expect(result![0].text).toBe('Keep me');
        });
    });

    describe('groupSentencesByRoot (Heuristics)', () => {
        // Access private method
        const groupSentencesByRoot = (p: AudioContentPipeline, sentences: any[]) => {
            return (p as any).groupSentencesByRoot(sentences);
        };

        /**
         * Case 1: Complex Multi-Sentence Paragraph
         *
         * Outcome: Merge (1 Group)
         * Reasoning: All segments reside in the same leaf text node.
         *            Rule 1 (Vertical Ancestry) ensures they are grouped together as they share the same parent path.
         */
        it('Case 1: Complex Multi-Sentence Paragraph (should merge)', () => {
            const segments = [
                { text: "This is the first sentence.", cfi: "epubcfi(/6/4!/4/2/1:0)" },
                { text: "This is the second sentence.", cfi: "epubcfi(/6/4!/4/2/1:26)" },
                { text: "Third sentence here.", cfi: "epubcfi(/6/4!/4/2/1:53)" },
                { text: "Fourth one follows.", cfi: "epubcfi(/6/4!/4/2/1:74)" },
                { text: "Fifth sentence.", cfi: "epubcfi(/6/4!/4/2/1:94)" },
                { text: "Sixth sentence.", cfi: "epubcfi(/6/4!/4/2/1:110)" },
                { text: "Seventh sentence.", cfi: "epubcfi(/6/4!/4/2/1:126)" },
                { text: "Eighth sentence.", cfi: "epubcfi(/6/4!/4/2/1:143)" },
                { text: "Ninth sentence.", cfi: "epubcfi(/6/4!/4/2/1:160)" },
                { text: "Tenth sentence.", cfi: "epubcfi(/6/4!/4/2/1:176)" },
            ];

            const result = groupSentencesByRoot(pipeline, segments);

            expect(result.length).toBe(1);
            expect(result[0].segments.length).toBe(10);
        });

        /**
         * Case 2: Multi-Column Lookup Table (Nomenclature)
         *
         * Outcome: Merge (1 Group)
         * Reasoning: Sequential rows under common parent `/10`. Essential to merge keys with values for classification.
         *            - Rule 2 (Sibling Proximity) merges adjacent rows (e.g., /10/2 and /10/4).
         *            - Unified Snapping ensures parents are identified at the correct depth (e.g., Row level) to facilitate comparison.
         */
        it('Case 2: Multi-Column Lookup Table (should merge)', () => {
            // Nested table to satisfy Depth >= 2 guard
            const segments = [
                { text: "4Q", cfi: "epubcfi(/6/2!/4/10/2/2/1:0)" },
                { text: "Cave 4 Qumran", cfi: "epubcfi(/6/2!/4/10/2/4/1:0)" },
                { text: "Qoh", cfi: "epubcfi(/6/2!/4/10/4/2/1:0)" },
                { text: "Ecclesiastes", cfi: "epubcfi(/6/2!/4/10/4/4/1:0)" },
                { text: "a", cfi: "epubcfi(/6/2!/4/10/6/2/1:0)" },
                { text: "Copy one", cfi: "epubcfi(/6/2!/4/10/6/4/1:0)" },
                { text: "DSS", cfi: "epubcfi(/6/2!/4/10/8/2/1:0)" },
                { text: "Dead Sea Scrolls", cfi: "epubcfi(/6/2!/4/10/8/4/1:0)" },
                { text: "MT", cfi: "epubcfi(/6/2!/4/10/10/2/1:0)" },
                { text: "Masoretic Text", cfi: "epubcfi(/6/2!/4/10/10/4/1:0)" },
            ];

            const result = groupSentencesByRoot(pipeline, segments);

            expect(result.length).toBe(1);
            expect(result[0].segments.length).toBe(10);
        });

        /**
         * Case 3: Deeply Nested Definition List
         *
         * Outcome: Merge (1 Group)
         * Reasoning: Depth-snapping (Depth > 4) forces siblings /2, /4, and /6 together.
         *            The aggressively snapped parent CFI ensures that deeply nested items (Terms and Definitions)
         *            are treated as belonging to the same container, triggering Rule 1 (Vertical Ancestry) or Rule 2.
         */
        it('Case 3: Deeply Nested Definition List (should merge)', () => {
            const segments = [
                { text: "Term 1", cfi: "epubcfi(/6/4!/8/2/2/2/1:0)" },
                { text: "Def segment 1.", cfi: "epubcfi(/6/4!/8/2/2/4/2/1:0)" },
                { text: "Def segment 2.", cfi: "epubcfi(/6/4!/8/2/2/4/2/1:15)" },
                { text: "Def segment 3.", cfi: "epubcfi(/6/4!/8/2/2/4/2/1:30)" },
                { text: "Term 2", cfi: "epubcfi(/6/4!/8/2/4/2/1:0)" },
                { text: "Def segment 1.", cfi: "epubcfi(/6/4!/8/2/4/4/2/1:0)" },
                { text: "Def segment 2.", cfi: "epubcfi(/6/4!/8/2/4/4/2/1:15)" },
                { text: "Def segment 3.", cfi: "epubcfi(/6/4!/8/2/4/4/2/1:30)" },
                { text: "Term 3", cfi: "epubcfi(/6/4!/8/2/6/2/1:0)" },
                { text: "Def segment 1.", cfi: "epubcfi(/6/4!/8/2/6/4/2/1:0)" },
                { text: "Def segment 2.", cfi: "epubcfi(/6/4!/8/2/6/4/2/1:15)" },
                { text: "Def segment 3.", cfi: "epubcfi(/6/4!/8/2/6/4/2/1:30)" },
            ];

            const result = groupSentencesByRoot(pipeline, segments);

            expect(result.length).toBe(1);
            expect(result[0].segments.length).toBe(12);
        });

        /**
         * Case 4: Mixed Structural Environment (20 Segments)
         *
         * This case tests the system's ability to transition between merging and splitting across diverse semantic boundaries.
         *
         * Expected Outcome:
         * - Group 1: Seg 1 (Preface /2)
         * - Group 2: Seg 2-5 (Body /4) -> Standard Merge
         * - Group 3: Seg 6-15 (Table/Metadata /6) -> Sibling Proximity Merge (Rows/Cells)
         * - Group 4: Seg 16-17 (Body /8) -> Standard Merge
         * - Group 5: Seg 18 (Figure /10) -> Split (Level 1 divergence)
         * - Group 6: Seg 19-20 (Footnote /12) -> Standard Merge
         */
        it('Case 4: Mixed Structural Environment (should split and merge correctly)', () => {
             const segments = [
                // 1. Introduction (Parent /4/2)
                { text: "Introduction", cfi: "epubcfi(/6/4!/4/2/1:0)" },

                // 2-3. Paragraph (Parent /4/4) - Merged via Rule 1 (Same parent)
                { text: "Paragraph Start", cfi: "epubcfi(/6/4!/4/4/1:0)" },
                { text: "Paragraph End", cfi: "epubcfi(/6/4!/4/4/1:20)" },

                // 4-13. Metadata Table (Parent /4/6) - Merged via Rule 2/3 (Sibling Proximity under Depth 2)
                { text: "Key:", cfi: "epubcfi(/6/4!/4/6/2/2/1:0)" },
                { text: "Value A", cfi: "epubcfi(/6/4!/4/6/2/4/1:0)" },
                { text: "Key:", cfi: "epubcfi(/6/4!/4/6/4/2/1:0)" },
                { text: "Value B", cfi: "epubcfi(/6/4!/4/6/4/4/1:0)" },
                { text: "Key:", cfi: "epubcfi(/6/4!/4/6/6/2/1:0)" },
                { text: "Value C", cfi: "epubcfi(/6/4!/4/6/6/4/1:0)" },
                { text: "Key:", cfi: "epubcfi(/6/4!/4/6/8/2/1:0)" },
                { text: "Value D", cfi: "epubcfi(/6/4!/4/6/8/4/1:0)" },
                { text: "Key:", cfi: "epubcfi(/6/4!/4/6/10/2/1:0)" },
                { text: "Value E", cfi: "epubcfi(/6/4!/4/6/10/4/1:0)" },

                // 14-17. Body Resumed (Parent /4/8) - Merged via Rule 1
                { text: "Body text resumes", cfi: "epubcfi(/6/4!/4/8/1:0)" },
                { text: "More text.", cfi: "epubcfi(/6/4!/4/8/1:15)" },
                { text: "Still more.", cfi: "epubcfi(/6/4!/4/8/1:30)" },
                { text: "End body.", cfi: "epubcfi(/6/4!/4/8/1:45)" },

                // 18. Caption (Parent /4/10) - Split (Level 2 divergence)
                { text: "Caption", cfi: "epubcfi(/6/4!/4/10/2/1:0)" },

                // 19-20. Footnotes (Parent /4/12) - Merged via Rule 1
                { text: "Footnote A", cfi: "epubcfi(/6/4!/4/12/2/1:0)" },
                { text: "Footnote B", cfi: "epubcfi(/6/4!/4/12/2/1:20)" },
            ];

            const result = groupSentencesByRoot(pipeline, segments);

            // Expect 6 groups
            expect(result).toHaveLength(6);

            // Group 1: Introduction
            expect(result[0].segments).toHaveLength(1);
            expect(result[0].segments[0].text).toBe("Introduction");

            // Group 2: Paragraph
            expect(result[1].segments).toHaveLength(2);
            expect(result[1].fullText).toContain("Paragraph End");

            // Group 3: Metadata Table
            expect(result[2].segments).toHaveLength(10);
            expect(result[2].fullText).toContain("Value E");

            // Group 4: Resumed Body
            expect(result[3].segments).toHaveLength(4);
            expect(result[3].fullText).toContain("End body");

            // Group 5: Caption
            expect(result[4].segments).toHaveLength(1);
            expect(result[4].segments[0].text).toBe("Caption");

            // Group 6: Footnotes
            expect(result[5].segments).toHaveLength(2);
            expect(result[5].fullText).toContain("Footnote B");
        });
    });
});
