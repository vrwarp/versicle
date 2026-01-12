import { getDB } from '../db/db';
import { useLibraryStore } from '../store/useLibraryStore';
import type { StaticBookManifest, UserInventoryItem, UserProgress, StaticResource } from '../types/db';

export const seedLibrary = async (books: Partial<StaticBookManifest & UserInventoryItem & UserProgress & { epubBlob: ArrayBuffer | Blob }>[]) => {
    const db = await getDB();
    const tx = db.transaction(['user_inventory', 'static_manifests', 'user_progress', 'static_resources'], 'readwrite');

    for (const book of books) {
        const bookId = book.bookId || 'default-id';

        await tx.objectStore('static_manifests').put({
            bookId,
            title: book.title || 'Unknown Title',
            author: book.author || 'Unknown Author',
            description: book.description || '',
            schemaVersion: book.schemaVersion || 1,
            fileHash: book.fileHash || 'mock-hash',
            fileSize: book.fileSize || 0,
            totalChars: book.totalChars || 0,
            coverBlob: book.coverBlob || new Blob(['mock-cover'], { type: 'image/jpeg' })
        } as StaticBookManifest);

        await tx.objectStore('user_inventory').put({
            bookId,
            addedAt: book.addedAt || Date.now(),
            status: book.status || 'unread',
            tags: book.tags || [],
            lastInteraction: book.lastInteraction || Date.now(),
            sourceFilename: book.sourceFilename || 'book.epub'
        } as UserInventoryItem);

        await tx.objectStore('user_progress').put({
            bookId,
            percentage: book.percentage || 0,
            lastRead: book.lastRead || 0,
            completedRanges: book.completedRanges || []
        } as UserProgress);

        if (book.epubBlob) {
             await tx.objectStore('static_resources').put({ bookId, epubBlob: book.epubBlob } as StaticResource);
        }
    }

    await tx.done;

    // Force store refresh
    await useLibraryStore.getState().fetchBooks();
};
