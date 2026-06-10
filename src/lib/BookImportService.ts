/**
 * Main-thread service for importing EPUB files into the library.
 *
 * Owns the heavy extraction pipeline (epubjs, JSZip, image compression via lib/ingestion)
 * and delegates the IndexedDB writes to the lean worker-safe DBService. Lives outside
 * DBService so the TTS engine worker — which imports DBService for IndexedDB — never
 * bundles the ingestion pipeline.
 */
import { dbService, handleDbError } from '../db/DBService';
import { extractBookData, generateFileFingerprint } from './ingestion';
import type { ExtractionOptions } from './tts';
import type { StaticBookManifest } from '../types/db';

class BookImportService {
    /**
     * Adds a new book to the library (Phase 2: Pure Ingestion).
     * Returns the StaticBookManifest for the caller to create UserInventoryItem.
     * Only writes to static_* and cache_* stores. Does NOT write user_inventory.
     */
    async addBook(
        file: File,
        ttsOptions?: ExtractionOptions,
        onProgress?: (progress: number, message: string) => void
    ): Promise<StaticBookManifest> {
        try {
            const data = await extractBookData(file, ttsOptions, onProgress);
            await dbService.ingestBook(data);
            return data.manifest;
        } catch (error) {
            handleDbError(error);
        }
    }

    /**
     * Imports a book with a specific book ID.
     * Used for restoring synced books where the inventory already exists via Yjs
     * but the local static data (manifest, resources, structure) doesn't exist.
     *
     * This extracts the book, overrides all bookId references with the specified ID,
     * then ingests the data.
     */
    async importBookWithId(
        bookId: string,
        file: File,
        ttsOptions?: ExtractionOptions,
        onProgress?: (progress: number, message: string) => void
    ): Promise<StaticBookManifest> {
        try {
            const data = await extractBookData(file, ttsOptions, onProgress);

            // Override all bookId references with the specified ID
            const originalBookId = data.bookId;

            data.bookId = bookId;
            data.manifest.bookId = bookId;
            data.resource.bookId = bookId;
            data.structure.bookId = bookId;
            data.inventory.bookId = bookId;
            data.progress.bookId = bookId;
            data.overrides.bookId = bookId;

            // Update section IDs that include the bookId
            data.structure.spineItems = data.structure.spineItems.map(item => ({
                ...item,
                id: item.id.replace(originalBookId, bookId)
            }));

            // Update TTS batch IDs
            data.ttsContentBatches = data.ttsContentBatches.map(batch => ({
                ...batch,
                id: batch.id.replace(originalBookId, bookId),
                bookId
            }));

            // Update table batch IDs
            data.tableBatches = data.tableBatches.map(table => ({
                ...table,
                id: table.id.replace(originalBookId, bookId),
                bookId
            }));

            await dbService.ingestBook(data, 'overwrite');
            return data.manifest;
        } catch (error) {
            handleDbError(error);
        }
    }

    /**
     * Restores an offloaded book: verifies the file's fingerprint against the stored
     * manifest, then writes the binary content back.
     */
    async restoreBook(id: string, file: File): Promise<void> {
        try {
            const bundle = await dbService.getManifestBundle(id);
            if (!bundle) throw new Error('Book metadata not found');
            const manifest = bundle.manifest;

            // Verify Hash
            const newFingerprint = await generateFileFingerprint(file, {
                title: manifest.title,
                author: manifest.author,
                filename: file.name
            });

            if (manifest.fileHash && manifest.fileHash !== newFingerprint) {
                throw new Error('File verification failed: Fingerprint mismatch.');
            }

            await dbService.restoreBookResource(id, await file.arrayBuffer());
        } catch (error) {
            handleDbError(error);
        }
    }
}

export const bookImportService = new BookImportService();
