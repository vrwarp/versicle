import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bookRepository } from './BookRepository';
import { bookContent } from '@data/repos/bookContent';
import { useBookStore } from '@store/useBookStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import type { ManifestBundle } from '@data/repos/bookContent';

vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getManifestBundle: vi.fn(),
        getManifestBundleBulk: vi.fn(),
        deleteBook: vi.fn().mockResolvedValue(undefined),
    },
}));

// The yjs-backed stores are mocked with plain state holders: the repository only reads
// getState(), so the merge logic is exercised without loading yjs.
vi.mock('@store/useBookStore', () => ({
    useBookStore: { getState: vi.fn(() => ({ books: {} })) },
}));

vi.mock('@store/useContentAnalysisStore', () => ({
    useContentAnalysisStore: { getState: vi.fn() },
}));

function bundle(overrides: Partial<ManifestBundle['manifest']> = {}, hasResource = true): ManifestBundle {
    return {
        manifest: {
            bookId: 'b1',
            title: 'Manifest Title',
            author: 'Manifest Author',
            description: 'desc',
            schemaVersion: 3,
            fileHash: 'hash',
            fileSize: 100,
            totalChars: 1000,
            language: 'en',
            ...overrides,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        structure: { bookId: 'b1', toc: [{ id: 't1', href: 'h', label: 'L' }], spineItems: [] },
        hasResource,
    };
}

describe('BookRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useBookStore.getState).mockReturnValue({ books: {} } as never);
    });

    describe('getBookMetadata', () => {
        it('returns undefined when there is no manifest', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(undefined);
            expect(await bookRepository.getBookMetadata('missing')).toBeUndefined();
        });

        it('builds metadata from the manifest when no inventory exists', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(bundle());

            const meta = await bookRepository.getBookMetadata('b1');

            expect(meta).toMatchObject({
                id: 'b1',
                bookId: 'b1',
                title: 'Manifest Title',
                author: 'Manifest Author',
                filename: 'unknown.epub',
                isOffloaded: false,
                language: 'en',
                version: 3,
            });
            expect(meta?.syntheticToc).toEqual([{ id: 't1', href: 'h', label: 'L' }]);
        });

        it('prefers inventory overrides (custom title/author, filename, language)', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(bundle());
            vi.mocked(useBookStore.getState).mockReturnValue({
                books: {
                    b1: {
                        bookId: 'b1',
                        title: 'Inventory Title',
                        customTitle: 'Custom Title',
                        customAuthor: 'Custom Author',
                        sourceFilename: 'real.epub',
                        language: 'fr',
                        addedAt: 42,
                    },
                },
            } as never);

            const meta = await bookRepository.getBookMetadata('b1');

            expect(meta).toMatchObject({
                title: 'Custom Title',
                author: 'Custom Author',
                filename: 'real.epub',
                language: 'fr',
                addedAt: 42,
            });
        });

        it('flags offloaded books when the binary resource is missing', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(bundle({}, false));
            const meta = await bookRepository.getBookMetadata('b1');
            expect(meta?.isOffloaded).toBe(true);
        });

        it('converts an ArrayBuffer coverBlob to a Blob (WebKit IDB storage shape)', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(
                bundle({ coverBlob: new ArrayBuffer(4) as never })
            );
            const meta = await bookRepository.getBookMetadata('b1');
            expect(meta?.coverBlob).toBeInstanceOf(Blob);
        });
    });

    describe('getBookMetadataBulk', () => {
        it('preserves index mapping, including missing books', async () => {
            vi.mocked(bookContent.getManifestBundleBulk).mockResolvedValue([
                bundle({ bookId: 'a' }),
                undefined,
                bundle({ bookId: 'c' }),
            ]);

            const result = await bookRepository.getBookMetadataBulk(['a', 'b', 'c']);

            expect(result).toHaveLength(3);
            expect(result[0]?.bookId).toBe('a');
            expect(result[1]).toBeUndefined();
            expect(result[2]?.bookId).toBe('c');
        });
    });

    describe('getBookIdByFilename', () => {
        it('finds the book id by source filename in the inventory', () => {
            vi.mocked(useBookStore.getState).mockReturnValue({
                books: {
                    b1: { bookId: 'b1', sourceFilename: 'one.epub' },
                    b2: { bookId: 'b2', sourceFilename: 'two.epub' },
                },
            } as never);

            expect(bookRepository.getBookIdByFilename('two.epub')).toBe('b2');
            expect(bookRepository.getBookIdByFilename('nope.epub')).toBeUndefined();
        });
    });

    /**
     * perf (P-mem): every book's cover thumbnail used to be copied into a
     * fresh Blob on the awaited boot path and then held — in the merged
     * metadata, in the library projection and in `useBook` — for the life of
     * the tab (~6-30MB on a 300-book shelf). Every real consumer prefers the
     * service-worker route, which reads the bytes from the SW's own IndexedDB
     * connection, so while the page is SW controlled the bytes never have to
     * enter the app's heap at all; `hasCover` is what the projection needs.
     */
    describe('regression: cover bytes are not pinned while the SW serves covers', () => {
        const setController = (controller: object | null) => {
            Object.defineProperty(navigator, 'serviceWorker', {
                value: { controller },
                writable: true,
                configurable: true,
            });
        };

        afterEach(() => {
            // Restore jsdom's default (no serviceWorker container at all).
            Reflect.deleteProperty(navigator, 'serviceWorker');
        });

        it('omits coverBlob but still reports hasCover when a controller is active', async () => {
            setController({});
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(
                bundle({ coverBlob: new ArrayBuffer(4) as never })
            );

            const meta = await bookRepository.getBookMetadata('b1');

            expect(meta?.coverBlob).toBeUndefined();
            expect(meta?.hasCover).toBe(true);
        });

        it('keeps the fallback blob when no controller is present', async () => {
            setController(null);
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(
                bundle({ coverBlob: new ArrayBuffer(4) as never })
            );

            const meta = await bookRepository.getBookMetadata('b1');

            expect(meta?.coverBlob).toBeInstanceOf(Blob);
            expect(meta?.hasCover).toBe(true);
        });

        it('reports hasCover false for a coverless book in both lanes', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(bundle());
            expect((await bookRepository.getBookMetadata('b1'))?.hasCover).toBe(false);

            setController({});
            expect((await bookRepository.getBookMetadata('b1'))?.hasCover).toBe(false);
        });

        it('holds no cover bytes for ANY book in the bulk boot read', async () => {
            setController({});
            vi.mocked(bookContent.getManifestBundleBulk).mockResolvedValue([
                bundle({ bookId: 'a', coverBlob: new ArrayBuffer(4) as never }),
                bundle({ bookId: 'b', coverBlob: new ArrayBuffer(4) as never }),
            ]);

            const result = await bookRepository.getBookMetadataBulk(['a', 'b']);

            expect(result.map((m) => m?.coverBlob)).toEqual([undefined, undefined]);
            expect(result.map((m) => m?.hasCover)).toEqual([true, true]);
        });
    });

    describe('deleteBook', () => {
        it('cleans up yjs content analysis then deletes the IDB rows', async () => {
            const deleteBookAnalysis = vi.fn();
            vi.mocked(useContentAnalysisStore.getState).mockReturnValue({ deleteBookAnalysis } as never);

            await bookRepository.deleteBook('b1');

            expect(deleteBookAnalysis).toHaveBeenCalledWith('b1');
            expect(bookContent.deleteBook).toHaveBeenCalledWith('b1');
        });
    });
});
