/**
 * SectionAnalysisDriver — the background content-analysis orchestration half
 * of the strangled AudioContentPipeline (Phase 5c; phase5-tts-strangler.md
 * §5c.2). Queue building went to the pure SectionQueueBuilder (the host
 * orchestrates it); what remains here is detection/adaptation driving:
 *
 *  - {@link triggerAnalysis}: skip-mask detection + table adaptations for the
 *    current section (background, callback-reported);
 *  - {@link prewarmNextSection}: fire-and-forget pre-warming for section N+1;
 *  - {@link detectContentSkipMask}: groups → ReferenceSectionDetector →
 *    raw-index skip mask (the AnalysisApplier's reapplication read).
 *
 * D4 fix by construction: section content is fetched as ONE
 * `{sentences, citationMarkers}` unit (see {@link SectionContent}) — the
 * legacy path-dependence (loadSection passed sentences and DROPPED markers;
 * only the prewarm path carried them) is unrepresentable.
 */
import type { EngineContext } from './engine/EngineContext';
import type { SectionMetadata } from '~types/book';
import type { CitationMarker } from '~types/cache';
import type { ContentType } from '~types/content-analysis';
import type { SentenceNode } from '~types/tts-content';
import { preprocessBlockRoots, groupSegmentsByRoot, type CfiGroup } from '@kernel/cfi';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { ReferenceSectionDetector, collectReferenceTailIndices } from './ReferenceSectionDetector';
import { createGenAILogTelemetry } from './detectionTelemetry';

/** Prepared section content: sentences and citation markers ALWAYS together. */
export interface SectionContent {
    sentences: SentenceNode[];
    citationMarkers: CitationMarker[];
}

export class SectionAnalysisDriver {
    private readonly ctx: EngineContext;
    public readonly tableProcessor: TableAdaptationProcessor;
    private readonly detector: ReferenceSectionDetector;

    constructor(ctx: EngineContext) {
        this.ctx = ctx;
        this.tableProcessor = new TableAdaptationProcessor(ctx);
        this.detector = new ReferenceSectionDetector(
            { genAI: ctx.genAI, contentAnalysis: ctx.contentAnalysis, book: ctx.book, content: ctx.content },
            createGenAILogTelemetry(ctx.genAI),
        );
    }

    /**
     * Triggers background content analysis (skip-mask detection and table
     * adaptations) for a section. `content` is the already-fetched prepared
     * content when the caller has it (the loadSection path); when absent it is
     * fetched once — sentences and markers together.
     */
    async triggerAnalysis(
        bookId: string,
        sectionId: string,
        content?: SectionContent,
        onMaskFound?: (mask: Set<number>) => void,
        onAdaptationsFound?: (adaptations: { indices: number[], text: string }[]) => void
    ): Promise<void> {
        const genAISettings = this.ctx.genAI.getSettings();
        const skipTypes = genAISettings.contentFilterSkipTypes;
        const isContentAnalysisEnabled = genAISettings.isContentAnalysisEnabled && genAISettings.isEnabled;

        if (isContentAnalysisEnabled && skipTypes.length > 0) {
            // Trigger background detection
            this.detectContentSkipMask(bookId, sectionId, skipTypes, content)
                .then(mask => {
                    if (mask && mask.size > 0 && onMaskFound) {
                        onMaskFound(mask);
                    }
                })
                .catch(err => console.warn("Background mask detection failed", err));
        }

        if (genAISettings.isTableAdaptationEnabled && genAISettings.isEnabled) {
            void (async () => {
                try {
                    // Fetch content if not provided, as processTableAdaptations needs sentences
                    const target = content ?? await this.fetchContent(bookId, sectionId);

                    // The callback is optional — results are persisted to the contentAnalysis
                    // port by processTableAdaptations, and the engine's AnalysisApplier
                    // reactively subscribes.
                    await this.tableProcessor.processTableAdaptations(
                        bookId, sectionId, target.sentences,
                        onAdaptationsFound || (() => { })
                    );
                } catch (err) {
                    console.warn("Background table adaptation failed", err);
                }
            })();
        }
    }

    /**
     * Fire-and-forget pre-warming of GenAI analysis for the NEXT section so
     * filtering data is ready by the time auto-advance reaches it.
     */
    async prewarmNextSection(bookId: string, currentSectionIndex: number, playlist: SectionMetadata[]): Promise<void> {
        const genAISettings = this.ctx.genAI.getSettings();
        if (!genAISettings.isEnabled || !genAISettings.isContentAnalysisEnabled) {
            return;
        }

        if (!bookId || currentSectionIndex === -1) return;

        const nextIndex = currentSectionIndex + 1;
        if (nextIndex >= playlist.length) return;

        const nextSection = playlist[nextIndex];

        // Fire and forget, but handle errors
        void (async () => {
            try {
                const content = await this.fetchContent(bookId, nextSection.sectionId);
                if (content.sentences.length === 0) return;

                const analysisTasks: Promise<unknown>[] = [];

                // 1. Reference Detection Analysis
                if (genAISettings.contentFilterSkipTypes.length > 0) {
                    const groups = await this.buildGroups(bookId, nextSection.sectionId, content.sentences);
                    analysisTasks.push(
                        this.detector.detect(bookId, nextSection.sectionId, {
                            groups,
                            citationMarkers: content.citationMarkers,
                        })
                    );
                }

                // 2. Table Adaptation Analysis
                if (genAISettings.isTableAdaptationEnabled) {
                    analysisTasks.push(
                        this.tableProcessor.processTableAdaptations(
                            bookId,
                            nextSection.sectionId,
                            content.sentences,
                            () => { } // Background pre-warming doesn't need immediate callback
                        )
                    );
                }

                if (analysisTasks.length > 0) {
                    await Promise.allSettled(analysisTasks);
                }
            } catch (e) {
                console.warn('Background analysis failed', e);
            }
        })();
    }

    /**
     * Analyzes content for skipping based on current settings and returns the set
     * of raw sentence indices to skip.
     */
    async detectContentSkipMask(
        bookId: string,
        sectionId: string,
        skipTypes: ContentType[],
        content?: SectionContent
    ): Promise<Set<number>> {
        try {
            const target = content ?? await this.fetchContent(bookId, sectionId);
            if (target.sentences.length === 0) return new Set<number>();

            const groups = await this.buildGroups(bookId, sectionId, target.sentences);
            const referenceStartCfi = await this.detector.detect(bookId, sectionId, {
                groups,
                citationMarkers: target.citationMarkers,
            });

            if (referenceStartCfi && skipTypes.includes('reference')) {
                return collectReferenceTailIndices(groups, referenceStartCfi);
            }
        } catch (e) {
            console.warn("Error detecting content skip mask", e);
        }

        return new Set<number>();
    }

    /** Fetch prepared section content — sentences AND markers, one read (D4). */
    private async fetchContent(bookId: string, sectionId: string): Promise<SectionContent> {
        const ttsContent = await this.ctx.content.getTTSPreparation(bookId, sectionId);
        return {
            sentences: ttsContent?.sentences || [],
            citationMarkers: ttsContent?.citationMarkers || [],
        };
    }

    /** Group raw sentences by structural root, snapped to this section's table roots. */
    private async buildGroups(bookId: string, sectionId: string, sentences: SentenceNode[]): Promise<CfiGroup[]> {
        // Fetch table CFIs for grouping; filter by section to keep getParentCfi
        // complexity at O(N_sentences * N_section_tables).
        const tableImages = await this.ctx.content.getTableImages(bookId);
        const sectionTableImages = tableImages.filter(img => img.sectionId === sectionId);
        const preprocessedTableRoots = preprocessBlockRoots(sectionTableImages.map(img => img.cfi));
        return groupSegmentsByRoot(sentences, preprocessedTableRoots);
    }
}
