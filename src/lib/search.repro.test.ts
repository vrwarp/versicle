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

        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 200));

        try {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const results = await Promise.race([Promise.all([p1, p2]), timeout]) as any[];

             // Verify correct mapping
             expect(results[0][0].excerpt).toBe('Result for query1');
             expect(results[1][0].excerpt).toBe('Result for query2');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
             throw new Error(`Test failed with error: ${e.message}`);
        }
    });
});
