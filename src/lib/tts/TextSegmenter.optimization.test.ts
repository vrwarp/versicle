import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

// Copied from TextSegmenter.ts to serve as baseline for parity check
const RE_LAST_WORD_TRIMLESS = /(\S+)\s*$/;
const RE_LAST_TWO_WORDS_TRIMLESS = /((?:\S+\s+)\S+)\s*$/;
const RE_FIRST_WORD_TRIMLESS = /^\s*(\S+)/;

describe('TextSegmenter Optimizations', () => {
    const inputs = [
        "Hello world",
        "Hello world   ",
        "Mr. Smith",
        "This is a longer sentence with more words.",
        "Word",
        "   Word",
        "One Two Three",
        "Trailing space ",
        "Two  Spaces",
        "et al.",
        "Foo bar baz qux.",
        "",
        "   ",
        "word1 word2",
        "word1   word2",
        "word1 word2   "
    ];

    describe('getLastWord', () => {
        it('matches Regex behavior for extracting last word', () => {
            inputs.forEach(input => {
                const match = RE_LAST_WORD_TRIMLESS.exec(input);
                const expected = match ? match[1] : '';

                const actual = TextSegmenter.getLastWord(input);

                expect(actual).toBe(expected);
            });
        });
    });

    describe('getLastTwoWords', () => {
        it('matches Regex behavior for extracting last two words', () => {
            inputs.forEach(input => {
                const match = RE_LAST_TWO_WORDS_TRIMLESS.exec(input);
                const expected = match ? match[1] : null; // Regex behavior: match[1] or null if no match

                const actual = TextSegmenter.getLastTwoWords(input);

                // Normalize expectation: Regex returns match array or null.
                // If match, match[1] is the string.
                // If no match, expected is null.
                // My manual implementation should return null if no match.

                expect(actual).toBe(expected);
            });
        });
    });

    describe('getFirstWord', () => {
        it('matches Regex behavior for extracting first word', () => {
            inputs.forEach(input => {
                const match = RE_FIRST_WORD_TRIMLESS.exec(input);
                const expected = match ? match[1] : '';

                const actual = TextSegmenter.getFirstWord(input);

                expect(actual).toBe(expected);
            });
        });
    });
});
