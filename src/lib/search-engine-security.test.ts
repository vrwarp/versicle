import { describe, it, expect, vi } from 'vitest';
import { SearchEngine } from './search-engine';

describe('SearchEngine Security', () => {
    it('should abort search if execution takes too long (ReDoS protection)', () => {
        const engine = new SearchEngine();
        const bookId = 'redos-test';

        // Create a large text buffer that might be slow to process with certain regexes,
        // or just mock Date.now() to simulate time passing.
        // Mocking Date.now is more reliable for testing the guard logic.
        const longText = 'a'.repeat(100000);

        engine.indexBook(bookId, [
            { href: 'chap1', text: longText, bookId, sectionId: 'chap1', characterCount: 100000, playOrder: 0 }
        ]);

        let callCount = 0;
        const originalDateNow = Date.now;

        // Mock Date.now to increment by 50ms every time it's called
        // This simulates a slow loop
        const startTime = 1000;
        global.Date.now = vi.fn(() => {
            callCount++;
            return startTime + (callCount * 20); // 20ms per call
        });

        try {
            // Search for 'a' - which will have MANY matches (every character)
            // It should hit the timeout loop
            const results = engine.search(bookId, 'a');

            // We expect some results, but it should have bailed out before finding ALL 100,000 matches
            // MAX_RESULTS is 50, so it stops there normally.
            // We need to ensure it stops due to TIME, not MAX_RESULTS.
            // Let's set MAX_RESULTS logic aside: the test confirms the guard exists if we pass the time limit.
            // Actually, if MAX_RESULTS is 50, and time limit is 100ms, and we increment 20ms per call...
            // It will take 5 calls (100ms) to timeout.
            // 5 results < 50 results.

            expect(results.length).toBeLessThan(50);
            expect(results.length).toBeGreaterThan(0);

        } finally {
            global.Date.now = originalDateNow;
        }
    });

    it('should handle special regex characters safely', () => {
        const engine = new SearchEngine();
        engine.indexBook('test', [{ href: '1', text: 'This has a (parenthesis) and a *star*', bookId: 't', sectionId: '1', characterCount: 10, playOrder: 1 }]);

        // Searching for "(" should not throw syntax error
        const results = engine.search('test', '(');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('(');
    });
});
