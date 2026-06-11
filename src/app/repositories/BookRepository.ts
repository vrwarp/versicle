/**
 * Main-thread repository for book inventory reads and book deletion.
 *
 * Merges the raw static rows (IndexedDB, via the lean worker-safe DBService) with the
 * yjs-backed user inventory (useBookStore). Lives outside DBService so the TTS engine
 * worker — which imports DBService for IndexedDB — never bundles yjs or opens a second
 * Y.Doc/IndexedDB connection. Worker-side engine code reaches merged book metadata
 * through the EngineContext book port, whose host implementation calls this repository.
 */
import { bookContent, type ManifestBundle } from '@data/repos/bookContent';
import { useBookStore } from '@store/useBookStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import type { BookMetadata, UserInventoryItem } from '~types/db';

function toBookMetadata(bundle: ManifestBundle, inventory: UserInventoryItem | undefined): BookMetadata {
    const { manifest, structure, hasResource } = bundle;
    // coverBlob may be ArrayBuffer at runtime (stored as ArrayBuffer for WebKit IDB compatibility)
    const rawCoverBlob = manifest.coverBlob as unknown as Blob | ArrayBuffer | undefined;
    return {
        id: manifest.bookId,
        title: inventory?.customTitle || inventory?.title || manifest.title,
        author: inventory?.customAuthor || inventory?.author || manifest.author,
        description: manifest.description,
        coverBlob: rawCoverBlob instanceof ArrayBuffer ? new Blob([rawCoverBlob]) : rawCoverBlob,
        addedAt: inventory?.addedAt || Date.now(),

        bookId: manifest.bookId,
        filename: inventory?.sourceFilename || 'unknown.epub',
        fileHash: manifest.fileHash,
        fileSize: manifest.fileSize,
        totalChars: manifest.totalChars,
        version: manifest.schemaVersion,
        syntheticToc: structure?.toc,

        isOffloaded: !hasResource,
        language: inventory?.language || manifest.language,
        coverPalette: inventory?.coverPalette || manifest.coverPalette,
        perceptualPalette: inventory?.perceptualPalette || manifest.perceptualPalette,
        baseFontSize: manifest.baseFontSize,
        baseLineHeight: manifest.baseLineHeight
    };
}

class BookRepository {
    /**
     * Retrieves the merged metadata for a specific book.
     * Post-Yjs migration: user_inventory is in Yjs (useBookStore), not IndexedDB.
     */
    async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
        const bundle = await bookContent.getManifestBundle(id);
        if (!bundle) return undefined;
        return toBookMetadata(bundle, useBookStore.getState().books[id]);
    }

    /**
     * Retrieves merged metadata for multiple books in a single IDB transaction.
     * Preserves the exact index mapping of the input array.
     */
    async getBookMetadataBulk(ids: string[]): Promise<(BookMetadata | undefined)[]> {
        const bundles = await bookContent.getManifestBundleBulk(ids);
        const inventoryBooks = useBookStore.getState().books;
        return bundles.map((bundle, i) =>
            bundle ? toBookMetadata(bundle, inventoryBooks[ids[i]]) : undefined
        );
    }

    /**
     * Retrieves the book ID associated with a given filename (from the yjs inventory).
     */
    getBookIdByFilename(filename: string): string | undefined {
        const books = useBookStore.getState().books;
        for (const book of Object.values(books)) {
            if (book.sourceFilename === filename) {
                return book.bookId;
            }
        }
        return undefined;
    }

    /**
     * Deletes a book: yjs content-analysis cleanup plus all static/cache rows in IndexedDB.
     * (Inventory/progress/annotation cleanup is handled by their own stores' actions.)
     */
    async deleteBook(id: string): Promise<void> {
        useContentAnalysisStore.getState().deleteBookAnalysis(id);
        await bookContent.deleteBook(id);
    }
}

export const bookRepository = new BookRepository();
