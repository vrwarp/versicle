import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Performance', () => {
    let engine: SearchEngine;
    const BOOK_ID = 'test-book';

    beforeEach(() => {
        engine = new SearchEngine();
        engine.initIndex(BOOK_ID);
    });

    it('should measure search performance on a large dataset with NO MATCHES', () => {
        // Generate a large dummy book with repetitive content to simulate a real scenario
        // We use NO MATCHES because returning early hides the O(N) regex performance. We want to scan the whole thing.
        const numSections = 1000;
        const sectionLength = 10000; // 10k chars per section -> 10M total chars

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

        // Measure Current RegExp approach implicitly by calling the actual engine
        const startCurrent = performance.now();
        const results = engine.search(BOOK_ID, query);
        const endCurrent = performance.now();
        const durationCurrent = endCurrent - startCurrent;

        console.log(`[Search Perf] Time taken to search large text block (no match): ${durationCurrent.toFixed(2)} ms`);

        expect(results).toBeDefined();
        expect(results.length).toBe(0);
    });
});
