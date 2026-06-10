import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createZustandEngineContext } from './engine/createZustandEngineContext';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { contentAnalysisRepository } from '../../db/ContentAnalysisRepository';

// ContentAnalysisRepository.getContentAnalysis is synchronous, but these tests
// (written when it was async) install async implementations; the processor
// tolerates the returned promise. Keep runtime behaviour identical and give
// the mock an async-shaped view of the method for the type checker.
const getContentAnalysisAsyncMock = contentAnalysisRepository.getContentAnalysis as unknown as (
    bookId: string,
    sectionId: string,
) => Promise<unknown>;

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTableImages: vi.fn().mockResolvedValue([]),
        getBookStructure: vi.fn().mockResolvedValue(null),
    }
}));

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
        getBookMetadata: vi.fn().mockResolvedValue({}),
    }
}));

vi.mock('../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn(() => false),
        configure: vi.fn(),
        generateTableAdaptations: vi.fn().mockResolvedValue([]),
    }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn(() => ({
            isEnabled: true,
            isTableAdaptationEnabled: true,
            apiKey: 'test-key',
            model: 'gemini-1.5-flash',
        }))
    }
}));

describe('TableAdaptationProcessor - Deduplication (Vulnerability 3)', () => {
    let processor: TableAdaptationProcessor;

    beforeEach(() => {
        processor = new TableAdaptationProcessor(createZustandEngineContext());
        vi.clearAllMocks();
    });

    it('should deduplicate concurrent calls for the same bookId:sectionId', async () => {
        let resolveFirst!: () => void;
        const firstCallBlocked = new Promise<void>(r => { resolveFirst = r; });

        // Track how many times the inner logic actually executes
        let executionCount = 0;

        vi.mocked(getContentAnalysisAsyncMock).mockImplementation(async () => {
            executionCount++;
            // Block the first call so we can fire a second one while it's in-flight
            if (executionCount === 1) {
                await firstCallBlocked;
            }
            return { tableAdaptations: [{ rootCfi: 'cfi1', text: 'Adapted' }] } as never;
        });

        const sentences = [{ text: 'test', cfi: 'epubcfi(/6/14!/4/2/1:0)' }];
        const callback = vi.fn();

        // Fire two concurrent calls
        const promise1 = processor.processTableAdaptations('book1', 'section1', sentences, callback);
        const promise2 = processor.processTableAdaptations('book1', 'section1', sentences, callback);

        // Let the first call proceed
        resolveFirst();
        await Promise.all([promise1, promise2]);

        // The core logic (getContentAnalysis) should have been called only once
        // because the second call should have returned the in-flight promise
        expect(executionCount).toBe(1);
    });

    it('should allow a second call after the first one completes', async () => {
        let executionCount = 0;

        vi.mocked(getContentAnalysisAsyncMock).mockImplementation(async () => {
            executionCount++;
            return { tableAdaptations: [] } as never;
        });

        const sentences = [{ text: 'test', cfi: 'cfi1' }];
        const callback = vi.fn();

        // First call
        await processor.processTableAdaptations('book1', 'section1', sentences, callback);
        expect(executionCount).toBe(1);

        // Second call (should start a fresh execution since the first completed)
        await processor.processTableAdaptations('book1', 'section1', sentences, callback);
        expect(executionCount).toBe(2);
    });

    it('should deduplicate per section — different sections run independently', async () => {
        let executionCount = 0;

        vi.mocked(getContentAnalysisAsyncMock).mockImplementation(async () => {
            executionCount++;
            return { tableAdaptations: [] } as never;
        });

        const sentences = [{ text: 'test', cfi: 'cfi1' }];
        const callback = vi.fn();

        // Fire calls for different sections concurrently
        await Promise.all([
            processor.processTableAdaptations('book1', 'section1', sentences, callback),
            processor.processTableAdaptations('book1', 'section2', sentences, callback),
        ]);

        // Both should execute independently
        expect(executionCount).toBe(2);
    });

    it('should clean up the promise map even if the inner logic throws', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(contentAnalysisRepository.getContentAnalysis).mockRejectedValue(new Error('DB Error'));

        const sentences = [{ text: 'test', cfi: 'cfi1' }];
        const callback = vi.fn();

        // Should not throw (caught internally)
        await processor.processTableAdaptations('book1', 'section1', sentences, callback);

        // The map should be cleaned up, so a second call should start fresh
        vi.mocked(contentAnalysisRepository.getContentAnalysis).mockResolvedValue({ tableAdaptations: [] } as never);

        let secondExecuted = false;
        vi.mocked(getContentAnalysisAsyncMock).mockImplementation(async () => {
            secondExecuted = true;
            return { tableAdaptations: [] } as never;
        });

        await processor.processTableAdaptations('book1', 'section1', sentences, callback);
        expect(secondExecuted).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 0));
        consoleSpy.mockRestore();
    });
});
