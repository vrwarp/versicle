import { dbService } from '../../db/DBService';
import { TextSegmenter } from './TextSegmenter';
import type { EngineContext } from './engine/EngineContext';
import { generateSecureId } from '../crypto';
import EpubCFI from 'epubjs/src/epubcfi';
import type { CitationMarker } from '../../types/db';
import { genAIService } from '../genai/GenAIService';
import { getParentCfi, generateCfiRange, parseCfiRange, type PreprocessedRoot } from '../cfi-utils';
import type { SectionMetadata } from '../../types/db';
import type { ContentType } from '../../types/content-analysis';
import type { TTSQueueItem } from './AudioPlayerService';
import type { SentenceNode } from '../tts';
import { BIBLE_ABBREVIATIONS } from '../../data/bible-lexicon';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { findTocItem, resolveSyntheticPreference } from '../reader/titleResolver';

/**
 * Manages the transformation of raw book content into a playable TTS queue.
 * Handles content fetching, GenAI-based filtering (tables, footnotes), and text segmentation.
 */
export class AudioContentPipeline {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private analysisPromises = new Map<string, Promise<any>>();

    private lastAbbrInputs: { custom: string[], bible: boolean } | null = null;
    private lastAbbrResult: string[] | null = null;

    private readonly ctx: EngineContext;
    public tableProcessor: TableAdaptationProcessor;

    /**
     * @param ctx The engine context. Required (no default) so this module never statically
     *   imports the Zustand-backed context — that keeps the engine graph worker-importable.
     *   The main thread passes `createZustandEngineContext()`; a worker passes a
     *   message-channel-backed context; tests pass a fake.
     */
    constructor(ctx: EngineContext) {
        this.ctx = ctx;
        this.tableProcessor = new TableAdaptationProcessor(ctx);
    }

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

            const bookMetadata = await this.ctx.book.getMetadata(bookId);
            const useSynthetic = resolveSyntheticPreference(bookMetadata);

            if (useSynthetic) {
                // Priority 1: AI-extracted title
                const analysis = await this.ctx.contentAnalysis.getContentAnalysis(bookId, section.sectionId);
                if (analysis && analysis.structure && analysis.structure.title) {
                    title = analysis.structure.title;
                }
            }

            // Priority 2: Label from the Stored TOC
            if (!title) {
                const structure = await dbService.getBookStructure(bookId);

                const tocSource = (useSynthetic && bookMetadata?.syntheticToc)
                    ? bookMetadata.syntheticToc
                    : structure?.toc;

                const tocEntry = tocSource ? findTocItem(tocSource, section.sectionId) : null;

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
            this.ctx.readerUI.setCurrentSection(title, section.sectionId);

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
                const settings = this.ctx.config.getSettings();

                // Inject Bible abbreviations if enabled
                const biblePref = await this.ctx.lexicon.getBibleLexiconPreference(bookId);
                const shouldIncludeBible = biblePref === 'on' || (biblePref === 'default' && settings.isBibleLexiconEnabled);

                const abbreviations = this.getMergedAbbreviations(settings.customAbbreviations, shouldIncludeBible);

                const finalSentences = TextSegmenter.refineSegments(
                    workingSentences,
                    abbreviations,
                    settings.alwaysMerge,
                    settings.sentenceStarters,
                    settings.profiles[bookMetadata?.language || 'en']?.minSentenceLength ?? this.ctx.config.getDefaultMinSentenceLength(bookMetadata?.language || 'en'),
                    bookMetadata?.language || 'en'
                );

                // Add Preroll if enabled
                if (prerollEnabled) {
                    const prerollText = this.generatePreroll(title, Math.round(section.characterCount / 5), speed);
                    newQueue.push({
                        text: prerollText,
                        cfi: null,
                        isPreroll: true,
                        title: title
                    });
                }

                finalSentences.forEach((s) => {
                    if (s.cfi) {
                        newQueue.push({
                            text: s.text,
                            cfi: s.cfi,
                            sourceIndices: s.sourceIndices,
                            isSkipped: false,
                            title: title
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
                    title: title
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
        const genAISettings = this.ctx.genAI.getSettings();
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
        const genAISettings = this.ctx.genAI.getSettings();
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
                    analysisTasks.push(this.getOrDetectContentTypes(bookId, nextSection.sectionId, groups, ttsContent.citationMarkers));
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
            let citationMarkers: CitationMarker[] | undefined;
            if (!targetSentences) {
                const ttsContent = await dbService.getTTSContent(bookId, sectionId);
                targetSentences = ttsContent?.sentences || [];
                citationMarkers = ttsContent?.citationMarkers;
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
            const referenceStartCfi = await this.getOrDetectContentTypes(bookId, sectionId, groups, citationMarkers);

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
     * Retrieves cached reference start CFI from DB or triggers detection if missing.
     * Strategy is read from the GenAI store. Gemini also shadow-runs the deterministic
     * detector for telemetry, enabling offline threshold tuning.
     */
    async getOrDetectContentTypes(bookId: string, sectionId: string, groups: { rootCfi: string; segments: { text: string; cfi: string }[]; fullText: string }[], citationMarkers?: CitationMarker[]): Promise<string | undefined | null> {
        // Deduplicate concurrent requests for the same section
        const key = `${bookId}:${sectionId}`;
        if (this.analysisPromises.has(key)) {
            return this.analysisPromises.get(key);
        }

        const promise = (async () => {
            // 1. Check existing classification in DB
            const contentAnalysis = await this.ctx.contentAnalysis.getContentAnalysis(bookId, sectionId);

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

            // 2. If not found, detect
            const aiStore = this.ctx.genAI.getSettings();
            const strategy = aiStore.referenceDetectionStrategy;

            // Deterministic-only path
            if (strategy === 'deterministic') {
                const detIndex = this.runDeterministicDetector(groups);
                const detCfi = detIndex >= 0 ? groups[detIndex]?.rootCfi : null;
                await this.ctx.contentAnalysis.saveReferenceStartCfi(bookId, sectionId, detCfi ?? undefined);
                return detCfi ?? undefined;
            }

            const canUseGenAI = aiStore.isEnabled && (genAIService.isConfigured() || !!aiStore.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse')));

            if (!canUseGenAI) {
                return null;
            }

            try {
                // Mark as loading to prevent concurrent attempts from other sources
                this.ctx.contentAnalysis.markAnalysisLoading(bookId, sectionId);

                const idToCfiMap = new Map<string, string>();
                const markers = citationMarkers || [];
                const markerGroupIndex = this.attributeMarkersToGroups(groups, markers);

                // Compute hint signals for the prompt
                const enumeratorCandidateIndex = this.runDeterministicDetector(groups);
                const markerDropoffIndex = this.computeMarkerDropoffIndex(groups, markers, markerGroupIndex);

                const nodesToDetect = groups.map((g, index) => {
                    const id = index.toString();
                    idToCfiMap.set(id, g.rootCfi);
                    const groupMarkers = markers.filter((_, mi) => markerGroupIndex[mi] === index);
                    return {
                        id,
                        sampleText: g.fullText,
                        // A note/endnote entry opens with its reference anchor. This position-aware
                        // flag is a far stronger signal than a position-independent marker count.
                        leadsWithMarker: groupMarkers.some(m => m.leading),
                    };
                });

                // Ensure service is configured if we have a key
                if (!genAIService.isConfigured() && aiStore.apiKey) {
                    genAIService.configure(aiStore.apiKey, 'gemini-1.5-flash'); // Fallback default
                }

                if (genAIService.isConfigured()) {
                    const bookMetadata = await this.ctx.book.getMetadata(bookId);
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

                    const { classifications: results, justification, agreedWithHeuristic } = await genAIService.detectContentTypes(
                        nodesToDetect,
                        { enumeratorCandidate: enumeratorCandidateIndex },
                        { bookTitle, sectionTitle }
                    );

                    // Find the first result marked as reference
                    const referenceResult = results.find(res => res.type === 'reference');
                    const referenceStartCfi = referenceResult ? idToCfiMap.get(referenceResult.id) : undefined;

                    // Deterministic shadow result mapped back to rootCfi for telemetry
                    const detShadowCfi = enumeratorCandidateIndex >= 0 ? groups[enumeratorCandidateIndex]?.rootCfi ?? null : null;
                    this.emitReferenceDetectionTelemetry({ bookId, sectionId, groups, markers, markerGroupIndex, geminiCfi: referenceStartCfi, detShadowCfi, enumeratorCandidateIndex, markerDropoffIndex, agreedWithHeuristic, justification });

                    // Persist detection results (this sets status to 'success')
                    await this.ctx.contentAnalysis.saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
                    return referenceStartCfi;
                }
            } catch (e: unknown) {
                console.warn("Content detection failed", e);
                // Mark as error with timestamp
                const message = e instanceof Error ? e.message : String(e);
                this.ctx.contentAnalysis.markAnalysisError(bookId, sectionId, message || 'Unknown error');
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
     * Deterministic reference-section detector.
     * Finds the longest tail run of consecutive groups that match enumerator patterns
     * (e.g., "[1] Author", "1. Author", "1 Smith") starting at or past 60% of chapter length.
     * Returns the group index of the first group in that run, or -1 if none found.
     */
    private runDeterministicDetector(groups: { fullText: string }[]): number {
        const ENUMERATOR = /^\s*(?:\[(\d+)\]|(\d+)[.)]\s|(\d+)\s+[A-Z])/;
        let bestRunStart = -1;
        let bestRunLen = 0;
        let runStart = -1;
        let runLen = 0;

        for (let i = 0; i < groups.length; i++) {
            if (ENUMERATOR.test(groups[i].fullText)) {
                if (runLen === 0) runStart = i;
                runLen++;
                if (runLen > bestRunLen) {
                    bestRunLen = runLen;
                    bestRunStart = runStart;
                }
            } else {
                runLen = 0;
            }
        }

        if (bestRunLen >= 2 && bestRunStart >= groups.length * 0.6) {
            return bestRunStart;
        }
        return -1;
    }

    /**
     * Finds the highest group index where superscript citation markers are still dense.
     * Signals the last body group before an endnote block (markers drop off past this index).
     * Returns -1 if total superscript markers < 3 or no dense window found.
     */
    private computeMarkerDropoffIndex(
        groups: { segments: { cfi: string }[] }[],
        markers: CitationMarker[],
        markerGroupIndex: number[]
    ): number {
        const totalSuper = markers.filter(m => m.super).length;
        if (totalSuper < 3) return -1;

        const n = groups.length;
        const groupSuperCounts = new Array(n).fill(0);
        markers.forEach((mk, mi) => {
            const gi = markerGroupIndex[mi];
            if (gi >= 0 && gi < n && mk.super) groupSuperCounts[gi]++;
        });

        for (let i = n - 1; i >= 0; i--) {
            if (groupSuperCounts[i] === 0) continue;
            let windowCount = 0;
            for (let j = Math.max(0, i - 4); j <= i; j++) windowCount += groupSuperCounts[j];
            if (windowCount >= 2) return i;
        }
        return -1;
    }

    /**
     * Attributes each citation marker to the group whose [firstSegmentCfi, lastSegmentCfi]
     * range contains it, using proper CFI comparison. Returns a per-marker array of group
     * indices (-1 when no group contains the marker or comparison fails).
     */
    private attributeMarkersToGroups(
        groups: { segments: { cfi: string }[] }[],
        markers: CitationMarker[]
    ): number[] {
        if (markers.length === 0) return [];
        const comparer = new EpubCFI();
        // Pre-parse group bounds once.
        //
        // The upper bound MUST be the END of the last segment, not the last segment's range CFI
        // itself. epubjs `compare` against a range CFI uses that range's START offset, so
        // `new EpubCFI(lastSegmentRange)` collapses the upper bound down to where the last
        // segment *begins*. For a single-segment group (first === last) that makes the
        // [start, end] window a single point, orphaning any marker that isn't exactly at the
        // segment start — e.g. a footnote-head back-reference that sits in a <span> before the
        // spoken text. Convert both ends to explicit point CFIs (first-segment start,
        // last-segment end) via parseCfiRange so the window spans the group's full extent.
        const bounds = groups.map(g => {
            const first = g.segments[0]?.cfi;
            const last = g.segments[g.segments.length - 1]?.cfi;
            if (!first || !last) return null;
            try {
                const startPoint = parseCfiRange(first)?.fullStart || first;
                const endPoint = parseCfiRange(last)?.fullEnd || last;
                return { start: new EpubCFI(startPoint), end: new EpubCFI(endPoint) };
            } catch {
                return null;
            }
        });

        return markers.map(mk => {
            let parsed: EpubCFI;
            try {
                parsed = new EpubCFI(mk.cfi);
            } catch {
                return -1;
            }
            for (let i = 0; i < bounds.length; i++) {
                const b = bounds[i];
                if (!b) continue;
                try {
                    // @ts-expect-error epubjs compare accepts EpubCFI objects despite strict string types
                    if (comparer.compare(parsed, b.start) >= 0 && comparer.compare(parsed, b.end) <= 0) {
                        return i;
                    }
                } catch {
                    // ignore this group
                }
            }
            return -1;
        });
    }

    /** Normalizes a numeric marker/enumerator to its bare digits (e.g. "[3]" → "3"), else null. */
    private normalizeEnumerator(text: string): string | null {
        const m = /(\d+)/.exec(text);
        return m ? m[1] : null;
    }

    private emitReferenceDetectionTelemetry(params: {
        bookId: string;
        sectionId: string;
        groups: { rootCfi: string; segments: { text: string; cfi: string }[]; fullText: string }[];
        markers: CitationMarker[];
        markerGroupIndex: number[];
        geminiCfi: string | undefined;
        detShadowCfi: string | null;
        enumeratorCandidateIndex: number;
        markerDropoffIndex: number;
        agreedWithHeuristic: boolean;
        justification: string;
    }): void {
        const { bookId, sectionId, groups, markers, markerGroupIndex, geminiCfi, detShadowCfi, enumeratorCandidateIndex, markerDropoffIndex, agreedWithHeuristic, justification } = params;
        const ENUMERATOR = /^\s*(?:\[(\d+)\]|(\d+)[.)]\s|(\d+)\s+[A-Z])/;
        const n = groups.length;

        // Per-group marker counts (and whether any leading marker attributes there) from the
        // shared attribution. leadsWithMarker is the position-aware signal now fed to the model.
        const groupMarkerCounts = new Array(n).fill(0);
        const groupLeadsWithMarker = new Array(n).fill(false);
        markers.forEach((mk, mi) => {
            const gi = markerGroupIndex[mi];
            if (gi >= 0 && gi < n) {
                groupMarkerCounts[gi]++;
                if (mk.leading) groupLeadsWithMarker[gi] = true;
            }
        });

        // Per-group features. startCfi/endCfi are the exact segment bounds used by
        // attributeMarkersToGroups — pairing them with markerDetail below makes orphaned
        // markers (groupIndex -1) diagnosable: compare a marker's cfi against the bounds.
        const perGroup = groups.map((g, i) => {
            const m = ENUMERATOR.exec(g.fullText);
            const enumeratorValue = m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
            const enumeratorType = m
                ? (m[1] ? 'bracketed' : m[2] ? 'dotted' : 'spaced')
                : null;
            return {
                groupIndex: i,
                fractionFromEnd: n > 1 ? (n - 1 - i) / (n - 1) : 0,
                enumeratorType,
                enumeratorValue,
                markerCount: groupMarkerCounts[i],
                leadsWithMarker: groupLeadsWithMarker[i],
                segmentCount: g.segments.length,
                startCfi: g.segments[0]?.cfi,
                endCfi: g.segments[g.segments.length - 1]?.cfi,
            };
        });

        // Per-marker dump: full marker metadata plus the group it attributed to (-1 = orphaned).
        // Lets offline analysis reconstruct exactly why a marker landed inside or outside a group.
        const markerDetail = markers.map((mk, mi) => ({
            cfi: mk.cfi,
            markerText: mk.markerText,
            super: mk.super,
            numeric: mk.numeric,
            glued: mk.glued,
            targetHref: mk.targetHref,
            groupIndex: markerGroupIndex[mi] ?? -1,
        }));

        // Body = first 60% of groups; tail = last 40%.
        // bodyMarkerSet holds normalized numeric markers found in the body; tailEnumeratorSet
        // holds enumerators starting tail groups. High overlap → tail enumerates body citations.
        const bodyThreshold = Math.floor(n * 0.6);
        const bodyMarkerSet = new Set<string>();
        markers.forEach((mk, mi) => {
            const gi = markerGroupIndex[mi];
            if (gi !== -1 && gi < bodyThreshold && mk.numeric) {
                const norm = this.normalizeEnumerator(mk.markerText);
                if (norm) bodyMarkerSet.add(norm);
            }
        });

        const tailGroups = groups.slice(bodyThreshold);
        const tailEnumeratorSet = new Set<string>();
        let longestTailEnumeratorRun = 0;
        let curRun = 0;
        for (const g of tailGroups) {
            const m = ENUMERATOR.exec(g.fullText);
            if (m) {
                const val = m[1] ?? m[2] ?? m[3];
                if (val) tailEnumeratorSet.add(val);
                curRun++;
                if (curRun > longestTailEnumeratorRun) longestTailEnumeratorRun = curRun;
            } else {
                curRun = 0;
            }
        }

        const overlap = [...bodyMarkerSet].filter(v => tailEnumeratorSet.has(v)).length;
        const setOverlapFraction = tailEnumeratorSet.size > 0
            ? overlap / tailEnumeratorSet.size
            : 0;

        this.ctx.genAI.addLog({
            id: generateSecureId(),
            timestamp: Date.now(),
            type: 'response',
            method: 'detectReferenceStart',
            payload: {
                bookId,
                sectionId,
                groupCount: n,
                markerCount: markers.length,
                orphanMarkerCount: markerGroupIndex.filter(gi => gi === -1).length,
                geminiCfi,
                detShadowCfi,
                enumeratorCandidateIndex,
                markerDropoffIndex,
                agreedWithHeuristic,
                justification,
                setOverlapFraction,
                longestTailEnumeratorRun,
                bodyMarkerSet: [...bodyMarkerSet],
                tailEnumeratorSet: [...tailEnumeratorSet],
                markerDetail,
                perGroup,
            },
        });
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
