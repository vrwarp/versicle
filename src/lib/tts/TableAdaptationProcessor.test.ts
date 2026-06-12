import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createZustandEngineContext } from '@app/tts/createZustandEngineContext';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { bookContent } from '@data/repos/bookContent';
import { contentAnalysisRepository } from '@app/repositories/ContentAnalysisRepository';
import { useGenAIStore } from '@store/useGenAIStore';
import type { SentenceNode } from '~types/tts-content';

vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getTableImages: vi.fn(),
        getBookStructure: vi.fn(),
    }
}));
vi.mock('../genai/GenAIService');
vi.mock('@store/useGenAIStore');

vi.mock('@app/repositories/ContentAnalysisRepository', () => ({
    contentAnalysisRepository: {
        getContentAnalysis: vi.fn(),
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        saveTableAdaptations: vi.fn(),
        clearAll: vi.fn(),
    }
}));

vi.mock('@app/repositories/BookRepository', () => ({
    bookRepository: {
        getBookMetadata: vi.fn(),
    }
}));


describe('TableAdaptationProcessor', () => {
    let processor: TableAdaptationProcessor;

    beforeEach(() => {
        processor = new TableAdaptationProcessor(createZustandEngineContext());
        vi.clearAllMocks();
    });

    // preprocessTableRoots was deleted (it emitted a literal 'epubcfi(${range.parent})' via an
    // escaped template literal). Its behavior — and the regression tests — now live with the
    // canonical preprocessBlockRoots in src/lib/cfi-utils.test.ts.

    describe('processTableAdaptations', () => {
        it('should process existing adaptations immediately', async () => {
            const sentences: SentenceNode[] = [{ text: 'Inside', cfi: 'epubcfi(/6/14!/4/2/1:0)' }];
            const bookId = 'book1';
            const sectionId = 'section1';

            vi.mocked(useGenAIStore.getState).mockReturnValue({
                isEnabled: true,
                isTableAdaptationEnabled: true,
                apiKey: 'test-key',
                model: 'gemini-1.5-flash',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            vi.mocked(contentAnalysisRepository.getContentAnalysis).mockResolvedValue({
                tableAdaptations: [{ rootCfi: 'epubcfi(/6/14!/4,/2,/3)', text: 'Adapted text' }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            vi.mocked(bookContent.getTableImages).mockResolvedValue([]);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let foundAdaptations: any = null;
            await processor.processTableAdaptations(bookId, sectionId, sentences, (adaptations) => {
                foundAdaptations = adaptations;
            });

            expect(foundAdaptations).toBeDefined();
            expect(foundAdaptations[0].text).toBe('Adapted text');
        });
    });
});

describe('regression: AudioContentPipeline_TableCfi', () => {
    // Carried verbatim from the deleted AudioContentPipeline_TableCfi.test.ts
    // (absorption ledger row 17): range-CFI table roots must exclude siblings
    // that merely share the parent prefix.
    it('should correctly exclude siblings when using Range CFI with parent container', () => {
        const processor = new TableAdaptationProcessor(createZustandEngineContext());

        // Table CFI is a range within parent /6/14!/4; range covers child 2 to 3.
        const tableCfi = 'epubcfi(/6/14!/4,/2,/3)';
        const adaptationText = 'Table content';

        const adaptationsMap = new Map<string, string>();
        adaptationsMap.set(tableCfi, adaptationText);

        const sentences: SentenceNode[] = [
            { text: 'Inside Table', cfi: 'epubcfi(/6/14!/4/2/1:0)' },
            { text: 'Outside Sibling', cfi: 'epubcfi(/6/14!/4/4/1:0)' }
        ];

        const result = processor.mapSentencesToAdaptations(sentences, adaptationsMap);

        const indices = result.flatMap(r => r.indices);
        expect(indices).toContain(0); // Inside
        expect(indices).not.toContain(1); // Outside
        expect(indices.length).toBe(1);
    });
});
