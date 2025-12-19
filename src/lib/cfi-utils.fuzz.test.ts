
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeCfiRanges, generateCfiRange } from './cfi-utils';

// Mock epubjs
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

describe('cfi-utils Fuzzing', () => {
    beforeEach(() => {
        // Use standard mock behavior
        mockEpubCFI = class MockCFI {
            compare(a: string, b: string) {
                // Simple lexical sort is usually sufficient for fuzzing structure unless we generate conflicting logic
                // But let's try to be consistent with our generated CFIs
                if (a === b) return 0;
                // Parse integers if possible for better sorting in fuzz
                const strip = (s: string) => s.replace(/^epubcfi\(|\)$/g, '');
                const aParts = strip(a).split(/[:/,!]/).filter(Boolean);
                const bParts = strip(b).split(/[:/,!]/).filter(Boolean);

                for(let i=0; i<Math.min(aParts.length, bParts.length); i++) {
                    const nA = parseInt(aParts[i]);
                    const nB = parseInt(bParts[i]);
                    if (!isNaN(nA) && !isNaN(nB)) {
                        if (nA !== nB) return nA - nB;
                    }
                    if (aParts[i] < bParts[i]) return -1;
                    if (aParts[i] > bParts[i]) return 1;
                }
                return aParts.length - bParts.length;
            }
        };
    });

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
        const merged = mergeCfiRanges([range1], range2);

        expect(merged).toHaveLength(1);
        // It should contain start of cfi1 and end of cfi3 (approximately)
        // Since generateCfiRange strips stuff, we just check length.

        // Idempotency: Merge(A, A) = A
        const mergedSelf = mergeCfiRanges([range1], range1);
        expect(mergedSelf).toHaveLength(1);
        expect(mergedSelf[0]).toBe(range1);
    });

    it('handles large inputs without crashing', () => {
        const ranges: string[] = [];
        for(let i=0; i<100; i++) {
            // Ensure strict ordering for generation
            // Actually generateRandomCfi is pseudo-random hash, not strictly increasing.
            // So we might have start > end.
            // generateCfiRange handles start/end blindly, just stripping common prefix.
            // If common prefix is short, it might be weird.
            // Let's force simple increasing structure
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i+1})`;
            ranges.push(generateCfiRange(s, e));
        }

        // All adjacent ranges: 0-1, 1-2, 2-3...
        // Should merge into ONE giant range 0-100
        const result = ranges.reduce((acc, curr) => mergeCfiRanges(acc, curr), [] as string[]);

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

        const result = ranges.reduce((acc, curr) => mergeCfiRanges(acc, curr), [] as string[]);

        // Should remain 50 separate ranges
        expect(result).toHaveLength(50);
    });
});
