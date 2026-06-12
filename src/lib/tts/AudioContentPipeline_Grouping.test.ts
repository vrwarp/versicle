
import { describe, it, expect } from 'vitest';
import { createZustandEngineContext } from '@app/tts/createZustandEngineContext';
import { AudioContentPipeline } from './AudioContentPipeline';
import { preprocessBlockRoots, parseCfiRange, generateCfiRange, type PreprocessedRoot } from '../cfi-utils';

// Helper to access private method
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupSentences(pipeline: AudioContentPipeline, sentences: any[], tableCfis: string[] | PreprocessedRoot[] = []): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pipeline as any).groupSentencesByRoot(sentences, tableCfis);
}

describe('AudioContentPipeline Grouping Logic', () => {
    it('should inconsistently split groups depending on order (P1, Div, P2 vs Div, P1, P2)', () => {
        const pipeline = new AudioContentPipeline(createZustandEngineContext());

        // Data setup using correct CFIs with spine separator (!)
        // Spine: /6/14

        // Div text node: path /4/1:0 -> Parent /4
        const divText = { text: 'Div Text', cfi: 'epubcfi(/6/14!/4/1:0)' };

        // P1 text node: path /4/2/1:0 -> Parent /4/2
        const p1Text = { text: 'P1 Text', cfi: 'epubcfi(/6/14!/4/2/1:0)' };

        // P2 text node: path /4/4/1:0 -> Parent /4/4
        const p2Text = { text: 'P2 Text', cfi: 'epubcfi(/6/14!/4/4/1:0)' };

        // Case 1: Div, P1, P2
        // Expected: All grouped together because Div is ancestor of both
        const case1 = groupSentences(pipeline, [divText, p1Text, p2Text]);

        // Case 2: P1, Div, P2
        // Expected: All grouped together because P1 initiates group, Div expands scope to /4, then P2 fits in /4
        const case2 = groupSentences(pipeline, [p1Text, divText, p2Text]);

        expect(case1.length).toBe(1); // Div captures both children
        expect(case2.length).toBe(1); // Div (in middle) expands scope to capture P2
    });

    describe('regression: AudioPlayerService.test (grouping)', () => {
        // Carried from the deleted AudioPlayerService.test.ts grouping block
        // (absorption ledger row 1): the pure groupSentencesByRoot pins lived
        // there for historical reasons; the colliding-parent skip-mask case is
        // covered end-to-end by parity P14 (sourceIndices-keyed masks).
        it('groups sentences by parent and generates Range CFIs for rootCfi', () => {
            const pipeline = new AudioContentPipeline(createZustandEngineContext());
            const sentences = [
                { text: 'A', cfi: 'epubcfi(/6/14!/4/2/1:0)' },
                { text: 'B', cfi: 'epubcfi(/6/14!/4/2/3:0)' }, // Same parent /4/2
                { text: 'C', cfi: 'epubcfi(/6/14!/4/4/1:0)' }, // New parent /4/4
            ];

            const groups = groupSentences(pipeline, sentences);

            expect(groups).toHaveLength(2);
            expect(groups[0].segments).toHaveLength(2);
            expect(groups[0].rootCfi).toBe(
                generateCfiRange('epubcfi(/6/14!/4/2/1:0)', 'epubcfi(/6/14!/4/2/3:0)'));
            expect(groups[1].segments).toHaveLength(1);
            expect(groups[1].rootCfi).toBe(
                generateCfiRange('epubcfi(/6/14!/4/4/1:0)', 'epubcfi(/6/14!/4/4/1:0)'));
        });

        it('generates unique rootCfi for adjacent groups sharing the same parent (Map Collision Fix)', () => {
            const pipeline = new AudioContentPipeline(createZustandEngineContext());
            // Groups separated by an intervening different parent: A1 / B1 / A2.
            const sentences = [
                { text: 'A1', cfi: 'epubcfi(/6/14!/4/2/1:0)' }, // Parent A
                { text: 'B1', cfi: 'epubcfi(/6/14!/4/4/1:0)' }, // Parent B
                { text: 'A2', cfi: 'epubcfi(/6/14!/4/2/3:0)' }, // Parent A again
            ];

            const groups = groupSentences(pipeline, sentences);

            expect(groups).toHaveLength(3);
            expect(groups[0].rootCfi).not.toBe(groups[2].rootCfi);
            expect(groups[0].rootCfi).toContain('1:0');
            expect(groups[2].rootCfi).toContain('3:0');
        });
    });

    describe('regression: range-CFI table roots keep distinct group identities (D2)', () => {
        // The deleted TableAdaptationProcessor.preprocessTableRoots escaped its template
        // literal and emitted the literal string 'epubcfi(${range.parent})' as every
        // range-CFI table's `original`, so adjacent tables merged into a single group.
        // The pipeline now feeds preprocessBlockRoots output into groupSentencesByRoot.
        it('keeps two adjacent range-CFI tables in separate groups with parseable root CFIs', () => {
            const pipeline = new AudioContentPipeline(createZustandEngineContext());

            // Two sibling tables (/4/10 and /4/12), each persisted as a range CFI
            const tableRoots = preprocessBlockRoots([
                'epubcfi(/6/14!/4/10,/2/1:0,/8/1:20)',
                'epubcfi(/6/14!/4/12,/2/1:0,/6/1:14)',
            ]);

            const sentences = [
                { text: 'Table 1 row A', cfi: 'epubcfi(/6/14!/4/10/2/1:0)' },
                { text: 'Table 1 row B', cfi: 'epubcfi(/6/14!/4/10/8/1:0)' },
                { text: 'Table 2 row A', cfi: 'epubcfi(/6/14!/4/12/2/1:0)' },
                { text: 'Table 2 row B', cfi: 'epubcfi(/6/14!/4/12/6/1:0)' },
            ];

            const groups = groupSentences(pipeline, sentences, tableRoots);

            // Broken version: both tables shared the junk identity and merged into ONE group.
            expect(groups).toHaveLength(2);
            expect(groups[0].segments).toHaveLength(2);
            expect(groups[1].segments).toHaveLength(2);

            for (const group of groups) {
                // No literal '${' placeholder may leak into emitted CFIs/group data
                expect(JSON.stringify(group)).not.toContain('${');
                // The finalized root must be a parseable range CFI
                expect(parseCfiRange(group.rootCfi)).not.toBeNull();
            }
            expect(parseCfiRange(groups[0].rootCfi)?.parent).toBe('/6/14!/4/10');
            expect(parseCfiRange(groups[1].rootCfi)?.parent).toBe('/6/14!/4/12');
        });
    });
});
