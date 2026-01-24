import { describe, it, expect } from 'vitest';
import { tryFastMergeCfi, mergeCfiSlow, parseCfiRange } from './cfi-utils';
import { SeededRandom, DEFAULT_FUZZ_SEED } from '../test/fuzz-utils';

function assertCfiEqual(actual: string | null, expected: string | null) {
    if (actual === null && expected === null) return;
    if (actual === null || expected === null) {
        // One is null, the other isn't
        expect(actual).toBe(expected);
        return;
    }

    const pActual = parseCfiRange(actual);
    const pExpected = parseCfiRange(expected);

    expect(pActual).not.toBeNull();
    expect(pExpected).not.toBeNull();

    if (pActual && pExpected) {
        expect(pActual.fullStart).toBe(pExpected.fullStart);
        expect(pActual.fullEnd).toBe(pExpected.fullEnd);
    }
}

describe('tryFastMergeCfi', () => {
    const parent = '/6/14[chapter1]!/4/2';

    describe('Base Cases', () => {
        it('merges Range + Range with same parent', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(${parent},/1:10,/1:20)`;
            const expected = mergeCfiSlow(left, right);

            assertCfiEqual(tryFastMergeCfi(left, right), expected);
        });

        it('merges Range + Point (Point is successor)', () => {
            const left = `epubcfi(${parent},/1:0,/1:10)`;
            const right = `epubcfi(${parent}/1:15)`;
            const expected = mergeCfiSlow(left, right);
            assertCfiEqual(tryFastMergeCfi(left, right), expected);
        });

        it('merges Point + Range (Point is predecessor)', () => {
            const left = `epubcfi(${parent}/1:0)`;
            const right = `epubcfi(${parent},/1:5,/1:10)`;
            const expected = mergeCfiSlow(left, right);
            assertCfiEqual(tryFastMergeCfi(left, right), expected);
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

            const fastResult = tryFastMergeCfi(left, right);
            const slowResult = mergeCfiSlow(left, right);
            assertCfiEqual(fastResult, slowResult);
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
        const prng = new SeededRandom(DEFAULT_FUZZ_SEED);
        const ITERATIONS = 1000;

        // Generators
        const genPath = (depth: number) => {
            const steps = [];
            for(let i=0; i<depth; i++) {
                steps.push(`/${prng.nextInt(2, 40)}`); // Evens usually for elements
                if (prng.next() > 0.8) steps.push(`[id${prng.nextInt(1, 100)}]`);
            }
            return steps.join('');
        };

        const genCfiRange = (parent: string) => {
            const startStep = `/${prng.nextInt(1, 10)}:${prng.nextInt(0, 100)}`;
            const endStep = `/${prng.nextInt(11, 20)}:${prng.nextInt(0, 100)}`;
            return `epubcfi(${parent},${startStep},${endStep})`;
        };

        const genCfiPoint = (parent: string) => {
            const step = `/${prng.nextInt(1, 10)}:${prng.nextInt(0, 100)}`;
            return `epubcfi(${parent}${step})`;
        };

        it(`matches slow-path result or returns null (Fuzz x${ITERATIONS})`, () => {
            let fastPathHits = 0;

            for(let i=0; i<ITERATIONS; i++) {
                // 1. Generate Parent(s)
                const parentA = genPath(prng.nextInt(2, 5));
                // 50% chance of same parent
                const parentB = (prng.next() > 0.5) ? parentA : genPath(prng.nextInt(2, 5));

                // 2. Generate Left/Right (Range or Point)
                const typeA = prng.next() > 0.3 ? 'range' : 'point';
                const typeB = prng.next() > 0.3 ? 'range' : 'point';

                const cfiA = typeA === 'range' ? genCfiRange(parentA) : genCfiPoint(parentA);
                const cfiB = typeB === 'range' ? genCfiRange(parentB) : genCfiPoint(parentB);

                // 3. Run Fast Merge
                const fastResult = tryFastMergeCfi(cfiA, cfiB);

                if (fastResult !== null) {
                    fastPathHits++;

                    // 4. Verify against Slow Merge
                    const slowResult = mergeCfiSlow(cfiA, cfiB);
                    assertCfiEqual(fastResult, slowResult);
                }
            }

            console.log(`Fuzzing complete. Fast path hit rate: ${fastPathHits}/${ITERATIONS}`);
        });
    });
});
