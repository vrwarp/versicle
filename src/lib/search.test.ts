import { describe, it, expect, vi } from 'vitest';

// Move mock setup BEFORE import
// Mock Worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage(data: any) {
    const id = data.id;

    setTimeout(() => {
        if (!this.onmessage) return;

        if (data.type === 'INIT_INDEX' || data.type === 'ADD_TO_INDEX') {
            this.onmessage({
                data: { type: 'ACK', id }
            } as MessageEvent);
        } else if (data.type === 'FINISH_INDEXING') {
            this.onmessage({
                data: { type: 'INDEX_COMPLETE', bookId: data.payload?.bookId, id }
            } as MessageEvent);
        } else if (data.type === 'SEARCH') {
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
    }, 0);
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

    it('should index a book using batch messages and send completion signal', async () => {
        const postMessageSpy = vi.spyOn(MockWorker.prototype, 'postMessage');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1');

        // Should initialize
        expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'INIT_INDEX',
            payload: { bookId: 'book-1' }
        }));

        // Should load chapter
        expect(mockBook.load).toHaveBeenCalledWith('chap1.html');

        // Should send add message
        expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_TO_INDEX',
            payload: {
                bookId: 'book-1',
                sections: expect.arrayContaining([
                    expect.objectContaining({ href: 'chap1.html' })
                ])
            }
        }));

        // Should send completion signal
        expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'FINISH_INDEXING',
            payload: { bookId: 'book-1' }
        }));
    });

    it('should report progress', async () => {
        const onProgress = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1', onProgress);
        expect(onProgress).toHaveBeenCalledWith(1.0);
    });

    it('should search and return results', async () => {
        const results = await searchClient.search('query', 'book-1');
        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
    });
});
