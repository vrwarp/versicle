import { describe, it, expect } from 'vitest';
import { getParentCfi, parseCfiRange, generateCfiRange, mergeCfiRanges } from './cfi-utils';

describe('cfi-utils', () => {

  describe('parseCfiRange', () => {
    it('parses range CFI correctly', () => {
      const cfi = 'epubcfi(/6/2!/4/2,:0,:10)';
      const result = parseCfiRange(cfi);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.parent).toBe('/6/2!/4/2');
        expect(result.start).toBe(':0');
        expect(result.end).toBe(':10');
        expect(result.fullStart).toBe('epubcfi(/6/2!/4/2:0)');
      }
    });

    it('returns null for invalid range format', () => {
      expect(parseCfiRange('invalid')).toBeNull();
      expect(parseCfiRange('epubcfi(invalid)')).toBeNull(); // Missing comma split
    });
  });

  describe('generateCfiRange', () => {
    it('generates range CFI from two overlapping CFIs', () => {
      const start = 'epubcfi(/6/2!/4/2/1:5)';
      const end = 'epubcfi(/6/2!/4/2/1:15)';
      const range = generateCfiRange(start, end);
      expect(range).toBe('epubcfi(/6/2!/4/2/1,:5,:15)');
    });

    it('generates range CFI with different paths', () => {
      const start = 'epubcfi(/6/2!/4/2/1:0)';
      const end = 'epubcfi(/6/2!/4/2/2:0)';
      const range = generateCfiRange(start, end);
      expect(range).toBe('epubcfi(/6/2!/4/2,/1:0,/2:0)');
    });
  });

  describe('getParentCfi', () => {
    it('strips leaf node correctly', () => {
      const cfi = 'epubcfi(/6/2!/4/2/1:0)';
      const parent = getParentCfi(cfi);
      expect(parent).toBe('epubcfi(/6/2!/4/2)');
    });

    it('collapses deeply nested paths to block level (depth 3)', () => {
      const cfi = 'epubcfi(/6/2!/4/2/2/1/1)';
      const parent = getParentCfi(cfi);
      expect(parent).toBe('epubcfi(/6/2!/4/2/2)');
    });

    it('returns same path if depth is small', () => {
       const cfi = 'epubcfi(/6/2!/4/2)';
       const parent = getParentCfi(cfi);
       expect(parent).toBe('epubcfi(/6/2!/4)');
    });

    it('handles multiple segments properly', () => {
      const cfi = 'epubcfi(/6/10!/4/2/2/6/1:45)';
      const parent = getParentCfi(cfi);
      expect(parent).toBe('epubcfi(/6/10!/4/2/2)');
    });

    it('extracts parent from range CFI', () => {
        const cfi = 'epubcfi(/6/2!/4/2,:0,:10)';
        const parent = getParentCfi(cfi);
        expect(parent).toBe('epubcfi(/6/2!/4/2)');
    });
  });

  describe('mergeCfiRanges', () => {
      it('merges overlapping ranges', () => {
          const range1 = 'epubcfi(/6/2!/4/2,:0,:10)';
          const range2 = 'epubcfi(/6/2!/4/2,:5,:20)';
          const merged = mergeCfiRanges([range1], range2);
          expect(merged).toHaveLength(1);
          // Expect merged range to cover :0 to :20
          expect(merged[0]).toContain(',:0,:20');
      });

      it('keeps disjoint ranges separate', () => {
          const range1 = 'epubcfi(/6/2!/4/2,:0,:10)';
          const range2 = 'epubcfi(/6/2!/4/2,:30,:40)';
          const merged = mergeCfiRanges([range1], range2);
          expect(merged).toHaveLength(2);
      });

      it('handles ranges across different chapters (disjoint)', () => {
           // Different spine items (2 vs 4)
           const r1 = 'epubcfi(/6/2!/4/2/1,:0,:10)';
           const r2 = 'epubcfi(/6/4!/4/2/2,:0,:10)';
           const merged = mergeCfiRanges([r1], r2);
           expect(merged).toHaveLength(2);
      });
  });
});
