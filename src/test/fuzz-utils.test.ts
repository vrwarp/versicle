import { describe, it, expect } from 'vitest';
import { SeededRandom, DEFAULT_FUZZ_SEED } from './fuzz-utils';

describe('SeededRandom', () => {
    it('produces deterministic sequences with same seed', () => {
        const rng1 = new SeededRandom(DEFAULT_FUZZ_SEED);
        const rng2 = new SeededRandom(DEFAULT_FUZZ_SEED);

        for (let i = 0; i < 100; i++) {
            expect(rng1.next()).toBe(rng2.next());
        }
    });

    it('produces different sequences with different seeds', () => {
        const rng1 = new SeededRandom(1);
        const rng2 = new SeededRandom(2);

        // At least one of the first 10 values should differ
        const values1 = Array.from({ length: 10 }, () => rng1.next());
        const values2 = Array.from({ length: 10 }, () => rng2.next());

        expect(values1).not.toEqual(values2);
    });

    it('next() returns values in [0, 1)', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 1000; i++) {
            const val = rng.next();
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    it('nextInt() returns values in [min, max]', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 1000; i++) {
            const val = rng.nextInt(5, 10);
            expect(val).toBeGreaterThanOrEqual(5);
            expect(val).toBeLessThanOrEqual(10);
            expect(Number.isInteger(val)).toBe(true);
        }
    });

    it('nextBool() returns both true and false', () => {
        const rng = new SeededRandom(42);
        let trueCount = 0;
        let falseCount = 0;

        for (let i = 0; i < 1000; i++) {
            if (rng.nextBool()) trueCount++;
            else falseCount++;
        }

        expect(trueCount).toBeGreaterThan(0);
        expect(falseCount).toBeGreaterThan(0);
    });

    it('nextString() returns strings of correct length', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 100; i++) {
            const len = rng.nextInt(1, 50);
            const str = rng.nextString(len);
            expect(str.length).toBe(len);
        }
    });

    it('nextElement() returns elements from array', () => {
        const rng = new SeededRandom(42);
        const arr = ['a', 'b', 'c', 'd', 'e'];

        for (let i = 0; i < 100; i++) {
            const elem = rng.nextElement(arr);
            expect(arr).toContain(elem);
        }
    });

    it('nextElement() throws on empty array', () => {
        const rng = new SeededRandom(42);
        expect(() => rng.nextElement([])).toThrow('Cannot select from empty array');
    });

    it('shuffle() returns all original elements', () => {
        const rng = new SeededRandom(42);
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const shuffled = rng.shuffle(arr);

        expect(shuffled.length).toBe(arr.length);
        expect(shuffled.sort()).toEqual(arr.sort());
    });

    it('subset() returns correct size', () => {
        const rng = new SeededRandom(42);
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        const sub = rng.subset(arr, 3);
        expect(sub.length).toBe(3);
        sub.forEach(elem => expect(arr).toContain(elem));
    });

    it('nextUnicodeString() returns non-empty strings', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 50; i++) {
            const str = rng.nextUnicodeString(10);
            expect(str.length).toBeGreaterThan(0);
        }
    });

    it('nextCfi() returns valid-looking CFI strings', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 100; i++) {
            const cfi = rng.nextCfi();
            expect(cfi).toMatch(/^epubcfi\(/);
            expect(cfi).toMatch(/\)$/);
        }
    });
});
