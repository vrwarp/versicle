/**
 * SectionQueueBuilder suite (Phase 5c; phase5-tts-strangler.md §5c.2).
 * Carries the surviving assertions of the deleted AudioContentPipeline
 * loadSection/Bible suites as named regression blocks (absorption ledger
 * row 17) — rewritten against the PURE builder: no ports, no mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildSectionQueue, generatePreroll } from './SectionQueueBuilder';
import { beforeAll } from 'vitest';
import { emptySectionMessage } from './emptySectionMessages';
import { AbbreviationMerger } from './abbreviationMerge';
import { resolveBiblePreference } from './biblePreference';
import { loadBibleLexicon } from './bible-lexicon';
import { TextSegmenter } from './TextSegmenter';
import { resolveSectionTitle } from './sectionTitle';
import type { BookMetadata } from '~types/book';

const SETTINGS = {
    abbreviations: [] as string[],
    alwaysMerge: [] as string[],
    sentenceStarters: [] as string[],
    minSentenceLength: 0,
    language: 'en',
};

const OPTIONS = {
    sectionIndex: 0,
    prerollEnabled: false,
    speed: 1.0,
    characterCount: 500,
};

describe('regression: AudioContentPipeline.test (loadSection queue building)', () => {
    it('builds a queue from prepared sentences with the generic title fallback', () => {
        const { queue, title } = buildSectionQueue(
            [{ text: 'Hello world', cfi: 'cfi1' }],
            SETTINGS,
            OPTIONS,
        );

        expect(title).toBe('Section 1');
        expect(queue).toHaveLength(1);
        expect(queue[0].text).toBe('Hello world');
        expect(queue[0].title).toBe('Section 1');
        expect(queue[0].isSkipped).toBe(false);
    });

    it('handles empty chapters gracefully with one informational preroll item', () => {
        const { queue } = buildSectionQueue([], SETTINGS, OPTIONS);

        expect(queue).toHaveLength(1);
        expect(queue[0].isPreroll).toBe(true);
        expect(queue[0].cfi).toBeNull();
    });

    it('generates a preroll when enabled', () => {
        const { queue } = buildSectionQueue(
            [{ text: 'Hello', cfi: 'cfi1' }],
            SETTINGS,
            { ...OPTIONS, prerollEnabled: true },
        );

        expect(queue).toHaveLength(2);
        expect(queue[0].isPreroll).toBe(true);
        expect(queue[0].text).toContain('Estimated reading time');
        expect(queue[1].text).toBe('Hello');
    });

    it('drops refined sentences without a CFI from the queue', () => {
        const { queue } = buildSectionQueue(
            [{ text: 'Anchored sentence.', cfi: 'cfi1' }, { text: 'Unanchored sentence.', cfi: '' }],
            SETTINGS,
            OPTIONS,
        );
        expect(queue.map(q => q.text)).toEqual(['Anchored sentence.']);
    });

    it('uses the resolved section title when provided', () => {
        const { queue, title } = buildSectionQueue(
            [{ text: 'Hello', cfi: 'cfi1' }],
            SETTINGS,
            { ...OPTIONS, sectionTitle: 'Chapter One' },
        );
        expect(title).toBe('Chapter One');
        expect(queue[0].title).toBe('Chapter One');
    });

    it('generatePreroll estimates reading time from word count and speed', () => {
        expect(generatePreroll('Ch', 180, 1.0)).toContain('1 minute');
        expect(generatePreroll('Ch', 360, 1.0)).toContain('2 minutes');
        expect(generatePreroll('Ch', 360, 2.0)).toContain('1 minute');
    });
});

describe('empty-section filler is deterministic and language-keyed (5c-PR2; i18n ADR)', () => {
    it('same inputs → same message (no randomization, no cache fragmentation)', () => {
        const a = buildSectionQueue([], SETTINGS, OPTIONS).queue[0].text;
        const b = buildSectionQueue([], SETTINGS, OPTIONS).queue[0].text;
        expect(a).toBe(b);
        expect(a).toBe(emptySectionMessage('en'));
    });

    it('keys the filler by the book language (zh book never speaks English filler)', () => {
        const zh = buildSectionQueue([], { ...SETTINGS, language: 'zh-TW' }, OPTIONS).queue[0].text;
        expect(zh).toBe(emptySectionMessage('zh'));
        expect(zh).not.toBe(emptySectionMessage('en'));
    });

    it('falls back to English for unknown languages', () => {
        expect(emptySectionMessage('tlh')).toBe(emptySectionMessage('en'));
        expect(emptySectionMessage(undefined)).toBe(emptySectionMessage('en'));
    });
});

describe('regression: AudioContentPipeline_Bible', () => {
    // The deleted suite asserted which abbreviation set reached
    // TextSegmenter.refineSegments. That decision is now the composition of
    // resolveBiblePreference (per-book pref vs global flag) and the async
    // AbbreviationMerger (lazy Bible JSON since 5c-PR3); the builder hands
    // settings.abbreviations through verbatim (pinned via a refineSegments spy).
    let BIBLE_ABBREVIATIONS: string[] = [];
    beforeAll(async () => {
        BIBLE_ABBREVIATIONS = (await loadBibleLexicon()).abbreviations;
    });

    it('injects bible abbreviations when enabled globally (book pref = default)', async () => {
        const merger = new AbbreviationMerger();
        const merged = await merger.merge(['Dr.'], resolveBiblePreference('default', true));
        expect(merged).toEqual(expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']));
    });

    it('does NOT inject bible abbreviations when disabled globally', async () => {
        const merger = new AbbreviationMerger();
        const merged = await merger.merge(['Dr.'], resolveBiblePreference('default', false));
        expect(merged).toEqual(['Dr.']);
    });

    it('injects bible abbreviations when disabled globally but enabled for the book', async () => {
        const merger = new AbbreviationMerger();
        const merged = await merger.merge(['Dr.'], resolveBiblePreference('on', false));
        expect(merged).toEqual(expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']));
    });

    it('omits bible abbreviations when the book pref is off even with the global flag on', async () => {
        const merger = new AbbreviationMerger();
        expect(await merger.merge(['Dr.'], resolveBiblePreference('off', true))).toEqual(['Dr.']);
    });

    it('memoizes the merged array reference for identical inputs (segmenter cache stability)', async () => {
        const merger = new AbbreviationMerger();
        const custom = ['Dr.'];
        expect(await merger.merge(custom, true)).toBe(await merger.merge(custom, true));
    });

    it('the merged set reaches TextSegmenter.refineSegments through the builder', async () => {
        const spy = vi.spyOn(TextSegmenter, 'refineSegments');
        try {
            const merger = new AbbreviationMerger();
            const abbreviations = await merger.merge(['Dr.'], true);
            buildSectionQueue([{ text: 'Test.', cfi: 'cfi' }], { ...SETTINGS, abbreviations }, OPTIONS);

            expect(spy).toHaveBeenCalledWith(
                expect.anything(),
                expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']),
                expect.anything(), // alwaysMerge
                expect.anything(), // sentenceStarters
                expect.anything(), // minSentenceLength
                'en',              // locale
            );
        } finally {
            spy.mockRestore();
        }
    });
});

describe('resolveSectionTitle (host-side priority chain)', () => {
    const ports = (overrides: {
        analysisTitle?: string;
        toc?: Array<{ id: string; href: string; label: string; subitems?: never[] }>;
    } = {}) => ({
        contentAnalysis: {
            getContentAnalysis: vi.fn(async () =>
                overrides.analysisTitle
                    ? ({ structure: { title: overrides.analysisTitle } } as never)
                    : undefined),
        },
        content: {
            getBookStructure: vi.fn(async () =>
                overrides.toc ? ({ toc: overrides.toc } as never) : undefined),
        },
    });

    it('prefers the AI-extracted title when the synthetic TOC is in use', async () => {
        const title = await resolveSectionTitle(ports({ analysisTitle: 'AI Title' }), {
            bookId: 'b',
            sectionId: 's1',
            metadata: { useSyntheticToc: true } as BookMetadata,
            spineTitle: 'Spine',
        });
        expect(title).toBe('AI Title');
    });

    it('falls back to the stored TOC label', async () => {
        const title = await resolveSectionTitle(
            ports({ toc: [{ id: 's1', href: 's1', label: 'TOC Label' }] }),
            { bookId: 'b', sectionId: 's1', metadata: undefined, spineTitle: 'Spine' },
        );
        expect(title).toBe('TOC Label');
    });

    it('falls back to the spine title, then undefined (builder supplies Section N)', async () => {
        expect(await resolveSectionTitle(ports(), {
            bookId: 'b', sectionId: 's1', metadata: undefined, spineTitle: 'Spine',
        })).toBe('Spine');
        expect(await resolveSectionTitle(ports(), {
            bookId: 'b', sectionId: 's1', metadata: undefined,
        })).toBeUndefined();
    });

    it('does not consult content analysis when the synthetic TOC is not preferred', async () => {
        const p = ports({ analysisTitle: 'AI Title' });
        await resolveSectionTitle(p, { bookId: 'b', sectionId: 's1', metadata: undefined });
        expect(p.contentAnalysis.getContentAnalysis).not.toHaveBeenCalled();
    });
});
