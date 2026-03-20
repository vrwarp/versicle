import { dbService } from '../../db/DBService';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { getParentCfi, generateCfiRange, parseCfiRange, type PreprocessedRoot } from '../cfi-utils';
import type { SectionMetadata, NavigationItem } from '../../types/db';
import type { ContentType } from '../../types/content-analysis';
import type { TTSQueueItem } from './AudioPlayerService';
import type { SentenceNode } from '../tts';
import { BIBLE_ABBREVIATIONS } from '../../data/bible-lexicon';
import { LexiconService } from './LexiconService';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';

/**
 * Manages the transformation of raw book content into a playable TTS queue.
 * Handles content fetching, GenAI-based filtering (tables, footnotes), and text segmentation.
 */
export class AudioContentPipeline {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private analysisPromises = new Map<string, Promise<any>>();

    private lastAbbrInputs: { custom: string[], bible: boolean } | null = null;
    private lastAbbrResult: string[] | null = null;

    public tableProcessor = new TableAdaptationProcessor();

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

                // Pre-calculate target path once to avoid repeated split operations
                const targetPath = section.sectionId.split('#')[0];

                // Recursive helper to find TOC entry by href
                const findTocEntry = (items: NavigationItem[]): NavigationItem | undefined => {
                    for (const item of items) {
                        // Exact match (fastest)
                        if (item.href === section.sectionId) return item;

                        // Loose match: Check if item.href matches the file path of the spine item.
                        // Instead of splitting every item.href, check if it starts with the target path
                        // and is followed by '#' or end of string.
                        if (item.href.startsWith(targetPath)) {
                            const charAfter = item.href.charCodeAt(targetPath.length);
                            // 35 is '#'
                            if (Number.isNaN(charAfter) || charAfter === 35) {
                                return item;
                            }
                        }

                        if (item.subitems && item.subitems.length > 0) {
                            const found = findTocEntry(item.subitems);
                            if (found) return found;
                        }
                    }
                    return undefined;
                };

                const tocEntry = structure?.toc ? findTocEntry(structure.toc) : undefined;

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
            if (skipTypes.length > 0) {
                // Trigger background detection
                this.detectContentSkipMask(bookId, sectionId, skipTypes, sentences)
                    .then(mask => {
                        if (mask && mask.size > 0 && onMaskFound) {
                            onMaskFound(mask);
                        }
                    })
                    .catch(err => console.warn("Background mask detection failed", err));
            }
        }

        if (genAISettings.isTableAdaptationEnabled && genAISettings.isEnabled) {
            (async () => {
                try {
                    // Fetch sentences if not provided, as processTableAdaptations needs them
                    let targetSentences = sentences;
                    if (!targetSentences) {
                        const content = await dbService.getTTSContent(bookId, sectionId);
                        targetSentences = content?.sentences || [];
                    }

                    // Trigger table adaptations
                    // The callback is optional — results are persisted to useContentAnalysisStore
                    // by processTableAdaptations, and AudioPlayerService reactively subscribes.
                    await this.tableProcessor.processTableAdaptations(
                        bookId, sectionId, targetSentences,
                        onAdaptationsFound || (() => { }) // no-op if no callback
                    );
                } catch (err) {
                    console.warn("Background table adaptation failed", err);
                }
            })();
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
        if (!genAISettings.isEnabled || !genAISettings.isContentAnalysisEnabled) {
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

                const analysisTasks: Promise<unknown>[] = [];

                // 2. Reference Detection Analysis
                if (genAISettings.contentFilterSkipTypes.length > 0) {
                    // Fetch Table CFIs for Grouping
                    const tableImages = await dbService.getTableImages(bookId);
                    const sectionTableImages = tableImages.filter(img => img.sectionId === nextSection.sectionId);

                    // Preprocess table roots for efficient querying (optimized)
                    const preprocessedTableRoots = this.tableProcessor.preprocessTableRoots(sectionTableImages);

                    // Group (Using raw sentences to ensure correct parent mapping)
                    const groups = this.groupSentencesByRoot(ttsContent.sentences, preprocessedTableRoots);

                    // Detect (will use deduplicated promise if already running)
                    analysisTasks.push(this.getOrDetectContentTypes(bookId, nextSection.sectionId, groups));
                }

                // 3. Table Adaptation Analysis
                if (genAISettings.isTableAdaptationEnabled) {
                    analysisTasks.push(
                        this.tableProcessor.processTableAdaptations(
                            bookId,
                            nextSection.sectionId,
                            ttsContent.sentences,
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

            // Preprocess table roots for efficient querying (optimized)
            const preprocessedTableRoots = this.tableProcessor.preprocessTableRoots(sectionTableImages);

            // Group sentences by Root Node
            const groups = this.groupSentencesByRoot(targetSentences, preprocessedTableRoots);
            const referenceStartCfi = await this.getOrDetectContentTypes(bookId, sectionId, groups);

            if (referenceStartCfi && skipTypes.includes('reference')) {
                let isReferenceSection = false;
                for (const g of groups) {
                    if (g.rootCfi === referenceStartCfi) {
                        isReferenceSection = true;
                    }
                    if (isReferenceSection) {
                        for (const segment of g.segments) {
                            if (segment.sourceIndices) {
                                segment.sourceIndices.forEach(idx => indicesToSkip.add(idx));
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


    /**
     * Retrieves cached reference start CFI from DB or triggers GenAI detection if missing.
     */
    async getOrDetectContentTypes(bookId: string, sectionId: string, groups: { rootCfi: string; segments: { text: string; cfi: string }[]; fullText: string }[]): Promise<string | undefined | null> {
        // Deduplicate concurrent requests for the same section
        const key = `${bookId}:${sectionId}`;
        if (this.analysisPromises.has(key)) {
            return this.analysisPromises.get(key);
        }

        const promise = (async () => {
            // 1. Check existing classification in DB
            const contentAnalysis = await dbService.getContentAnalysis(bookId, sectionId);

            // If we have stored reference start CFI, return it
            if (contentAnalysis?.referenceStartCfi !== undefined) {
                return contentAnalysis.referenceStartCfi;
            }

            // RETRY LOGIC: Check status and timestamps
            if (contentAnalysis?.status === 'success') {
                return contentAnalysis.referenceStartCfi || undefined;
            }

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

                    // Note: Using default model (gemini-1.5-flash) from GenAIService
                    const results = await genAIService.detectContentTypes(nodesToDetect, { bookTitle, sectionTitle });

                    // Find the first result marked as reference
                    const referenceResult = results.find(res => res.type === 'reference');
                    const referenceStartCfi = referenceResult ? idToCfiMap.get(referenceResult.id) : undefined;

                    // Persist detection results (this sets status to 'success')
                    await dbService.saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
                    return referenceStartCfi;
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

        // Cache the clean parent base for the current group to avoid repeated string ops
        let currentParentBase: string | null = null;

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
            if (currentGroup && currentParentBase === null) {
                // Initialize cache if missing
                currentParentBase = currentGroup.parentCfi.endsWith(')') ? currentGroup.parentCfi.slice(0, -1) : currentGroup.parentCfi;
            }

            const newParentBase = parentCfi.endsWith(')') ? parentCfi.slice(0, -1) : parentCfi;

            // Check if one path is a prefix of the other, confirming they belong to the same branch.
            // We verify that the prefix match is followed by a separator or is the end of string
            // to avoid false positives (e.g. "/1" matching "/10").
            const isDescendant = currentGroup && currentParentBase && newParentBase.startsWith(currentParentBase) &&
                (newParentBase.length === currentParentBase.length || ['/', '!', ':'].includes(newParentBase[currentParentBase.length]));

            const isAncestor = currentGroup && currentParentBase && currentParentBase.startsWith(newParentBase) &&
                (currentParentBase.length === newParentBase.length || ['/', '!', ':'].includes(currentParentBase[newParentBase.length]));

            const isInternalNode = isDescendant || isAncestor;

            if (!currentGroup || !isInternalNode) {
                if (currentGroup) {
                    finalizeGroup(currentGroup);
                }
                currentGroup = { parentCfi, segments: [], fullText: '' };
                // Reset cache
                currentParentBase = parentCfi.endsWith(')') ? parentCfi.slice(0, -1) : parentCfi;
            } else if (isAncestor) {
                // If the new sentence is an ancestor of the current group (e.g. a Div containing a P),
                // we expand the group's scope to the ancestor's level. This ensures subsequent
                // descendants of this ancestor are correctly included in the group.
                currentGroup.parentCfi = parentCfi;
                // Update cache
                currentParentBase = newParentBase;
            }

            currentGroup.segments.push(s);
            // Optimization: Only accumulate enough text for detection (200 chars needed, cap at 1000 for safety)
            if (currentGroup.fullText.length < 1000) {
                currentGroup.fullText += s.text + '. ';
            }
        }

        if (currentGroup) {
            finalizeGroup(currentGroup);
        }
        return groups;
    }
}
