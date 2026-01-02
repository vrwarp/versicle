import { describe, it, expect } from 'vitest';
import {
    RE_LAST_WORD,
    RE_LAST_TWO_WORDS,
    RE_FIRST_WORD,
    RE_LEADING_PUNCTUATION,
    RE_TRAILING_PUNCTUATION,
    RE_SENTENCE_FALLBACK
} from './TextSegmenter';

describe('TextSegmenter Regexes', () => {
    describe('RE_LAST_WORD', () => {
        it('matches the last word in a string', () => {
            expect('Hello World'.match(RE_LAST_WORD)?.[0]).toBe('World');
            expect('Testing...'.match(RE_LAST_WORD)?.[0]).toBe('Testing...');
        });

        it('handles single word strings', () => {
            expect('Word'.match(RE_LAST_WORD)?.[0]).toBe('Word');
        });

        it('does not match trailing whitespace', () => {
            // Because \S+ must be at the end ($), this will fail if there is trailing whitespace
            // The code trims before using this regex, so this behavior is expected.
            expect('Trailing '.match(RE_LAST_WORD)).toBeNull();
        });
    });

    describe('RE_LAST_TWO_WORDS', () => {
        it('matches the last two words separated by whitespace', () => {
            expect('Hello World'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('Hello World');
            expect('one two three'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('two three');
        });

        it('handles punctuation', () => {
            expect('et al.'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('et al.');
        });

        it('does not match single words', () => {
            expect('Hello'.match(RE_LAST_TWO_WORDS)).toBeNull();
        });

        it('requires whitespace separation', () => {
            expect('HelloStart'.match(RE_LAST_TWO_WORDS)).toBeNull();
        });
    });

    describe('RE_FIRST_WORD', () => {
        it('matches the first word', () => {
            expect('Hello World'.match(RE_FIRST_WORD)?.[0]).toBe('Hello');
        });

        it('matches punctuation at start', () => {
            expect('"Quote" start'.match(RE_FIRST_WORD)?.[0]).toBe('"Quote"');
        });

        it('does not match leading whitespace', () => {
             // ^\S+ requires start with non-whitespace.
             // Code trims before use.
             expect(' Start'.match(RE_FIRST_WORD)).toBeNull();
        });
    });

    describe('RE_LEADING_PUNCTUATION', () => {
        it('matches leading quotes', () => {
            expect('"Hello'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('"');
            expect("'Hello".match(RE_LEADING_PUNCTUATION)?.[0]).toBe("'");
        });

        it('matches brackets', () => {
            expect('(Parenthesis'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('(');
            expect('[Bracket'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('[');
        });

        it('matches multiple punctuation marks', () => {
            expect('"(Hello'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('"(');
        });

        it('does not match letters', () => {
            expect('Hello'.match(RE_LEADING_PUNCTUATION)).toBeNull();
        });
    });

    describe('RE_TRAILING_PUNCTUATION', () => {
        it('matches trailing period', () => {
            expect('End.'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('.');
        });

        it('matches trailing question mark', () => {
            expect('Why?'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('?');
        });

        it('matches trailing exclamation point', () => {
            expect('Yes!'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('!');
        });

        it('matches trailing colon and semicolon', () => {
            expect('List:'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(':');
            expect('Wait;'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(';');
        });

        it('matches comma', () => {
            expect('Wait,'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(',');
        });

        it('does not match multiple trailing punctuation (only the last one)', () => {
            // Regex is /[.,!?;:]$/ which matches exactly one character
            expect('Really?!'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('!');
        });
    });

    describe('RE_SENTENCE_FALLBACK', () => {
        it('splits text into sentences based on punctuation', () => {
            const text = 'Hello world. How are you? I am fine!';
            const matches = text.match(RE_SENTENCE_FALLBACK);
            expect(matches).toEqual(['Hello world.', ' How are you?', ' I am fine!']);
        });

        it('handles no punctuation at end', () => {
            // The regex captures "([^.!?]+[.!?]+)"
            // It won't capture the trailing text if it lacks punctuation.
            // The fallbackSegment method handles the remainder logic separately.
            const text = 'Hello world. Incomplete';
            const matches = text.match(RE_SENTENCE_FALLBACK);
            expect(matches).toEqual(['Hello world.']);
        });

        it('handles multiple punctuation marks', () => {
            const text = 'Really?! Yes.';
            const matches = text.match(RE_SENTENCE_FALLBACK);
            expect(matches).toEqual(['Really?!', ' Yes.']);
        });
    });
});
