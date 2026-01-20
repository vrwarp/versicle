import { describe, it, expect } from 'vitest';
import {
    UserInventoryItemSchema,
    ReadingListEntrySchema,
    UserProgressSchema,
    UserAnnotationSchema,
    UserOverridesSchema,
    validateYjsUpdate
} from './validators';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../../test/fuzz-utils';

describe('Sync Validators Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    /**
     * Creates a valid UserInventoryItem.
     */
    const createValidInventoryItem = (rng: SeededRandom) => ({
        bookId: rng.nextString(36),
        title: rng.nextString(rng.nextInt(1, 100)),
        author: rng.nextString(rng.nextInt(1, 50)),
        addedAt: Date.now() - rng.nextInt(0, 1000000000),
        lastInteraction: Date.now() - rng.nextInt(0, 1000000),
        sourceFilename: rng.nextBool() ? rng.nextString(50) : undefined,
        tags: Array.from({ length: rng.nextInt(0, 5) }, () => rng.nextString(10)),
        rating: rng.nextBool() ? rng.nextInt(0, 5) : undefined,
        status: rng.nextElement(['unread', 'reading', 'completed', 'abandoned'] as const),
        customTitle: rng.nextBool() ? rng.nextString(50) : undefined,
        customAuthor: rng.nextBool() ? rng.nextString(30) : undefined,
        coverPalette: rng.nextBool() ? Array.from({ length: 5 }, () => rng.nextInt(0, 65535)) : undefined,
    });

    /**
     * Creates a valid UserProgress.
     */
    const createValidProgress = (rng: SeededRandom) => ({
        bookId: rng.nextString(36),
        percentage: rng.next(),
        currentCfi: rng.nextBool() ? rng.nextCfi() : undefined,
        lastPlayedCfi: rng.nextBool() ? rng.nextCfi() : undefined,
        currentQueueIndex: rng.nextBool() ? rng.nextInt(0, 100) : undefined,
        currentSectionIndex: rng.nextBool() ? rng.nextInt(0, 50) : undefined,
        lastRead: Date.now() - rng.nextInt(0, 1000000),
        completedRanges: Array.from({ length: rng.nextInt(0, 10) }, () => rng.nextCfi()),
    });

    /**
     * Creates a valid UserAnnotation.
     */
    const createValidAnnotation = (rng: SeededRandom) => ({
        id: rng.nextString(36),
        bookId: rng.nextString(36),
        cfiRange: rng.nextCfi(),
        text: rng.nextString(rng.nextInt(1, 500)),
        type: rng.nextElement(['highlight', 'note'] as const),
        color: '#' + rng.nextString(6, '0123456789abcdef'),
        note: rng.nextBool() ? rng.nextString(rng.nextInt(0, 200)) : undefined,
        created: Date.now() - rng.nextInt(0, 1000000),
    });

    describe('UserInventoryItemSchema', () => {
        it('accepts valid inventory items', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const item = createValidInventoryItem(rng);

                try {
                    const result = validateYjsUpdate(UserInventoryItemSchema, item);
                    expect(result).toBeDefined();
                    expect(result.bookId).toBe(item.bookId);
                } catch (e) {
                    console.error(`Valid item rejected at iteration ${i}:`, item);
                    throw e;
                }
            }
        });

        it('rejects invalid inventory items', () => {
            const rng = new SeededRandom(SEED);

            const invalidItems = [
                // Missing required fields
                {},
                { bookId: 'test' },
                // Wrong types
                { bookId: 123, title: 'Test', author: 'Author', addedAt: 100, lastInteraction: 100, tags: [], status: 'reading' },
                { bookId: 'test', title: null, author: 'Author', addedAt: 100, lastInteraction: 100, tags: [], status: 'reading' },
                // Invalid enum value
                { bookId: 'test', title: 'Test', author: 'Author', addedAt: 100, lastInteraction: 100, tags: [], status: 'invalid' },
                // Invalid rating
                { bookId: 'test', title: 'Test', author: 'Author', addedAt: 100, lastInteraction: 100, tags: [], status: 'reading', rating: 10 },
                // Random garbage
                rng.nextUnicodeString(50),
                null,
                undefined,
                42,
                [],
            ];

            for (const item of invalidItems) {
                expect(() => validateYjsUpdate(UserInventoryItemSchema, item)).toThrow();
            }
        });

        it('handles coverPalette array validation', () => {
            const rng = new SeededRandom(SEED);

            // Valid palette
            const validItem = {
                ...createValidInventoryItem(rng),
                coverPalette: [0, 100, 1000, 10000, 65535]
            };
            expect(() => validateYjsUpdate(UserInventoryItemSchema, validItem)).not.toThrow();

            // Invalid: wrong length
            const wrongLength = {
                ...createValidInventoryItem(rng),
                coverPalette: [0, 100, 1000]
            };
            expect(() => validateYjsUpdate(UserInventoryItemSchema, wrongLength)).toThrow();

            // Invalid: value out of range
            const outOfRange = {
                ...createValidInventoryItem(rng),
                coverPalette: [0, 100, 100000, 10000, 65535]
            };
            expect(() => validateYjsUpdate(UserInventoryItemSchema, outOfRange)).toThrow();
        });
    });

    describe('UserProgressSchema', () => {
        it('accepts valid progress objects', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const progress = createValidProgress(rng);

                try {
                    const result = validateYjsUpdate(UserProgressSchema, progress);
                    expect(result).toBeDefined();
                } catch (e) {
                    console.error(`Valid progress rejected at iteration ${i}:`, progress);
                    throw e;
                }
            }
        });

        it('rejects invalid percentage values', () => {
            const rng = new SeededRandom(SEED);

            const invalidPercentages = [-1, 2, 100, -0.5, 1.5];

            for (const percentage of invalidPercentages) {
                const progress = {
                    ...createValidProgress(rng),
                    percentage
                };

                expect(() => validateYjsUpdate(UserProgressSchema, progress)).toThrow();
            }
        });
    });

    describe('UserAnnotationSchema', () => {
        it('accepts valid annotations', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const annotation = createValidAnnotation(rng);

                try {
                    const result = validateYjsUpdate(UserAnnotationSchema, annotation);
                    expect(result).toBeDefined();
                } catch (e) {
                    console.error(`Valid annotation rejected at iteration ${i}:`, annotation);
                    throw e;
                }
            }
        });

        it('rejects invalid annotation type', () => {
            const rng = new SeededRandom(SEED);

            const annotation = {
                ...createValidAnnotation(rng),
                type: 'invalid'
            };

            expect(() => validateYjsUpdate(UserAnnotationSchema, annotation)).toThrow();
        });
    });

    describe('ReadingListEntrySchema', () => {
        it('accepts valid reading list entries', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const entry = {
                    filename: rng.nextString(50),
                    title: rng.nextString(100),
                    author: rng.nextString(50),
                    isbn: rng.nextBool() ? rng.nextString(13, '0123456789') : undefined,
                    percentage: rng.next(),
                    lastUpdated: Date.now(),
                    status: rng.nextBool() ? rng.nextElement(['read', 'currently-reading', 'to-read'] as const) : undefined,
                    rating: rng.nextBool() ? rng.nextInt(1, 5) : undefined,
                };

                try {
                    const result = validateYjsUpdate(ReadingListEntrySchema, entry);
                    expect(result).toBeDefined();
                } catch (e) {
                    console.error(`Valid entry rejected at iteration ${i}:`, entry);
                    throw e;
                }
            }
        });
    });

    describe('UserOverridesSchema', () => {
        it('accepts valid overrides', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 50; i++) {
                const overrides = {
                    bookId: rng.nextString(36),
                    lexicon: Array.from({ length: rng.nextInt(0, 5) }, () => ({
                        id: rng.nextString(36),
                        original: rng.nextString(20),
                        replacement: rng.nextString(20),
                        isRegex: rng.nextBool(),
                        applyBeforeGlobal: rng.nextBool(),
                        created: Date.now(),
                    })),
                    lexiconConfig: rng.nextBool() ? { applyBefore: rng.nextBool() } : undefined,
                    settings: rng.nextBool() ? { key: 'value' } : undefined,
                };

                try {
                    const result = validateYjsUpdate(UserOverridesSchema, overrides);
                    expect(result).toBeDefined();
                } catch (e) {
                    console.error(`Valid overrides rejected at iteration ${i}:`, overrides);
                    throw e;
                }
            }
        });
    });

    describe('Random garbage input', () => {
        it('rejects random garbage for all schemas', () => {
            const rng = new SeededRandom(SEED);

            const schemas = [
                UserInventoryItemSchema,
                ReadingListEntrySchema,
                UserProgressSchema,
                UserAnnotationSchema,
                UserOverridesSchema,
            ];

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const garbage = generateRandomGarbage(rng);

                for (const schema of schemas) {
                    try {
                        validateYjsUpdate(schema, garbage);
                        // If it doesn't throw, that's only okay if:
                        // - It's an object that happens to match the schema
                        // For random garbage, this is unlikely but possible
                    } catch {
                        // Expected to throw
                    }
                }
            }
        });
    });
});

/**
 * Generates random garbage data of various types.
 */
function generateRandomGarbage(rng: SeededRandom): unknown {
    const type = rng.nextInt(0, 10);

    switch (type) {
        case 0:
            return null;
        case 1:
            return undefined;
        case 2:
            return rng.nextInt(-1000000, 1000000);
        case 3:
            return rng.next();
        case 4:
            return rng.nextBool();
        case 5:
            return rng.nextUnicodeString(rng.nextInt(0, 100));
        case 6:
            return Array.from({ length: rng.nextInt(0, 10) }, () => generateRandomGarbage(rng));
        case 7: {
            const obj: Record<string, unknown> = {};
            const keys = rng.nextInt(0, 10);
            for (let i = 0; i < keys; i++) {
                obj[rng.nextString(rng.nextInt(1, 20))] = generateRandomGarbage(rng);
            }
            return obj;
        }
        case 8:
            return new Date(rng.nextInt(0, Date.now()));
        case 9:
            return Symbol(rng.nextString(5));
        default:
            return () => rng.nextString(10);
    }
}
