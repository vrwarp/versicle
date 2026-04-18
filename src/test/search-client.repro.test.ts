import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchClient } from '../lib/search';
import { Book } from 'epubjs';

// Mock Worker class
class MockWorker {
    onmessage: any;
    postMessage() {}
    terminate() {}
}
global.Worker = MockWorker as any;

describe('SearchClient Concurrent Indexing', () => {
    beforeEach(() => {
        searchClient.terminate();
    });

    it('should broadcast intermediate progress to all concurrent indexing callers', async () => {
        const mockBook = {
            ready: Promise.resolve(),
            spine: {
                items: [
                    { id: '1', href: 'chapter1.xhtml' },
                    { id: '2', href: 'chapter2.xhtml' },
                    { id: '3', href: 'chapter3.xhtml' },
                    { id: '4', href: 'chapter4.xhtml' },
                    { id: '5', href: 'chapter5.xhtml' },
                    { id: '6', href: 'chapter6.xhtml' },
                ]
            },
            archive: {
                getBlob: vi.fn().mockResolvedValue({ text: () => Promise.resolve('<xml></xml>') })
            }
        } as unknown as Book;

        // Mock comlink worker engine
        vi.spyOn(searchClient as any, 'getEngine').mockReturnValue({
            initIndex: vi.fn().mockResolvedValue(undefined),
            supportsXmlParsing: vi.fn().mockResolvedValue(true),
            addDocuments: vi.fn().mockResolvedValue(undefined)
        });

        const onProgress1 = vi.fn();
        const onProgress2 = vi.fn();

        const p1 = searchClient.indexBook(mockBook, 'book-1', onProgress1);
        const p2 = searchClient.indexBook(mockBook, 'book-1', onProgress2);

        await Promise.all([p1, p2]);

        expect(onProgress1).toHaveBeenCalled();
        expect(onProgress2).toHaveBeenCalled();

        // Assert that both callers received intermediate updates (e.g. not just a single 1.0 update at the end)
        expect(onProgress1.mock.calls.length).toBeGreaterThan(1);
        expect(onProgress2.mock.calls.length).toBeGreaterThan(1);
    });
});
