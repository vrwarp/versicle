import { describe, it, expect } from 'vitest';
import { findApproximateMatch } from './textMatching';

describe('findApproximateMatch', () => {
    describe('Exact Match', () => {
        it('should find an exact match at the beginning of the text', () => {
            const text = 'The quick brown fox jumps over the lazy dog';
            const query = 'The quick';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 0, end: 9 });
        });

        it('should find an exact match in the middle of the text', () => {
            const text = 'The quick brown fox jumps over the lazy dog';
            const query = 'brown fox';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 10, end: 19 });
        });

        it('should find an exact match at the end of the text', () => {
            const text = 'The quick brown fox jumps over the lazy dog';
            const query = 'lazy dog';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 35, end: 43 });
        });
    });

    describe('Case-Insensitive Match', () => {
        it('should find a match with different casing', () => {
            const text = 'The Quick Brown Fox';
            const query = 'the quick';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 0, end: 9 });
        });

        it('should find a match when the query is all caps', () => {
            const text = 'The Quick Brown Fox';
            const query = 'BROWN';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 10, end: 15 });
        });
    });

    describe('Flexible Whitespace Match', () => {
        it('should match when the text has multiple spaces', () => {
            const text = 'The  quick   brown    fox';
            const query = 'The quick brown';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 0, end: 18 });
        });

        it('should match when the text has tabs or newlines', () => {
            const text = 'The\tquick\nbrown\r\nfox';
            const query = 'The quick brown';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 0, end: 15 });
        });
    });

    describe('Regex Special Characters', () => {
        it('should handle dots correctly', () => {
            const text = 'Match this. literal dot';
            const query = 'this. literal';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 6, end: 19 });
        });

        it('should handle parentheses correctly', () => {
            const text = 'Match (parentheses) correctly';
            const query = '(parentheses)';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 6, end: 19 });
        });

        it('should handle brackets correctly', () => {
            const text = 'Match [brackets] correctly';
            const query = '[brackets]';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 6, end: 16 });
        });

        it('should handle stars and pluses correctly', () => {
            const text = 'Match * and + correctly';
            const query = '* and +';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 6, end: 13 });
        });

        it('should handle complex regex characters in query', () => {
            const text = 'Find $100.00? (Yes!) [100%]';
            const query = '$100.00? (Yes!) [100%]';
            const result = findApproximateMatch(text, query);
            expect(result).toEqual({ start: 5, end: 27 });
        });
    });

    describe('Edge Cases', () => {
        it('should return null for empty text', () => {
            expect(findApproximateMatch('', 'query')).toBeNull();
        });

        it('should return null for empty query', () => {
            expect(findApproximateMatch('text', '')).toBeNull();
        });

        it('should return null when query is not found', () => {
            expect(findApproximateMatch('The quick brown fox', 'lazy dog')).toBeNull();
        });

        it('should return null when query is longer than text', () => {
            expect(findApproximateMatch('short', 'this is a much longer query')).toBeNull();
        });

        it('should handle null/undefined-like inputs (if they bypass TS)', () => {
            // @ts-expect-error - testing runtime behavior
            expect(findApproximateMatch(null, 'query')).toBeNull();
            // @ts-expect-error - testing runtime behavior
            expect(findApproximateMatch('text', undefined)).toBeNull();
        });
    });
});
