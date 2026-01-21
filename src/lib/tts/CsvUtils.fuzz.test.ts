import { describe, it, expect } from 'vitest';
import { LexiconCSV, SimpleListCSV } from './CsvUtils';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../../test/fuzz-utils';
import type { LexiconRule } from '../../types/db';

describe('LexiconCSV Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    /**
     * Creates a random LexiconRule for testing.
     */
    const createRandomRule = (rng: SeededRandom, id: number): LexiconRule => ({
        id: `rule-${id}`,
        original: rng.nextUnicodeString(rng.nextInt(1, 50)),
        replacement: rng.nextUnicodeString(rng.nextInt(0, 50)),
        isRegex: rng.nextBool(),
        applyBeforeGlobal: rng.nextBool(),
        created: Date.now() - rng.nextInt(0, 1000000000),
        bookId: rng.nextBool() ? rng.nextString(10) : undefined
    });

    describe('Round-trip preservation', () => {
        it('preserves all fields through generate/parse cycle', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const numRules = rng.nextInt(1, 20);
                const rules: LexiconRule[] = [];

                for (let j = 0; j < numRules; j++) {
                    rules.push(createRandomRule(rng, j));
                }

                try {
                    const csv = LexiconCSV.generate(rules);
                    expect(typeof csv).toBe('string');

                    const parsed = LexiconCSV.parse(csv);
                    expect(parsed.length).toBe(rules.length);

                    // Verify essential fields are preserved
                    for (let j = 0; j < rules.length; j++) {
                        expect(parsed[j].original).toBe(rules[j].original);
                        expect(parsed[j].replacement).toBe(rules[j].replacement);
                        expect(parsed[j].isRegex).toBe(rules[j].isRegex);
                        expect(parsed[j].applyBeforeGlobal).toBe(rules[j].applyBeforeGlobal);
                    }
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) with ${numRules} rules`);
                    throw e;
                }
            }
        });

        it('handles empty input', () => {
            const csv = LexiconCSV.generate([]);
            expect(typeof csv).toBe('string');

            const parsed = LexiconCSV.parse(csv);
            expect(parsed).toEqual([]);
        });
    });

    describe('Parsing robustness', () => {
        it('survives random string input without crashing', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const randomCsv = rng.nextUnicodeString(rng.nextInt(0, 300));

                try {
                    const result = LexiconCSV.parse(randomCsv);
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
                const rules: LexiconRule[] = [{
                    id: `special-${i}`,
                    original: 'test' + rng.nextElement(specialCharacters) + 'pattern',
                    replacement: 'replace' + rng.nextElement(specialCharacters) + 'text',
                    isRegex: rng.nextBool(),
                    created: Date.now()
                }];

                try {
                    const csv = LexiconCSV.generate(rules);
                    const parsed = LexiconCSV.parse(csv);

                    expect(parsed.length).toBe(1);
                    expect(parsed[0].original).toBe(rules[0].original);
                    expect(parsed[0].replacement).toBe(rules[0].replacement);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} with special characters`);
                    throw e;
                }
            }
        });

        it('handles regex patterns in CSV', () => {
            const regexPatterns = [
                '\\bword\\b',
                '[a-z]+',
                '(foo|bar)',
                '.*?',
                '^start',
                'end$',
                '\\d{3}-\\d{4}',
            ];

            for (const pattern of regexPatterns) {
                const rules: LexiconRule[] = [{
                    id: 'regex-test',
                    original: pattern,
                    replacement: 'replacement',
                    isRegex: true,
                    created: Date.now()
                }];

                try {
                    const csv = LexiconCSV.generate(rules);
                    const parsed = LexiconCSV.parse(csv);

                    expect(parsed.length).toBe(1);
                    expect(parsed[0].original).toBe(pattern);
                    expect(parsed[0].isRegex).toBe(true);
                } catch (e) {
                    console.error(`Crashed on regex pattern: ${pattern}`);
                    throw e;
                }
            }
        });
    });

    describe('Edge cases', () => {
        it('handles rules with empty strings', () => {
            const edgeCaseRules: LexiconRule[] = [
                { id: '1', original: '', replacement: '', isRegex: false, created: Date.now() },
                { id: '2', original: 'test', replacement: '', isRegex: false, created: Date.now() },
                { id: '3', original: '', replacement: 'test', isRegex: false, created: Date.now() },
            ];

            for (const rule of edgeCaseRules) {
                try {
                    const csv = LexiconCSV.generate([rule]);
                    const parsed = LexiconCSV.parse(csv);

                    expect(parsed.length).toBe(1);
                    expect(parsed[0].original).toBe(rule.original);
                    expect(parsed[0].replacement).toBe(rule.replacement);
                } catch (e) {
                    console.error(`Crashed on edge case: ${JSON.stringify(rule)}`);
                    throw e;
                }
            }
        });

        it('handles very long strings', () => {
            const rng = new SeededRandom(SEED);

            const rules: LexiconRule[] = [{
                id: 'long-rule',
                original: rng.nextString(1000),
                replacement: rng.nextString(1000),
                isRegex: false,
                created: Date.now()
            }];

            const csv = LexiconCSV.generate(rules);
            const parsed = LexiconCSV.parse(csv);

            expect(parsed.length).toBe(1);
            expect(parsed[0].original).toBe(rules[0].original);
        });
    });
});

describe('SimpleListCSV Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    describe('Round-trip preservation', () => {
        it('preserves items through generate/parse cycle', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const numItems = rng.nextInt(0, 50);
                const items: string[] = [];

                for (let j = 0; j < numItems; j++) {
                    items.push(rng.nextString(rng.nextInt(1, 30)));
                }

                const header = 'Abbreviations';

                try {
                    const csv = SimpleListCSV.generate(items, header);
                    expect(typeof csv).toBe('string');

                    const parsed = SimpleListCSV.parse(csv, header);
                    expect(parsed).toEqual(items);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) with ${numItems} items`);
                    throw e;
                }
            }
        });
    });

    describe('Parsing robustness', () => {
        it('survives random string input', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const randomText = rng.nextUnicodeString(rng.nextInt(0, 200));

                try {
                    const result = SimpleListCSV.parse(randomText);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });

        it('handles various line endings', () => {
            const items = ['item1', 'item2', 'item3'];
            // SimpleListCSV.parse() uses /\r?\n/ regex, so it supports \n and \r\n but not \r alone
            const cases = [
                { input: items.join('\n'), expected: items },
                { input: items.join('\r\n'), expected: items },
                // \r alone is NOT treated as a line separator
            ];

            for (const { input, expected } of cases) {
                try {
                    const result = SimpleListCSV.parse(input);
                    expect(result).toEqual(expected);
                } catch (e) {
                    console.error(`Crashed on line ending variant`);
                    throw e;
                }
            }
        });

    });
});
