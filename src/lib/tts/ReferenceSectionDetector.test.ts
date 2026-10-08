/**
 * ReferenceSectionDetector unit suite (Phase 5c; phase5-tts-strangler.md
 * §5c.2): the strategy seam, the persisted retry/timeout state machine, the
 * concurrent promise dedup, and the deterministic detector — previously
 * tested only through AudioContentPipeline integration.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    ReferenceSectionDetector,
    runDeterministicDetector,
    runLeadingMarkerDetector,
    findLeadingMarkerRun,
    computeMarkerDropoffIndex,
    collectReferenceTailIndices,
    MAX_GROUPS_FOR_DETERMINISTIC_ONLY,
    LEADING_MARKER_MIN_POSITION,
} from './ReferenceSectionDetector';
import type { DetectionObservation } from './ReferenceSectionDetector';
import { createGenAILogTelemetry } from './detectionTelemetry';
import { FakeEngineContext } from './engine/FakeEngineContext';
import type { CfiGroup } from '@kernel/cfi';
import type { CitationMarker } from '~types/cache';

const group = (rootCfi: string, fullText: string, sourceIndices: number[] = []): CfiGroup => ({
    rootCfi,
    fullText,
    segments: [{ text: fullText, cfi: rootCfi, sourceIndices }],
});

/** A 10-group chapter whose last 3 groups are an enumerated reference tail. */
const REFERENCE_TAIL_GROUPS: CfiGroup[] = [
    ...Array.from({ length: 7 }, (_, i) => group(`epubcfi(/6/4!/4/${2 * i + 2},,)`, `Body paragraph ${i}.`, [i])),
    group('epubcfi(/6/4!/4/16,,)', '[1] Smith, A Source.', [7]),
    group('epubcfi(/6/4!/4/18,,)', '[2] Jones, Another Source.', [8]),
    group('epubcfi(/6/4!/4/20,,)', '[3] Brown, A Third Source.', [9]),
];

function makeDetector(genAISettings: Record<string, unknown>, telemetry?: { onDetection: (o: DetectionObservation) => void }) {
    const ctx = new FakeEngineContext();
    ctx.genAISettings = { isEnabled: true, apiKey: 'k', ...genAISettings } as never;
    const detector = new ReferenceSectionDetector(
        { genAI: ctx.genAI, contentAnalysis: ctx.contentAnalysis, book: ctx.book, content: ctx.content },
        telemetry,
    );
    return { ctx, detector };
}

describe('ReferenceSectionDetector', () => {
    describe('strategy: deterministic', () => {
        it('persists and returns the enumerator-run result without any model call', async () => {
            const { ctx, detector } = makeDetector({ referenceDetectionStrategy: 'deterministic' });

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            expect(result).toBe('epubcfi(/6/4!/4/16,,)');
            expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: 'epubcfi(/6/4!/4/16,,)' }]);
            expect(ctx.detectContentTypesCalls).toHaveLength(0);
        });

        it('persists undefined when no tail run exists (negative cache)', async () => {
            const { ctx, detector } = makeDetector({ referenceDetectionStrategy: 'deterministic' });
            const groups = REFERENCE_TAIL_GROUPS.slice(0, 7); // body only

            const result = await detector.detect('b', 's', { groups, citationMarkers: [] });

            expect(result).toBeUndefined();
            expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: undefined }]);
        });
    });

    describe('persisted retry/timeout state machine', () => {
        it('returns the stored referenceStartCfi without re-detecting', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.contentAnalyses['b/s'] = { referenceStartCfi: 'epubcfi(/6/4!/4/16,,)' } as never;

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            expect(result).toBe('epubcfi(/6/4!/4/16,,)');
            expect(ctx.detectContentTypesCalls).toHaveLength(0);
        });

        it('skips while a recent loading row exists, retries after the 60s timeout', async () => {
            const { ctx, detector } = makeDetector({ referenceDetectionStrategy: 'deterministic' });
            ctx.contentAnalyses['b/s'] = { status: 'loading', lastAttempt: Date.now() - 10_000 } as never;

            expect(await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] })).toBeNull();

            ctx.contentAnalyses['b/s'] = { status: 'loading', lastAttempt: Date.now() - 61_000 } as never;
            expect(await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] }))
                .toBe('epubcfi(/6/4!/4/16,,)');
        });

        it('backs off after a recent error, retries after the 5-minute delay', async () => {
            const { ctx, detector } = makeDetector({ referenceDetectionStrategy: 'deterministic' });
            ctx.contentAnalyses['b/s'] = { status: 'error', lastAttempt: Date.now() - 60_000 } as never;

            expect(await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] })).toBeNull();

            ctx.contentAnalyses['b/s'] = { status: 'error', lastAttempt: Date.now() - 6 * 60_000 } as never;
            expect(await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] }))
                .toBe('epubcfi(/6/4!/4/16,,)');
        });

        it('marks an analysis error when the model call rejects, answering this playback from the shadow', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const markError = vi.spyOn(ctx.contentAnalysis, 'markAnalysisError');
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(new Error('boom'));

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            // The enumerator shadow (group 7) serves now; the model is retried later.
            expect(result).toBe('epubcfi(/6/4!/4/16,,)');
            expect(markError).toHaveBeenCalledWith('b', 's', 'boom');
            expect(ctx.savedReferenceCfis).toHaveLength(0);
        });

        it('returns null when the model call rejects and no shadow exists', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(new Error('boom'));
            const bodyOnly = REFERENCE_TAIL_GROUPS.slice(0, 7);

            expect(await detector.detect('b', 's', { groups: bodyOnly, citationMarkers: [] })).toBeNull();
        });

        it('persists the deterministic shadow as TERMINAL on a validation-rejected response (no retry loop)', async () => {
            // GENAI_INVALID_RESPONSE is not transient: the identical prompt fails
            // identically on every revisit, so the error-status retry machinery
            // must not re-send it across sessions. The deterministic shadow
            // result becomes the stored answer instead.
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const markError = vi.spyOn(ctx.contentAnalysis, 'markAnalysisError');
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(
                Object.assign(new Error('referenceStartIndex 0 is before 40% of chapter'), {
                    code: 'GENAI_INVALID_RESPONSE',
                }),
            );

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            // Shadow = enumerator run starting at group 7
            expect(result).toBe('epubcfi(/6/4!/4/16,,)');
            expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: 'epubcfi(/6/4!/4/16,,)' }]);
            expect(markError).not.toHaveBeenCalled();
        });

        it('persists a terminal negative when validation rejects and the shadow found nothing', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const markError = vi.spyOn(ctx.contentAnalysis, 'markAnalysisError');
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(
                Object.assign(new Error('bad response'), { code: 'GENAI_INVALID_RESPONSE' }),
            );
            const bodyOnly = REFERENCE_TAIL_GROUPS.slice(0, 7);

            const result = await detector.detect('b', 's', { groups: bodyOnly, citationMarkers: [] });

            expect(result).toBeUndefined();
            expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: undefined }]);
            expect(markError).not.toHaveBeenCalled();
        });
    });

    describe('concurrent promise dedup', () => {
        it('serves concurrent detect() calls for the same section from ONE run', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            ctx.contentTypeDetections = {
                classifications: [{ id: '7', type: 'reference' }],
                justification: '', agreedWithHeuristic: true,
            };

            const input = { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] };
            const [a, b] = await Promise.all([
                detector.detect('b', 's', input),
                detector.detect('b', 's', input),
            ]);

            expect(a).toBe(b);
            expect(ctx.detectContentTypesCalls).toHaveLength(1);
        });
    });

    describe('GenAI strategy with deterministic shadow + injected telemetry', () => {
        it('feeds the enumerator candidate hint and reports the shadow result to the observer', async () => {
            const observations: DetectionObservation[] = [];
            const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
            ctx.genAIConfigured = true;
            ctx.contentTypeDetections = {
                classifications: [{ id: '8', type: 'reference' }],
                justification: 'model said so', agreedWithHeuristic: false,
            };

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            // The model's pick wins (group 8), the deterministic shadow (group 7) is telemetry.
            expect(result).toBe('epubcfi(/6/4!/4/18,,)');
            expect(ctx.detectContentTypesCalls[0].hints).toEqual({ enumeratorCandidate: 7, leadingMarkerCandidate: -1 });
            expect(observations).toHaveLength(1);
            expect(observations[0].source).toBe('model');
            expect(observations[0].detShadowCfi).toBe('epubcfi(/6/4!/4/16,,)');
            expect(observations[0].referenceStartCfi).toBe('epubcfi(/6/4!/4/18,,)');
            expect(observations[0].justification).toBe('model said so');
        });

        it('returns null (no model call) when GenAI is not ready', async () => {
            const { ctx, detector } = makeDetector({ apiKey: undefined });
            ctx.genAIConfigured = false;

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            expect(result).toBeNull();
            expect(ctx.detectContentTypesCalls).toHaveLength(0);
        });
    });

    describe('sections too small for a model call', () => {
        it('answers a <= 5-group section from the deterministic detector alone (no model call)', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const tiny = [
                group('epubcfi(/6/4!/4/2,,)', 'Body paragraph one.', [0]),
                group('epubcfi(/6/4!/4/4,,)', 'Body paragraph two.', [1]),
                group('epubcfi(/6/4!/4/6,,)', 'Body paragraph three.', [2]),
                group('epubcfi(/6/4!/4/8,,)', '[1] Smith, A Source.', [3]),
                group('epubcfi(/6/4!/4/10,,)', '[2] Jones, Another Source.', [4]),
            ];
            expect(tiny.length).toBeLessThanOrEqual(MAX_GROUPS_FOR_DETERMINISTIC_ONLY);

            const result = await detector.detect('b', 's', { groups: tiny, citationMarkers: [] });

            // The enumerator run at group 3 (>= 60% of 5 groups) is the answer, persisted as success.
            expect(result).toBe('epubcfi(/6/4!/4/8,,)');
            expect(ctx.detectContentTypesCalls).toHaveLength(0);
            expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: 'epubcfi(/6/4!/4/8,,)' }]);
        });

        it('a 6-group section still goes to the model', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const six = REFERENCE_TAIL_GROUPS.slice(0, 6);
            await detector.detect('b', 's', { groups: six, citationMarkers: [] });
            expect(ctx.detectContentTypesCalls).toHaveLength(1);
        });
    });

    describe('model calls are serialized across sections', () => {
        it('the second section\'s model call does not start until the first has finished', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const started: string[] = [];
            let releaseFirst!: () => void;
            const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockImplementation(async (_nodes, _hints, context) => {
                started.push(context?.bookId ?? '?');
                if (started.length === 1) await firstDone;
                return { classifications: [], justification: '', agreedWithHeuristic: null };
            });

            const input = { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] };
            const p1 = detector.detect('b1', 's1', input);
            const p2 = detector.detect('b2', 's2', input);
            await new Promise((r) => setTimeout(r, 20));
            expect(started).toEqual(['b1']);

            releaseFirst();
            await Promise.all([p1, p2]);
            expect(started).toEqual(['b1', 'b2']);
        });

        it('a failing first call does not wedge the chain', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            vi.spyOn(ctx.genAI, 'detectContentTypes')
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce({ classifications: [], justification: '', agreedWithHeuristic: null });
            const input = { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] };
            // The failed call answers from the enumerator shadow (group 7)…
            expect(await detector.detect('b', 's1', input)).toBe('epubcfi(/6/4!/4/16,,)');
            // …and the chain still reaches the next section's model call.
            expect(await detector.detect('b', 's2', input)).toBeUndefined();
        });
    });

    describe('log correlation + position telemetry', () => {
        it('stamps one correlationId on the model call context and the telemetry record, with the model\'s index and position', async () => {
            const observations: DetectionObservation[] = [];
            const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
            ctx.genAIConfigured = true;
            ctx.contentTypeDetections = {
                classifications: [{ id: '8', type: 'reference' }, { id: '9', type: 'reference' }],
                justification: 'tail', agreedWithHeuristic: null,
            };

            await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            const context = ctx.detectContentTypesCalls[0].context;
            expect(context?.correlationId).toEqual(expect.any(String));
            expect(observations[0].correlationId).toBe(context?.correlationId);
            expect(observations[0].referenceStartIndex).toBe(8);
            expect(observations[0].positionFraction).toBeCloseTo(0.8);
            expect(observations[0].agreedWithHeuristic).toBeNull();
        });

        it('reports index -1 and a null position when the model found nothing', async () => {
            const observations: DetectionObservation[] = [];
            const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
            ctx.genAIConfigured = true;
            await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });
            expect(observations[0].referenceStartIndex).toBe(-1);
            expect(observations[0].positionFraction).toBeNull();
        });
    });

    describe('deterministic primitives', () => {
        it('runDeterministicDetector finds the tail enumerator run start', () => {
            expect(runDeterministicDetector(REFERENCE_TAIL_GROUPS)).toBe(7);
        });

        it('runDeterministicDetector rejects runs before 60% of the chapter', () => {
            const groups = [
                group('epubcfi(/1,,)', '[1] Early citation.'),
                group('epubcfi(/2,,)', '[2] Early citation.'),
                ...Array.from({ length: 8 }, (_, i) => group(`epubcfi(/${i + 3},,)`, `Body ${i}.`)),
            ];
            expect(runDeterministicDetector(groups)).toBe(-1);
        });

        it('runDeterministicDetector requires a run of at least two groups', () => {
            const groups = [
                ...Array.from({ length: 9 }, (_, i) => group(`epubcfi(/${i + 1},,)`, `Body ${i}.`)),
                group('epubcfi(/10,,)', '[1] Lone citation.'),
            ];
            expect(runDeterministicDetector(groups)).toBe(-1);
        });

        it('computeMarkerDropoffIndex requires ≥3 superscript markers', () => {
            const markers = [{ cfi: 'x', markerText: '1', super: true, numeric: true, glued: false, leading: false }];
            expect(computeMarkerDropoffIndex(REFERENCE_TAIL_GROUPS, markers, [0])).toBe(-1);
        });

        it('collectReferenceTailIndices collects the start group and everything after it', () => {
            const mask = collectReferenceTailIndices(REFERENCE_TAIL_GROUPS, 'epubcfi(/6/4!/4/16,,)');
            expect([...mask].sort((a, b) => a - b)).toEqual([7, 8, 9]);
        });

        it('collectReferenceTailIndices returns an empty set for null/unknown roots', () => {
            expect(collectReferenceTailIndices(REFERENCE_TAIL_GROUPS, null).size).toBe(0);
            expect(collectReferenceTailIndices(REFERENCE_TAIL_GROUPS, 'epubcfi(/nope,,)').size).toBe(0);
        });
    });
});

/**
 * The Oct 2026 activity-log export: the endnotes of both books numbered their
 * entries with a superscript back-link (`<sup><a href="#t1">1</a></sup>`),
 * which extraction strips from the spoken text — so the enumerator detector
 * saw "Francis Collins et al., …" and found nothing in any of nine sections,
 * while the trailing run of groups that OPEN with a linked marker began
 * exactly where the model put the boundary in both answered sections (173 of
 * 262, 20 of 23). Seven sections never got an answer at all (eleven 503s and
 * a timeout); three of them carried such a run.
 */
describe('regression: a linked note tail is decided locally (Oct 2026 export)', () => {
    // Element steps only (2k+2): the CFI comparator treats odd steps as text nodes.
    const cfiAt = (k: number) => `epubcfi(/6/4!/4/${2 * k + 2}/1:0)`;
    /** One group per paragraph; the segment's point CFI is where a marker must sit to attribute to it. */
    const paragraph = (k: number, fullText: string): CfiGroup => ({
        rootCfi: `epubcfi(/6/4!/4/${2 * k + 2},,)`,
        fullText,
        segments: [{ text: fullText, cfi: cfiAt(k), sourceIndices: [k] }],
    });
    const marker = (k: number, overrides: Partial<CitationMarker> = {}): CitationMarker => ({
        cfi: cfiAt(k), markerText: '1', super: true, numeric: true, glued: false, leading: true, targetHref: '#t1', ...overrides,
    });

    // 10 groups: 7 body paragraphs (2 and 3 carry markers, see below) + 3 endnotes.
    const BODY = Array.from({ length: 7 }, (_, k) => paragraph(k, `Body paragraph ${k} of the chapter.`));
    const NOTES = [
        paragraph(7, 'Francis Collins et al., “Question 15,” BioLogos (2010).'),
        paragraph(8, 'See how Charles Hodge treats the subject in his Systematic Theology.'),
        paragraph(9, 'Alexander, Creation or Evolution, 246–49.'),
    ];
    const CHAPTER = [...BODY, ...NOTES];
    const MARKERS: CitationMarker[] = [
        // An in-text reference: superscript, glued to the sentence, linked — NOT leading.
        marker(2, { markerText: '1', glued: true, leading: false, targetHref: '#b1' }),
        // A block-quoted verse number: leading, but linked to nothing.
        marker(3, { markerText: '4', targetHref: undefined }),
        // The note heads: each opens its paragraph and links back to the body.
        marker(7, { markerText: '1' }),
        marker(8, { markerText: '2', targetHref: '#t2' }),
        marker(9, { markerText: '3', targetHref: '#t3' }),
    ];
    const genaiReady = (ctx: FakeEngineContext) => {
        ctx.genAIConfigured = true;
        ctx.contentTypeDetections = { classifications: [], justification: 'model ran', agreedWithHeuristic: null };
    };

    it('answers from the trailing run of linked leading markers: no model call, persisted, reported', async () => {
        const observations: DetectionObservation[] = [];
        const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
        genaiReady(ctx);

        const result = await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: MARKERS });

        expect(result).toBe('epubcfi(/6/4!/4/16,,)');
        expect(ctx.detectContentTypesCalls).toHaveLength(0);
        expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: 'epubcfi(/6/4!/4/16,,)' }]);
        expect(observations).toHaveLength(1);
        expect(observations[0]).toMatchObject({
            source: 'leading-marker',
            referenceStartCfi: 'epubcfi(/6/4!/4/16,,)',
            referenceStartIndex: 7,
            positionFraction: 0.7,
            leadingMarkerRun: { start: 7, length: 3 },
            leadingMarkerCandidateIndex: 7,
            enumeratorCandidateIndex: -1,
            agreedWithHeuristic: null,
        });
        expect(observations[0].correlationId).toEqual(expect.any(String));
        expect(observations[0].justification).toContain('Linked note tail: 3 groups from group 7');
    });

    it('a leading marker without a link target (a verse number) does not make a note head', async () => {
        const { ctx, detector } = makeDetector({});
        genaiReady(ctx);
        const unlinkedTail = MARKERS.map((m) => (m.leading ? { ...m, targetHref: undefined } : m));

        await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: unlinkedTail });

        expect(ctx.detectContentTypesCalls).toHaveLength(1);
        expect(ctx.detectContentTypesCalls[0].hints).toEqual({ enumeratorCandidate: -1, leadingMarkerCandidate: -1 });
    });

    it('a gap before the last group leaves the decision to the model', async () => {
        const { ctx, detector } = makeDetector({});
        genaiReady(ctx);
        const lastNoteUnmarked = MARKERS.filter((m) => m.cfi !== cfiAt(9));

        await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: lastNoteUnmarked });

        expect(ctx.detectContentTypesCalls).toHaveLength(1);
        expect(ctx.detectContentTypesCalls[0].hints.leadingMarkerCandidate).toBe(-1);
    });

    it('a run that begins before half the section goes to the model as HINT B, not as the answer', async () => {
        const observations: DetectionObservation[] = [];
        const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
        genaiReady(ctx);
        // Every paragraph from group 2 on opens with a linked marker: all notes, or all verses.
        const linkedFromTwo = Array.from({ length: 8 }, (_, i) => marker(i + 2, { markerText: String(i + 1), targetHref: `#t${i + 1}` }));

        await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: linkedFromTwo });

        expect(ctx.detectContentTypesCalls).toHaveLength(1);
        expect(ctx.detectContentTypesCalls[0].hints).toEqual({ enumeratorCandidate: -1, leadingMarkerCandidate: 2 });
        expect(observations[0]).toMatchObject({
            source: 'model',
            leadingMarkerRun: { start: 2, length: 8 },
            leadingMarkerCandidateIndex: -1,
        });
    });

    it('the deterministic strategy answers from the linked run too', async () => {
        const { ctx, detector } = makeDetector({ referenceDetectionStrategy: 'deterministic' });

        const result = await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: MARKERS });

        expect(result).toBe('epubcfi(/6/4!/4/16,,)');
        expect(ctx.detectContentTypesCalls).toHaveLength(0);
    });

    it('the default telemetry records the local answer as a response entry with the linked-marker features', async () => {
        const ctx = new FakeEngineContext();
        ctx.genAISettings = { isEnabled: true, apiKey: 'k' } as never;
        genaiReady(ctx);
        const detector = new ReferenceSectionDetector(
            { genAI: ctx.genAI, contentAnalysis: ctx.contentAnalysis, book: ctx.book, content: ctx.content },
            createGenAILogTelemetry(ctx.genAI),
        );

        await detector.detect('b', 's', { groups: CHAPTER, citationMarkers: MARKERS });

        const entry = ctx.genAILogs.find((l) => l.method === 'detectReferenceStart');
        expect(entry?.type).toBe('response');
        const payload = entry?.payload as {
            source: string; referenceStartIndex: number; leadingMarkerRun: unknown;
            perGroup: { leadsWithMarker: boolean; leadsWithLinkedMarker: boolean }[];
            markerDetail: { leading: boolean }[];
        };
        expect(payload).toMatchObject({ source: 'leading-marker', referenceStartIndex: 7, leadingMarkerRun: { start: 7, length: 3 } });
        // The verse number leads but does not link; the note heads do both.
        expect(payload.perGroup[3]).toMatchObject({ leadsWithMarker: true, leadsWithLinkedMarker: false });
        expect(payload.perGroup[7]).toMatchObject({ leadsWithMarker: true, leadsWithLinkedMarker: true });
        expect(payload.markerDetail.map((m) => m.leading)).toEqual([false, true, true, true, true]);
    });

    describe('primitives', () => {
        const linkedAt = (indices: number[], n: number) => {
            const groups = Array.from({ length: n }, (_, k) => paragraph(k, `Group ${k}.`));
            const markers = indices.map((k) => marker(k));
            return { groups, markers, markerGroupIndex: indices };
        };

        it('findLeadingMarkerRun is the stretch of linked-leading groups ending at the LAST group', () => {
            const { groups, markers, markerGroupIndex } = linkedAt([1, 7, 8, 9], 10);
            expect(findLeadingMarkerRun(groups, markers, markerGroupIndex)).toEqual({ start: 7, length: 3 });
            const gap = linkedAt([7, 8], 10);
            expect(findLeadingMarkerRun(gap.groups, gap.markers, gap.markerGroupIndex)).toBeNull();
            expect(findLeadingMarkerRun(groups, [], [])).toBeNull();
        });

        it('runLeadingMarkerDetector applies the position floor and accepts a lone trailing note', () => {
            expect(LEADING_MARKER_MIN_POSITION).toBe(0.5);
            const atFloor = linkedAt([5, 6, 7, 8, 9], 10);
            expect(runLeadingMarkerDetector(atFloor.groups, atFloor.markers, atFloor.markerGroupIndex)).toBe(5);
            const belowFloor = linkedAt([4, 5, 6, 7, 8, 9], 10);
            expect(runLeadingMarkerDetector(belowFloor.groups, belowFloor.markers, belowFloor.markerGroupIndex)).toBe(-1);
            const lone = linkedAt([9], 10);
            expect(runLeadingMarkerDetector(lone.groups, lone.markers, lone.markerGroupIndex)).toBe(9);
        });

        it('orphaned markers (group -1) never count', () => {
            const { groups, markers } = linkedAt([9], 10);
            expect(runLeadingMarkerDetector(groups, markers, [-1])).toBe(-1);
        });
    });
});

/**
 * On the Oct 2026 export twelve detection attempts died (eleven 503s, one
 * timeout) and the log held nothing about those sections but their prompts —
 * the telemetry record was only written after a successful model call. A
 * failure now reaches the observer with the section's full structure, and
 * the deterministic shadow answers that playback while the model is retried.
 */
describe('regression: a failed model call is reported to telemetry with the section structure', () => {
    const overloaded = () =>
        Object.assign(new Error('This model is currently experiencing high demand.'), {
            code: 'GENAI_UNKNOWN',
            retryable: true,
            context: { status: 503, apiStatus: 'UNAVAILABLE' },
        });

    it('records source "failure" with the error code and status, correlated with the model call', async () => {
        const observations: DetectionObservation[] = [];
        const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
        ctx.genAIConfigured = true;
        const call = vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(overloaded());

        await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

        expect(observations).toHaveLength(1);
        expect(observations[0]).toMatchObject({
            source: 'failure',
            referenceStartCfi: undefined,
            referenceStartIndex: null,
            positionFraction: null,
            detShadowCfi: 'epubcfi(/6/4!/4/16,,)',
            enumeratorCandidateIndex: 7,
            agreedWithHeuristic: null,
            failure: {
                message: 'This model is currently experiencing high demand.',
                code: 'GENAI_UNKNOWN',
                status: 503,
                retryable: true,
            },
        });
        expect(observations[0].correlationId).toBe(call.mock.calls[0][2]?.correlationId);
    });

    it('a worker-revived error (status only in context) and a plain Error both describe cleanly', async () => {
        const observations: DetectionObservation[] = [];
        const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
        ctx.genAIConfigured = true;
        vi.spyOn(ctx.genAI, 'detectContentTypes')
            .mockRejectedValueOnce(Object.assign(new Error('timed out'), { code: 'NET_TIMEOUT', retryable: true }))
            .mockRejectedValueOnce(new Error('plain'));

        await detector.detect('b', 's1', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });
        await detector.detect('b', 's2', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

        expect(observations[0].failure).toEqual({ message: 'timed out', code: 'NET_TIMEOUT', retryable: true });
        expect(observations[1].failure).toEqual({ message: 'plain' });
    });

    it('the default telemetry writes the failure as an error entry carrying the per-group and per-marker data', async () => {
        const ctx = new FakeEngineContext();
        ctx.genAISettings = { isEnabled: true, apiKey: 'k' } as never;
        ctx.genAIConfigured = true;
        vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(overloaded());
        const detector = new ReferenceSectionDetector(
            { genAI: ctx.genAI, contentAnalysis: ctx.contentAnalysis, book: ctx.book, content: ctx.content },
            createGenAILogTelemetry(ctx.genAI),
        );

        await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

        const entry = ctx.genAILogs.find((l) => l.method === 'detectReferenceStart');
        expect(entry?.type).toBe('error');
        expect(entry?.payload).toMatchObject({
            source: 'failure',
            failure: { code: 'GENAI_UNKNOWN', status: 503 },
            groupCount: 10,
            referenceStartIndex: null,
            enumeratorCandidateIndex: 7,
        });
        expect((entry?.payload as { perGroup: unknown[] }).perGroup).toHaveLength(10);
    });

    it('a validation rejection is reported as a failure too, then persisted from the shadow as before', async () => {
        const observations: DetectionObservation[] = [];
        const { ctx, detector } = makeDetector({}, { onDetection: (o) => observations.push(o) });
        ctx.genAIConfigured = true;
        vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(
            Object.assign(new Error('referenceStartIndex 99 is outside [-1, 9]'), { code: 'GENAI_INVALID_RESPONSE' }),
        );

        const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

        expect(result).toBe('epubcfi(/6/4!/4/16,,)');
        expect(ctx.savedReferenceCfis).toEqual([{ bookId: 'b', sectionId: 's', cfi: 'epubcfi(/6/4!/4/16,,)' }]);
        expect(observations[0]).toMatchObject({ source: 'failure', failure: { code: 'GENAI_INVALID_RESPONSE' } });
    });
});
