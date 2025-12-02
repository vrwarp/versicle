import { describe, it, expect } from 'vitest';
import { Sanitizer } from './Sanitizer';

describe('Sanitizer URL Edge Cases', () => {
    it('should preserve closing parenthesis when URL is inside parentheses', () => {
        const input = '(See http://example.com)';
        const expected = '(See example.com)';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('should preserve closing parenthesis when URL ends with slash inside parentheses', () => {
        const input = '(Check http://google.com/)';
        const expected = '(Check google.com)'; // Trailing slash is part of URL, consumed.
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('should intentionally truncate URLs ending in parenthesis to preserve sentence structure', () => {
        // As per documentation/memory, we sacrifice full URL matching for sentence structure.
        const input = 'See http://en.wikipedia.org/wiki/Joy_(programming_language)';
        // The regex should stop before the final ')', so it replaces the URL part but leaves ')'
        const expected = 'See en.wikipedia.org)';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });
});
