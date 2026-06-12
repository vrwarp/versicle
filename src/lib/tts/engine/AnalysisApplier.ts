/**
 * AnalysisApplier — GenAI content-analysis application, extracted from
 * AudioPlayerService (Phase 5b decomposition; phase5-tts-strangler.md §5b.1).
 *
 * Owns:
 *  - the contentAnalysis snapshot subscription (reactive injection) and the
 *    synchronous timestamp dedup that keeps rapid duplicate pushes from
 *    enqueueing more than one reapplication task (P16);
 *  - the genAI settings subscription (hot-swap / late hydration): a settings
 *    change resets the dedup and re-applies the cached analysis;
 *  - the three mask/adaptation callback sites (loadSection, restore, and the
 *    reactive update), all submitting queue mutations as SEQUENCED commands
 *    (5b-PR3) with the book/section guard evaluated inside the task.
 *
 * The applier never writes the queue itself — it hands masks/adaptations to
 * the controller-owned QueueModel inside sequenced tasks.
 */
import type { SectionAnalysisDriver } from '../SectionAnalysisDriver';
import type { QueueModel } from '../QueueModel';
import type { TaskContext } from '../TaskSequencer';
import type {
    EngineContext,
    SectionAnalysis,
    TableAdaptation,
} from './EngineContext';
import type { SectionMetadata } from '~types/db';

export interface AnalysisApplierDeps {
    ctx: EngineContext;
    driver: SectionAnalysisDriver;
    queue: QueueModel;
    enqueue: <T>(label: string, task: (taskCtx: TaskContext) => Promise<T>) => Promise<T | void>;
    getBookId: () => string | null;
    getSection: (sectionIndex: number) => SectionMetadata | undefined;
}

export class AnalysisApplier {
    private lastAppliedAnalysisSectionId: string | null = null;
    private lastAppliedAnalysisTimestamp: number = 0;

    constructor(private readonly deps: AnalysisApplierDeps) {}

    /** Wire the contentAnalysis + genAI subscriptions. Call once at engine construction. */
    start(): void {
        const { ctx } = this.deps;

        // Subscribe to content analysis changes (Reactive Injection)
        ctx.contentAnalysis.subscribe((state) => {
            this.handleContentAnalysisUpdate(state);
        });

        // Subscribe to GenAI settings changes for hot-swapping behavior and
        // late-hydration support.
        ctx.genAI.subscribe(() => {
            const bookId = this.deps.getBookId();
            if (!bookId) return;

            const sectionIndex = this.deps.queue.currentSectionIndex;
            if (sectionIndex === -1) return;

            const section = this.deps.getSection(sectionIndex);
            if (!section) return;

            // Reset timestamp to force re-application or clearing of mask
            this.reset();
            this.applyCachedAnalysis(bookId, section.sectionId);
        });
    }

    /** Forget the dedup state (book switch / section navigation). */
    reset(): void {
        this.lastAppliedAnalysisSectionId = null;
        this.lastAppliedAnalysisTimestamp = 0;
    }

    /** Re-run the handler against the cached snapshot when a success row exists. */
    applyCachedAnalysis(bookId: string, sectionId: string): void {
        const analysis = this.deps.ctx.contentAnalysis.getAnalysis(bookId, sectionId);
        if (analysis && analysis.status === 'success') {
            this.handleContentAnalysisUpdate(this.deps.ctx.contentAnalysis.getSnapshot());
        }
    }

    private handleContentAnalysisUpdate(state: { sections: Record<string, SectionAnalysis> }) {
        const bookId = this.deps.getBookId();
        if (!bookId) return;

        const sectionIndex = this.deps.queue.currentSectionIndex;
        if (sectionIndex === -1) return;

        const section = this.deps.getSection(sectionIndex);
        if (!section) return;

        const key = `${bookId}/${section.sectionId}`;
        const analysis = state.sections[key];

        if (analysis && analysis.status === 'success') {
            // Skip if we've already processed this exact analysis update for this specific section
            if (this.lastAppliedAnalysisSectionId === section.sectionId && analysis.generatedAt <= this.lastAppliedAnalysisTimestamp) return;

            // Update timestamp synchronously to prevent concurrent duplicate enqueueing
            this.lastAppliedAnalysisSectionId = section.sectionId;
            this.lastAppliedAnalysisTimestamp = analysis.generatedAt;

            this.deps.enqueue('analysis.apply', async () => {
                // Validate current context
                if (this.deps.getBookId() !== bookId) return;
                const activeSection = this.deps.getSection(this.deps.queue.currentSectionIndex);
                if (!activeSection || activeSection.sectionId !== section.sectionId) return;

                const genAISettings = this.deps.ctx.genAI.getSettings();

                // 1. Apply or clear Skip Mask
                if (genAISettings.isEnabled && genAISettings.isContentAnalysisEnabled && genAISettings.contentFilterSkipTypes.length > 0) {
                    const mask = await this.deps.driver.detectContentSkipMask(bookId, section.sectionId, genAISettings.contentFilterSkipTypes);
                    if (mask.size > 0 && this.deps.getBookId() === bookId && this.deps.queue.currentSectionIndex === sectionIndex) {
                        this.deps.queue.applySkippedMask(mask, section.sectionId);
                    }
                } else {
                    this.deps.queue.applySkippedMask(new Set(), section.sectionId);
                }

                // 2. Apply or clear Table Adaptations
                if (genAISettings.isEnabled && genAISettings.isTableAdaptationEnabled && analysis.tableAdaptations) {
                    const ttsContent = await this.deps.ctx.content.getTTSPreparation(bookId, section.sectionId);
                    if (ttsContent && this.deps.getBookId() === bookId && this.deps.queue.currentSectionIndex === sectionIndex) {
                        const adaptations = this.deps.driver.tableProcessor.mapSentencesToAdaptations(
                            ttsContent.sentences,
                            new Map(analysis.tableAdaptations.map((a: TableAdaptation) => [a.rootCfi, a.text]))
                        );
                        this.deps.queue.applyTableAdaptations(adaptations);
                    }
                } else {
                    this.deps.queue.applyTableAdaptations([]);
                }
            });
        }
    }

    /**
     * The pipeline reports skip masks through detached async callbacks
     * (triggerAnalysis runs in the background); the mutation is enqueued with
     * the book/section guard evaluated inside the task (5b-PR3).
     */
    maskCallback(bookId: string, sectionIndex: number, sectionId: string) {
        return (mask: Set<number>) => {
            void this.deps.enqueue('analysis.maskCallback', async () => {
                if (this.deps.getBookId() === bookId && this.deps.queue.currentSectionIndex === sectionIndex) {
                    this.deps.queue.applySkippedMask(mask, sectionId);
                }
            });
        };
    }

    /** Table-adaptation companion of {@link maskCallback}. */
    adaptationsCallback(bookId: string, sectionIndex: number) {
        return (adaptations: { indices: number[], text: string }[]) => {
            void this.deps.enqueue('analysis.adaptationsCallback', async () => {
                if (this.deps.getBookId() === bookId && this.deps.queue.currentSectionIndex === sectionIndex) {
                    this.deps.queue.applyTableAdaptations(adaptations);
                }
            });
        };
    }
}
