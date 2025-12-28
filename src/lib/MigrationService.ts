import { getDB } from '../db/db';
import { extractContentOffscreen } from './offscreen-renderer';
import type { TTSContent } from '../types/db';

const CURRENT_SEGMENTATION_VERSION = 1;

/**
 * Service to handle migration of content to the new reactive segmentation format.
 */
export class MigrationService {
    /**
     * Checks if a migration to the new segmentation format is required.
     */
    static async isMigrationRequired(): Promise<boolean> {
        try {
            const db = await getDB();
            const version = await db.get('app_metadata', 'segmentation_version');
            return (version === undefined || version < CURRENT_SEGMENTATION_VERSION);
        } catch (e) {
            console.error('Failed to check migration status', e);
            return false;
        }
    }

    /**
     * Performs the migration.
     * Re-ingests all books with empty abbreviations to ensure maximal splitting.
     *
     * @param onProgress - Callback for progress reporting.
     */
    static async migrateLibrary(onProgress?: (progress: number, message: string) => void): Promise<void> {
        const db = await getDB();
        const books = await db.getAll('books');

        if (books.length === 0) {
            await db.put('app_metadata', CURRENT_SEGMENTATION_VERSION, 'segmentation_version');
            return;
        }

        console.log(`Starting migration for ${books.length} books...`);

        for (let i = 0; i < books.length; i++) {
            const book = books[i];
            const bookId = book.id;
            const progress = Math.round((i / books.length) * 100);

            onProgress?.(progress, `Updating format for "${book.title}"...`);

            try {
                // 1. Get file
                // Try 'files' store first (uploaded books)
                let file = await db.get('files', bookId);

                // If not in 'files', it might be an offloaded book or sample book?
                // If offloaded, we can't migrate it until restored.
                // We should probably skip it and maybe flag it?
                // But migration is "all or nothing" usually.
                // If it's offloaded, 'files' entry is missing.

                if (!file) {
                    // Check if offloaded
                    if (book.isOffloaded) {
                        console.warn(`Skipping offloaded book "${book.title}" (ID: ${bookId}). It will need re-ingestion upon restore.`);
                        // We can't do anything. The user will have old segmentation if they somehow play it without restoring?
                        // No, restoring re-ingests.
                        // So skipping is fine.
                        continue;
                    }
                    console.warn(`File not found for book "${book.title}" (ID: ${bookId}). Skipping.`);
                    continue;
                }

                // Ensure file is correct type (File or ArrayBuffer)
                let ingestibleFile: File | ArrayBuffer;
                if (file instanceof Blob && !(file instanceof File)) {
                     ingestibleFile = new File([file], book.filename || 'book.epub', { type: file.type || 'application/epub+zip' });
                } else {
                     ingestibleFile = file as File | ArrayBuffer;
                }

                // 2. Re-extract content with EMPTY options
                // We reuse extractContentOffscreen but with minimal options
                const chapters = await extractContentOffscreen(ingestibleFile, {
                    abbreviations: [],
                    alwaysMerge: [],
                    // we keep sanitization enabled as it was likely enabled before
                    sanitizationEnabled: true
                });

                // 3. Update tts_content store
                const ttsStore = db.transaction('tts_content', 'readwrite').objectStore('tts_content');

                for (const chapter of chapters) {
                     const id = `${bookId}-${chapter.href}`;
                     const content: TTSContent = {
                         id,
                         bookId,
                         sectionId: chapter.href,
                         sentences: chapter.sentences
                     };
                     await ttsStore.put(content);
                }

            } catch (err) {
                console.error(`Failed to migrate book "${book.title}"`, err);
                // Continue with next book? Yes.
            }
        }

        // Finalize
        await db.put('app_metadata', CURRENT_SEGMENTATION_VERSION, 'segmentation_version');
        onProgress?.(100, 'Library update complete.');
        console.log('Migration complete.');
    }
}
