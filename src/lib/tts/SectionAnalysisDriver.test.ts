/**
 * SectionAnalysisDriver suite (Phase 5c; phase5-tts-strangler.md §5c.2).
 * Carries the surviving assertions of the deleted AudioContentPipeline
 * trigger/filtering suites as named regression blocks (absorption ledger
 * row 17), driven through FakeEngineContext (no module mocks).
 *
 * The D4 block is NEW with 5c-PR2: {sentences, citationMarkers} always
 * travel together, and marker hints reach the detection prompt from the
 * PRIMARY (loadSection) path — the doc-named test.
 */
import { describe, it, expect, vi } from 'vitest';
import { SectionAnalysisDriver } from './SectionAnalysisDriver';
import { FakeEngineContext } from './engine/FakeEngineContext';
import type { CitationMarker } from '~types/db';

const GENAI_ALL_ON = {
    isEnabled: true,
    isContentAnalysisEnabled: true,
    isTableAdaptationEnabled: true,
    contentFilterSkipTypes: ['reference'],
    apiKey: 'test-key',
} as const;

function makeDriver(genAISettings: Record<string, unknown> = { ...GENAI_ALL_ON }) {
    const ctx = new FakeEngineContext();
    ctx.genAISettings = genAISettings as never;
    const driver = new SectionAnalysisDriver(ctx);
    return { ctx, driver };
}

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

describe('regression: AudioContentPipeline_TriggerAnalysis', () => {
    describe('Vulnerability 2 Regression: Callbacks are optional', () => {
        it('runs skip-mask detection even without an onMaskFound callback', async () => {
            const { driver } = makeDriver();
            const detectSpy = vi.spyOn(driver, 'detectContentSkipMask').mockResolvedValue(new Set([1]));

            await driver.triggerAnalysis('book1', 'section1', {
                sentences: [{ text: 'test', cfi: 'cfi1' }],
                citationMarkers: [],
            });
            await settle();

            expect(detectSpy).toHaveBeenCalledWith('book1', 'section1', ['reference'], expect.anything());
        });

        it('runs processTableAdaptations even without an onAdaptationsFound callback', async () => {
            const { driver } = makeDriver();
            const processSpy = vi.spyOn(driver.tableProcessor, 'processTableAdaptations').mockResolvedValue(undefined);

            await driver.triggerAnalysis('book1', 'section1', {
                sentences: [{ text: 'test', cfi: 'cfi1' }],
                citationMarkers: [],
            });
            await settle();

            expect(processSpy).toHaveBeenCalledWith('book1', 'section1', expect.anything(), expect.any(Function));
        });

        it('invokes onMaskFound when provided and the mask is non-empty', async () => {
            const { driver } = makeDriver();
            vi.spyOn(driver, 'detectContentSkipMask').mockResolvedValue(new Set([1, 2]));
            const onMaskFound = vi.fn();

            await driver.triggerAnalysis('book1', 'section1',
                { sentences: [{ text: 'test', cfi: 'cfi1' }], citationMarkers: [] }, onMaskFound);
            await settle();

            expect(onMaskFound).toHaveBeenCalledWith(new Set([1, 2]));
        });

        it('does NOT invoke onMaskFound when the mask is empty', async () => {
            const { driver } = makeDriver();
            vi.spyOn(driver, 'detectContentSkipMask').mockResolvedValue(new Set());
            const onMaskFound = vi.fn();

            await driver.triggerAnalysis('book1', 'section1',
                { sentences: [{ text: 'test', cfi: 'cfi1' }], citationMarkers: [] }, onMaskFound);
            await settle();

            expect(onMaskFound).not.toHaveBeenCalled();
        });
    });

    describe('Vulnerability 1: prewarmNextSection pre-warming', () => {
        it('runs both reference detection and table adaptations for the next chapter', async () => {
            const { ctx, driver } = makeDriver();
            const sentences = [{ text: 'Next chapter', cfi: 'epubcfi(/6/4!/4/2/1:0)' }];
            ctx.ttsContent['book1/next'] = { sentences };
            // Force the deterministic strategy so detection persists without a model call.
            ctx.genAISettings = { ...GENAI_ALL_ON, referenceDetectionStrategy: 'deterministic' } as never;

            const tableSpy = vi.spyOn(driver.tableProcessor, 'processTableAdaptations').mockResolvedValue(undefined);

            const playlist = [
                { sectionId: 'current', characterCount: 100 },
                { sectionId: 'next', characterCount: 200 },
            ];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await driver.prewarmNextSection('book1', 0, playlist as any);
            await settle(50);

            // Deterministic detection persisted a result for the NEXT section…
            expect(ctx.savedReferenceCfis.some(s => s.sectionId === 'next')).toBe(true);
            // …and table adaptation pre-warming ran with the same sentences.
            expect(tableSpy).toHaveBeenCalledWith('book1', 'next', sentences, expect.any(Function));
        });

        it('does not crash when already at the last chapter', async () => {
            const { driver } = makeDriver();
            const playlist = [{ sectionId: 'only', characterCount: 100 }];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await driver.prewarmNextSection('book1', 0, playlist as any);
            // No assertions needed — just verifying no exception is thrown
        });

        it('does not fire analysis when GenAI is disabled', async () => {
            const { ctx, driver } = makeDriver({ ...GENAI_ALL_ON, isEnabled: false });
            ctx.ttsContent['book1/next'] = { sentences: [{ text: 'x', cfi: 'epubcfi(/6/4!/4/2/1:0)' }] };

            const tableSpy = vi.spyOn(driver.tableProcessor, 'processTableAdaptations');

            const playlist = [
                { sectionId: 'current', characterCount: 100 },
                { sectionId: 'next', characterCount: 200 },
            ];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await driver.prewarmNextSection('book1', 0, playlist as any);
            await settle(50);

            expect(ctx.savedReferenceCfis).toHaveLength(0);
            expect(tableSpy).not.toHaveBeenCalled();
        });
    });
});

describe('regression: AudioContentPipeline.test (content filtering)', () => {
    it('reports skipped raw indices through onMaskFound when a reference start is cached', async () => {
        const { ctx, driver } = makeDriver();
        // Two sentences in distinct groups (/2/2/2 vs /2/2/4).
        const s1 = { text: 'Keep me', cfi: 'epubcfi(/2/2/2:0)', sourceIndices: [0] };
        const s2 = { text: 'Skip me', cfi: 'epubcfi(/2/2/4:0)', sourceIndices: [1] };
        // Persisted analysis classifies s2's group as the reference start.
        ctx.contentAnalyses['book1/s1'] = { referenceStartCfi: 'epubcfi(/2/2/4:0,,)' } as never;

        const onMaskFound = vi.fn();
        await driver.triggerAnalysis('book1', 's1', { sentences: [s1, s2], citationMarkers: [] }, onMaskFound);
        await settle();

        expect(onMaskFound).toHaveBeenCalled();
        const mask: Set<number> = onMaskFound.mock.calls[0][0];
        expect(mask.has(1)).toBe(true);
        expect(mask.has(0)).toBe(false);
    });
});

describe('D4: {sentences, citationMarkers} always travel together (5c-PR2)', () => {
    const MARKED_SENTENCES = [
        { text: 'Body text with a citation.', cfi: 'epubcfi(/6/4!/4/2/1:0)', sourceIndices: [0] },
        { text: '1 Smith, The Source. More of the entry text here.', cfi: 'epubcfi(/6/4!/4/6/1:0)', sourceIndices: [1] },
    ];
    // A leading marker INSIDE the second group's bounds.
    const MARKERS: CitationMarker[] = [{
        cfi: 'epubcfi(/6/4!/4/6/1:0)',
        markerText: '1', super: true, numeric: true, glued: false, leading: true,
    }];

    function gemini(ctx: FakeEngineContext) {
        ctx.genAIConfigured = true;
        ctx.contentTypeDetections = {
            classifications: [{ id: '1', type: 'reference' }],
            justification: 'test', agreedWithHeuristic: true,
        };
    }

    it('marker hints reach the detection prompt from the PRIMARY (loadSection) path', async () => {
        const { ctx, driver } = makeDriver();
        gemini(ctx);

        // The primary path: triggerAnalysis with already-fetched content — markers included.
        const onMaskFound = vi.fn();
        await driver.triggerAnalysis('book1', 's1',
            { sentences: MARKED_SENTENCES, citationMarkers: MARKERS }, onMaskFound);
        await vi.waitFor(() => expect(ctx.detectContentTypesCalls.length).toBeGreaterThan(0));

        // The leadsWithMarker flag (derived from the markers) reached the prompt nodes.
        const nodes = ctx.detectContentTypesCalls[0].nodes as Array<{ id: string; leadsWithMarker?: boolean }>;
        expect(nodes.some(n => n.leadsWithMarker === true)).toBe(true);
    });

    it('fetching content (no caller-provided sentences) also carries the markers', async () => {
        const { ctx, driver } = makeDriver();
        gemini(ctx);
        ctx.ttsContent['book1/s1'] = {
            sentences: MARKED_SENTENCES,
            citationMarkers: MARKERS as never,
        };

        await driver.detectContentSkipMask('book1', 's1', ['reference']);

        expect(ctx.detectContentTypesCalls.length).toBeGreaterThan(0);
        const nodes = ctx.detectContentTypesCalls[0].nodes as Array<{ id: string; leadsWithMarker?: boolean }>;
        expect(nodes.some(n => n.leadsWithMarker === true)).toBe(true);
    });

    it('a successful GenAI detection emits the telemetry log through the injected observer', async () => {
        const { ctx, driver } = makeDriver();
        gemini(ctx);

        await driver.detectContentSkipMask('book1', 's1', ['reference'],
            { sentences: MARKED_SENTENCES, citationMarkers: MARKERS });

        expect(ctx.genAILogs.some(l => l.method === 'detectReferenceStart')).toBe(true);
    });
});
