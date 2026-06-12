/**
 * Main-thread repository for content-analysis reads/writes.
 *
 * Thin adapter over the yjs-backed useContentAnalysisStore. Lives outside the
 * data layer (src/data/repos — the carve of the deleted DBService) so the TTS
 * engine worker — which reaches IndexedDB through those repos — never bundles yjs. Worker-side
 * engine code reaches content analysis through the EngineContext contentAnalysis port, whose
 * host implementation calls this repository.
 */
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import type { ContentAnalysis } from '~types/book';

class ContentAnalysisRepository {
    getContentAnalysis(bookId: string, sectionId: string): ContentAnalysis | undefined {
        const yjsAnalysis = useContentAnalysisStore.getState().getAnalysis(bookId, sectionId);
        if (!yjsAnalysis) return undefined;

        return {
            id: `${bookId}-${sectionId}`,
            bookId,
            sectionId,
            structure: { title: yjsAnalysis.title, footnoteMatches: [] },
            referenceStartCfi: yjsAnalysis.referenceStartCfi,
            tableAdaptations: yjsAnalysis.tableAdaptations,
            lastAnalyzed: yjsAnalysis.generatedAt,
            status: yjsAnalysis.status,
            lastError: yjsAnalysis.lastError,
            lastAttempt: yjsAnalysis.lastAttempt,
        };
    }

    saveReferenceStartCfi(bookId: string, sectionId: string, referenceStartCfi: string | undefined): void {
        useContentAnalysisStore.getState().saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
    }

    markAnalysisLoading(bookId: string, sectionId: string): void {
        useContentAnalysisStore.getState().markAnalysisLoading(bookId, sectionId);
    }

    markAnalysisError(bookId: string, sectionId: string, error: string): void {
        useContentAnalysisStore.getState().markAnalysisError(bookId, sectionId, error);
    }

    saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): void {
        useContentAnalysisStore.getState().saveTableAdaptations(bookId, sectionId, adaptations);
    }

    clearAll(): void {
        useContentAnalysisStore.getState().clearAll();
    }
}

export const contentAnalysisRepository = new ContentAnalysisRepository();
