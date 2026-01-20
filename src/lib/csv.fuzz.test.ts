import { describe, it, expect } from 'vitest';
import { exportReadingListToCSV, parseReadingListCSV } from './csv';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../test/fuzz-utils';
import type { ReadingListEntry } from '../types/db';

describe('CSV Parsing Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    /**
     * Creates a random ReadingListEntry.
     */
    const createRandomEntry = (rng: SeededRandom): ReadingListEntry => ({
        filename: rng.nextString(rng.nextInt(5, 50)),
        title: rng.nextUnicodeString(rng.nextInt(1, 100)),
        author: rng.nextUnicodeString(rng.nextInt(1, 50)),
        isbn: rng.nextBool() ? rng.nextString(13, '0123456789') : undefined,
        percentage: rng.next(),
        lastUpdated: Date.now() - rng.nextInt(0, 1000000000),
        status: rng.nextElement(['read', 'currently-reading', 'to-read'] as const),
        rating: rng.nextBool() ? rng.nextInt(1, 5) : undefined
    });

    describe('Round-trip preservation', () => {
        it('preserves essential fields through export/import cycle', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const numEntries = rng.nextInt(1, 20);
                const entries: ReadingListEntry[] = [];

                for (let j = 0; j < numEntries; j++) {
                    entries.push(createRandomEntry(rng));
                }

                try {
                    const csv = exportReadingListToCSV(entries);
                    expect(typeof csv).toBe('string');

                    const parsed = parseReadingListCSV(csv);
                    expect(Array.isArray(parsed)).toBe(true);
                    expect(parsed.length).toBe(entries.length);

                    // Verify essential fields are preserved
                    for (let j = 0; j < entries.length; j++) {
                        expect(parsed[j].title).toBe(entries[j].title);
                        expect(parsed[j].author).toBe(entries[j].author);
                        // Percentage might have slight floating point differences
                        expect(Math.abs(parsed[j].percentage - entries[j].percentage)).toBeLessThan(0.001);
                    }
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) with ${numEntries} entries`);
                    throw e;
                }
            }
        });

        it('handles empty input', () => {
            const csv = exportReadingListToCSV([]);
            expect(typeof csv).toBe('string');

            const parsed = parseReadingListCSV(csv);
            expect(parsed).toEqual([]);
        });
    });

    describe('Parsing robustness', () => {
        it('survives random string input without crashing', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const randomCsv = rng.nextUnicodeString(rng.nextInt(0, 500));

                try {
                    const result = parseReadingListCSV(randomCsv);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });

        it('handles entries with special CSV characters', () => {
            const rng = new SeededRandom(SEED);

            const specialCharacters = [',', '"', '\n', '\r', '\t', '\\'];

            for (let i = 0; i < 50; i++) {
                const entries: ReadingListEntry[] = [{
                    filename: 'test-' + i,
                    // Include special characters in title and author
                    title: 'Title' + rng.nextElement(specialCharacters) + 'with' + rng.nextElement(specialCharacters) + 'special',
                    author: 'Author' + rng.nextElement(specialCharacters) + 'Name',
                    percentage: 0.5,
                    lastUpdated: Date.now(),
                    status: 'reading' as const
                }];

                try {
                    const csv = exportReadingListToCSV(entries);
                    const parsed = parseReadingListCSV(csv);

                    expect(parsed.length).toBe(1);
                    // PapaParse should handle the escaping correctly
                    expect(parsed[0].title).toBe(entries[0].title);
                    expect(parsed[0].author).toBe(entries[0].author);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} with special characters`);
                    throw e;
                }
            }
        });

        it('handles malformed header rows', () => {
            const malformedCsvs = [
                '',
                'random,headers,here',
                'Title,Author',  // Missing columns
                'Title,Author,ISBN,My Rating,Exclusive Shelf,Date Read,Filename,Percentage', // Header only
            ];

            for (const csv of malformedCsvs) {
                try {
                    const result = parseReadingListCSV(csv);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on malformed CSV: ${csv.substring(0, 50)}`);
                    throw e;
                }
            }
        });

        it('handles rows with missing columns', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 50; i++) {
                // Create CSV with varying column counts
                const header = 'Title,Author,ISBN,My Rating,Exclusive Shelf,Date Read,Filename,Percentage';
                const rows = [header];

                for (let j = 0; j < rng.nextInt(1, 10); j++) {
                    const numCols = rng.nextInt(0, 10);
                    const row = Array.from({ length: numCols }, () => rng.nextString(rng.nextInt(0, 20)));
                    rows.push(row.join(','));
                }

                const csv = rows.join('\n');

                try {
                    const result = parseReadingListCSV(csv);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} with varying columns`);
                    throw e;
                }
            }
        });
    });

    describe('Unicode handling', () => {
        it('preserves Unicode in round-trip', () => {
            const unicodeTitles = [
                '日本語の本',
                'Книга на русском',
                'Βιβλίο στα ελληνικά',
                '📚 Book with Emoji 🔥',
                'Título en español con ñ',
                'Héllo Wörld',
            ];

            for (const title of unicodeTitles) {
                const entries: ReadingListEntry[] = [{
                    filename: 'unicode-test',
                    title,
                    author: 'Author',
                    percentage: 0.5,
                    lastUpdated: Date.now(),
                    status: 'reading' as const
                }];

                try {
                    const csv = exportReadingListToCSV(entries);
                    const parsed = parseReadingListCSV(csv);

                    expect(parsed.length).toBe(1);
                    expect(parsed[0].title).toBe(title);
                } catch (e) {
                    console.error(`Crashed on Unicode title: ${title}`);
                    throw e;
                }
            }
        });
    });

    describe('Edge cases', () => {
        it('handles very long entries', () => {
            const rng = new SeededRandom(SEED);

            const entries: ReadingListEntry[] = [{
                filename: rng.nextString(500),
                title: rng.nextString(1000),
                author: rng.nextString(500),
                percentage: 0.5,
                lastUpdated: Date.now(),
                status: 'reading' as const
            }];

            const csv = exportReadingListToCSV(entries);
            const parsed = parseReadingListCSV(csv);

            expect(parsed.length).toBe(1);
        });

        it('handles many entries', () => {
            const rng = new SeededRandom(SEED);
            const entries: ReadingListEntry[] = [];

            for (let i = 0; i < 500; i++) {
                entries.push(createRandomEntry(rng));
            }

            const csv = exportReadingListToCSV(entries);
            const parsed = parseReadingListCSV(csv);

            expect(parsed.length).toBe(500);
        });

        it('handles percentage edge cases', () => {
            const percentages = [0, 0.0001, 0.5, 0.9999, 1, 1.5, -0.5, NaN, Infinity];

            for (const percentage of percentages) {
                const entries: ReadingListEntry[] = [{
                    filename: 'test',
                    title: 'Test',
                    author: 'Author',
                    percentage,
                    lastUpdated: Date.now(),
                    status: 'reading' as const
                }];

                try {
                    const csv = exportReadingListToCSV(entries);
                    expect(typeof csv).toBe('string');
                } catch (e) {
                    console.error(`Crashed on percentage: ${percentage}`);
                    throw e;
                }
            }
        });
    });
});
