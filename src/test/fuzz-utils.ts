/**
 * Seedable PRNG utility for fuzz testing.
 * Uses a Linear Congruential Generator (LCG) for reproducible random sequences.
 * 
 * Usage:
 * ```typescript
 * const rng = new SeededRandom(12345);
 * const value = rng.next(); // [0, 1)
 * const str = rng.nextString(10);
 * ```
 */
export class SeededRandom {
    private seed: number;

    // LCG parameters (same as glibc)
    private static readonly A = 1103515245;
    private static readonly C = 12345;
    private static readonly M = 2 ** 31;

    constructor(seed: number) {
        this.seed = seed % SeededRandom.M;
    }

    /**
     * Returns a random float in [0, 1).
     */
    next(): number {
        this.seed = (SeededRandom.A * this.seed + SeededRandom.C) % SeededRandom.M;
        return this.seed / SeededRandom.M;
    }

    /**
     * Returns a random integer in [min, max] (inclusive).
     */
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /**
     * Returns a random boolean.
     */
    nextBool(): boolean {
        return this.next() < 0.5;
    }

    /**
     * Returns a random string of the given length from the charset.
     */
    nextString(length: number, charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += charset.charAt(this.nextInt(0, charset.length - 1));
        }
        return result;
    }

    /**
     * Returns a random element from the array.
     */
    nextElement<T>(arr: readonly T[]): T {
        if (arr.length === 0) {
            throw new Error('Cannot select from empty array');
        }
        return arr[this.nextInt(0, arr.length - 1)];
    }

    /**
     * Returns a shuffled copy of the array using Fisher-Yates.
     */
    shuffle<T>(arr: readonly T[]): T[] {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    /**
     * Returns a random subset of the array with the given size.
     */
    subset<T>(arr: readonly T[], size: number): T[] {
        if (size >= arr.length) return [...arr];
        const shuffled = this.shuffle(arr);
        return shuffled.slice(0, size);
    }

    /**
     * Returns a string with random Unicode characters including emoji and special chars.
     */
    nextUnicodeString(length: number): string {
        const ranges = [
            // ASCII letters and digits
            () => String.fromCharCode(this.nextInt(65, 90)),
            () => String.fromCharCode(this.nextInt(97, 122)),
            () => String.fromCharCode(this.nextInt(48, 57)),
            // Common punctuation
            () => this.nextElement(['.', ',', '!', '?', ';', ':', '-', "'", '"', '(', ')', '[', ']']),
            // Whitespace
            () => this.nextElement([' ', '\t', '\n']),
            // Common emojis (as surrogate pairs)
            () => this.nextElement(['😀', '🔥', '❤️', '👍', '🎉', '📚', '✨', '💡']),
            // Accented Latin
            () => String.fromCharCode(this.nextInt(192, 255)),
            // Greek
            () => String.fromCharCode(this.nextInt(913, 969)),
            // CJK (Chinese)
            () => String.fromCharCode(this.nextInt(0x4E00, 0x4E50)),
        ];

        let result = '';
        for (let i = 0; i < length; i++) {
            const generator = this.nextElement(ranges);
            result += generator();
        }
        return result;
    }

    /**
     * Returns a random CFI-like string for EPUB testing.
     */
    nextCfi(): string {
        const step = this.nextInt(2, 100);
        const offset = this.nextInt(0, 500);
        const id = this.nextBool() ? `[id${this.nextInt(1, 99)}]` : '';
        return `epubcfi(/6/${step}${id}!/4/2/1:${offset})`;
    }

    /**
     * Gets the current seed (useful for debugging failed tests).
     */
    getSeed(): number {
        return this.seed;
    }
}

/**
 * Default seed for reproducible tests.
 * Tests should use this or document any alternative seed.
 */
export const DEFAULT_FUZZ_SEED = 12345;

/**
 * Number of iterations for fuzz tests.
 * Can be overridden for heavier/lighter testing.
 */
export const DEFAULT_FUZZ_ITERATIONS = 500;
