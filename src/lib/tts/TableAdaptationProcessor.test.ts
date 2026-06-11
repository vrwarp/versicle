import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createZustandEngineContext } from '../../app/tts/createZustandEngineContext';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { dbService } from '../../db/DBService';
import { contentAnalysisRepository } from '../../db/ContentAnalysisRepository';
import { useGenAIStore } from '../../store/useGenAIStore';
import { type SentenceNode } from '../tts';

vi.mock('../../db/DBService');
vi.mock('../genai/GenAIService');
vi.mock('../../store/useGenAIStore');

vi.mock('../../db/ContentAnalysisRepository', () => ({
    contentAnalysisRepository: {
        getContentAnalysis: vi.fn(),
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        saveTableAdaptations: vi.fn(),
        clearAll: vi.fn(),
    }
}));

vi.mock('../../db/BookRepository', () => ({
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

            vi.mocked(dbService.getTableImages).mockResolvedValue([]);

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
