import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchClient } from '../lib/search';

// Mock Worker
class MockWorker {
  terminate() {}
}
vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', class {
    constructor(url: string) { return url; }
    toString() { return ''; }
});

// We want to test out-of-order promise resolution in SearchClient.search
// Memory architecture doc:
// Architecture/Search Subsystem: When making concurrent calls to a Comlink Web Worker proxy (e.g., in SearchClient), avoid out-of-order promise resolutions by explicitly tracking requests per context (e.g., mapping counters by bookId) and using a map of pending promises (pendingSearches). Crucially, avoid 'head-of-line blocking' performance regressions; do not force new requests to wait for older ones. Instead, reject stale results with a specific error (e.g., 'Search superseded') and explicitly ignore this error in calling UI components to prevent false failure notifications.

describe('SearchClient Out-Of-Order Concurrent Searches', () => {
    beforeEach(() => {
        searchClient.terminate();
        vi.clearAllMocks();
    });

    it('rejects stale search requests when a newer query is issued for the same book', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveFirstQuery: (v: any) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveSecondQuery: (v: any) => void;

        const mockEngine = {
            search: vi.fn().mockImplementation((bookId: string, query: string) => {
                if (query === 'query1') {
                    return new Promise(resolve => { resolveFirstQuery = resolve; });
                } else if (query === 'query2') {
                    return new Promise(resolve => { resolveSecondQuery = resolve; });
                }
                return Promise.resolve([]);
            }),
            initIndex: vi.fn(),
            addDocuments: vi.fn()
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(searchClient as any, 'getEngine').mockReturnValue(mockEngine);

        const p1 = searchClient.search('query1', 'book1');
        const p2 = searchClient.search('query2', 'book1'); // p2 starts while p1 is running

        // Now resolve p2 FIRST (fast network response)
        resolveSecondQuery!([{ excerpt: 'Result for query2' }]);
        const res2 = await p2;
        expect(res2[0].excerpt).toBe('Result for query2');

        // Then resolve p1 LAST (slow network response)
        resolveFirstQuery!([{ excerpt: 'Result for query1' }]);

        // p1 should be rejected because it's superseded by p2
        await expect(p1).rejects.toThrow('Search superseded');
    });
});
