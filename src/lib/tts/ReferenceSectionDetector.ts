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
 *  - Model calls run ONE AT A TIME across sections (the load path and the
 *    next-section prewarm used to fire two requests in the same millisecond
 *    at a 5-requests-per-minute pool, and the Jul–Sep 2026 export showed one
 *    of each such pair dying without an answer), and sections too small to
 *    hold a reference tail never reach the model at all.
 *  - A LINKED NOTE TAIL is decided locally, with no model call: the trailing
 *    run of groups that open with a citation marker linking back to the body
 *    ({@link findLeadingMarkerRun}). On the Oct 2026 export that run started
 *    exactly where the model put the boundary in both answered sections, and
 *    would have answered three of the seven sections that never got one.
 *  - Every model failure reaches the telemetry observer too, with the
 *    section's full marker/group structure, so a section that never gets an
 *    answer is diagnosable offline (the export used to hold only its prompt);
 *    the deterministic shadow result answers that playback meanwhile.
 */
import type { CitationMarker } from '~types/cache';
import type { CfiGroup } from '@kernel/cfi';
import { attributeMarkersToGroups } from '@kernel/cfi';
import { findTocItem } from '../reader/titleResolver';
import { generateSecureId } from '../crypto';
import { ensureGenAIReady } from './genaiReady';
import type { GenAIPort, ContentAnalysisPort, BookInfoPort, BookContentPort } from './engine/EngineContext';

/** Enumerator patterns for reference entries: "[1] Author", "1. Author", "1 Smith". */
export const REFERENCE_ENUMERATOR_RE = /^\s*(?:\[(\d+)\]|(\d+)[.)]\s|(\d+)\s+[A-Z])/;

/**
 * Sections with this many groups or fewer are answered by the deterministic
 * detector alone. A one-to-five group section cannot carry a body AND a
 * reference tail worth a model call: on the Jul–Sep 2026 export 25 of 286
 * detection requests (22 sections) were spent on such sections, and the
 * validator already skipped its own checks for them.
 */
export const MAX_GROUPS_FOR_DETERMINISTIC_ONLY = 5;

/**
 * The position floor for the linked-note-tail answer ({@link runLeadingMarkerDetector}):
 * the run must start at or past this fraction of the section's groups to be
 * decided locally. Without a floor a scripture chapter whose every verse
 * opens with a linked number would be silenced whole; with it, a section
 * that IS all notes starts below the floor and goes to the model with the
 * run as a hint instead. Lower than the enumerator detector's 60%: a 57-note
 * tail on the Oct 2026 export began at 59.9% of its chapter, and a run that
 * reaches the last group with every entry linked is far stronger evidence
 * than a run of text enumerators.
 */
export const LEADING_MARKER_MIN_POSITION = 0.5;

/** The narrow port slice the detector needs (injected; tests pass fakes). */
export interface DetectorPorts {
    genAI: GenAIPort;
    contentAnalysis: ContentAnalysisPort;
    book: Pick<BookInfoPort, 'getMetadata'>;
    content: Pick<BookContentPort, 'getBookStructure'>;
}

/** A trailing run of groups that each open with a linked citation marker. */
export interface LeadingMarkerRun {
    /** Index of the run's first group; the run always reaches the last group. */
    start: number;
    length: number;
}

/** Who decided the boundary — or that nobody did (the model call failed). */
type DetectionSource = 'model' | 'leading-marker' | 'failure';

/**
 * A model failure as the telemetry records it. Duck-typed off the C10 error
 * contract (code / context.status / retryable) because the error may have
 * been revived across the worker boundary without its subclass.
 */
interface DetectionFailure {
    message: string;
    /** The stable code (GENAI_UNKNOWN, NET_TIMEOUT, NET_RATE_LIMITED, …) when the error carried one. */
    code?: string;
    /** The HTTP status for a GenAI HTTP failure (503 = overloaded, 429 = quota). */
    status?: number;
    retryable?: boolean;
}

/** Everything the detector observed for one detection run. */
export interface DetectionObservation {
    bookId: string;
    sectionId: string;
    /**
     * Shared by the request/response/error log entries of this model call
     * (minted for a local answer too, so every record has one).
     */
    correlationId: string;
    groups: CfiGroup[];
    markers: CitationMarker[];
    /** Per-marker group attribution (see attributeMarkersToGroups). */
    markerGroupIndex: number[];
    source: DetectionSource;
    /** The persisted answer: the reference-start root CFI, or undefined (none, or failed). */
    referenceStartCfi: string | undefined;
    /** The answer's group index (-1 = no reference section); null when the model call failed. */
    referenceStartIndex: number | null;
    /**
     * referenceStartIndex / groups.length, or null when -1 or failed. The
     * former 40% validation guard lives on here as a REVIEW signal, not a
     * rejection.
     */
    positionFraction: number | null;
    detShadowCfi: string | null;
    enumeratorCandidateIndex: number;
    /** The trailing run of linked-leading-marker groups at ANY position, or null. */
    leadingMarkerRun: LeadingMarkerRun | null;
    /** That run's start when it qualifies as the local answer (see LEADING_MARKER_MIN_POSITION), else -1. */
    leadingMarkerCandidateIndex: number;
    markerDropoffIndex: number;
    /** null when no deterministic hint was given (nothing to agree with), or no model ran. */
    agreedWithHeuristic: boolean | null;
    /** The model's reasoning, or a one-line account of the local decision. */
    justification: string;
    /** Why the model call failed (source 'failure' only). */
    failure?: DetectionFailure;
}

/** The deterministic signals, computed once per detection and shared by every path. */
interface DeterministicShadow {
    markerGroupIndex: number[];
    enumeratorCandidateIndex: number;
    leadingMarkerRun: LeadingMarkerRun | null;
    leadingMarkerCandidateIndex: number;
    markerDropoffIndex: number;
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
    /** The one-at-a-time chain every model call joins (see the header). */
    private modelCallChain: Promise<unknown> = Promise.resolve();

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

        // The deterministic signals are computed ONCE here: every path below
        // uses them — as the answer, as the model's hints, or as the fallback
        // when the model call fails.
        const shadow = computeDeterministicShadow(groups, citationMarkers);

        // Deterministic-only path: the configured strategy, or a section too
        // small to be worth a model call. A linked note tail outranks a run of
        // text enumerators (it is the stronger evidence); either is persisted.
        if (strategy === 'deterministic' || groups.length <= MAX_GROUPS_FOR_DETERMINISTIC_ONLY) {
            const detIndex = shadow.leadingMarkerCandidateIndex >= 0
                ? shadow.leadingMarkerCandidateIndex
                : shadow.enumeratorCandidateIndex;
            const detCfi = shadowCfi(groups, detIndex);
            await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, detCfi ?? undefined);
            return detCfi ?? undefined;
        }

        // Fast path: a linked note tail is decided locally — no model call, no
        // quota, no wait, and no dependence on a model that may be answering
        // 503 all day. Reported to telemetry like a model answer, so the
        // export shows what the heuristic decided and a wrong call is
        // reviewable offline.
        if (shadow.leadingMarkerCandidateIndex >= 0) {
            const index = shadow.leadingMarkerCandidateIndex;
            const referenceStartCfi = groups[index]?.rootCfi;
            const length = shadow.leadingMarkerRun?.length ?? 0;
            this.telemetry?.onDetection({
                bookId, sectionId, correlationId: generateSecureId(), groups, markers: citationMarkers,
                markerGroupIndex: shadow.markerGroupIndex,
                source: 'leading-marker',
                referenceStartCfi,
                referenceStartIndex: index,
                positionFraction: index / groups.length,
                detShadowCfi: shadowCfi(groups, shadow.enumeratorCandidateIndex),
                enumeratorCandidateIndex: shadow.enumeratorCandidateIndex,
                leadingMarkerRun: shadow.leadingMarkerRun,
                leadingMarkerCandidateIndex: index,
                markerDropoffIndex: shadow.markerDropoffIndex,
                agreedWithHeuristic: null,
                justification: `Linked note tail: ${length} groups from group ${index} to the end each open with a citation marker that links back to the text.`,
            });
            await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
            return referenceStartCfi;
        }

        // Model calls are serialized across sections: join the chain, and keep
        // the chain alive whatever this call's outcome.
        const run = this.modelCallChain.then(
            () => this.detectWithModel(bookId, sectionId, groups, citationMarkers, shadow),
        );
        this.modelCallChain = run.catch(() => undefined);
        return run;
    }

    private async detectWithModel(
        bookId: string,
        sectionId: string,
        groups: CfiGroup[],
        citationMarkers: CitationMarker[],
        shadow: DeterministicShadow,
    ): Promise<string | undefined | null> {
        const { contentAnalysis, genAI } = this.ports;
        const markers = citationMarkers;
        const { markerGroupIndex, enumeratorCandidateIndex, leadingMarkerRun, markerDropoffIndex } = shadow;
        // The deterministic shadow result doubles as the terminal answer when
        // the model's reply fails validation, and as this playback's answer
        // when the call fails transiently.
        const detShadowCfi = shadowCfi(groups, enumeratorCandidateIndex);
        // One id per model call, stamped on every log entry the client writes
        // for it AND on the telemetry record, so an exported log pairs
        // request, response/error and telemetry without guessing.
        const correlationId = generateSecureId();
        const observe = (
            outcome: Pick<DetectionObservation, 'source' | 'referenceStartCfi' | 'referenceStartIndex' | 'agreedWithHeuristic' | 'justification' | 'failure'>,
        ): void => {
            const index = outcome.referenceStartIndex;
            this.telemetry?.onDetection({
                bookId, sectionId, correlationId, groups, markers, markerGroupIndex,
                positionFraction: index !== null && index >= 0 && groups.length > 0 ? index / groups.length : null,
                detShadowCfi,
                enumeratorCandidateIndex,
                leadingMarkerRun,
                leadingMarkerCandidateIndex: shadow.leadingMarkerCandidateIndex,
                markerDropoffIndex,
                ...outcome,
            });
        };

        try {
            if (!(await ensureGenAIReady(genAI))) {
                return null;
            }

            // Mark as loading to prevent concurrent attempts from other sources
            contentAnalysis.markAnalysisLoading(bookId, sectionId);

            const idToCfiMap = new Map<string, string>();
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
                {
                    enumeratorCandidate: enumeratorCandidateIndex,
                    // A linked run that reaches the model did NOT qualify as the
                    // local answer (it starts below the position floor): the
                    // model decides whether the section is all notes.
                    leadingMarkerCandidate: leadingMarkerRun ? leadingMarkerRun.start : -1,
                },
                // bookId rides to the egress consent gate (P9 threading).
                { bookId, bookTitle, sectionTitle, correlationId }
            );

            // Find the first result marked as reference. Its id IS the group
            // index (ids were minted from the index above), which stays true
            // even for a partial classification list.
            const referenceResult = results.find(res => res.type === 'reference');
            const referenceStartCfi = referenceResult ? idToCfiMap.get(referenceResult.id) : undefined;
            const parsedId = referenceResult ? Number.parseInt(referenceResult.id, 10) : -1;
            const referenceStartIndex = referenceResult
                ? (Number.isInteger(parsedId) && parsedId >= 0 ? parsedId : results.indexOf(referenceResult))
                : -1;

            observe({ source: 'model', referenceStartCfi, referenceStartIndex, agreedWithHeuristic, justification });

            // Persist detection results (this sets status to 'success')
            await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, referenceStartCfi);
            return referenceStartCfi;
        } catch (e: unknown) {
            console.warn("Content detection failed", e);
            // The failure record carries the section's full structure to the
            // log, so a section that never gets an answer (a 503 streak, a
            // timeout) is diagnosable offline — the export used to hold only
            // its prompt.
            observe({
                source: 'failure',
                referenceStartCfi: undefined,
                referenceStartIndex: null,
                agreedWithHeuristic: null,
                justification: '',
                failure: describeDetectionFailure(e),
            });
            // A validation-rejected model response is not transient: re-sending
            // the identical prompt tends to fail identically, and the 'error'
            // status retry machinery re-attempted it on every revisit past
            // RETRY_DELAY — across sessions and days — without ever converging.
            // Persist the deterministic shadow result as the terminal answer
            // instead. Transient failures (429s, network) keep the retry path.
            // Branch by stable code, not instanceof — the error may have
            // crossed a worker boundary (types/errors.ts contract; the
            // Comlink transfer handler in lib/comlinkAppError.ts is what
            // keeps `code` alive across it).
            if ((e as { code?: string } | null)?.code === 'GENAI_INVALID_RESPONSE') {
                await contentAnalysis.saveReferenceStartCfi(bookId, sectionId, detShadowCfi ?? undefined);
                return detShadowCfi ?? undefined;
            }
            // Mark as error with timestamp
            const message = e instanceof Error ? e.message : String(e);
            contentAnalysis.markAnalysisError(bookId, sectionId, message || 'Unknown error');
            // A transient failure (503, timeout, offline) keeps the model's
            // retry path, but THIS playback gets the deterministic shadow
            // answer when there is one rather than nothing at all.
            return detShadowCfi ?? null;
        }
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
 * Finds the trailing run of groups that OPEN with a citation marker carrying a
 * link target — the shape of a note block whose entries each begin with a
 * superscript number linking back to the body
 * (`<sup><a href="#t1">1</a></sup> Francis Collins et al., …`). Extraction
 * suppresses that number from the spoken text, so {@link runDeterministicDetector}
 * sees "Francis Collins et al., …" and never fires: on the Oct 2026 export it
 * found nothing in any of nine sections, while this run started exactly where
 * the model placed the boundary in both answered ones (173 of 262, 20 of 23).
 *
 * The link target is what separates a note head from a verse number: the body
 * of the same chapter had twelve groups opening with a superscript (block-quoted
 * scripture), none of them linked, while all 89 note markers were. The run is
 * the longest stretch of such groups ending at the LAST group — a gap means
 * the model decides (the Church Fathers chapters on that export had holes in
 * their note blocks and are left to it). Returns null when the last group does
 * not open with a linked marker.
 */
export function findLeadingMarkerRun(
    groups: ReadonlyArray<unknown>,
    markers: ReadonlyArray<Pick<CitationMarker, 'leading' | 'targetHref'>>,
    markerGroupIndex: ReadonlyArray<number>,
): LeadingMarkerRun | null {
    const n = groups.length;
    const opensWithLink = new Array<boolean>(n).fill(false);
    markers.forEach((mk, mi) => {
        const gi = markerGroupIndex[mi];
        if (gi >= 0 && gi < n && mk.leading && mk.targetHref) opensWithLink[gi] = true;
    });
    let start = n;
    while (start > 0 && opensWithLink[start - 1]) start--;
    return start < n ? { start, length: n - start } : null;
}

/** The run start when it may be decided locally (at or past the position floor), else -1. */
function leadingMarkerCandidate(run: LeadingMarkerRun | null, groupCount: number): number {
    return run && run.start >= groupCount * LEADING_MARKER_MIN_POSITION ? run.start : -1;
}

/**
 * Linked-note-tail detector: the {@link findLeadingMarkerRun} start when the
 * run begins at or past {@link LEADING_MARKER_MIN_POSITION} of the section,
 * or -1. A single trailing group counts: a last paragraph that opens with a
 * linked citation marker is a lone endnote, not body text.
 */
export function runLeadingMarkerDetector(
    groups: ReadonlyArray<unknown>,
    markers: ReadonlyArray<Pick<CitationMarker, 'leading' | 'targetHref'>>,
    markerGroupIndex: ReadonlyArray<number>,
): number {
    return leadingMarkerCandidate(findLeadingMarkerRun(groups, markers, markerGroupIndex), groups.length);
}

function computeDeterministicShadow(groups: CfiGroup[], markers: CitationMarker[]): DeterministicShadow {
    const markerGroupIndex = attributeMarkersToGroups(groups, markers);
    const leadingMarkerRun = findLeadingMarkerRun(groups, markers, markerGroupIndex);
    return {
        markerGroupIndex,
        enumeratorCandidateIndex: runDeterministicDetector(groups),
        leadingMarkerRun,
        leadingMarkerCandidateIndex: leadingMarkerCandidate(leadingMarkerRun, groups.length),
        markerDropoffIndex: computeMarkerDropoffIndex(groups, markers, markerGroupIndex),
    };
}

/** A deterministic candidate mapped back to its group's rootCfi (null when none). */
function shadowCfi(groups: ReadonlyArray<CfiGroup>, index: number): string | null {
    return index >= 0 ? groups[index]?.rootCfi ?? null : null;
}

/** The log-safe account of a failed model call (see {@link DetectionFailure}). */
function describeDetectionFailure(e: unknown): DetectionFailure {
    const failure: DetectionFailure = { message: e instanceof Error ? e.message : String(e) };
    if (typeof e !== 'object' || e === null) return failure;
    const { code, retryable, status, context } = e as {
        code?: unknown; retryable?: unknown; status?: unknown; context?: { status?: unknown };
    };
    if (typeof code === 'string') failure.code = code;
    if (typeof retryable === 'boolean') failure.retryable = retryable;
    const httpStatus = typeof status === 'number' ? status : context?.status;
    if (typeof httpStatus === 'number') failure.status = httpStatus;
    return failure;
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
