import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Reliability/Predictability Issue', () => {
    let engine: SearchEngine;
    const BOOK_ID = 'repro-book';

    beforeEach(() => {
        engine = new SearchEngine();
        engine.initIndex(BOOK_ID);
    });

    it('should quickly reject queries not present in a large document to avoid massive GC thrashing', () => {
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

        const query = 'THIS_DOES_NOT_EXIST';

        // Spy on String.prototype.toLowerCase to verify we aren't allocating new strings
        const toLowerCaseSpy = vi.spyOn(String.prototype, 'toLowerCase');

        const results = engine.search(BOOK_ID, query);

        // query.toLowerCase() is called once, but the giant text blocks should NOT be lowercased
        // because the fast-path regex check should fail early.
        expect(toLowerCaseSpy).toHaveBeenCalledTimes(1);
        expect(results.length).toBe(0);

        toLowerCaseSpy.mockRestore();
    });
});
