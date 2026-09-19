import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createZustandEngineContext } from '@app/tts/createZustandEngineContext';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { FakeEngineContext } from './engine/FakeEngineContext';
import { bookContent } from '@data/repos/bookContent';
import { contentAnalysisRepository } from '@app/repositories/ContentAnalysisRepository';
import { useGenAIStore } from '@store/useGenAIStore';
import type { SentenceNode } from '~types/tts-content';

vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getTableImages: vi.fn(),
        listTableLocations: vi.fn(),
        getBookStructure: vi.fn(),
    }
}));
vi.mock('@store/useGenAIStore');

vi.mock('@app/repositories/ContentAnalysisRepository', () => ({
    contentAnalysisRepository: {
        getContentAnalysis: vi.fn(),
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        saveTableAdaptations: vi.fn(),
        clearAll: vi.fn(),
    }
}));

vi.mock('@app/repositories/BookRepository', () => ({
    bookRepository: {
        getBookMetadata: vi.fn(),
    }
}));


describe('TableAdaptationProcessor', () => {
    let processor: TableAdaptationProcessor;

    beforeEach(() => {
        processor = new TableAdaptationProcessor(createZustandEngineContext());
        vi.clearAllMocks();
    });

    // preprocessTableRoots was deleted (it emitted a literal 'epubcfi(${range.parent})' via an
    // escaped template literal). Its behavior — and the regression tests — now live with the
    // canonical preprocessBlockRoots in the kernel suite (src/kernel/cfi/cfi.test.ts).

    describe('processTableAdaptations', () => {
        it('should process existing adaptations immediately', async () => {
            const sentences: SentenceNode[] = [{ text: 'Inside', cfi: 'epubcfi(/6/14!/4/2/1:0)' }];
            const bookId = 'book1';
            const sectionId = 'section1';

            vi.mocked(useGenAIStore.getState).mockReturnValue({
                isEnabled: true,
                isTableAdaptationEnabled: true,
                apiKey: 'test-key',
                model: 'gemini-1.5-flash',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            vi.mocked(contentAnalysisRepository.getContentAnalysis).mockResolvedValue({
                tableAdaptations: [{ rootCfi: 'epubcfi(/6/14!/4,/2,/3)', text: 'Adapted text' }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            vi.mocked(bookContent.getTableImages).mockResolvedValue([]);
            vi.mocked(bookContent.listTableLocations).mockResolvedValue([]);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let foundAdaptations: any = null;
            await processor.processTableAdaptations(bookId, sectionId, sentences, (adaptations) => {
                foundAdaptations = adaptations;
            });

            expect(foundAdaptations).toBeDefined();
            expect(foundAdaptations[0].text).toBe('Adapted text');
        });

        it('a persisted "not a table" verdict (empty text) is neither re-sent to the model nor narrated', async () => {
            const sentences: SentenceNode[] = [{ text: 'Caption under the illustration', cfi: 'epubcfi(/6/14!/4/2/1:0)' }];
            vi.mocked(useGenAIStore.getState).mockReturnValue({
                isEnabled: true,
                isTableAdaptationEnabled: true,
                apiKey: 'test-key',
                model: 'gemini-1.5-flash',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            // The model already said "not a table" for this image on an earlier visit.
            vi.mocked(contentAnalysisRepository.getContentAnalysis).mockResolvedValue({
                tableAdaptations: [{ rootCfi: 'epubcfi(/6/14!/4/2)', text: '' }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            vi.mocked(bookContent.getTableImages).mockResolvedValue([
                { id: 'img', bookId: 'book1', sectionId: 'section1', cfi: 'epubcfi(/6/14!/4/2)', imageBlob: new Blob(['x']) },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any);
            vi.mocked(bookContent.listTableLocations).mockResolvedValue([
                { id: 'img', sectionId: 'section1', cfi: 'epubcfi(/6/14!/4/2)' },
            ]);
            const ctx = createZustandEngineContext();
            const generate = vi.spyOn(ctx.genAI, 'generateTableAdaptations');
            const onAdaptationsFound = vi.fn();

            await new TableAdaptationProcessor(ctx).processTableAdaptations('book1', 'section1', sentences, onAdaptationsFound);

            expect(generate).not.toHaveBeenCalled();
            expect(contentAnalysisRepository.saveTableAdaptations).not.toHaveBeenCalled();
            // An empty verdict never replaces the sentences under the image.
            for (const call of onAdaptationsFound.mock.calls) {
                expect(call[0]).toEqual([]);
            }
        });
    });
});

describe('regression: AudioContentPipeline_TableCfi', () => {
    // Carried verbatim from the deleted AudioContentPipeline_TableCfi.test.ts
    // (absorption ledger row 17): range-CFI table roots must exclude siblings
    // that merely share the parent prefix.
    it('should correctly exclude siblings when using Range CFI with parent container', () => {
        const processor = new TableAdaptationProcessor(createZustandEngineContext());

        // Table CFI is a range within parent /6/14!/4; range covers child 2 to 3.
        const tableCfi = 'epubcfi(/6/14!/4,/2,/3)';
        const adaptationText = 'Table content';

        const adaptationsMap = new Map<string, string>();
        adaptationsMap.set(tableCfi, adaptationText);

        const sentences: SentenceNode[] = [
            { text: 'Inside Table', cfi: 'epubcfi(/6/14!/4/2/1:0)' },
            { text: 'Outside Sibling', cfi: 'epubcfi(/6/14!/4/4/1:0)' }
        ];

        const result = processor.mapSentencesToAdaptations(sentences, adaptationsMap);

        const indices = result.flatMap(r => r.indices);
        expect(indices).toContain(0); // Inside
        expect(indices).not.toContain(1); // Outside
        expect(indices.length).toBe(1);
    });
});

describe('regression: a reprocess of the OPEN book must not skip its adaptations', () => {
    // The per-book table-location memo outlives a reprocess of the book that is open.
    // A reprocess deletes that book's table-image rows and writes new ones keyed
    // `${bookId}-${cfi}`, so any CFI drift re-keys every row: the memo's ids resolve to no
    // live blob, the node list comes out empty and the method returned silently — no table
    // adaptation for that section for the rest of the session. Before the memo, the work set
    // and the blobs came from the same live read, so a reprocess degraded gracefully.
    //
    // Driven through FakeEngineContext (no module mocks): its content port serves both
    // listTableLocations and getTableImages from `tableLocations`, so rewriting that array
    // after the memo is warmed IS the reprocess.
    const OLD_CFI = 'epubcfi(/6/14!/4/2)';
    const NEW_CFI = 'epubcfi(/6/14!/4/4)';
    const SENTENCES: SentenceNode[] = [{ text: 'Row one, column one.', cfi: 'epubcfi(/6/14!/4/4/1:0)' }];

    async function reprocessedWhileOpen() {
        const ctx = new FakeEngineContext();
        ctx.genAISettings = { isEnabled: true, isTableAdaptationEnabled: true, apiKey: 'test-key' };
        ctx.genAIConfigured = true;
        ctx.tableAdaptationResults = [{ cfi: NEW_CFI, adaptation: 'A table, in words.' }];
        ctx.tableLocations['book1'] = [{ id: `book1-${OLD_CFI}`, cfi: OLD_CFI, sectionId: 'section1' }];

        const processor = new TableAdaptationProcessor(ctx);
        // Warmed by the first section load (SectionAnalysisDriver.buildGroups shares this memo).
        await processor.getTableLocations('book1');
        // …and now the open book is reprocessed: same table, drifted CFI, new row id.
        ctx.tableLocations['book1'] = [{ id: `book1-${NEW_CFI}`, cfi: NEW_CFI, sectionId: 'section1' }];
        return { ctx, processor };
    }

    it('still sends the section\'s tables to the model when every memoized row id is gone', async () => {
        const { ctx, processor } = await reprocessedWhileOpen();

        await processor.processTableAdaptations('book1', 'section1', SENTENCES, () => {});

        expect(ctx.generateTableAdaptationsCalls).toHaveLength(1);
        expect(ctx.generateTableAdaptationsCalls[0].nodes.map(n => n.rootCfi)).toEqual([NEW_CFI]);
        expect(ctx.savedTableAdaptations).toEqual([{
            bookId: 'book1',
            sectionId: 'section1',
            adaptations: [{ rootCfi: NEW_CFI, text: 'A table, in words.' }],
        }]);
    });

    it('drops the stale memo, so the grouping read heals too', async () => {
        const { ctx, processor } = await reprocessedWhileOpen();
        expect(ctx.tableLocationReads).toEqual(['book1']);

        await processor.processTableAdaptations('book1', 'section1', SENTENCES, () => {});
        await processor.getTableLocations('book1');

        expect(ctx.tableLocationReads).toEqual(['book1', 'book1']);
    });
});


/**
 * The residual the blob-miss heal above could not reach: a reprocess that moves
 * a table to a DIFFERENT sectionId. The stale memo reports the new section as
 * tableless, the method returned before the image read, and the heal — which
 * hangs off that read — never fired, so the section went without adaptations
 * for the rest of the session. An empty section list is now confirmed against
 * the live rows, but only ONCE per book: the cost is one extra read for the
 * whole book, never one per tableless section.
 */
describe('regression: a table the reprocess moved to another section still heals', () => {
    const CFI = 'epubcfi(/6/14!/4/2)';
    const SENTENCES: SentenceNode[] = [{ text: 'Row one, column one.', cfi: 'epubcfi(/6/14!/4/2/1:0)' }];

    function openBook(locations: Array<{ id: string; cfi: string; sectionId: string }>) {
        const ctx = new FakeEngineContext();
        ctx.genAISettings = { isEnabled: true, isTableAdaptationEnabled: true, apiKey: 'test-key' };
        ctx.genAIConfigured = true;
        ctx.tableAdaptationResults = [{ cfi: CFI, adaptation: 'A table, in words.' }];
        ctx.tableLocations['book1'] = locations;
        return { ctx, processor: new TableAdaptationProcessor(ctx) };
    }

    it('sends the moved table instead of returning on the stale empty list', async () => {
        const { ctx, processor } = openBook([{ id: `book1-${CFI}`, cfi: CFI, sectionId: 'section1' }]);
        // Warmed by the first section load (buildGroups shares this memo)…
        await processor.getTableLocations('book1');
        // …then the open book is reprocessed and the table lands in section2.
        ctx.tableLocations['book1'] = [{ id: `book1-${CFI}`, cfi: CFI, sectionId: 'section2' }];

        await processor.processTableAdaptations('book1', 'section2', SENTENCES, () => {});

        expect(ctx.generateTableAdaptationsCalls).toHaveLength(1);
        expect(ctx.generateTableAdaptationsCalls[0].nodes.map(n => n.rootCfi)).toEqual([CFI]);
        expect(ctx.savedTableAdaptations).toEqual([{
            bookId: 'book1',
            sectionId: 'section2',
            adaptations: [{ rootCfi: CFI, text: 'A table, in words.' }],
        }]);
        // …and the stale memo is dropped, so the grouping read heals too.
        await processor.getTableLocations('book1');
        expect(ctx.tableLocationReads).toEqual(['book1', 'book1']);
    });

    it('confirms an empty section once per book, not once per section', async () => {
        // The memo is accurate: one table, in section1, nothing anywhere else.
        const { ctx, processor } = openBook([{ id: `book1-${CFI}`, cfi: CFI, sectionId: 'section1' }]);
        const imageReads = vi.spyOn(ctx.content, 'getTableImages');

        for (const sectionId of ['section2', 'section3', 'section4']) {
            await processor.processTableAdaptations('book1', sectionId, SENTENCES, () => {});
        }

        expect(imageReads).toHaveBeenCalledTimes(1);
        expect(imageReads).toHaveBeenCalledWith('book1', 'section2');
        // Nothing was sent, and a confirmed-accurate memo is left alone.
        expect(ctx.generateTableAdaptationsCalls).toEqual([]);
        expect(ctx.tableLocationReads).toEqual(['book1']);
    });

    it('a book with no tables at all never pays a read per section', async () => {
        const { ctx, processor } = openBook([]);
        const imageReads = vi.spyOn(ctx.content, 'getTableImages');

        for (const sectionId of ['section1', 'section2', 'section3', 'section4']) {
            await processor.processTableAdaptations('book1', sectionId, SENTENCES, () => {});
        }

        expect(imageReads).toHaveBeenCalledTimes(1);
        expect(ctx.generateTableAdaptationsCalls).toEqual([]);
    });

    it('with the model off, the confirmation costs no read at all', async () => {
        const { ctx, processor } = openBook([]);
        ctx.genAISettings = { isEnabled: false };
        ctx.genAIConfigured = false;
        const imageReads = vi.spyOn(ctx.content, 'getTableImages');

        for (const sectionId of ['section1', 'section2']) {
            await processor.processTableAdaptations('book1', sectionId, SENTENCES, () => {});
        }

        expect(imageReads).not.toHaveBeenCalled();
    });
});
