
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeCfiRanges, parseCfiRange, generateCfiRange } from './cfi-utils';

// We need to be able to reset the mock to test the fallback behavior
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockEpubCFI: any;

vi.mock('epubjs', () => {
  return {
    default: {
      get CFI() {
        return mockEpubCFI;
      }
    }
  };
});

describe('cfi-utils', () => {
    beforeEach(() => {
        // Default Mock Behavior: Simple Lexical Sort
        mockEpubCFI = class MockCFI {
            compare(a: string, b: string) {
                if (a === b) return 0;
                return a < b ? -1 : 1;
            }
        };
    });

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
        describe('Standard Behavior (with epubjs)', () => {
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
        });

        describe('Fallback Behavior (without epubjs)', () => {
            beforeEach(() => {
                mockEpubCFI = undefined;
            });

            it('uses fallback comparator to sort and merge ranges', () => {
                const range1 = 'epubcfi(/6/14!/4/2/1,:10,:30)';
                const range2 = 'epubcfi(/6/14!/4/2/1,:20,:40)';
                const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                const result = mergeCfiRanges([range1], range2);

                expect(result).toHaveLength(1);
                expect(result[0]).toBe('epubcfi(/6/14!/4/2/1,:10,:40)');
                consoleSpy.mockRestore();
            });

            it('correctly compares numerical offsets (1:2 vs 1:10)', () => {
                // This is the tricky case: lexicographically "1:10" < "1:2" because '1' < '2'
                // But numerically 2 < 10.
                const range1 = 'epubcfi(/6/14!/4/2/1,:2,:5)';
                const range2 = 'epubcfi(/6/14!/4/2/1,:10,:15)';

                // If sorted numerically: range1, range2.
                // If sorted lexicographically: range2, range1 (WRONG).

                const result = mergeCfiRanges([range1], range2);

                expect(result).toHaveLength(2);
                // Should be sorted by start
                expect(result[0]).toBe(range1);
                expect(result[1]).toBe(range2);
            });
        });

        describe('Edge Cases', () => {
             it('returns empty array for empty input', () => {
                 expect(mergeCfiRanges([])).toEqual([]);
             });
        });
    });
});
