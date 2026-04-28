import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Worker
class MockWorker {
  terminate() {}
}
vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', class {
    constructor(url: string) { return url; }
    toString() { return ''; }
});

const mockEngine = {
    initIndex: vi.fn(),
    addDocuments: vi.fn(),
    search: vi.fn(),
    supportsXmlParsing: vi.fn()
};

vi.mock('comlink', () => ({
    wrap: vi.fn(() => mockEngine),
    expose: vi.fn(),
    Remote: {}
}));

import { searchClient } from './search';

describe('SearchClient - Out of order', () => {
    beforeEach(() => {
        searchClient.terminate();
        vi.clearAllMocks();
    });

    it('should ignore stale search results if a newer search is pending or has resolved', async () => {
        let resolveSlow: any;
        let resolveFast: any;

        mockEngine.search.mockImplementation((bookId, query) => {
            if (query === 'slow') {
                return new Promise(r => { resolveSlow = r; });
            }
            return new Promise(r => { resolveFast = r; });
        });

        const results: string[] = [];

        const p1 = searchClient.search('slow', 'b1').then(res => {
            if (res !== undefined) {
                results.push('slow_result');
            }
        }).catch(e => {
            if (e.message === 'Search cancelled') {
                results.push('slow_cancelled');
            }
        });

        const p2 = searchClient.search('fast', 'b1').then(res => {
            if (res !== undefined) {
                results.push('fast_result');
            }
        });

        // Fast resolves first
        resolveFast([{ href: 'fast', excerpt: 'fast' }]);

        await p2; // Wait for the fast one to finish
        expect(results).toEqual(['fast_result']);

        // Now resolve the older slow one
        resolveSlow([{ href: 'slow', excerpt: 'slow' }]);
        await p1; // Wait for the slow one to finish

        // Since 'fast' was newer, the slow one's result should be ignored or cancelled
        expect(results).toEqual(['fast_result', 'slow_cancelled']);
    });
});
