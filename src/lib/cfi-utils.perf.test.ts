import { mergeCfiRanges, generateCfiRange } from './cfi-utils';
import { describe, it, expect } from 'vitest';

describe('mergeCfiRanges Performance', () => {
    // Helper to generate sequential CFIs
    const generateSequentialRanges = (count: number) => {
        const ranges: string[] = [];
        for (let i = 0; i < count; i++) {
            // Fake CFI: /6/14!/4/2/1:{i*10},/1:{i*10+5}
            // Using a simple structure to ensure they parse and compare correctly
            // We use simple step numbers
            const start = `epubcfi(/6/14!/4/2/1:${i * 20})`;
            const end = `epubcfi(/6/14!/4/2/1:${i * 20 + 10})`;
            ranges.push(generateCfiRange(start, end));
        }
        return ranges;
    };

    it('benchmarks appending to a large list', () => {
        const N = 1000;
        const existing = generateSequentialRanges(N);
        const nextStart = `epubcfi(/6/14!/4/2/1:${N * 20})`;
        const nextEnd = `epubcfi(/6/14!/4/2/1:${N * 20 + 10})`;
        const nextRange = generateCfiRange(nextStart, nextEnd);

        const start = performance.now();
        // Run multiple times to average out noise
        for (let i = 0; i < 100; i++) {
            mergeCfiRanges(existing, nextRange);
        }
        const end = performance.now();

        const avgTime = (end - start) / 100;
        console.log(`Average time to merge 1 range into ${N} ranges: ${avgTime.toFixed(4)}ms`);

        // Sanity check
        const result = mergeCfiRanges(existing, nextRange);
        expect(result.length).toBe(N + 1);
    });

    it('verifies optimization correctness for sequential append', () => {
        const ranges = [
            'epubcfi(/6/14!/4/2,/1:0,/1:10)',
            'epubcfi(/6/14!/4/2,/1:20,/1:30)'
        ];
        const newRange = 'epubcfi(/6/14!/4/2,/1:40,/1:50)';

        const result = mergeCfiRanges(ranges, newRange);
        expect(result).toHaveLength(3);
        // Canonicalization might change the string structure slightly
        expect(result[2]).toContain(':40');
        expect(result[2]).toContain(':50');
    });

    it('verifies optimization correctness for overlapping append', () => {
        const ranges = [
            'epubcfi(/6/14!/4/2,/1:0,/1:10)',
            'epubcfi(/6/14!/4/2,/1:20,/1:30)'
        ];
        // Overlaps with the last one (starts at 25, ends at 35)
        // Last one ends at 30.
        const newRange = 'epubcfi(/6/14!/4/2,/1:25,/1:35)';

        const result = mergeCfiRanges(ranges, newRange);
        expect(result).toHaveLength(2);
        // The last one should be merged: 20 to 35
        // We can't easily assert the exact string without knowing implementation details of generateCfiRange
        // but length should be 2.
    });
});
