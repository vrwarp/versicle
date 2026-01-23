import { useMemo } from 'react';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import type { UserProgress } from '../types/db';
import { getDeviceId } from '../lib/device-id';

/**
 * Get the progress entry with the highest percentage for a book.
 * Aggregates across all devices and returns the max.
 */
function getMaxProgress(bookProgress: Record<string, UserProgress> | undefined): UserProgress | null {
    if (!bookProgress) return null;

    let max: UserProgress | null = null;
    for (const deviceId in bookProgress) {
        const current = bookProgress[deviceId];
        if (!max || current.percentage > max.percentage) {
            max = current;
        }
    }
    return max;
}

/**
 * Returns all books with static metadata merged.
 * Static metadata (cover, full title/author) is used if available,
 * otherwise falls back to Ghost Book metadata from Yjs inventory.
 */
export const useAllBooks = () => {
    const books = useBookStore(state => state.books);
    const staticMetadata = useLibraryStore(state => state.staticMetadata);
    const offloadedBookIds = useLibraryStore(state => state.offloadedBookIds);
    // Subscribe to progress changes (per-device structure)
    const progressMap = useReadingStateStore(state => state.progress);

    // OPTIMIZATION: Phase 1 - Base Books
    // Memoize the "static" transformation of books (merging inventory + library metadata).
    // This depends only on 'books', 'staticMetadata', and 'offloadedBookIds', which change rarely.
    // It does NOT depend on 'progressMap', which changes frequently (on every page turn).
    const baseBooks = useMemo(() => {
        return Object.values(books).map(book => {
            const hasCoverBlob = staticMetadata[book.bookId]?.coverBlob instanceof Blob;

            return {
                ...book,
                // Merge static metadata if available, otherwise use Ghost Book snapshots
                id: book.bookId,  // Alias for backwards compatibility
                // Prioritize user overrides (Yjs) > Static/Legacy Metadata > Snapshot
                title: book.customTitle || staticMetadata[book.bookId]?.title || book.title,
                author: book.customAuthor || staticMetadata[book.bookId]?.author || book.author,
                coverBlob: staticMetadata[book.bookId]?.coverBlob || undefined,
                version: staticMetadata[book.bookId]?.version || undefined,
                // OPTIMIZATION: Use Service Worker route for covers instead of creating blob URLs.
                // This prevents memory leaks from unrevoked createObjectURL calls and avoids sync overhead.
                coverUrl: hasCoverBlob
                    ? `/__versicle__/covers/${book.bookId}`
                    : undefined,
                // Add other static fields for compatibility
                fileHash: staticMetadata[book.bookId]?.fileHash,
                fileSize: staticMetadata[book.bookId]?.fileSize,
                totalChars: staticMetadata[book.bookId]?.totalChars,

                // Derive offloaded status from local set
                isOffloaded: offloadedBookIds.has(book.bookId),
            };
        }).sort((a, b) => b.lastInteraction - a.lastInteraction);
    }, [books, staticMetadata, offloadedBookIds]);

    // OPTIMIZATION: Phase 2 - Progress Merge
    // This memo runs when 'progressMap' updates (frequently), but it reuses the expensive
    // 'baseBooks' objects and only shallow-copies them to attach the new progress.
    // This avoids re-creating the entire book object structure and re-calculating metadata/urls.
    return useMemo(() => {
        return baseBooks.map(book => {
            const bookProgress = getMaxProgress(progressMap[book.id]);
            return {
                ...book,
                // Merge progress from reading state store (max across all devices)
                progress: bookProgress?.percentage || 0,
                currentCfi: bookProgress?.currentCfi || undefined,
                lastRead: bookProgress?.lastRead || 0
            };
        });
    }, [baseBooks, progressMap]);
};

/**
 * Returns a single book by ID with static metadata merged.
 */
export const useBook = (id: string | null) => {
    const book = useBookStore(state => id ? state.books[id] : null);
    const staticMeta = useLibraryStore(state => id ? state.staticMetadata[id] : null);
    const offloadedBookIds = useLibraryStore(state => state.offloadedBookIds);
    // Subscribe to progress changes (per-device structure)
    const progressMap = useReadingStateStore(state => state.progress);

    // Get max progress across all devices for this book
    const progress = id ? getMaxProgress(progressMap[id]) : null;

    // OPTIMIZATION: Memoize the single book result
    return useMemo(() => {
        if (!book) return null;

        const hasCoverBlob = staticMeta?.coverBlob instanceof Blob;

        return {
            ...book,
            id: book.bookId,  // Alias
            // Prioritize user overrides (Yjs) > Static/Legacy Metadata > Snapshot
            title: book.customTitle || staticMeta?.title || book.title,
            author: book.customAuthor || staticMeta?.author || book.author,
            coverBlob: staticMeta?.coverBlob || null,
            // OPTIMIZATION: Use Service Worker route
            coverUrl: hasCoverBlob ? `/__versicle__/covers/${book.bookId}` : undefined,
            fileHash: staticMeta?.fileHash,
            fileSize: staticMeta?.fileSize,
            totalChars: staticMeta?.totalChars,
            version: staticMeta?.version || undefined,

            isOffloaded: offloadedBookIds.has(book.bookId),

            // Merge progress (max across all devices)
            progress: progress?.percentage || 0,
            currentCfi: progress?.currentCfi || undefined
        };
    }, [book, staticMeta, offloadedBookIds, progress]);
};

/**
 * Returns the ID of the most recently read book.
 *
 * OPTIMIZATION: Efficiently scans the progress map to find the book with the latest timestamp.
 * This avoids iterating over the entire book library or creating large intermediate arrays.
 */
export const useLastReadBookId = () => {
    const progressMap = useReadingStateStore(state => state.progress);

    return useMemo(() => {
        const deviceId = getDeviceId();
        let maxLastRead = 0;
        let lastReadBookId: string | null = null;

        for (const bookId in progressMap) {
            const deviceMap = progressMap[bookId];
            const deviceProgress = deviceMap[deviceId];
            if (deviceProgress && deviceProgress.lastRead > maxLastRead) {
                maxLastRead = deviceProgress.lastRead;
                lastReadBookId = bookId;
            }
        }
        return lastReadBookId;
    }, [progressMap]);
};

/**
 * Returns the most recently read book with metadata merged.
 * Uses useLastReadBookId and useBook to avoid full library iteration.
 */
export const useLastReadBook = () => {
    const id = useLastReadBookId();
    return useBook(id);
};
