import { describe, it, expect } from 'vitest';
import { Sanitizer } from './Sanitizer';

describe('Sanitizer', () => {
    it('removes page numbers on their own lines', () => {
        const input = 'Chapter 1\nPage 42\nIt was a dark and stormy night.';
        const expected = 'Chapter 1\nIt was a dark and stormy night.';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('removes page numbers with various formats', () => {
        const input = '42\nText\n  Page 10  \nMore text';
        const expected = 'Text\nMore text';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('replaces URLs with hostname', () => {
        const input = 'Visit http://example.com/foo/bar for more info.';
        const expected = 'Visit example.com for more info.';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('replaces complex URLs with hostname', () => {
        const input = 'Check https://old.thecrossing.website/sermons today.';
        const expected = 'Check old.thecrossing.website today.';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('removes bracket citations', () => {
        const input = 'This is a claim [12]. Another claim [12-14].';
        const expected = 'This is a claim . Another claim .';
        // Note: double spaces might happen if we replace with space or empty string.
        // The Sanitizer collapses spaces at the end.
        expect(Sanitizer.sanitize(input)).toBe('This is a claim . Another claim .');
    });

    it('removes parenthetical citations', () => {
        const input = 'Studies show (Smith, 2020) that reading is good.';
        const expected = 'Studies show that reading is good.';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('removes complex citations', () => {
        const input = 'Results (Jones et al., 2019; Brown, 2021) indicated...';
        // Our regex might be conservative. Let's see.
        // The regex is: /\([A-Z][a-zA-Z]+(?: (?:et al\.|& [A-Z][a-zA-Z]+))?, \d{4}(?:;.*)?\)/g
        expect(Sanitizer.sanitize(input)).toBe('Results indicated...');
    });

    it('keeps narrative parentheses', () => {
        const input = 'He said (with a smile) that it was fine.';
        expect(Sanitizer.sanitize(input)).toBe(input);
    });

    it('removes visual separators', () => {
        const input = 'End of scene.\n* * *\nNext scene.';
        const expected = 'End of scene.\nNext scene.';
        expect(Sanitizer.sanitize(input)).toBe(expected);
    });

    it('collapses whitespace', () => {
        const input = 'Word   Word';
        expect(Sanitizer.sanitize(input)).toBe('Word Word');
    });
});
