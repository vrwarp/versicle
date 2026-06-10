import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contentAnalysisRepository } from './ContentAnalysisRepository';
import { useContentAnalysisStore } from '../store/useContentAnalysisStore';

// Mocked as a plain state holder — the repository only reads getState().
vi.mock('../store/useContentAnalysisStore', () => ({
    useContentAnalysisStore: { getState: vi.fn() },
}));

describe('ContentAnalysisRepository', () => {
    const storeState = {
        getAnalysis: vi.fn(),
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        saveTableAdaptations: vi.fn(),
        clearAll: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useContentAnalysisStore.getState).mockReturnValue(storeState as never);
    });

    describe('getContentAnalysis', () => {
        it('returns undefined when the store has no analysis', () => {
            storeState.getAnalysis.mockReturnValue(undefined);
            expect(contentAnalysisRepository.getContentAnalysis('b1', 's1')).toBeUndefined();
        });

        it('maps the yjs analysis to the ContentAnalysis shape', () => {
            storeState.getAnalysis.mockReturnValue({
                title: 'Chapter 1',
                referenceStartCfi: 'epubcfi(/6/2!/4)',
                tableAdaptations: [{ rootCfi: 'cfi', text: 'adapted' }],
                generatedAt: 1234,
                status: 'complete',
                lastError: undefined,
                lastAttempt: 1200,
            });

            const analysis = contentAnalysisRepository.getContentAnalysis('b1', 's1');

            expect(storeState.getAnalysis).toHaveBeenCalledWith('b1', 's1');
            expect(analysis).toEqual({
                id: 'b1-s1',
                bookId: 'b1',
                sectionId: 's1',
                structure: { title: 'Chapter 1', footnoteMatches: [] },
                referenceStartCfi: 'epubcfi(/6/2!/4)',
                tableAdaptations: [{ rootCfi: 'cfi', text: 'adapted' }],
                lastAnalyzed: 1234,
                status: 'complete',
                lastError: undefined,
                lastAttempt: 1200,
            });
        });
    });

    it('forwards writes to the store actions', () => {
        contentAnalysisRepository.saveReferenceStartCfi('b1', 's1', 'cfi');
        expect(storeState.saveReferenceStartCfi).toHaveBeenCalledWith('b1', 's1', 'cfi');

        contentAnalysisRepository.markAnalysisLoading('b1', 's1');
        expect(storeState.markAnalysisLoading).toHaveBeenCalledWith('b1', 's1');

        contentAnalysisRepository.markAnalysisError('b1', 's1', 'boom');
        expect(storeState.markAnalysisError).toHaveBeenCalledWith('b1', 's1', 'boom');

        contentAnalysisRepository.saveTableAdaptations('b1', 's1', [{ rootCfi: 'c', text: 't' }]);
        expect(storeState.saveTableAdaptations).toHaveBeenCalledWith('b1', 's1', [{ rootCfi: 'c', text: 't' }]);

        contentAnalysisRepository.clearAll();
        expect(storeState.clearAll).toHaveBeenCalled();
    });
});
