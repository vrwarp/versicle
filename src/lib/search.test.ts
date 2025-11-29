import { describe, it, expect, vi } from 'vitest';

// Move mock setup BEFORE import
// Mock Worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage(data: any) {
    if (data.type === 'INDEX_BOOK') {
       setTimeout(() => {
           // Simulate indexing
           if (this.onmessage) {
             // We don't really use INDEX_COMPLETE in client yet but good for completeness
           }
       }, 10);
    } else if (data.type === 'SEARCH') {
        const id = data.id;
        setTimeout(() => {
            if (this.onmessage) {
                this.onmessage({
                    data: {
                        type: 'SEARCH_RESULTS',
                        id,
                        results: [
                            { href: 'chap1.html', excerpt: '...found match...' }
                        ]
                    }
                } as MessageEvent);
            }
        }, 10);
    }
  }
  terminate() {}
}

// Mock Worker global
vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', class {
    constructor(url: string) { return url; }
    toString() { return ''; }
});

// Now import the client which uses the global Worker
import { searchClient } from './search';

// Mock epubjs Book
const mockBook = {
  spine: {
      items: [
          { href: 'chap1.html', id: 'chap1' }
      ]
  },
  load: vi.fn().mockResolvedValue({
      body: { innerText: 'This is some text content in chapter 1.' }
  })
};

describe('SearchClient', () => {

    it('should index a book', async () => {
        // Just verify it doesn't throw and calls postMessage (via mock)
        // Since logic is mainly in worker, we are testing the bridge here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1');
        expect(mockBook.load).toHaveBeenCalledWith('chap1.html');
    });

    it('should search and return results', async () => {
        const results = await searchClient.search('query', 'book-1');
        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
    });
});
