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
    initIndex: vi.fn().mockResolvedValue(undefined),
    addDocuments: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([{ href: 'chap1.html', excerpt: '...found match...' }]),
    supportsXmlParsing: vi.fn().mockResolvedValue(false)
};

vi.mock('comlink', () => ({
    wrap: vi.fn(() => mockEngine),
    expose: vi.fn(),
    Remote: {}
}));

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
    beforeEach(() => {
        searchClient.terminate();
        vi.clearAllMocks();
    });

    it('should index a book using archive access', async () => {
        mockBook.archive.getBlob.mockResolvedValue(mockBlob);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-1');

        // Should initialize
        expect(mockEngine.initIndex).toHaveBeenCalledWith('book-1');

        // Should use archive to get blob
        expect(mockBook.archive.getBlob).toHaveBeenCalledWith('chap1.html');
        // Should NOT load chapter via rendering
        expect(mockBook.load).not.toHaveBeenCalled();

        // Should send add message
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

        // Should send add message (with content from load)
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
        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
        expect(mockEngine.search).toHaveBeenCalledWith('book-1', 'query');
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

    it('should offload XML to worker if supported', async () => {
        // Mock supported
        mockEngine.supportsXmlParsing.mockResolvedValue(true);
        mockBook.archive.getBlob.mockResolvedValue(mockBlob);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-offload');

        // Should use archive
        expect(mockBook.archive.getBlob).toHaveBeenCalled();

        // Should NOT parse on main thread (checking if DOMParser was instantiated is hard if we don't spy on it,
        // but we can check what was sent to addDocuments)

        expect(mockEngine.addDocuments).toHaveBeenCalledWith('book-offload', expect.arrayContaining([
            expect.objectContaining({
                href: 'chap1.html',
                xml: expect.stringContaining('<html'),
                text: undefined
            })
        ]));
    });

    it('should skip indexing if already indexed', async () => {
        mockBook.archive.getBlob.mockResolvedValue(mockBlob);

        // First index
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-idempotent');
        expect(mockEngine.initIndex).toHaveBeenCalledTimes(1);

        // Second index
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await searchClient.indexBook(mockBook as any, 'book-idempotent');
        expect(mockEngine.initIndex).toHaveBeenCalledTimes(1); // Should NOT be called again
    });
});
