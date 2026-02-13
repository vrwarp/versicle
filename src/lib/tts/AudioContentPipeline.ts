import { dbService } from '../../db/DBService';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { EpubCFI } from 'epubjs';
import { getParentCfi, generateCfiRange, parseCfiRange, preprocessBlockRoots, type PreprocessedRoot } from '../cfi-utils';
import type { SectionMetadata, NavigationItem } from '../../types/db';
import type { ContentType } from '../../types/content-analysis';
import type { TTSQueueItem } from './AudioPlayerService';
import type { SentenceNode } from '../tts';
import { BIBLE_ABBREVIATIONS } from '../../data/bible-lexicon';
import { LexiconService } from './LexiconService';

/**
 * Manages the transformation of raw book content into a playable TTS queue.
 * Handles content fetching, GenAI-based filtering (tables, footnotes), and text segmentation.
 */
export class AudioContentPipeline {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private analysisPromises = new Map<string, Promise<any>>();

    private lastAbbrInputs: { custom: string[], bible: boolean } | null = null;
    private lastAbbrResult: string[] | null = null;

    /**
     * Loads a section, processes its text, and returns a playable queue.
     *
     * @param {string} bookId The ID of the book.
     * @param {SectionMetadata} section The section metadata.
     * @param {number} sectionIndex The index of the section in the playlist.
     * @param {boolean} prerollEnabled Whether to add a preroll announcement.
     * @param {number} speed The current playback speed (used for preroll duration estimation).
     * @param {string} [sectionTitle] Optional override for the section title.
     * @param {(mask: Set<number>) => void} [onMaskFound] Callback to report skipped indices found during background analysis.
     * @returns {Promise<TTSQueueItem[] | null>} The processed queue or null on failure.
     */
    async loadSection(
        bookId: string,
        section: SectionMetadata,
        sectionIndex: number,
        prerollEnabled: boolean,
        speed: number,
        sectionTitle?: string,
        onMaskFound?: (mask: Set<number>) => void,
        onAdaptationsFound?: (adaptations: { indices: number[], text: string }[]) => void
    ): Promise<TTSQueueItem[] | null> {
        try {
            const ttsContent = await dbService.getTTSContent(bookId, section.sectionId);

            // Determine Title
            let title: string | undefined = undefined;

            // Priority 1: AI-extracted title
            const analysis = await dbService.getContentAnalysis(bookId, section.sectionId);
            if (analysis && analysis.structure && analysis.structure.title) {
                title = analysis.structure.title;
            }

            // Priority 2: Label from the Stored TOC
            if (!title) {
                const structure = await dbService.getBookStructure(bookId);

                // Recursive helper to find TOC entry by href
                const findTocEntry = (items: NavigationItem[], href: string): NavigationItem | undefined => {
                    for (const item of items) {
                        if (item.href === href) return item;

                        // Loose match: Check if item.href matches the file path of the spine item
                        // This covers cases where TOC points to a specific anchor but the section is the whole file
                        const itemPath = item.href.split('#')[0];
                        const sectionPath = href.split('#')[0];
                        if (itemPath === sectionPath) return item;

                        if (item.subitems && item.subitems.length > 0) {
                            const found = findTocEntry(item.subitems, href);
                            if (found) return found;
                        }
                    }
                    return undefined;
                };

                const tocEntry = structure?.toc ? findTocEntry(structure.toc, section.sectionId) : undefined;

                if (tocEntry) {
                    title = tocEntry.label;
                }
            }

            // Priority 3: Use Spine Title (Provided Argument)
            if (!title && sectionTitle) {
                title = sectionTitle;
            }

            // Final generic fallback
            title = title || `Section ${sectionIndex + 1}`;

            // Sync the Reader UI Store to ensure CompassPill stays accurate during auto-advance
            useReaderUIStore.getState().setCurrentSection(title, section.sectionId);

            const bookMetadata = await dbService.getBookMetadata(bookId);
            const coverUrl = bookMetadata?.coverUrl || (bookMetadata?.coverBlob ? `/__versicle__/covers/${bookId}` : undefined);

            const newQueue: TTSQueueItem[] = [];

            const NO_TEXT_MESSAGES = [
                "This chapter appears to be empty.",
                "There is no text to read here.",
                "This page contains only images or formatting.",
                "Silence fills this chapter.",
                "Moving on, as this section has no content.",
                "No words found on this page.",
                "This section is blank.",
                "Skipping this empty section.",
                "Nothing to read here.",
                "This part of the book is silent."
            ];

            if (ttsContent && ttsContent.sentences.length > 0) {
                const workingSentences = ttsContent.sentences;

                // Dynamic Refinement: Merge segments based on current settings
                const settings = useTTSStore.getState();

                // Inject Bible abbreviations if enabled
                const biblePref = await LexiconService.getInstance().getBibleLexiconPreference(bookId);
                const shouldIncludeBible = biblePref === 'on' || (biblePref === 'default' && settings.isBibleLexiconEnabled);

                const abbreviations = this.getMergedAbbreviations(settings.customAbbreviations, shouldIncludeBible);

                const finalSentences = TextSegmenter.refineSegments(
                    workingSentences,
                    abbreviations,
                    settings.alwaysMerge,
                    settings.sentenceStarters,
                    settings.minSentenceLength
                );

                // Add Preroll if enabled
                if (prerollEnabled) {
                    const prerollText = this.generatePreroll(title, Math.round(section.characterCount / 5), speed);
                    newQueue.push({
                        text: prerollText,
                        cfi: null,
                        isPreroll: true,
                        title: title,
                        bookTitle: bookMetadata?.title,
                        author: bookMetadata?.author,
                        coverUrl: coverUrl
                    });
                }

                finalSentences.forEach((s) => {
                    if (s.cfi) {
                        newQueue.push({
                            text: s.text,
                            cfi: s.cfi,
                            sourceIndices: s.sourceIndices,
                            isSkipped: false,
                            title: title,
                            bookTitle: bookMetadata?.title,
                            author: bookMetadata?.author,
                            coverUrl: coverUrl
                        });
                    }
                });

                // -----------------------------------------------------------
                // Background Analysis (Async)
                // -----------------------------------------------------------
                this.triggerAnalysis(
                    bookId,
                    section.sectionId,
                    workingSentences,
                    onMaskFound,
                    onAdaptationsFound
                );
            } else {
                // Empty Chapter Handling
                const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
                newQueue.push({
                    text: randomMessage,
                    cfi: null,
                    isPreroll: true,
                    title: title,
                    bookTitle: bookMetadata?.title,
                    author: bookMetadata?.author,
                    coverUrl: coverUrl
                });
            }

            return newQueue;
        } catch (e) {
            console.error("Failed to load section content", e);
            return null;
        }
    }

    /**
     * Triggers background content analysis (skip mask detection and table adaptations).
     * 
     * @param bookId The book ID.
     * @param sectionId The section ID.
     * @param sentences Optional pre-loaded sentences. If not provided, will be fetched from DB.
     * @param onMaskFound Callback for skip mask.
     * @param onAdaptationsFound Callback for table adaptations.
     */
    async triggerAnalysis(
        bookId: string,
        sectionId: string,
        sentences: SentenceNode[] | undefined,
        onMaskFound?: (mask: Set<number>) => void,
        onAdaptationsFound?: (adaptations: { indices: number[], text: string }[]) => void
    ): Promise<void> {
        const genAISettings = useGenAIStore.getState();
        const skipTypes = genAISettings.contentFilterSkipTypes;
        const isContentAnalysisEnabled = genAISettings.isContentAnalysisEnabled && genAISettings.isEnabled;

        if (isContentAnalysisEnabled) {
            if (skipTypes.length > 0 && onMaskFound) {
                // Trigger background detection
                this.detectContentSkipMask(bookId, sectionId, skipTypes, sentences)
                    .then(mask => {
                        if (mask && mask.size > 0) {
                            onMaskFound(mask);
                        }
                    })
                    .catch(err => console.warn("Background mask detection failed", err));
            }
        }

        if (onAdaptationsFound && genAISettings.isTableAdaptationEnabled && genAISettings.isEnabled) {
            // Fetch sentences if not provided, as processTableAdaptations needs them
            let targetSentences = sentences;
            if (!targetSentences) {
                const content = await dbService.getTTSContent(bookId, sectionId);
                targetSentences = content?.sentences || [];
            }

            // Trigger table adaptations
            this.processTableAdaptations(bookId, sectionId, targetSentences, onAdaptationsFound)
                .catch(err => console.warn("Background table adaptation failed", err));
        }
    }

    /**
     * Helper to merge custom and Bible abbreviations with memoization.
     * Prevents creating a new array reference on every call, allowing TextSegmenter
     * to skip rebuilding its internal Set cache.
     */
    private getMergedAbbreviations(customAbbreviations: string[], shouldIncludeBible: boolean): string[] {
        if (
            this.lastAbbrInputs &&
            this.lastAbbrInputs.custom === customAbbreviations &&
            this.lastAbbrInputs.bible === shouldIncludeBible
        ) {
            return this.lastAbbrResult!;
        }

        let merged = customAbbreviations;
        if (shouldIncludeBible) {
            merged = [...customAbbreviations, ...BIBLE_ABBREVIATIONS];
        }

        this.lastAbbrInputs = { custom: customAbbreviations, bible: shouldIncludeBible };
        this.lastAbbrResult = merged;
        return merged;
    }

    /**
     * Generates a spoken preroll message estimating the reading time.
     *
     * @param {string} chapterTitle The title of the chapter.
     * @param {number} wordCount The word count of the chapter.
     * @param {number} [speed=1.0] The playback speed.
     * @returns {string} The formatted string.
     */
    generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
        const WORDS_PER_MINUTE = 180;
        const adjustedWpm = WORDS_PER_MINUTE * speed;
        const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
        return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }

    /**
     * Triggers a background GenAI analysis for the *next* chapter to prepare content filtering data.
     *
     * @param {string} bookId The book ID.
     * @param {number} currentSectionIndex The current section index.
     * @param {SectionMetadata[]} playlist The full playlist of sections.
     */
    async triggerNextChapterAnalysis(bookId: string, currentSectionIndex: number, playlist: SectionMetadata[]) {
        const genAISettings = useGenAIStore.getState();
        if (!genAISettings.isEnabled || !genAISettings.isContentAnalysisEnabled || genAISettings.contentFilterSkipTypes.length === 0) {
            return;
        }

        if (!bookId || currentSectionIndex === -1) return;

        const nextIndex = currentSectionIndex + 1;
        if (nextIndex >= playlist.length) return;

        const nextSection = playlist[nextIndex];

        // Fire and forget, but handle errors
        (async () => {
            try {
                // 1. Get Content
                const ttsContent = await dbService.getTTSContent(bookId, nextSection.sectionId);
                if (!ttsContent || ttsContent.sentences.length === 0) return;

                // 2. Fetch Table CFIs for Grouping
                const tableImages = await dbService.getTableImages(bookId);
                // OPTIMIZATION: Filter table images by the current section ID to avoid checking irrelevant tables.
                // This reduces getParentCfi complexity from O(N_sentences * N_total_book_tables) to O(N_sentences * N_section_tables).
                const sectionTableImages = tableImages.filter(img => img.sectionId === nextSection.sectionId);
                const tableCfis = sectionTableImages.map(img => parseCfiRange(img.cfi)?.parent ? `epubcfi(${parseCfiRange(img.cfi)!.parent})` : img.cfi);

                // Preprocess table roots for efficient querying
                const preprocessedTableRoots = preprocessBlockRoots(tableCfis);

                // 3. Group (Using raw sentences to ensure correct parent mapping)
                const groups = this.groupSentencesByRoot(ttsContent.sentences, preprocessedTableRoots);

                // 4. Detect (will use deduplicated promise if already running)
                await this.getOrDetectContentTypes(bookId, nextSection.sectionId, groups);

            } catch (e) {
                console.warn('Background analysis failed', e);
            }
        })();
    }

    /**
     * Analyzes content for skipping based on current settings and returns a set of raw indices to skip.
     *
     * @param {string} bookId The book ID.
     * @param {string} sectionId The section ID.
     * @param {ContentType[]} skipTypes The content types to filter out.
     * @param {SentenceNode[]} [sentences] The raw sentences to analyze. If not provided, they will be fetched from DB.
     * @returns {Promise<Set<number>>} A Set of raw sentence indices to skip.
     */
    async detectContentSkipMask(bookId: string, sectionId: string, skipTypes: ContentType[], sentences?: SentenceNode[]): Promise<Set<number>> {
        const indicesToSkip = new Set<number>();

        try {
            let targetSentences = sentences;
            if (!targetSentences) {
                const ttsContent = await dbService.getTTSContent(bookId, sectionId);
                targetSentences = ttsContent?.sentences || [];
            }

            if (targetSentences.length === 0) return indicesToSkip;

            // Fetch Table CFIs for Grouping
            const tableImages = await dbService.getTableImages(bookId);
            // OPTIMIZATION: Filter table images by the current section ID to avoid checking irrelevant tables.
            // This reduces getParentCfi complexity from O(N_sentences * N_total_book_tables) to O(N_sentences * N_section_tables).
            const sectionTableImages = tableImages.filter(img => img.sectionId === sectionId);
            const tableCfis = sectionTableImages.map(img => parseCfiRange(img.cfi)?.parent ? `epubcfi(${parseCfiRange(img.cfi)!.parent})` : img.cfi);

            // Preprocess table roots for efficient querying
            const preprocessedTableRoots = preprocessBlockRoots(tableCfis);

            // Group sentences by Root Node
            const groups = this.groupSentencesByRoot(targetSentences, preprocessedTableRoots);
            const detectedTypes = await this.getOrDetectContentTypes(bookId, sectionId, groups);

            if (detectedTypes && detectedTypes.length > 0) {
                const typeMap = new Map<string, ContentType>();
                detectedTypes.forEach((r: { rootCfi: string; type: ContentType }) => typeMap.set(r.rootCfi, r.type));

                const skipRoots = new Set<string>();
                groups.forEach(g => {
                    const type = typeMap.get(g.rootCfi);
                    if (type && skipTypes.includes(type)) {
                        skipRoots.add(g.rootCfi);
                    }
                });

                if (skipRoots.size > 0) {
                    for (const g of groups) {
                        if (skipRoots.has(g.rootCfi)) {
                            // Mark all segments in this group as skipped
                            for (const segment of g.segments) {
                                if (segment.sourceIndices) {
                                    segment.sourceIndices.forEach(idx => indicesToSkip.add(idx));
                                }
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.warn("Error detecting content skip mask", e);
        }

        return indicesToSkip;
    }


    async processTableAdaptations(
        bookId: string,
        sectionId: string,
        sentences: SentenceNode[],
        onAdaptationsFound: (adaptations: { indices: number[], text: string }[]) => void
    ): Promise<void> {
        const genAISettings = useGenAIStore.getState();

        try {
            // Ensure we have sentences
            if (!sentences || sentences.length === 0) return;
            const targetSentences = sentences;

            // 1. Check DB for existing adaptations
            const analysis = await dbService.getContentAnalysis(bookId, sectionId);
            const existingAdaptations = new Map<string, string>(
                analysis?.tableAdaptations?.map(a => [a.rootCfi, a.text]) || []
            );

            // Notify with cached data immediately if available
            if (existingAdaptations.size > 0) {
                const result = this.mapSentencesToAdaptations(targetSentences, existingAdaptations);
                if (result.length > 0) {
                    onAdaptationsFound(result);
                }
            }

            // 2. Identify tables that actually exist in the current section
            const tableImages = await dbService.getTableImages(bookId);
            const sectionTableImages = tableImages.filter(img => img.sectionId === sectionId);

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

                const results = await genAIService.generateTableAdaptations(nodes);

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

            if (range && range.parent) {
                // Reconstruct parent CFI string: epubcfi(parent)
                // But wait, parseCfiRange returns 'parent' as the path inside.
                cleanRoot = range.parent;
                rangeStart = range.fullStart;
                rangeEnd = range.fullEnd;
            } else {
                // Strip wrapper manually if not a range or simple path
                cleanRoot = root.replace(/^epubcfi\((.*)\)$/, '$1');
            }
            // Normalize: remove trailing ')' if present from lazy regex or range structure
            cleanRoot = cleanRoot.replace(/\)$/, '');

            return { original: root, clean: cleanRoot, rangeStart, rangeEnd };
        });

        const cfiComparer = new EpubCFI();

        // Iterate through all sentences and check if they belong to any known table root
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            if (!sentence.cfi) continue;

            const cleanCfi = sentence.cfi.replace(/^epubcfi\((.*)\)$/, '$1');

            // Check if this sentence is a child of any known table adaptation root.
            const match = parsedRoots.find(({ clean, rangeStart, rangeEnd }) => {
                // Check for prefix match with valid separator boundary
                // Include ',' for range handling
                const isPrefixMatch = cleanCfi.startsWith(clean) &&
                    (cleanCfi.length === clean.length || ['/', '!', '[', ':', ','].includes(cleanCfi[clean.length]));

                if (!isPrefixMatch) return false;

                // If the table root is a range (e.g. encompasses multiple siblings), verify strictly within bounds.
                // This prevents false positives where siblings of the table share the same parent prefix.
                if (rangeStart && rangeEnd) {
                    try {
                        const afterStart = cfiComparer.compare(sentence.cfi, rangeStart) >= 0;
                        const beforeEnd = cfiComparer.compare(sentence.cfi, rangeEnd) <= 0;
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
     * Retrieves cached content classifications from DB or triggers GenAI detection if missing.
     */
    async getOrDetectContentTypes(bookId: string, sectionId: string, groups: { rootCfi: string; segments: { text: string; cfi: string }[]; fullText: string }[]) {
        // Deduplicate concurrent requests for the same section
        const key = `${bookId}:${sectionId}`;
        if (this.analysisPromises.has(key)) {
            return this.analysisPromises.get(key);
        }

        const promise = (async () => {
            // 1. Check existing classification in DB
            const contentAnalysis = await dbService.getContentAnalysis(bookId, sectionId);

            // If we have stored content types, return them
            if (contentAnalysis?.contentTypes && contentAnalysis.contentTypes.length > 0) {
                return contentAnalysis.contentTypes;
            }

            // RETRY LOGIC: Check status and timestamps
            const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes
            const LOADING_TIMEOUT = 60 * 1000; // 1 minute (in case process died)

            if (contentAnalysis?.status === 'loading') {
                const elapsed = Date.now() - (contentAnalysis.lastAttempt || 0);
                if (elapsed < LOADING_TIMEOUT) {
                    // Still loading, skip
                    return null;
                }
            }

            if (contentAnalysis?.status === 'error') {
                const elapsed = Date.now() - (contentAnalysis.lastAttempt || 0);
                if (elapsed < RETRY_DELAY) {
                    console.warn(`Skipping analysis for ${bookId}/${sectionId}: Recent error (${Math.round(elapsed / 1000)}s ago)`);
                    return null;
                }
            }

            // 2. If not found, detect with GenAI
            const aiStore = useGenAIStore.getState();
            const canUseGenAI = aiStore.isEnabled && (genAIService.isConfigured() || !!aiStore.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse')));

            if (!canUseGenAI) {
                return null;
            }

            try {
                // Mark as loading to prevent concurrent attempts from other sources
                dbService.markAnalysisLoading(bookId, sectionId);

                const idToCfiMap = new Map<string, string>();

                const nodesToDetect = groups.map((g, index) => {
                    const id = index.toString();
                    idToCfiMap.set(id, g.rootCfi);
                    return {
                        id,
                        sampleText: g.fullText.substring(0, 200)
                    };
                });

                // Ensure service is configured if we have a key
                if (!genAIService.isConfigured() && aiStore.apiKey) {
                    genAIService.configure(aiStore.apiKey, 'gemini-1.5-flash'); // Fallback default
                }

                if (genAIService.isConfigured()) {
                    // Note: Using default model (gemini-1.5-flash) from GenAIService
                    const results = await genAIService.detectContentTypes(nodesToDetect);

                    // Reconstruct the original format for DB persistence
                    const finalResults = results.map(res => ({
                        rootCfi: idToCfiMap.get(res.id) || '',
                        type: res.type
                    })).filter(r => r.rootCfi !== '');

                    // Persist detection results (this sets status to 'success')
                    await dbService.saveContentClassifications(bookId, sectionId, finalResults);
                    return finalResults;
                }
            } catch (e: unknown) {
                console.warn("Content detection failed", e);
                // Mark as error with timestamp
                const message = e instanceof Error ? e.message : String(e);
                dbService.markAnalysisError(bookId, sectionId, message || 'Unknown error');
            }

            return null;
        })();

        this.analysisPromises.set(key, promise);
        try {
            return await promise;
        } finally {
            this.analysisPromises.delete(key);
        }
    }

    /**
     * Groups individual text segments by their common semantic root element using CFI structure.
     * This allows the GenAI to classify logical blocks (tables, asides) rather than fragmented sentences.
     */
    private groupSentencesByRoot(sentences: { text: string; cfi: string; sourceIndices?: number[] }[], tableCfis: string[] | PreprocessedRoot[] = []): { rootCfi: string; segments: { text: string; cfi: string; sourceIndices?: number[] }[]; fullText: string }[] {
        const groups: { rootCfi: string; segments: { text: string; cfi: string; sourceIndices?: number[] }[]; fullText: string }[] = [];
        let currentGroup: { parentCfi: string; segments: { text: string; cfi: string; sourceIndices?: number[] }[]; fullText: string } | null = null;

        const finalizeGroup = (group: { segments: { text: string; cfi: string; sourceIndices?: number[] }[]; fullText: string }) => {
            const first = group.segments[0].cfi;
            const last = group.segments[group.segments.length - 1].cfi;

            // Convert to Range CFI: epubcfi(common,start,end)
            const rootCfi = generateCfiRange(
                parseCfiRange(first)?.fullStart || first,
                parseCfiRange(last)?.fullEnd || last
            );

            groups.push({
                rootCfi,
                segments: group.segments,
                fullText: group.fullText
            });
        };

        for (const s of sentences) {
            const fullCfi = s.cfi || '';
            const parentCfi = getParentCfi(fullCfi, tableCfis);

            // Helper to check if the current group already "contains" this new parent
            const currentParentBase = currentGroup ? currentGroup.parentCfi.replace(/\)$/, '') : '';
            const newParentBase = parentCfi.replace(/\)$/, '');

            // Check if one path is a prefix of the other, confirming they belong to the same branch.
            // We verify that the prefix match is followed by a separator or is the end of string
            // to avoid false positives (e.g. "/1" matching "/10").
            const isDescendant = currentGroup && newParentBase.startsWith(currentParentBase) &&
                (newParentBase.length === currentParentBase.length || ['/', '!', ':'].includes(newParentBase[currentParentBase.length]));

            const isAncestor = currentGroup && currentParentBase.startsWith(newParentBase) &&
                (currentParentBase.length === newParentBase.length || ['/', '!', ':'].includes(currentParentBase[newParentBase.length]));

            const isInternalNode = isDescendant || isAncestor;

            if (!currentGroup || !isInternalNode) {
                if (currentGroup) {
                    finalizeGroup(currentGroup);
                }
                currentGroup = { parentCfi, segments: [], fullText: '' };
            }

            currentGroup.segments.push(s);
            currentGroup.fullText += s.text + '. ';
        }

        if (currentGroup) {
            finalizeGroup(currentGroup);
        }
        return groups;
    }
}
