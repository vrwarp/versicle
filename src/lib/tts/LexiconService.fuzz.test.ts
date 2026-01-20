import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../../test/fuzz-utils';
import type { LexiconRule } from '../../types/db';

// Mock the store dependencies
vi.mock('../../store/useLexiconStore', () => ({
    useLexiconStore: {
        getState: () => ({
            rules: [],
            bibleLexiconPreferences: new Map()
        })
    }
}));

vi.mock('../../store/yjs-provider', () => ({
    waitForYjsSync: vi.fn().mockResolvedValue(undefined)
}));

describe('LexiconService.applyLexicon Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;
    let service: LexiconService;

    beforeEach(() => {
        // Get fresh instance for each test
        service = LexiconService.getInstance();
    });

    /**
     * Creates a random lexicon rule.
     */
    const createRandomRule = (rng: SeededRandom, id: number, isRegex: boolean = false): LexiconRule => ({
        id: `rule-${id}`,
        original: rng.nextString(rng.nextInt(1, 20)),
        replacement: rng.nextString(rng.nextInt(0, 20)),
        isRegex,
        created: Date.now(),
        applyBeforeGlobal: rng.nextBool()
    });

    /**
     * Creates a potentially malformed regex rule.
     */
    const createMalformedRegexRule = (rng: SeededRandom, id: number): LexiconRule => {
        const malformedPatterns = [
            '[unclosed',
            '(unclosed',
            '*invalid',
            '+invalid',
            '?invalid',
            '\\',
            '[z-a]',
            '(?P<bad)',
            rng.nextUnicodeString(rng.nextInt(1, 20))
        ];

        return {
            id: `malformed-${id}`,
            original: rng.nextElement(malformedPatterns),
            replacement: rng.nextString(rng.nextInt(0, 10)),
            isRegex: true,
            created: Date.now()
        };
    };

    describe('Basic robustness', () => {
        it('survives random text inputs with valid rules', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const text = rng.nextUnicodeString(rng.nextInt(0, 500));
                const numRules = rng.nextInt(0, 10);
                const rules: LexiconRule[] = [];

                for (let j = 0; j < numRules; j++) {
                    rules.push(createRandomRule(rng, j, false));
                }

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) with text length ${text.length}`);
                    throw e;
                }
            }
        });

        it('survives empty input', () => {
            const result = service.applyLexicon('', []);
            expect(result).toBe('');
        });

        it('survives empty rules', () => {
            const rng = new SeededRandom(SEED);
            const text = rng.nextUnicodeString(100);
            const result = service.applyLexicon(text, []);
            expect(typeof result).toBe('string');
        });
    });

    describe('Regex rule handling', () => {
        it('survives valid regex rules', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const text = rng.nextString(rng.nextInt(10, 200));
                const rules: LexiconRule[] = [];

                // Create valid regex rules
                const validPatterns = [
                    '\\b\\w+\\b',
                    '[aeiou]',
                    '\\d+',
                    '(foo|bar)',
                    'test.*',
                    '^start',
                    'end$'
                ];

                for (let j = 0; j < rng.nextInt(1, 5); j++) {
                    rules.push({
                        id: `regex-${j}`,
                        original: rng.nextElement(validPatterns),
                        replacement: rng.nextString(rng.nextInt(0, 10)),
                        isRegex: true,
                        created: Date.now()
                    });
                }

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });

        it('gracefully handles malformed regex patterns', () => {
            const rng = new SeededRandom(SEED);
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            for (let i = 0; i < 100; i++) {
                const text = rng.nextString(rng.nextInt(10, 100));
                const rules: LexiconRule[] = [];

                for (let j = 0; j < rng.nextInt(1, 5); j++) {
                    rules.push(createMalformedRegexRule(rng, j));
                }

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                    // Should have warned about invalid regex
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}) - should have caught error`);
                    throw e;
                }
            }

            consoleSpy.mockRestore();
        });

        it('handles mixed valid and invalid regex rules', () => {
            const rng = new SeededRandom(SEED);
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            for (let i = 0; i < 50; i++) {
                const text = 'Hello world, this is a test string with some words.';
                const rules: LexiconRule[] = [];

                // Mix of valid, invalid, and literal rules
                rules.push(createRandomRule(rng, 0, false)); // Literal
                rules.push({
                    id: 'valid-regex',
                    original: '\\bword\\b',
                    replacement: 'WORD',
                    isRegex: true,
                    created: Date.now()
                });
                rules.push(createMalformedRegexRule(rng, 2)); // Malformed

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on iteration ${i}`);
                    throw e;
                }
            }

            consoleSpy.mockRestore();
        });
    });

    describe('Unicode and normalization', () => {
        it('handles Unicode text correctly', () => {
            const rng = new SeededRandom(SEED);

            const unicodeTexts = [
                'Héllo wörld',
                '日本語テスト',
                'Привет мир',
                '😀🔥❤️',
                'Ａｂｃ１２３', // Fullwidth
                'ñ é ü ö',
            ];

            for (const text of unicodeTexts) {
                const rules: LexiconRule[] = [
                    createRandomRule(rng, 0, false)
                ];

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on Unicode text: ${text}`);
                    throw e;
                }
            }
        });

        it('handles Unicode in rules', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const text = rng.nextUnicodeString(100);
                const rules: LexiconRule[] = [{
                    id: 'unicode-rule',
                    original: rng.nextUnicodeString(rng.nextInt(1, 10)),
                    replacement: rng.nextUnicodeString(rng.nextInt(0, 10)),
                    isRegex: false,
                    created: Date.now()
                }];

                try {
                    const result = service.applyLexicon(text, rules);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });
    });

    describe('Edge cases', () => {
        it('handles rules with empty original/replacement', () => {
            const text = 'Hello world';

            const edgeCaseRules: LexiconRule[] = [
                { id: '1', original: '', replacement: 'test', isRegex: false, created: Date.now() },
                { id: '2', original: 'hello', replacement: '', isRegex: false, created: Date.now() },
                { id: '3', original: '', replacement: '', isRegex: false, created: Date.now() },
            ];

            for (const rule of edgeCaseRules) {
                try {
                    const result = service.applyLexicon(text, [rule]);
                    expect(typeof result).toBe('string');
                } catch (e) {
                    console.error(`Crashed on edge case rule: ${JSON.stringify(rule)}`);
                    throw e;
                }
            }
        });

        it('handles very long text', () => {
            const rng = new SeededRandom(SEED);
            const text = rng.nextString(10000);
            const rules = [createRandomRule(rng, 0, false)];

            const result = service.applyLexicon(text, rules);
            expect(typeof result).toBe('string');
        });

        it('handles many rules', () => {
            const rng = new SeededRandom(SEED);
            const text = rng.nextString(100);
            const rules: LexiconRule[] = [];

            for (let i = 0; i < 100; i++) {
                rules.push(createRandomRule(rng, i, rng.nextBool()));
            }

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = service.applyLexicon(text, rules);
            consoleSpy.mockRestore();

            expect(typeof result).toBe('string');
        });
    });
});
