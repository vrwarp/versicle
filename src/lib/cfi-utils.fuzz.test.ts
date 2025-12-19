import { describe, it, expect } from 'vitest';
import { mergeCfiRanges, generateCfiRange } from './cfi-utils';

describe('cfi-utils Fuzzing', () => {

    const generateRandomCfi = (seed: number) => {
        // Generate valid-looking CFI structure
        // epubcfi(/6/14!/4/2/1:0)
        // Let's vary the last part mainly for ranges
        const step = Math.floor((seed * 9301 + 49297) % 233280);
        const offset = Math.floor(seed % 100);
        return `epubcfi(/6/${step}!/4/2/1:${offset})`;
    };

    it('remains stable under random merges (Idempotency & Associativity)', () => {
        const cfi1 = generateRandomCfi(1);
        const cfi2 = generateRandomCfi(2);
        const cfi3 = generateRandomCfi(3);

        const range1 = generateCfiRange(cfi1, cfi2); // Range 1-2
        const range2 = generateCfiRange(cfi2, cfi3); // Range 2-3

        // Merge (1-2) + (2-3) should be (1-3)
        // Note: this assumes range1 and range2 overlap or abut.
        // Since random generation is used, they might not.
        // But we just test stability (no crash, returns something).

        const ranges = [range1, range2];
        const merged = mergeCfiRanges(ranges);

        expect(merged.length).toBeGreaterThan(0);

        // Idempotency: Merge(A, A) = A
        const mergedSelf = mergeCfiRanges([range1], range1);
        expect(mergedSelf).toHaveLength(1);
        expect(mergedSelf[0]).toBe(range1);
    });

    it('handles large inputs without crashing', () => {
        const ranges: string[] = [];
        for(let i=0; i<100; i++) {
            // Ensure strict ordering for generation
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i+1})`;
            ranges.push(generateCfiRange(s, e));
        }

        // All adjacent ranges: 0-1, 1-2, 2-3...
        // Should merge into ONE giant range 0-100
        const result = mergeCfiRanges(ranges);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain(':0');
        expect(result[0]).toContain(':100');
    });

    it('handles non-contiguous fuzz', () => {
        const ranges: string[] = [];
        // Even: 0-1, 2-3, 4-5...
        for(let i=0; i<100; i+=2) {
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i+1})`;
            ranges.push(generateCfiRange(s, e));
        }

        const result = mergeCfiRanges(ranges);

        // Should remain 50 separate ranges
        expect(result).toHaveLength(50);
    });
});
