
import { describe, it, expect } from 'vitest';
import { sanitizeContent } from './sanitizer';

describe('Sanitizer Link Safety', () => {
    it('should add rel="noopener noreferrer" to links with target="_blank"', () => {
        const dirty = '<a href="http://example.com" target="_blank">External Link</a>';
        const clean = sanitizeContent(dirty);
        expect(clean).toContain('rel="noopener noreferrer"');
    });

    it('should NOT add rel="noopener noreferrer" to links without target="_blank"', () => {
        const dirty = '<a href="http://example.com">Internal Link</a>';
        const clean = sanitizeContent(dirty);
        expect(clean).not.toContain('rel="noopener noreferrer"');
    });
});
