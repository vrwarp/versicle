import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Comlink from 'comlink';

// Mock comlink
vi.mock('comlink', () => ({
    wrap: vi.fn(),
    expose: vi.fn()
}));

// Mock Worker
class MockWorker {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', class {
    constructor(url: string) { return url; }
    toString() { return ''; }
});

import { searchClient } from './search';

// Mock epubjs Book
const mockBlob = new Blob(['<html xmlns="http://www.w3.org/1999/xhtml"><body>This is some text content in chapter 1.</body></html>'], { type: 'application/xhtml+xml' });

const mockBook = {
  spine: {
      items: [
          { href: 'chap1.html', id: 'chap1' }
      ]
  },
  archive: {
    getBlob: vi.fn().mockResolvedValue(mockBlob)
  },
  load: vi.fn().mockResolvedValue({
      body: { innerText: 'This is some text content in chapter 1.' }
  }),
  ready: Promise.resolve()
};

describe('SearchClient', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockEngine: any;

    beforeEach(() => {
        searchClient.terminate();
        vi.clearAllMocks();
        // Reset mockBook spies
        mockBook.archive.getBlob.mockResolvedValue(mockBlob);
        mockBook.load.mockResolvedValue({
            body: { innerText: 'This is some text content in chapter 1.' }
        });

        mockEngine = {
            initIndex: vi.fn().mockResolvedValue(undefined),
            addDocuments: vi.fn().mockResolvedValue(undefined),
            search: vi.fn().mockResolvedValue([{ href: 'chap1.html', excerpt: '...found match...' }])
        };
        (Comlink.wrap as any).mockReturnValue(mockEngine);
    });

    it('should index a book using archive access and call worker methods', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1');

        expect(Comlink.wrap).toHaveBeenCalled();
        expect(mockEngine.initIndex).toHaveBeenCalledWith('book-1');

        // Should use archive to get blob
        expect(mockBook.archive.getBlob).toHaveBeenCalledWith('chap1.html');
        // Should NOT load chapter via rendering
        expect(mockBook.load).not.toHaveBeenCalled();

        expect(mockEngine.addDocuments).toHaveBeenCalledWith('book-1', expect.arrayContaining([
            expect.objectContaining({ href: 'chap1.html', text: expect.stringContaining('This is some text content in chapter 1.') })
        ]));
    });

    it('should fallback to book.load if archive fails', async () => {
        mockBook.archive.getBlob.mockResolvedValue(null); // Simulate archive failure/missing file

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1');

        // Should attempt archive
        expect(mockBook.archive.getBlob).toHaveBeenCalledWith('chap1.html');
        // Should fallback to load
        expect(mockBook.load).toHaveBeenCalledWith('chap1.html');

        expect(mockEngine.addDocuments).toHaveBeenCalledWith('book-1', expect.arrayContaining([
            expect.objectContaining({ href: 'chap1.html', text: expect.stringContaining('This is some text content in chapter 1.') })
        ]));
    });

    it('should report progress', async () => {
        const onProgress = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1', onProgress);
        expect(onProgress).toHaveBeenCalledWith(1.0);
    });

    it('should search and return results', async () => {
        const results = await searchClient.search('query', 'book-1');
        expect(mockEngine.search).toHaveBeenCalledWith('book-1', 'query');
        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
    });

    it('should wait for book.ready before indexing', async () => {
        // Create a mock book that is not ready immediately
        const delayedBook = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            spine: undefined as any,
            ready: new Promise<void>((resolve) => {
                setTimeout(() => {
                    delayedBook.spine = {
                        items: [
                            { href: 'chap1.html', id: 'chap1' }
                        ]
                    };
                    resolve();
                }, 20);
            }),
            archive: {
                 getBlob: vi.fn().mockResolvedValue(mockBlob)
            },
            load: vi.fn().mockResolvedValue({
                body: { innerText: 'Content' }
            })
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(delayedBook as any, 'book-2');

        expect(delayedBook.spine).toBeDefined();
        expect(mockEngine.initIndex).toHaveBeenCalledWith('book-2');
    });
});
