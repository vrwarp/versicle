import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { EpubCFI } from 'epubjs';
import { parseCfiRange, type PreprocessedRoot } from '../cfi-utils';
import type { SentenceNode } from '../tts';

export class TableAdaptationProcessor {
    private tableAnalysisPromises = new Map<string, Promise<void>>();
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
            const genAISettings = useGenAIStore.getState();

            try {
                // Ensure we have sentences
                if (!sentences || sentences.length === 0) return;
                const targetSentences = sentences;

            // 1. Check DB for existing adaptations
            const analysis = await dbService.getContentAnalysis(bookId, sectionId);
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
            const tableImages = await dbService.getTableImages(bookId);
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
            const canUseGenAI = genAISettings.isEnabled && (genAIService.isConfigured() || !!genAISettings.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse')));
            if (!canUseGenAI) return;

            // Ensure service is configured
            if (!genAIService.isConfigured() && genAISettings.apiKey) {
                genAIService.configure(genAISettings.apiKey, 'gemini-1.5-flash');
            }

            if (genAIService.isConfigured()) {
                const nodes = workSet.map(img => ({
                    rootCfi: img.cfi,
                    imageBlob: img.imageBlob
                }));

                const bookMetadata = await dbService.getBookMetadata(bookId);
                const bookTitle = bookMetadata?.title || 'Unknown Book';
                const structure = await dbService.getBookStructure(bookId);
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

                const results = await genAIService.generateTableAdaptations(nodes, 512, { bookTitle, sectionTitle });

                // 5. Update DB
                await dbService.saveTableAdaptations(bookId, sectionId, results.map(r => ({
                    rootCfi: r.cfi,
                    text: r.adaptation
                })));

                // 6. Notify listeners with updated full set
                const updatedAnalysis = await dbService.getContentAnalysis(bookId, sectionId);
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
            // If it's a point/path, use it directly.
            // Strip epubcfi() wrapper for raw comparison if needed, but parseCfiRange handles format.
            // We use the full string representation of the parent/path for comparison.
            let cleanRoot = root;
            let rangeStart: string | null = null;
            let rangeEnd: string | null = null;

            let parsedRangeStart: EpubCFI | null = null;
            let parsedRangeEnd: EpubCFI | null = null;

            if (range && range.parent) {
                // Reconstruct parent CFI string: epubcfi(parent)
                // But wait, parseCfiRange returns 'parent' as the path inside.
                cleanRoot = range.parent;
                rangeStart = range.fullStart;
                rangeEnd = range.fullEnd;
                try {
                    parsedRangeStart = new EpubCFI(rangeStart);
                    parsedRangeEnd = new EpubCFI(rangeEnd);
                } catch (e) {
                    console.warn('Failed to parse range start/end for table adaptation', e);
                }
            } else {
                // Strip wrapper manually if not a range or simple path
                if (cleanRoot.startsWith('epubcfi(')) {
                    cleanRoot = cleanRoot.slice(8);
                }
                if (cleanRoot.endsWith(')')) {
                    cleanRoot = cleanRoot.slice(0, -1);
                }
            }
            // Normalize: remove trailing ')' if present from lazy regex or range structure
            if (cleanRoot.endsWith(')')) {
                cleanRoot = cleanRoot.slice(0, -1);
            }

            return { original: root, clean: cleanRoot, parsedRangeStart, parsedRangeEnd };
        });

        const cfiComparer = new EpubCFI();

        // Iterate through all sentences and check if they belong to any known table root
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            if (!sentence.cfi) continue;

            let cleanCfi = sentence.cfi;
            if (cleanCfi.startsWith('epubcfi(')) {
                cleanCfi = cleanCfi.slice(8);
            }
            if (cleanCfi.endsWith(')')) {
                cleanCfi = cleanCfi.slice(0, -1);
            }

            // Lazy-parse the sentence CFI only if needed
            let parsedSentenceCfi: EpubCFI | null = null;

            // Check if this sentence is a child of any known table adaptation root.
            const match = parsedRoots.find(({ clean, parsedRangeStart, parsedRangeEnd }) => {
                // Check for prefix match with valid separator boundary
                // Include ',' for range handling
                const isPrefixMatch = cleanCfi.startsWith(clean) &&
                    (cleanCfi.length === clean.length || ['/', '!', '[', ':', ','].includes(cleanCfi[clean.length]));

                if (!isPrefixMatch) return false;

                // If the table root is a range (e.g. encompasses multiple siblings), verify strictly within bounds.
                // This prevents false positives where siblings of the table share the same parent prefix.
                if (parsedRangeStart && parsedRangeEnd) {
                    try {
                        if (!parsedSentenceCfi) {
                            parsedSentenceCfi = new EpubCFI(sentence.cfi);
                        }
                        // @ts-expect-error epubjs compare accepts EpubCFI objects despite strict types
                        const afterStart = cfiComparer.compare(parsedSentenceCfi, parsedRangeStart) >= 0;
                        // @ts-expect-error epubjs compare accepts EpubCFI objects despite strict types
                        const beforeEnd = cfiComparer.compare(parsedSentenceCfi, parsedRangeEnd) <= 0;
                        return afterStart && beforeEnd;
                    } catch (e) {
                        console.warn('Failed to compare CFIs for table range check', e);
                        // Fallback to prefix match if comparison fails (safer than skipping?)
                        // Or safer to skip? Safer to skip to avoid swallowing whole chapters.
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

    /**
     * Efficiently preprocesses table images into block roots for grouping,
     * avoiding redundant CFI parsing.
     */
    public preprocessTableRoots(images: { cfi: string }[]): PreprocessedRoot[] {
        return images.map(img => {
            const range = parseCfiRange(img.cfi);
            if (range && range.parent) {
                return {
                    original: `epubcfi(\${range.parent})`,
                    clean: range.parent
                };
            } else {
                let clean = img.cfi;
                if (clean.startsWith('epubcfi(')) clean = clean.slice(8, -1);
                return {
                    original: img.cfi,
                    clean
                };
            }
        }).sort((a, b) => b.clean.length - a.clean.length);
    }
}
