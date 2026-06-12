/**
 * ReferenceSectionDetector — the reference-section ("endnotes tail")
 * detection strategy unit of the strangled AudioContentPipeline (Phase 5c;
 * phase5-tts-strangler.md §5c.2).
 *
 *  - Strategies: `deterministic` (the enumerator-run detector, always
 *    available) | GenAI (through the EXISTING GenAIService surface via the
 *    EngineContext GenAI port — the Phase 7 track replaces its internals),
 *    which also shadow-runs the deterministic detector for telemetry.
 *  - Owns the persisted retry/timeout state machine and the concurrent
 *    promise dedup that previously lived in getOrDetectContentTypes.
 *  - Telemetry is an INJECTED observer ({@link DetectionTelemetry}); the
 *    default GenAI-log implementation lives in ./detectionTelemetry.
 *  - D4 fix by construction: the input is `{groups, citationMarkers}` —
 *    sentences and markers ALWAYS travel together; there is no markers-less
 *    entry point.
 */
import type { CitationMarker } from '~types/db';
import type { CfiGroup } from '@kernel/cfi';
import { attributeMarkersToGroups } from '@kernel/cfi';
import { findTocItem } from '../reader/titleResolver';
import { ensureGenAIReady } from './genaiReady';
import type { GenAIPort, ContentAnalysisPort, BookInfoPort, BookContentPort } from './engine/EngineContext';

/** Enumerator patterns for reference entries: "[1] Author", "1. Author", "1 Smith". */
export const REFERENCE_ENUMERATOR_RE = /^\s*(?:\[(\d+)\]|(\d+)[.)]\s|(\d+)\s+[A-Z])/;

/** The narrow port slice the detector needs (injected; tests pass fakes). */
export interface DetectorPorts {
    genAI: GenAIPort;
    contentAnalysis: ContentAnalysisPort;
    book: Pick<BookInfoPort, 'getMetadata'>;
    content: Pick<BookContentPort, 'getBookStructure'>;
}

/** Everything the detector observed for one GenAI detection run. */
export interface DetectionObservation {
    bookId: string;
    sectionId: string;
    groups: CfiGroup[];
    markers: CitationMarker[];
    /** Per-marker group attribution (see attributeMarkersToGroups). */
    markerGroupIndex: number[];
    geminiCfi: string | undefined;
    detShadowCfi: string | null;
    enumeratorCandidateIndex: number;
    markerDropoffIndex: number;
    agreedWithHeuristic: boolean;
    justification: string;
}

/** Injected detection-telemetry observer (phase5 §5c.2). */
export interface DetectionTelemetry {
    onDetection(observation: DetectionObservation): void;
}

/** The detector's input: sentences (as groups) and markers, ALWAYS together. */
export interface DetectionInput {
    groups: CfiGroup[];
    citationMarkers: CitationMarker[];
}

const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes
const LOADING_TIMEOUT = 60 * 1000; // 1 minute (in case process died)

export class ReferenceSectionDetector {
    private detectionPromises = new Map<string, Promise<string | undefined | null>>();

    constructor(
        private readonly ports: DetectorPorts,
        private readonly telemetry?: DetectionTelemetry,
    ) {}

    /**
     * Retrieves the cached reference start CFI or runs detection. Returns the
     * reference-start root CFI, undefined when the section has none, or null
     * when detection is unavailable (disabled, recent error, in flight).
     */
    detect(bookId: string, sectionId: string, input: DetectionInput): Promise<string | undefined | null> {
        // Deduplicate concurrent requests for the same section
        const key = `${bookId}:${sectionId}`;
        const existing = this.detectionPromises.get(key);
        if (existing) return existing;

        const promise = this.detectInternal(bookId, sectionId, input);
        this.detectionPromises.set(key, promise);
        return promise.finally(() => {
            this.detectionPromises.delete(key);
        });
    }

    private async detectInternal(bookId: string, sectionId: string, input: DetectionInput): Promise<string | undefined | null> {
        const { groups, citationMarkers } = input;
        const { contentAnalysis, genAI } = this.ports;

        // 1. Check existing classification in DB
        const persisted = await contentAnalysis.getContentAnalysis(bookId, sectionId);

        // If we have stored reference start CFI, return it
        if (persisted?.referenceStartCfi !== undefined) {
            return persisted.referenceStartCfi;
        }

        // RETRY LOGIC: check status and timestamps (the persisted state machine)
        if (persisted?.status === 'success') {
            return persisted.referenceStartCfi || undefined;
        }

        if (persisted?.status === 'loading') {
            const elapsed = Date.now() - (persisted.lastAttempt || 0);
            if (elapsed < LOADING_TIMEOUT) {
                // Still loading, skip
                return null;
            }
        }

        if (persisted?.status === 'error') {
            const elapsed = Date.now() - (persisted.lastAttempt || 0);
            if (elapsed < RETRY_DELAY) {
                console.warn(`Skipping analysis for ${bookId}/${sectionId}: Recent error (${Math.round(elapsed / 1000)}s ago)`);
                return null;
            }
        }

        // 2. If not found, detect
        const strategy = genAI.getSettings().referenceDetectionStrategy;

        // Deterministic-only path
        if (strategy === 'deterministic') {
            const detIndex = runDeterministicDetector(groups);
            const detCfi = detIndex >= 0 ? groups[detIndex]?.rootCfi : null;
            await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, detCfi ?? undefined);
            return detCfi ?? undefined;
        }

        try {
            if (!(await ensureGenAIReady(genAI))) {
                return null;
            }

            // Mark as loading to prevent concurrent attempts from other sources
            contentAnalysis.markAnalysisLoading(bookId, sectionId);

            const idToCfiMap = new Map<string, string>();
            const markers = citationMarkers;
            const markerGroupIndex = attributeMarkersToGroups(groups, markers);

            // Compute hint signals for the prompt (the deterministic shadow run)
            const enumeratorCandidateIndex = runDeterministicDetector(groups);
            const markerDropoffIndex = computeMarkerDropoffIndex(groups, markers, markerGroupIndex);

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

            const { bookTitle, sectionTitle } = await this.lookupTitles(bookId, sectionId);

            const { classifications: results, justification, agreedWithHeuristic } = await genAI.detectContentTypes(
                nodesToDetect,
                { enumeratorCandidate: enumeratorCandidateIndex },
                { bookTitle, sectionTitle }
            );

            // Find the first result marked as reference
            const referenceResult = results.find(res => res.type === 'reference');
            const referenceStartCfi = referenceResult ? idToCfiMap.get(referenceResult.id) : undefined;

            // Deterministic shadow result mapped back to rootCfi for telemetry
            const detShadowCfi = enumeratorCandidateIndex >= 0 ? groups[enumeratorCandidateIndex]?.rootCfi ?? null : null;
            this.telemetry?.onDetection({
                bookId, sectionId, groups, markers, markerGroupIndex,
                geminiCfi: referenceStartCfi, detShadowCfi,
                enumeratorCandidateIndex, markerDropoffIndex, agreedWithHeuristic, justification,
            });

            // Persist detection results (this sets status to 'success')
            await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
            return referenceStartCfi;
        } catch (e: unknown) {
            console.warn("Content detection failed", e);
            // Mark as error with timestamp
            const message = e instanceof Error ? e.message : String(e);
            contentAnalysis.markAnalysisError(bookId, sectionId, message || 'Unknown error');
        }

        return null;
    }

    private async lookupTitles(bookId: string, sectionId: string): Promise<{ bookTitle: string; sectionTitle: string }> {
        const bookMetadata = await this.ports.book.getMetadata(bookId);
        const bookTitle = bookMetadata?.title || 'Unknown Book';
        const structure = await this.ports.content.getBookStructure(bookId);
        const tocEntry = structure?.toc ? findTocItem(structure.toc, sectionId) : null;
        return { bookTitle, sectionTitle: tocEntry?.label || 'Unknown Section' };
    }
}

/**
 * Deterministic reference-section detector.
 * Finds the longest tail run of consecutive groups that match enumerator patterns
 * (e.g., "[1] Author", "1. Author", "1 Smith") starting at or past 60% of chapter length.
 * Returns the group index of the first group in that run, or -1 if none found.
 */
export function runDeterministicDetector(groups: ReadonlyArray<{ fullText: string }>): number {
    let bestRunStart = -1;
    let bestRunLen = 0;
    let runStart = -1;
    let runLen = 0;

    for (let i = 0; i < groups.length; i++) {
        if (REFERENCE_ENUMERATOR_RE.test(groups[i].fullText)) {
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
export function computeMarkerDropoffIndex(
    groups: ReadonlyArray<{ segments: ReadonlyArray<{ cfi: string }> }>,
    markers: ReadonlyArray<CitationMarker>,
    markerGroupIndex: ReadonlyArray<number>
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
 * Maps a detected reference-start root CFI to the raw sentence indices of the
 * reference tail (that group and everything after it). Pure — the skip-mask
 * currency is `sourceIndices` (raw extraction indices).
 */
export function collectReferenceTailIndices(
    groups: ReadonlyArray<CfiGroup>,
    referenceStartCfi: string | undefined | null
): Set<number> {
    const indicesToSkip = new Set<number>();
    if (!referenceStartCfi) return indicesToSkip;

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
    return indicesToSkip;
}
