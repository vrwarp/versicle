import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';
import { SentenceNode } from '../tts';

vi.mock('../../db/DBService');
vi.mock('../genai/GenAIService');
vi.mock('../../store/useGenAIStore');

describe('TableAdaptationProcessor', () => {
    let processor: TableAdaptationProcessor;

    beforeEach(() => {
        processor = new TableAdaptationProcessor();
        vi.clearAllMocks();
    });

    describe('preprocessTableRoots', () => {
        it('should correctly preprocess table roots', () => {
            const images = [{ cfi: 'epubcfi(/6/14!/4,/2,/3)' }, { cfi: 'epubcfi(/6/12!/4/2)' }];
            const roots = processor.preprocessTableRoots(images);
            expect(roots).toHaveLength(2);
            // Sorts by clean length descending
            expect(roots[0].clean.length).toBeGreaterThanOrEqual(roots[1].clean.length);
        });
    });

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

            vi.mocked(dbService.getContentAnalysis).mockResolvedValue({
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
