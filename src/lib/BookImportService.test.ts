import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bookImportService } from './BookImportService';
import { bookContent } from '@data/repos/bookContent';
import * as ingestion from './ingestion';

vi.mock('./ingestion', () => ({
    extractBookData: vi.fn(),
    generateFileFingerprint: vi.fn().mockResolvedValue('hash'),
}));

vi.mock('@data/repos/bookContent', () => ({
    // handleDbError stays REAL (it lives in @data/errors now); only the
    // repo calls are stubbed.
    bookContent: {
        ingest: vi.fn().mockResolvedValue(undefined),
        getManifestBundle: vi.fn(),
        restoreResource: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('BookImportService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('addBook', () => {
        it('should call extractBookData and ingestBook', async () => {
            const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
            const mockData = {
                manifest: { bookId: 'new-id', title: 'Test' },
                ttsContentBatches: [],
                tableBatches: []
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(ingestion.extractBookData).mockResolvedValue(mockData as any);

            const manifest = await bookImportService.addBook(file);

            expect(ingestion.extractBookData).toHaveBeenCalledWith(file, undefined, undefined);
            expect(bookContent.ingest).toHaveBeenCalledWith(mockData);
            expect(manifest).toBe(mockData.manifest);
        });

        it('should wrap extraction failures in the generic database error', async () => {
            const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
            vi.mocked(ingestion.extractBookData).mockRejectedValue(new Error('Ingestion failed'));

            await expect(bookImportService.addBook(file)).rejects.toThrow('An unexpected database error occurred');
        });
    });

    describe('importBookWithId', () => {
        it('rewrites all bookId references before ingesting with overwrite', async () => {
            const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
            const mockData = {
                bookId: 'orig-id',
                manifest: { bookId: 'orig-id', title: 'Test' },
                resource: { bookId: 'orig-id' },
                structure: { bookId: 'orig-id', spineItems: [{ id: 'orig-id-sec1' }] },
                inventory: { bookId: 'orig-id' },
                progress: { bookId: 'orig-id' },
                overrides: { bookId: 'orig-id' },
                ttsContentBatches: [{ id: 'orig-id-sec1', bookId: 'orig-id' }],
                tableBatches: [{ id: 'orig-id-tbl1', bookId: 'orig-id' }]
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(ingestion.extractBookData).mockResolvedValue(mockData as any);

            await bookImportService.importBookWithId('target-id', file);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ingested = vi.mocked(bookContent.ingest).mock.calls[0][0] as any;
            expect(vi.mocked(bookContent.ingest).mock.calls[0][1]).toBe('overwrite');
            expect(ingested.bookId).toBe('target-id');
            expect(ingested.manifest.bookId).toBe('target-id');
            expect(ingested.structure.spineItems[0].id).toBe('target-id-sec1');
            expect(ingested.ttsContentBatches[0]).toMatchObject({ id: 'target-id-sec1', bookId: 'target-id' });
            expect(ingested.tableBatches[0]).toMatchObject({ id: 'target-id-tbl1', bookId: 'target-id' });
        });
    });

    describe('restoreBook', () => {
        const manifest = { bookId: 'b1', title: 'T', author: 'A', fileHash: 'hash' };

        it('verifies the fingerprint then writes the resource', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue({ manifest, structure: undefined, hasResource: false } as any);
            const file = new File([new Uint8Array([1, 2, 3])], 'book.epub');

            await bookImportService.restoreBook('b1', file);

            expect(ingestion.generateFileFingerprint).toHaveBeenCalledWith(file, {
                title: 'T', author: 'A', filename: 'book.epub'
            });
            expect(bookContent.restoreResource).toHaveBeenCalledWith('b1', expect.any(ArrayBuffer));
        });

        it('rejects on fingerprint mismatch without writing', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue({ manifest, structure: undefined, hasResource: false } as any);
            vi.mocked(ingestion.generateFileFingerprint).mockResolvedValueOnce('different-hash');
            const file = new File(['x'], 'book.epub');

            await expect(bookImportService.restoreBook('b1', file)).rejects.toThrow();
            expect(bookContent.restoreResource).not.toHaveBeenCalled();
        });

        it('rejects when the book has no manifest', async () => {
            vi.mocked(bookContent.getManifestBundle).mockResolvedValue(undefined);

            await expect(bookImportService.restoreBook('missing', new File(['x'], 'b.epub'))).rejects.toThrow();
            expect(bookContent.restoreResource).not.toHaveBeenCalled();
        });
    });
});
