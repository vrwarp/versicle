import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine', () => {
    let engine: SearchEngine;

    beforeEach(() => {
        engine = new SearchEngine();
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
});
