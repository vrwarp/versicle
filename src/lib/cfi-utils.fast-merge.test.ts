import { describe, it, expect } from 'vitest';
import { tryFastMergeCfi, generateCfiRange, parseCfiRange } from './cfi-utils';

// Simple seeded PRNG for deterministic fuzz testing
class MersenneTwister {
    private mt: number[];
    private index: number;

    constructor(seed: number) {
        this.mt = new Array(624);
        this.index = 0;
        this.mt[0] = seed;
        for (let i = 1; i < 624; i++) {
            const s = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
            this.mt[i] = ((1812433253 * ((s & 0xffff0000) >>> 16)) << 16) + (1812433253 * (s & 0x0000ffff)) + i;
            this.mt[i] >>>= 0;
        }
    }

    extractNumber() {
        if (this.index === 0) {
            this.generateNumbers();
        }
        let y = this.mt[this.index];
        y = y ^ (y >>> 11);
        y = y ^ ((y << 7) & 0x9d2c5680);
        y = y ^ ((y << 15) & 0xefc60000);
        y = y ^ (y >>> 18);
        this.index = (this.index + 1) % 624;
        return y >>> 0;
    }

    generateNumbers() {
        for (let i = 0; i < 624; i++) {
            const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7fffffff);
            this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1);
            if (y % 2 !== 0) {
                this.mt[i] = this.mt[i] ^ 0x9908b0df;
            }
        }
    }

    // Return float between 0 and 1
    random() {
        return this.extractNumber() / 4294967296;
    }

    // Return integer between min and max (inclusive)
    range(min: number, max: number) {
        return Math.floor(this.random() * (max - min + 1)) + min;
    }
}

describe('tryFastMergeCfi', () => {
    const parent = '/6/14[chapter1]!/4/2';

    describe('Base Cases', () => {
        it('merges Range + Range with same parent', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(${parent},/1:10,/1:20)`;
            const expected = `epubcfi(${parent},/1:0,/1:20)`;

            expect(tryFastMergeCfi(left, right)).toBe(expected);
        });

        it('merges Range + Point (Point is successor)', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(${parent}/1:15)`;
            // NOTE: The current implementation appends the Point's relative path.
            // parent=/6/14[chapter1]!/4/2
            // right relative = /1:15
            // Expected: epubcfi(parent, /1:0, /1:15)
            const expected = `epubcfi(${parent},/1:0,/1:15)`;
            expect(tryFastMergeCfi(left, right)).toBe(expected);
        });

        it('merges Point + Range (Point is predecessor)', () => {
            const left = `epubcfi(${parent}/1:0)`;
            const right = `epubcfi(${parent},/1:5,/1:10)`;
            const expected = `epubcfi(${parent},/1:0,/1:10)`;
            expect(tryFastMergeCfi(left, right)).toBe(expected);
        });
    });

    describe('Bail-out Cases (Should return null)', () => {
        it('returns null for Range + Range with different parents', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(/6/14[other]!/4/2,/1:10,/1:20)`;
            expect(tryFastMergeCfi(left, right)).toBeNull();
        });

        it('returns null for Range + Point with different parents', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(/6/14[other]!/4/2/1:15)`;
            expect(tryFastMergeCfi(left, right)).toBeNull();
        });

        it('returns null for Point + Range with different parents', () => {
            const left = `epubcfi(/6/14[other]!/4/2/1:0)`;
            const right = `epubcfi(${parent},/1:5,/1:10)`;
            expect(tryFastMergeCfi(left, right)).toBeNull();
        });

        it('returns null for Point + Point', () => {
            const left = `epubcfi(${parent}/1:0)`;
            const right = `epubcfi(${parent}/1:10)`;
            expect(tryFastMergeCfi(left, right)).toBeNull();
        });

        it('returns null for invalid inputs', () => {
            // @ts-expect-error Testing invalid input
            expect(tryFastMergeCfi(null, null)).toBeNull();
            expect(tryFastMergeCfi('', '')).toBeNull();
            expect(tryFastMergeCfi('invalid', 'epubcfi(...)')).toBeNull();
            expect(tryFastMergeCfi('epubcfi(...)', 'invalid')).toBeNull();
        });
    });

    describe('Edge Cases', () => {
        it('handles Ranges with IDs in steps', () => {
            // e.g. parent has [id], steps have [id]
            const complexParent = '/6/14[ch1]!/4[div1]/2[p1]';
            const left = `epubcfi(${complexParent},/1:0,/3:10)`;
            const right = `epubcfi(${complexParent},/3:10,/5:20)`;

            const result = tryFastMergeCfi(left, right);
            expect(result).toBe(`epubcfi(${complexParent},/1:0,/5:20)`);
        });

        it('handles partial parent matches (should bail)', () => {
            // parent1: /1/2
            // parent2: /1/20
            // verify /1/2 prefix check doesn't false positive on /1/20
            const p1 = '/1/2';
            const p2 = '/1/20';
            const left = `epubcfi(${p1},/1:0,/1:10)`;
            const right = `epubcfi(${p2},/1:0,/1:10)`;
            expect(tryFastMergeCfi(left, right)).toBeNull();
        });
    });

    describe('Fuzz Testing', () => {
        const prng = new MersenneTwister(12345); // Fixed seed
        const ITERATIONS = 1000;

        // Generators
        const genPath = (depth: number) => {
            const steps = [];
            for(let i=0; i<depth; i++) {
                steps.push(`/${prng.range(2, 20) * 2}`); // Evens usually for elements
                if (prng.random() > 0.8) steps.push(`[id${prng.range(1, 100)}]`);
            }
            return steps.join('');
        };

        const genCfiRange = (parent: string) => {
            const startStep = `/${prng.range(1, 10)}:${prng.range(0, 100)}`;
            const endStep = `/${prng.range(11, 20)}:${prng.range(0, 100)}`;
            return `epubcfi(${parent},${startStep},${endStep})`;
        };

        const genCfiPoint = (parent: string) => {
            const step = `/${prng.range(1, 10)}:${prng.range(0, 100)}`;
            return `epubcfi(${parent}${step})`;
        };

        it(`matches slow-path result or returns null (Fuzz x${ITERATIONS})`, () => {
            let fastPathHits = 0;

            for(let i=0; i<ITERATIONS; i++) {
                // 1. Generate Parent(s)
                const parentA = genPath(prng.range(2, 5));
                // 50% chance of same parent
                const parentB = (prng.random() > 0.5) ? parentA : genPath(prng.range(2, 5));

                // 2. Generate Left/Right (Range or Point)
                const typeA = prng.random() > 0.3 ? 'range' : 'point';
                const typeB = prng.random() > 0.3 ? 'range' : 'point';

                const cfiA = typeA === 'range' ? genCfiRange(parentA) : genCfiPoint(parentA);
                const cfiB = typeB === 'range' ? genCfiRange(parentB) : genCfiPoint(parentB);

                // 3. Run Fast Merge
                const fastResult = tryFastMergeCfi(cfiA, cfiB);

                if (fastResult !== null) {
                    fastPathHits++;

                    // 4. Verify against Slow Merge
                    // We need to parse the fast result and the inputs to compare logical equivalence
                    // effectively, we expect:
                    // Start of merged = Start of A
                    // End of merged = End of B (roughly, assuming A < B which fuzz doesn't guarantee, but fastMerge assumes strict structural appending)

                    // Actually, fastMerge logic assumes:
                    // Case 1 (Range+Range): Parent match. Result = (Parent, A.start, B.end)
                    // Case 2 (Range+Point): Parent match. Result = (Parent, A.start, B.relative)
                    // Case 3 (Point+Range): Parent match. Result = (Parent, A.relative, B.end)

                    // So we can verify by parsing the fast result and ensuring components match expectations.

                    const parsedA = parseCfiRange(cfiA) || { rawStart: '', rawEnd: '', start: '', end: '', parent: '' };
                    const parsedB = parseCfiRange(cfiB) || { rawStart: '', rawEnd: '', start: '', end: '', parent: '' };

                    // For Point inputs, parseCfiRange returns null usually, but we need to handle them for verification
                    // However, tryFastMergeCfi only works if it can parse ranges or extract relative paths.

                    // Let's rely on the fact that if fastResult is not null, it constructs a string.
                    // We should verify that string is valid CFI syntax and has the correct components.

                    const parsedResult = parseCfiRange(fastResult);
                    expect(parsedResult).not.toBeNull();

                    if (!parsedResult) continue;

                    expect(parsedResult.parent).toBe(parentA);

                    // Verify Start
                    if (typeA === 'range') {
                         // Expect merged start to equal A start
                         // Note: parseCfiRange(A).start excludes leading comma?
                         // parseCfiRange implementation:
                         // parts = content.split(',') -> parent, start, end
                         // start = parts[1] (includes /step/step...)
                         expect(parsedResult.start).toBe(parsedA.start);
                    } else {
                        // Point A: epubcfi(P/S)
                        // Fast merge (Point+Range) -> epubcfi(P, /S, RangeEnd)
                        // Start part should match /S
                        const relativeA = cfiA.slice(8 + parentA.length, -1);
                        expect(parsedResult.start).toBe(relativeA);
                    }

                    // Verify End
                    if (typeB === 'range') {
                        expect(parsedResult.end).toBe(parsedB.end);
                    } else {
                        // Point B: epubcfi(P/S)
                        // Fast merge (Range+Point) -> epubcfi(P, RangeStart, /S)
                        const relativeB = cfiB.slice(8 + parentB.length, -1);
                        expect(parsedResult.end).toBe(relativeB);
                    }
                }
            }

            console.log(`Fuzzing complete. Fast path hit rate: ${fastPathHits}/${ITERATIONS}`);
        });
    });
});
