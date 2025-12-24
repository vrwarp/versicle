import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Comprehensive Tests', () => {
    let engine: SearchEngine;

    beforeEach(() => {
        engine = new SearchEngine();
    });

    it('should handle regex special characters in query', () => {
        const text = 'This has a (parenthesis) and a [bracket] and a {brace}.';
        const sections = [{ id: '1', href: 'chap1.html', text }];
        engine.indexBook('test-book', sections);

        let results = engine.search('test-book', '(parenthesis)');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('(parenthesis)');

        results = engine.search('test-book', '[bracket]');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('[bracket]');

        results = engine.search('test-book', '{brace}');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('{brace}');
    });

    it('should correctly handle matches at the very beginning', () => {
        const text = 'Start of the text.';
        const sections = [{ id: '1', href: 'start.html', text }];
        engine.indexBook('start', sections);
        const results = engine.search('start', 'Start');
        expect(results[0].excerpt.trim()).toMatch(/^Start/);
    });

    it('should correctly handle matches at the very end', () => {
        const text = 'End of the text';
        const sections = [{ id: '1', href: 'end.html', text }];
        engine.indexBook('end', sections);
        const results = engine.search('end', 'text');
        expect(results[0].excerpt).toContain('text');
        expect(results[0].excerpt.endsWith('text')).toBe(true);
    });

    it('should handle unicode characters that change length when lowercased', () => {
        // "İ" (U+0130) lowercases to "i̇" (U+0069 U+0307) which is length 2.
        const text = 'AİB matching text';
        const sections = [{ id: '1', href: 'unicode.html', text }];
        engine.indexBook('unicode', sections);

        const results = engine.search('unicode', 'matching');

        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('matching');
    });

    it('should handle large text without crashing', () => {
        const largeText = 'word '.repeat(10000) + 'TARGET ' + 'word '.repeat(10000);
        const sections = [{ id: '1', href: 'large.html', text: largeText }];
        engine.indexBook('large', sections);

        const start = performance.now();
        const results = engine.search('large', 'TARGET');
        const end = performance.now();

        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('TARGET');
        console.log(`Large text search excerpt generation took ${end - start}ms`);
    });
});
