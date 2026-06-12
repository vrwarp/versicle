
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

describe('regression: remote-resource stripping (Phase 8 §H — tracking pixels)', () => {
    // The strict CSP flip dropped `img-src https:`; the sanitizer is the
    // FUNCTIONAL replacement: EPUB HTML must never reference remote
    // resources, so opening a book cannot beacon the reader's activity.
    it('strips the classic 1x1 remote tracking pixel (keeps the element + alt)', () => {
        const dirty = '<p>text</p><img src="https://tracker.example/p.gif" width="1" height="1" alt="cover" />';
        const clean = sanitizeContent(dirty);
        expect(clean).not.toContain('tracker.example');
        expect(clean).not.toContain('https://');
        expect(clean).toContain('<img'); // placeholder element survives
        expect(clean).toContain('alt="cover"');
    });

    it('strips http: and protocol-relative refs across img/source/video/audio', () => {
        const dirty = [
            '<img src="http://x.example/a.png" />',
            '<picture><source srcset="//x.example/b.png 1x, images/c.png 2x" /><img src="images/c.png" /></picture>',
            '<video poster="https://x.example/p.jpg" src="https://x.example/v.mp4"></video>',
            '<audio src="//x.example/a.mp3"></audio>',
        ].join('');
        const clean = sanitizeContent(dirty);
        expect(clean).not.toContain('x.example');
    });

    it('strips remote SVG image references (href and xlink:href)', () => {
        const dirty =
            '<svg><image xlink:href="https://x.example/i.png" /><image href="//x.example/j.png" /></svg>';
        const clean = sanitizeContent(dirty);
        expect(clean).not.toContain('x.example');
    });

    it('keeps zip-internal (relative) references untouched', () => {
        // blob:/data: handling is DOMPurify's own default URI policy and
        // not this hook's concern — epub.js injects blob resources AFTER
        // sanitize-at-serialize, so relative refs are what must survive.
        const dirty =
            '<img src="../images/cover.jpeg" alt="c" />' +
            '<svg><image xlink:href="images/fig1.png" /></svg>';
        const clean = sanitizeContent(dirty);
        expect(clean).toContain('../images/cover.jpeg');
        expect(clean).toContain('images/fig1.png');
    });

    it('remote links (a href) remain navigable — only RESOURCE loads are stripped', () => {
        const dirty = '<a href="https://example.com/source">Source</a>';
        const clean = sanitizeContent(dirty);
        expect(clean).toContain('https://example.com/source');
    });
});
