import {
    parseCfiRange, stripCfiWrapper, cfiContains, CfiComparator, tryParseCfiPoint,
    type ParsedCfiPoint,
} from '../../kernel/cfi';
import type { SentenceNode } from './sentence-extraction';
import type { EngineContext } from './engine/EngineContext';

export class TableAdaptationProcessor {
    private tableAnalysisPromises = new Map<string, Promise<void>>();
    private readonly ctx: EngineContext;

    /**
     * @param ctx The engine context. Required (no default) so this module never statically
     *   imports the Zustand-backed context, keeping the engine graph worker-importable.
     */
    constructor(ctx: EngineContext) {
        this.ctx = ctx;
    }
    /**
     * Retrieves cached table adaptations from DB or triggers GenAI detection if missing.
     * Replaces `AudioContentPipeline.processTableAdaptations`.
     */
    async processTableAdaptations(
        bookId: string,
        sectionId: string,
        sentences: SentenceNode[],
        onAdaptationsFound: (adaptations: { indices: number[], text: string }[]) => void
    ): Promise<void> {
        const key = `${bookId}:${sectionId}`;
        if (this.tableAnalysisPromises.has(key)) {
            return this.tableAnalysisPromises.get(key)!;
        }

        const promise = (async () => {
            const genAISettings = this.ctx.genAI.getSettings();

            try {
                // Ensure we have sentences
                if (!sentences || sentences.length === 0) return;
                const targetSentences = sentences;

            // 1. Check DB for existing adaptations
            const analysis = await this.ctx.contentAnalysis.getContentAnalysis(bookId, sectionId);
            const existingAdaptations = new Map<string, string>(
                analysis?.tableAdaptations?.map(a => {
                    const range = parseCfiRange(a.rootCfi);
                    return [(range && range.parent) ? `epubcfi(${range.parent})` : a.rootCfi, a.text];
                }) || []
            );

            // Notify with cached data immediately if available
            if (existingAdaptations.size > 0) {
                const result = this.mapSentencesToAdaptations(targetSentences, existingAdaptations);
                if (result.length > 0) {
                    onAdaptationsFound(result);
                }
            }

            // 2. Identify tables that actually exist in the current section
            // Normalizing legacy Range CFIs (e.g. from buggy cfiFromRange) to their Point CFI parents
            const tableImages = await this.ctx.content.getTableImages(bookId);
            const sectionTableImages = tableImages.filter(img => img.sectionId === sectionId).map(img => {
                const range = parseCfiRange(img.cfi);
                return {
                    ...img,
                    cfi: (range && range.parent) ? `epubcfi(${range.parent})` : img.cfi
                };
            });

            if (sectionTableImages.length === 0) return;

            // 3. Filter for those missing from the cache
            const workSet = sectionTableImages.filter(img => !existingAdaptations.has(img.cfi));

            if (workSet.length === 0) return;

            // 4. Check if GenAI is configured
            const canUseGenAI = genAISettings.isEnabled && ((await this.ctx.genAI.isConfigured()) || !!genAISettings.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse')));
            if (!canUseGenAI) return;

            // Ensure service is configured
            if (!(await this.ctx.genAI.isConfigured()) && genAISettings.apiKey) {
                this.ctx.genAI.configure(genAISettings.apiKey, 'gemini-1.5-flash');
            }

            if (await this.ctx.genAI.isConfigured()) {
                const nodes = workSet.map(img => ({
                    rootCfi: img.cfi,
                    imageBlob: img.imageBlob
                }));

                const bookMetadata = await this.ctx.book.getMetadata(bookId);
                const bookTitle = bookMetadata?.title || 'Unknown Book';
                const structure = await this.ctx.content.getBookStructure(bookId);
                const sectionMap = new Map<string, string>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const findSectionTitle = (items: { href: string, title?: string, subitems?: any[] }[]) => {
                    for (const item of items) {
                        if (item.href && item.href.split('#')[0] === sectionId) {
                            sectionMap.set(sectionId, item.title || 'Unknown Section');
                        }
                        if (item.subitems) {
                            findSectionTitle(item.subitems);
                        }
                    }
                };
                if (structure && structure.toc) findSectionTitle(structure.toc);
                const sectionTitle = sectionMap.get(sectionId) || 'Unknown Section';

                const results = await this.ctx.genAI.generateTableAdaptations(nodes, 512, { bookTitle, sectionTitle });

                // 5. Update DB
                await this.ctx.contentAnalysis.saveTableAdaptations(bookId, sectionId, results.map(r => ({
                    rootCfi: r.cfi,
                    text: r.adaptation
                })));

                // 6. Notify listeners with updated full set
                const updatedAnalysis = await this.ctx.contentAnalysis.getContentAnalysis(bookId, sectionId);
                const finalAdaptations = new Map<string, string>(
                    updatedAnalysis?.tableAdaptations?.map(a => [a.rootCfi, a.text]) || []
                );

                const finalResult = this.mapSentencesToAdaptations(targetSentences, finalAdaptations);
                onAdaptationsFound(finalResult);
            }

            } catch (e) {
                console.warn("Error processing table adaptations", e);
            }
        })();

        this.tableAnalysisPromises.set(key, promise);
        try {
            await promise;
        } finally {
            this.tableAnalysisPromises.delete(key);
        }
    }

    /**
     * Maps raw sentences to their corresponding table adaptations based on CFI structure.
     * Identifying which sentences belong to which table allows us to replace them in the queue.
     *
     * @param sentences The list of raw sentence nodes.
     * @param adaptationsMap A map of Table Root CFI -> Adaptation Text.
     * @returns An array of mappings, each containing the source indices and the replacement text.
     */
    public mapSentencesToAdaptations(sentences: SentenceNode[], adaptationsMap: Map<string, string>): { indices: number[], text: string }[] {
        const result: { indices: number[], text: string }[] = [];

        // We only care about CFIs that are keys in our adaptations map (which come from table images)
        // Sort by length descending to handle nested tables (match most specific first)
        const tableRoots = Array.from(adaptationsMap.keys()).sort((a, b) => b.length - a.length);

        // Create a map to collect indices for each table root
        const tableIndices = new Map<string, number[]>();

        // Pre-parse table roots to avoid repeated parsing
        const parsedRoots = tableRoots.map(root => {
            const range = parseCfiRange(root);
            // If it's a range, use the parent (common ancestor) for prefix matching.
            // If it's a point/path, use it directly (kernel stripCfiWrapper replaces
            // the hand-rolled wrapper stripping — phase5 §5c.4).
            let cleanRoot = root;

            let parsedRangeStart: ParsedCfiPoint | null = null;
            let parsedRangeEnd: ParsedCfiPoint | null = null;

            if (range && range.parent) {
                // parseCfiRange returns 'parent' as the path inside the wrapper.
                cleanRoot = range.parent;
                parsedRangeStart = tryParseCfiPoint(range.fullStart);
                parsedRangeEnd = tryParseCfiPoint(range.fullEnd);
                if (!parsedRangeStart || !parsedRangeEnd) {
                    console.warn('Failed to parse range start/end for table adaptation');
                    parsedRangeStart = null;
                    parsedRangeEnd = null;
                }
            } else {
                cleanRoot = stripCfiWrapper(cleanRoot);
            }

            return { original: root, clean: cleanRoot, parsedRangeStart, parsedRangeEnd };
        });

        const cfiComparer = new CfiComparator();

        // Iterate through all sentences and check if they belong to any known table root
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            if (!sentence.cfi) continue;

            const cleanCfi = stripCfiWrapper(sentence.cfi);

            // Lazy-parse the sentence CFI only if needed
            let parsedSentenceCfi: ParsedCfiPoint | null = null;

            // Check if this sentence is a child of any known table adaptation root.
            const match = parsedRoots.find(({ clean, parsedRangeStart, parsedRangeEnd }) => {
                // Prefix match at a step boundary via the kernel's canonical
                // cfiContains (THE separator set — this site already carried all
                // five separators; it now shares the one implementation).
                if (!cfiContains(clean, cleanCfi)) return false;

                // If the table root is a range (e.g. encompasses multiple siblings), verify strictly within bounds.
                // This prevents false positives where siblings of the table share the same parent prefix.
                if (parsedRangeStart && parsedRangeEnd) {
                    if (!parsedSentenceCfi) {
                        parsedSentenceCfi = tryParseCfiPoint(sentence.cfi);
                    }
                    if (!parsedSentenceCfi) {
                        // Unparseable sentence CFI: skip rather than risk swallowing whole chapters.
                        return false;
                    }
                    try {
                        const afterStart = cfiComparer.compare(parsedSentenceCfi, parsedRangeStart) >= 0;
                        const beforeEnd = cfiComparer.compare(parsedSentenceCfi, parsedRangeEnd) <= 0;
                        return afterStart && beforeEnd;
                    } catch (e) {
                        console.warn('Failed to compare CFIs for table range check', e);
                        // Safer to skip than to swallow whole chapters.
                        return false;
                    }
                }

                return true;
            });

            if (match) {
                const matchedRoot = match.original;
                if (!tableIndices.has(matchedRoot)) {
                    tableIndices.set(matchedRoot, []);
                }
                // Collect the raw sentence index (i).
                // This index aligns with `sourceIndices` used in the playback queue items.
                tableIndices.get(matchedRoot)?.push(i);
            }
        }

        // Construct result
        for (const [root, indices] of tableIndices.entries()) {
            const text = adaptationsMap.get(root);
            if (text) {
                result.push({ indices, text });
            }
        }

        return result;
    }
}
