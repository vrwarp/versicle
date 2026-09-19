import {
    parseCfiRange, stripCfiWrapper, cfiContains, CfiComparator, tryParseCfiPoint,
    type ParsedCfiPoint,
} from '@kernel/cfi';
import type { SentenceNode } from '~types/tts-content';
import type { TableLocation } from '@data/repos/bookContent';
import type { EngineContext } from './engine/EngineContext';
import { ensureGenAIReady } from './genaiReady';

/**
 * A table root as the adaptation cache keys it: legacy Range CFIs (e.g. from the buggy
 * `cfiFromRange`) collapse to their Point CFI parent, everything else passes through.
 */
function normalizeTableCfi(cfi: string): string {
    const range = parseCfiRange(cfi);
    return (range && range.parent) ? `epubcfi(${range.parent})` : cfi;
}

export class TableAdaptationProcessor {
    private tableAnalysisPromises = new Map<string, Promise<void>>();
    private readonly ctx: EngineContext;
    /**
     * Single-slot memo of the open book's table locations (id/cfi/sectionId,
     * no pixels). Both this processor and SectionAnalysisDriver.buildGroups
     * need the CFIs on EVERY section load and every prewarm; the table set
     * cannot change while a book is open, so one read per book is enough.
     *
     * Switching books drops the previous entry. The one stale window is a
     * reprocess of the book that is currently open: it deletes the book's
     * table rows and writes new ones keyed `${bookId}-${cfi}`, so any CFI
     * drift changes every row id and the memo's ids stop resolving. That
     * costs stale grouping until the next book switch — and it WOULD cost the
     * section's adaptations outright (a work set of stale ids matches no live
     * blob, leaving nothing to send the model), which is why
     * {@link processTableAdaptations} detects the total blob miss and heals
     * from the live read. A reprocess that MOVES a table to a different
     * sectionId never reaches that lookup at all (the stale memo reports the
     * section as tableless), so an empty section list is confirmed against the
     * live rows once per book — see {@link emptySectionProbedBookId}. There is
     * no engine-side reprocess notification today; reprocess writes IndexedDB
     * directly, with no store to subscribe to (unlike the lexicon invalidation
     * ping).
     */
    private locationsBookId: string | null = null;
    private locationsPromise: Promise<TableLocation[]> | null = null;
    /**
     * The book whose empty section list has already been confirmed against the
     * live table rows. Bounds that confirmation to ONE read per book instead of
     * one per tableless section (see {@link processTableAdaptations} step 3).
     */
    private emptySectionProbedBookId: string | null = null;

    /**
     * @param ctx The engine context. Required (no default) so this module never statically
     *   imports the Zustand-backed context, keeping the engine graph worker-importable.
     */
    constructor(ctx: EngineContext) {
        this.ctx = ctx;
    }
    /**
     * The open book's table locations, read once per book (see the memo
     * fields). Shared with SectionAnalysisDriver.buildGroups, which needs the
     * same CFIs for structural grouping.
     */
    async getTableLocations(bookId: string): Promise<TableLocation[]> {
        if (this.locationsBookId !== bookId || !this.locationsPromise) {
            this.locationsBookId = bookId;
            this.locationsPromise = this.ctx.content.listTableLocations(bookId).catch((e) => {
                // Never cache a rejection: the next section retries.
                if (this.locationsBookId === bookId) this.locationsPromise = null;
                throw e;
            });
        }
        return this.locationsPromise;
    }

    /** Forget the memo for `bookId`, so the next {@link getTableLocations} re-reads. */
    private invalidateTableLocations(bookId: string): void {
        if (this.locationsBookId !== bookId) return;
        this.locationsBookId = null;
        this.locationsPromise = null;
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

            // 2. Identify tables that actually exist in the current section.
            // LOCATIONS ONLY (no image bytes): the work set is decided from
            // CFIs, and the pixels are fetched below for the few tables that
            // actually reach the model. Normalizing legacy Range CFIs (e.g.
            // from buggy cfiFromRange) to their Point CFI parents.
            const locations = await this.getTableLocations(bookId);
            const sectionTables = locations.filter(t => t.sectionId === sectionId).map(t => ({
                ...t,
                cfi: normalizeTableCfi(t.cfi),
            }));

            // 3. Filter for those missing from the cache
            const workSet = sectionTables.filter(t => !existingAdaptations.has(t.cfi));

            // An EMPTY section list is ambiguous while the memo can be stale: a
            // reprocess that MOVED a table to a different sectionId empties this
            // section's list, and returning on it would never reach the blob
            // lookup the heal below hangs off — so the section would go without
            // adaptations until the next book switch. It is therefore confirmed
            // against the live rows, but only ONCE per book: the claim is made
            // synchronously, so concurrent section loads cannot each pay for it,
            // an accurate memo costs a single extra read for the WHOLE book, and
            // a book with no tables at all never pays one per section. (A move
            // into a section whose emptiness was already confirmed still waits
            // for the book switch — a bounded check buys the common case, not
            // every case.) The read itself stays behind the GenAI gate below:
            // with no model to send tables to there is nothing to heal.
            const verifyEmptySection = sectionTables.length === 0
                && this.emptySectionProbedBookId !== bookId;
            if (verifyEmptySection) this.emptySectionProbedBookId = bookId;

            if (workSet.length === 0 && !verifyEmptySection) return;

            // 4. Check if GenAI is enabled + configured (the ONE gate — 5c-PR2;
            // configures from the stored key, DEV/E2E-gated mock seam)
            if (await ensureGenAIReady(this.ctx.genAI)) {
                // Pixels, at last — and only this section's (the repo filters
                // before wrapping, so other sections' images are never
                // materialized).
                const images = await this.ctx.content.getTableImages(bookId, sectionId);
                const blobsById = new Map(images.map(img => [img.id, img.imageBlob]));
                let nodes = workSet
                    .map(t => ({ rootCfi: t.cfi, imageBlob: blobsById.get(t.id) }))
                    .filter((n): n is { rootCfi: string; imageBlob: Blob } => n.imageBlob !== undefined);

                if (nodes.length === 0 && (workSet.length > 0 || images.length > 0)) {
                    // Wanted tables, resolved none — or wanted none and the live
                    // rows say otherwise. Either way the memo disagrees with the
                    // rows, which is what a reprocess of the OPEN book does: it
                    // rewrites this book's rows, CFI drift re-keys every id
                    // (`workSet.length > 0`, nothing resolves) and a table can
                    // land in a different section than the memo remembers
                    // (`images.length > 0` for a section the memo called empty).
                    // Drop the memo so the next read — here and in buildGroups —
                    // is fresh, and rebuild the work set from the live rows
                    // already in hand, so the section still gets its adaptations
                    // instead of silently getting none for the rest of the
                    // session. A confirmed-empty section reads no images, so it
                    // falls through with nothing to do and leaves the memo alone.
                    this.invalidateTableLocations(bookId);
                    nodes = images
                        .map(img => ({ rootCfi: normalizeTableCfi(img.cfi), imageBlob: img.imageBlob }))
                        .filter(n => !existingAdaptations.has(n.rootCfi));
                }

                if (nodes.length === 0) return;

                const bookMetadata = await this.ctx.book.getMetadata(bookId);
                const bookTitle = bookMetadata?.title || 'Unknown Book';
                const structure = await this.ctx.content.getBookStructure(bookId);
                const sectionMap = new Map<string, string>();
                type TocLikeItem = { href: string; title?: string; subitems?: TocLikeItem[] };
                const findSectionTitle = (items: TocLikeItem[]) => {
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

                // bookId rides to the egress consent gate (P9 threading).
                const results = await this.ctx.genAI.generateTableAdaptations(nodes, 512, { bookId, bookTitle, sectionTitle });

                // 5. Update DB. A non-table the model skipped arrives with an
                // EMPTY adaptation and is persisted as such: the empty text
                // keeps it out of the work set on every later visit (never
                // re-sent) and out of the sentence mapping below (never
                // narrated) — mapSentencesToAdaptations ignores empty text.
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

        // Construct result. An empty text is a persisted "not a table" verdict:
        // the sentences under that root play as they are.
        for (const [root, indices] of tableIndices.entries()) {
            const text = adaptationsMap.get(root);
            if (text) {
                result.push({ indices, text });
            }
        }

        return result;
    }
}
