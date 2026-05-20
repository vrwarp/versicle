import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchEngine } from '../lib/search-engine';

describe('SearchEngine Performance', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('measures search performance on large text and ensures no string allocations', () => {
        const engine = new SearchEngine();
        const bookId = 'perf-book';
        engine.initIndex(bookId);

        // Generate a large text corpus - 50MB
        const baseText = 'The quick brown fox jumps over the lazy dog. ';
        let largeText = '';
        for (let i = 0; i < 500000; i++) {
            largeText += baseText;
            if (i % 10000 === 0) {
                largeText += 'HiddenTarget ';
            }
        }

        const sections = [{ id: '1', href: 'chapter1', text: largeText }, { id: '2', href: 'chapter2', text: largeText }];
        engine.addDocuments(bookId, sections);

        const toLowerCaseSpy = vi.spyOn(String.prototype, 'toLowerCase');

        const start = performance.now();
        const results = engine.search(bookId, 'hiddentarget');
        const end = performance.now();

        console.log(`Search took ${end - start} ms`);
        expect(results.length).toBeGreaterThan(0);

        // Assert that the string allocation method was not used, as required by the Bolt directive
        expect(toLowerCaseSpy).not.toHaveBeenCalled();
    });
});
