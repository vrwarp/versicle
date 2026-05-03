import { describe, it, expect, vi } from 'vitest';

// Mock Worker
class MockWorker {
  terminate() {}
}
vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', class {
    constructor(url: string) { return url; }
    toString() { return ''; }
});

// Mock Comlink
const mockEngine = {
    search: vi.fn().mockImplementation(async (_bookId: string, query: string) => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 50));
        return [{ href: 'result', excerpt: `Result for ${query}` }];
    }),
    initIndex: vi.fn(),
    addDocuments: vi.fn()
};

vi.mock('comlink', () => ({
    wrap: vi.fn(() => mockEngine),
    expose: vi.fn(),
    Remote: {}
}));

import { searchClient } from './search';

describe('SearchClient Race Condition', () => {

    it('should handle concurrent searches correctly', async () => {
        const p1 = searchClient.search('query1', 'book1');
        const p2 = searchClient.search('query2', 'book1');

        let timeoutId: NodeJS.Timeout | undefined;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Timeout')), 200);
        });

        try {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const results = await Promise.race([Promise.allSettled([p1, p2]), timeout]) as any[];

             // Verify correct mapping
             expect(results[0].status).toBe('rejected'); expect(results[0].reason.message).toBe('Search superseded');
             expect(results[1].status).toBe('fulfilled'); expect(results[1].value[0].excerpt).toBe('Result for query2');
             clearTimeout(timeoutId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
             throw new Error(`Test failed with error: ${e.message}`);
        }
    });
});
