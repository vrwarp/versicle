/**
 * Section display-title resolution for TTS (Phase 5c; extracted from
 * AudioContentPipeline.loadSection's priority chain). Reads only through the
 * narrow ports it is handed; the generic `Section N` fallback lives in the
 * pure SectionQueueBuilder.
 *
 * Priority: AI-extracted title (when synthetic TOC preferred) → stored TOC
 * label (synthetic or real) → the spine-provided title.
 */
import { findTocItem, resolveSyntheticPreference } from '../reader/titleResolver';
import type { BookMetadata } from '~types/db';
import type { ContentAnalysisPort, BookContentPort } from './engine/EngineContext';

export interface SectionTitlePorts {
    contentAnalysis: Pick<ContentAnalysisPort, 'getContentAnalysis'>;
    content: Pick<BookContentPort, 'getBookStructure'>;
}

export async function resolveSectionTitle(
    ports: SectionTitlePorts,
    args: {
        bookId: string;
        sectionId: string;
        /** Already-fetched book metadata (avoids a second getMetadata round-trip). */
        metadata: BookMetadata | undefined;
        /** The spine-provided title (lowest priority). */
        spineTitle?: string;
    },
): Promise<string | undefined> {
    const { bookId, sectionId, metadata, spineTitle } = args;

    let title: string | undefined = undefined;

    const useSynthetic = resolveSyntheticPreference(metadata);

    if (useSynthetic) {
        // Priority 1: AI-extracted title
        const analysis = await ports.contentAnalysis.getContentAnalysis(bookId, sectionId);
        if (analysis && analysis.structure && analysis.structure.title) {
            title = analysis.structure.title;
        }
    }

    // Priority 2: Label from the stored TOC
    if (!title) {
        const structure = await ports.content.getBookStructure(bookId);

        const tocSource = (useSynthetic && metadata?.syntheticToc)
            ? metadata.syntheticToc
            : structure?.toc;

        const tocEntry = tocSource ? findTocItem(tocSource, sectionId) : null;

        if (tocEntry) {
            title = tocEntry.label;
        }
    }

    // Priority 3: the spine-provided title
    if (!title && spineTitle) {
        title = spineTitle;
    }

    return title;
}
