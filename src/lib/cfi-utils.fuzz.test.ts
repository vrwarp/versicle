import { describe, it, expect } from 'vitest';
import { mergeCfiRanges, generateCfiRange, parseCfiRange, getParentCfi } from './cfi-utils';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../test/fuzz-utils';

describe('cfi-utils Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    /**
     * Generates a valid-looking CFI using seeded RNG.
     */
    const generateRandomCfi = (rng: SeededRandom, step?: number) => {
        const s = step ?? rng.nextInt(2, 100);
        const offset = rng.nextInt(0, 500);
        const hasId = rng.nextBool();
        const id = hasId ? `[id${rng.nextInt(1, 99)}]` : '';
        return `epubcfi(/6/${s}${id}!/4/2/1:${offset})`;
    };

    /**
     * Generates a random string with potentially problematic characters.
     */
    const randomString = (rng: SeededRandom, length: number) => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+[]{}|;:,.<>?/\\"`~';
        return rng.nextString(length, characters);
    };

    it('remains stable under random merges (Idempotency & Associativity)', () => {
        const rng = new SeededRandom(SEED);

        const cfi1 = generateRandomCfi(rng, 10);
        const cfi2 = generateRandomCfi(rng, 20);
        const cfi3 = generateRandomCfi(rng, 30);

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
        for (let i = 0; i < 100; i++) {
            // Ensure strict ordering for generation
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i + 1})`;
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
        for (let i = 0; i < 100; i += 2) {
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i + 1})`;
            ranges.push(generateCfiRange(s, e));
        }

        const result = mergeCfiRanges(ranges);

        // Should remain 50 separate ranges
        expect(result).toHaveLength(50);
    });

    it('parseCfiRange survives random strings', () => {
        const rng = new SeededRandom(SEED);

        for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
            const str = randomString(rng, rng.nextInt(0, 50));
            // Should not throw
            try {
                const res = parseCfiRange(str);
                // It's likely null, but strict check is it doesn't crash
                expect(res === null || typeof res === 'object').toBe(true);
            } catch (e) {
                console.error(`Crashed on input (seed=${SEED}, iteration=${i}): ${str}`);
                throw e;
            }
        }
    });

    it('getParentCfi survives random strings', () => {
        const rng = new SeededRandom(SEED);

        for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
            const str = randomString(rng, rng.nextInt(0, 50));
            try {
                const res = getParentCfi(str);
                expect(typeof res).toBe('string');
            } catch (e) {
                console.error(`Crashed on input (seed=${SEED}, iteration=${i}): ${str}`);
                throw e;
            }
        }
    });

    it('getParentCfi handles deep random paths', () => {
        const rng = new SeededRandom(SEED);

        for (let i = 0; i < 100; i++) {
            let path = 'epubcfi(/6/2!';
            const depth = rng.nextInt(0, 20); // up to 20 levels deep
            for (let d = 0; d < depth; d++) {
                path += `/${rng.nextInt(0, 10)}`;
            }
            path += ')';

            const res = getParentCfi(path);
            expect(typeof res).toBe('string');
            // It should potentially strip something but not crash
        }
    });

    it('generateCfiRange survives random CFI pairs', () => {
        const rng = new SeededRandom(SEED);

        for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
            const cfi1 = generateRandomCfi(rng);
            const cfi2 = generateRandomCfi(rng);

            try {
                const range = generateCfiRange(cfi1, cfi2);
                expect(typeof range).toBe('string');
            } catch (e) {
                console.error(`Crashed on inputs (seed=${SEED}, iteration=${i}): ${cfi1}, ${cfi2}`);
                throw e;
            }
        }
    });

    it('mergeCfiRanges survives random range inputs', () => {
        const rng = new SeededRandom(SEED);

        for (let i = 0; i < 100; i++) {
            const numRanges = rng.nextInt(1, 20);
            const ranges: string[] = [];

            for (let j = 0; j < numRanges; j++) {
                const cfi1 = generateRandomCfi(rng);
                const cfi2 = generateRandomCfi(rng);
                ranges.push(generateCfiRange(cfi1, cfi2));
            }

            try {
                const result = mergeCfiRanges(ranges);
                expect(Array.isArray(result)).toBe(true);
            } catch (e) {
                console.error(`Crashed on iteration ${i} (seed=${SEED}) with ${numRanges} ranges`);
                throw e;
            }
        }
    });
});
