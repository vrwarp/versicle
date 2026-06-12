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

    // The old "zero-width RegExp match" test was deleted in the Phase 7
    // search consolidation (PR-0c): the engine scans with String#indexOf, so
    // the test mocked a global the engine never touches and asserted nothing
    // (`toBeDefined` on an array) — a vacuous pin (search.md Debt list;
    // phase7-library-google.md PR-0c).

    describe('regression: edge placement and unicode (absorbed from search-engine.comprehensive.test.ts)', () => {
        it('handles bracketed/braced literals as plain text', () => {
            const text = 'This has a (parenthesis) and a [bracket] and a {brace}.';
            engine.indexBook('test-book', [{ id: '1', href: 'chap1.html', text }]);

            expect(engine.search('test-book', '(parenthesis)')).toHaveLength(1);
            expect(engine.search('test-book', '[bracket]')).toHaveLength(1);
            expect(engine.search('test-book', '{brace}')).toHaveLength(1);
            expect(engine.search('test-book', '(parenthesis)')[0].excerpt).toContain('(parenthesis)');
        });

        it('correctly handles matches at the very beginning', () => {
            engine.indexBook('start', [{ id: '1', href: 'start.html', text: 'Start of the text.' }]);
            const results = engine.search('start', 'Start');
            expect(results[0].excerpt.trim()).toMatch(/^Start/);
        });

        it('correctly handles matches at the very end', () => {
            engine.indexBook('end', [{ id: '1', href: 'end.html', text: 'End of the text' }]);
            const results = engine.search('end', 'text');
            expect(results[0].excerpt).toContain('text');
            expect(results[0].excerpt.endsWith('text')).toBe(true);
        });

        it('finds matches after length-changing lowercase mappings when context absorbs the drift', () => {
            // "İ" (U+0130) lowercases to "i̇" (2 code units) — small drifts stay
            // inside the ±40-char excerpt window.
            engine.indexBook('unicode', [{ id: '1', href: 'unicode.html', text: 'AİB matching text' }]);
            const results = engine.search('unicode', 'matching');
            expect(results).toHaveLength(1);
            expect(results[0].excerpt).toContain('matching');
        });
    });

    describe('documented current behavior: case-fold excerpt misalignment (phase7 PR-0c pin; fixed by PR-S2)', () => {
        it('loses the match from the excerpt when enough length-changing characters precede it', () => {
            // 45 × "İ" lowercase to 90 code units, so the match index found in
            // the lowercased haystack is shifted +45 relative to the ORIGINAL
            // string the excerpt is sliced from — the excerpt window no longer
            // contains the match. PR-S2 (original-string matching) flips this
            // assertion to `toContain('target')` deliberately.
            const text = 'İ'.repeat(45) + 'target';
            engine.indexBook('turkish', [{ id: '1', href: 'i.html', text }]);

            const results = engine.search('turkish', 'target');
            expect(results).toHaveLength(1);
            expect(results[0].excerpt).not.toContain('target');
        });
    });

    describe('regression: linear-scan throughput budget (absorbed from search-engine.perf.test.ts)', () => {
        it('scans a 2M-char no-match corpus within budget', () => {
            // No matches: early returns would hide the full-scan cost.
            const sections = Array.from({ length: 200 }, (_, i) => ({
                id: `sec-${i}`,
                href: `sec-${i}.xhtml`,
                text: 'abcdefghi '.repeat(1000),
            }));
            engine.initIndex('perf-book');
            engine.addDocuments('perf-book', sections);

            const start = performance.now();
            const results = engine.search('perf-book', 'APPLE');
            const duration = performance.now() - start;

            expect(results).toHaveLength(0);
            // Generous CI budget — the old file logged the number and asserted
            // nothing. An indexOf scan of 2M chars sits well under 100ms; a
            // 3s breach means the scan went accidentally quadratic.
            expect(duration).toBeLessThan(3000);
        });
    });
});
