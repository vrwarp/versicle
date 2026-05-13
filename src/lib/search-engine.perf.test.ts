import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Performance', () => {
    let engine: SearchEngine;
    const BOOK_ID = 'test-book';

    beforeEach(() => {
        engine = new SearchEngine();
        engine.initIndex(BOOK_ID);
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should measure search performance on a large dataset with NO MATCHES', () => {
        const numSections = 1000;
        const sectionLength = 10000;

        const sections = [];
        for (let i = 0; i < numSections; i++) {
            let text = '';
            for (let j = 0; j < sectionLength; j += 10) {
                text += 'abcdefghi ';
            }
            sections.push({
                id: `sec-${i}`,
                href: `sec-${i}.xhtml`,
                text: text
            });
        }

        engine.addDocuments(BOOK_ID, sections);

        const query = 'APPLE';

        const toLowerCaseSpy = vi.spyOn(String.prototype, 'toLowerCase');

        const startCurrent = performance.now();
        const results = engine.search(BOOK_ID, query);
        const endCurrent = performance.now();
        const durationCurrent = endCurrent - startCurrent;

        console.log(`[Search Perf] Time taken to search large text block (no match): ${durationCurrent.toFixed(2)} ms`);

        expect(results).toBeDefined();
        expect(results.length).toBe(0);

        // Assert that we did not use toLowerCase on the massive text blocks
        // It's allowed for the query string itself though, so let's check call count
        expect(toLowerCaseSpy).toHaveBeenCalledTimes(1);
    });
});
