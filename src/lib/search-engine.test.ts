import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine', () => {
    let engine: SearchEngine;

    beforeEach(() => {
        engine = new SearchEngine();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should index and search a book', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Call me Ishmael.' },
            { id: '2', href: 'chap2.html', text: 'The white whale swam.' }
        ];

        engine.indexBook('moby-dick', sections);

        const results = engine.search('moby-dick', 'Ishmael');

        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
        expect(results[0].excerpt).toContain('Ishmael');
    });

    it('should return empty array for unknown book', () => {
        const results = engine.search('unknown', 'query');
        expect(results).toEqual([]);
    });

    it('should handle case-insensitive search', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'This is a TEST.' }
        ];
        engine.indexBook('test-book', sections);

        const results = engine.search('test-book', 'test');
        expect(results).toHaveLength(1);
    });

    it('should generate excerpts', () => {
         const text = "A long time ago in a galaxy far, far away.... It is a period of civil war.";
         const sections = [
            { id: '1', href: 'starwars.html', text }
        ];
        engine.indexBook('sw', sections);

        const results = engine.search('sw', 'galaxy');
        expect(results[0].excerpt).toContain('galaxy');
        // Check context
        expect(results[0].excerpt).toContain('far away');
    });

    it('should handle regex special characters in query', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Why? Because I said so. (Parentheses) [Brackets] +Plus *Star.' }
        ];
        engine.indexBook('special-chars', sections);

        let results = engine.search('special-chars', 'Why?');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('Why?');

        results = engine.search('special-chars', '(Parentheses)');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('(Parentheses)');

        results = engine.search('special-chars', '[Brackets]');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('[Brackets]');

        results = engine.search('special-chars', '+Plus');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('+Plus');

        results = engine.search('special-chars', '*Star');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('*Star');
    });

    it('should handle unicode characters', () => {
        const sections = [
            { id: '1', href: 'unicode.html', text: 'Thé quick bröwn föx jumps över the lazy dögs. 💩' }
        ];
        engine.indexBook('unicode', sections);

        let results = engine.search('unicode', 'Thé');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('Thé');

        results = engine.search('unicode', 'bröwn');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('bröwn');

        results = engine.search('unicode', '💩');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('💩');
    });

    it('should return empty array when no match found in existing book', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Just some normal text.' }
        ];
        engine.indexBook('no-match', sections);

        const results = engine.search('no-match', 'missing');
        expect(results).toHaveLength(0);
    });

    it('should find multiple matches in the same section', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Apple banana apple orange Apple.' }
        ];
        engine.indexBook('multiple', sections);

        const results = engine.search('multiple', 'apple');
        expect(results).toHaveLength(3); // Apple, apple, Apple
        expect(results[0].excerpt).toContain('Apple');
        expect(results[1].excerpt).toContain('apple');
        expect(results[2].excerpt).toContain('Apple');
    });

    it('should cap results at 50', () => {
        const word = "repeat ";
        const text = word.repeat(100);
        const sections = [
            { id: '1', href: 'limit.html', text: text }
        ];
        engine.indexBook('limit', sections);

        const results = engine.search('limit', 'repeat');
        expect(results).toHaveLength(50);
    });

    it('should handle multiple sections', () => {
        const sections = [
             { id: '1', href: 'chap1.html', text: 'First chapter text.' },
             { id: '2', href: 'chap2.html', text: 'Second chapter text.' }
        ];
        engine.indexBook('multi-section', sections);

        const results = engine.search('multi-section', 'chapter');
        expect(results).toHaveLength(2);
        expect(results[0].href).toBe('chap1.html');
        expect(results[1].href).toBe('chap2.html');
    });

    it('should prevent infinite loops on zero-width matches', () => {
        engine.indexBook('testBook', [{ id: '1', href: 'chap1.html', text: 'hello world' }]);

        // Mock RegExp to return zero-width match at start, if code doesn't advance lastIndex, it will loop
        const originalRegExp = global.RegExp;
        vi.spyOn(global, 'RegExp').mockImplementation(function(...args) {
            const r = new originalRegExp(...args);
            r.exec = function(str) {
                this._count = (this._count || 0) + 1;
                if (this._count > 100) {
                    throw new Error("Infinite loop detected!");
                }

                // Return a zero-width match at the current lastIndex.
                const matchIndex = this.lastIndex;
                if (matchIndex < str.length) {
                    const match = Object.assign([''], { index: matchIndex, input: str });
                    return match;
                }
                return null;
            };
            return r;
        });

        // The safeguard should prevent the infinite loop and not throw an error.
        const results = engine.search('testBook', 'hello');
        expect(results).toBeDefined();
    });
});
