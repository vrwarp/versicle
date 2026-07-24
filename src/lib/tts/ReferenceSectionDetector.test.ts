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
    computeMarkerDropoffIndex,
    collectReferenceTailIndices,
} from './ReferenceSectionDetector';
import type { DetectionObservation } from './ReferenceSectionDetector';
import { FakeEngineContext } from './engine/FakeEngineContext';
import type { CfiGroup } from '@kernel/cfi';

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

        it('marks an analysis error when the model call rejects', async () => {
            const { ctx, detector } = makeDetector({});
            ctx.genAIConfigured = true;
            const markError = vi.spyOn(ctx.contentAnalysis, 'markAnalysisError');
            vi.spyOn(ctx.genAI, 'detectContentTypes').mockRejectedValue(new Error('boom'));

            const result = await detector.detect('b', 's', { groups: REFERENCE_TAIL_GROUPS, citationMarkers: [] });

            expect(result).toBeNull();
            expect(markError).toHaveBeenCalledWith('b', 's', 'boom');
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
            expect(ctx.detectContentTypesCalls[0].hints).toEqual({ enumeratorCandidate: 7 });
            expect(observations).toHaveLength(1);
            expect(observations[0].detShadowCfi).toBe('epubcfi(/6/4!/4/16,,)');
            expect(observations[0].geminiCfi).toBe('epubcfi(/6/4!/4/18,,)');
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
