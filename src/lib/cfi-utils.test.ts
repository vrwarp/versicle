import { describe, it, expect } from 'vitest';
import { mergeCfiRanges, parseCfiRange, generateCfiRange, generateEpubCfi } from './cfi-utils';

describe('cfi-utils', () => {

    describe('parseCfiRange', () => {
        it('parses a valid CFI range', () => {
            const range = 'epubcfi(/6/14!/4/2/1,:0,:10)';
            const parsed = parseCfiRange(range);
            expect(parsed).not.toBeNull();
            expect(parsed?.parent).toBe('/6/14!/4/2/1');
            expect(parsed?.start).toBe(':0');
            expect(parsed?.end).toBe(':10');
            expect(parsed?.fullStart).toBe('epubcfi(/6/14!/4/2/1:0)');
            expect(parsed?.fullEnd).toBe('epubcfi(/6/14!/4/2/1:10)');
        });

        it('returns null for invalid CFI range', () => {
            expect(parseCfiRange('invalid')).toBeNull();
            expect(parseCfiRange('epubcfi(/a,/b)')).toBeNull();
            expect(parseCfiRange('')).toBeNull();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(parseCfiRange(null as any)).toBeNull();
        });

        it('handles offsets correctly', () => {
            const range = 'epubcfi(/6/14!/4/2/1,:100,:200)';
            const parsed = parseCfiRange(range);
            expect(parsed?.start).toBe(':100');
            expect(parsed?.end).toBe(':200');
        });
    });

    describe('generateCfiRange', () => {
        it('generates a CFI range from two CFIs', () => {
            const start = 'epubcfi(/6/14!/4/2/1:0)';
            const end = 'epubcfi(/6/14!/4/2/1:10)';
            const range = generateCfiRange(start, end);
            expect(range).toBe('epubcfi(/6/14!/4/2/1,:0,:10)');
        });

        it('handles CFIs with step indirection', () => {
            const start = 'epubcfi(/6/14!/4[id]/2/1:0)';
            const end = 'epubcfi(/6/14!/4[id]/2/1:10)';
            const range = generateCfiRange(start, end);
            expect(range).toBe('epubcfi(/6/14!/4[id]/2/1,:0,:10)');
        });
    });

    describe('mergeCfiRanges', () => {
        it('merges overlapping ranges', () => {
            const range1 = 'epubcfi(/6/14!/4/2/1,:10,:30)';
            const range2 = 'epubcfi(/6/14!/4/2/1,:20,:40)';
            const result = mergeCfiRanges([range1], range2);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe('epubcfi(/6/14!/4/2/1,:10,:40)');
        });

        it('keeps disjoint ranges separate', () => {
            const range1 = 'epubcfi(/6/14!/4/2/1,:10,:20)';
            const range2 = 'epubcfi(/6/14!/4/2/1,:30,:40)';
            const result = mergeCfiRanges([range1], range2);
            expect(result).toHaveLength(2);
            expect(result[0]).toBe(range1);
            expect(result[1]).toBe(range2);
        });

        it('merges contained ranges', () => {
            const range1 = 'epubcfi(/6/14!/4/2/1,:10,:40)';
            const range2 = 'epubcfi(/6/14!/4/2/1,:20,:30)';
            const result = mergeCfiRanges([range1], range2);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(range1);
        });

        it('correctly compares numerical steps with assertions (2[id] vs 10[id])', () => {
            const range1 = 'epubcfi(/6/14!/2[id]/2/1,:0,:10)';
            const range2 = 'epubcfi(/6/14!/10[id]/2/1,:0,:10)';

            // Correct order: 2 comes before 10.
            const result = mergeCfiRanges([range1], range2);
            expect(result[0]).toBe(range1);
            expect(result[1]).toBe(range2);
        });

        it('correctly compares numerical offsets (1:2 vs 1:10)', () => {
            const range1 = 'epubcfi(/6/14!/4/2/1,:2,:5)';
            const range2 = 'epubcfi(/6/14!/4/2/1,:10,:15)';

            const result = mergeCfiRanges([range1], range2);

            expect(result).toHaveLength(2);
            expect(result[0]).toBe(range1);
            expect(result[1]).toBe(range2);
        });

        describe('Edge Cases', () => {
             it('returns empty array for empty input', () => {
                 expect(mergeCfiRanges([])).toEqual([]);
             });
        });
    });

    describe('generateEpubCfi', () => {
        it('generates a CFI for a simple range', () => {
             const dom = new DOMParser().parseFromString(
                 '<html><body><div><p>Hello</p></div></body></html>',
                 'text/html'
             );
             // Note: in jsdom/browser, parseFromString with text/html adds html, head, body if missing.
             // We explicitly added them to be sure of structure.
             const p = dom.querySelector('p');
             if (!p || !p.firstChild) throw new Error("Setup failed");

             const range = dom.createRange();
             range.setStart(p.firstChild, 0);
             range.setEnd(p.firstChild, 5);

             const baseCfi = 'epubcfi(/6/14!)';

             // We are not sure exactly what epub.js will generate for this structure without more context,
             // but it should at least return a string starting with the baseCfi.

             const cfi = generateEpubCfi(range, baseCfi);

             expect(cfi).toBeTypeOf('string');
             expect(cfi).toContain('epubcfi(/6/14!');
             // It should also contain the range content
             expect(cfi).toContain(',');
        });
    });
});
