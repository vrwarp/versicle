import { useMemo, useRef, useEffect } from 'react';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore, isValidProgress, getMostRecentProgress } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import type { UserProgress, UserInventoryItem } from '../types/db';
import { getDeviceId } from '../lib/device-id';

/**
 * Resolves the progress for a book using the "Local Priority > Global Recent" strategy.
 * Matches the logic in useReadingStateStore.getProgress().
 */
function resolveProgress(bookProgress: Record<string, UserProgress> | undefined): UserProgress | null {
    if (!bookProgress) return null;
    const deviceId = getDeviceId();

    // 1. Try Local (Must be Valid)
    const local = bookProgress[deviceId];
    if (local && isValidProgress(local)) {
        return local;
    }

    // 2. Fallback to Most Recent (Valid)
    const recent = getMostRecentProgress(bookProgress);
    if (recent) return recent;

    // 3. Final Fallback: Return Local (even if 0%) if exists, else null
    return local || null;
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
    const readingListEntries = useReadingListStore(state => state.entries);

    // OPTIMIZATION: Phase 1 - Base Books
    // Memoize the "static" transformation of books (merging inventory + library metadata).
    // This depends only on 'books', 'staticMetadata', and 'offloadedBookIds', which change rarely.
    // It does NOT depend on 'progressMap', which changes frequently (on every page turn).

    // Cache to maintain base book object identity across renders if raw book hasn't changed.
    // We use a WeakMap keyed by the raw UserInventoryItem object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseBookCacheRef = useRef(new WeakMap<UserInventoryItem, any>());

    // Track external dependencies to invalidate cache if they change
    const prevDepsRef = useRef({ staticMetadata, offloadedBookIds });

    // Invalidate cache if static metadata or offloaded status changes, as these affect the base book result
    // eslint-disable-next-line react-hooks/refs
    if (prevDepsRef.current.staticMetadata !== staticMetadata ||
        // eslint-disable-next-line react-hooks/refs
        prevDepsRef.current.offloadedBookIds !== offloadedBookIds) {
        // eslint-disable-next-line react-hooks/refs
        baseBookCacheRef.current = new WeakMap();
        // eslint-disable-next-line react-hooks/refs
        prevDepsRef.current = { staticMetadata, offloadedBookIds };
    }

    const baseBooks = useMemo(() => {
        // eslint-disable-next-line react-hooks/refs
        return Object.values(books).map(book => {
            // Check cache
            const cached = baseBookCacheRef.current.get(book);
            if (cached) return cached;

            const hasCoverBlob = staticMetadata[book.bookId]?.coverBlob instanceof Blob;

            const newBaseBook = {
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

            baseBookCacheRef.current.set(book, newBaseBook);
            return newBaseBook;
        }).sort((a, b) => b.lastInteraction - a.lastInteraction);
    }, [books, staticMetadata, offloadedBookIds]);

    // OPTIMIZATION: Use a cache to maintain stable object references.
    // We only want to return a new object if the underlying data actually changed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousResultsRef = useRef<Record<string, { result: any, base: any, progress: number, lastRead: number, currentCfi: string | undefined }>>({});

    // OPTIMIZATION: Phase 2 - Progress Merge
    // This memo runs when 'progressMap' updates (frequently).
    // We iterate over baseBooks and merge the latest progress.
    // CRITICAL: We compare with the previous result for each book.
    // If the base book reference matches AND the derived progress is identical,
    // we REUSE the previous object reference.
    const memoizedResult = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newCache: Record<string, { result: any, base: any, progress: number, lastRead: number, currentCfi: string | undefined }> = {};

        const cache = previousResultsRef.current;

        // eslint-disable-next-line react-hooks/refs
        const result = baseBooks.map(book => {
            const bookProgress = resolveProgress(progressMap[book.id]);
            const readingListEntry = book.sourceFilename ? readingListEntries[book.sourceFilename] : undefined;
            const progress = bookProgress?.percentage || readingListEntry?.percentage || 0;
            const currentCfi = bookProgress?.currentCfi || undefined;
            const lastRead = bookProgress?.lastRead || readingListEntry?.lastUpdated || 0;

            // Check cache for reuse
            const prev = cache[book.id];

            // Reuse if:
            // 1. Previous entry exists
            // 2. Base book object is referentially identical (Phase 1 didn't change it)
            // 3. Derived progress values are identical
            if (prev && prev.base === book && prev.progress === progress && prev.lastRead === lastRead && prev.currentCfi === currentCfi) {
                newCache[book.id] = prev;
                return prev.result;
            }

            // Create new object
            const newBook = {
                ...book,
                // Merge progress from reading state store (max across all devices)
                // Fallback to reading list progress if no device progress is found
                progress: progress,
                currentCfi: currentCfi,
                lastRead: lastRead
            };

            newCache[book.id] = {
                result: newBook,
                base: book,
                progress,
                lastRead,
                currentCfi
            };

            return newBook;
        });

        return { books: result, cache: newCache };
    }, [baseBooks, progressMap, readingListEntries]);

    // Update cache for next render
    useEffect(() => {
        previousResultsRef.current = memoizedResult.cache;
    }, [memoizedResult.cache]);

    return memoizedResult.books;
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
    const readingListEntries = useReadingListStore(state => state.entries);

    // Get resolved progress (Local > Recent) across all devices for this book
    const progress = id ? resolveProgress(progressMap[id]) : null;

    // OPTIMIZATION: Memoize the single book result
    return useMemo(() => {
        if (!book) return null;

        const hasCoverBlob = staticMeta?.coverBlob instanceof Blob;
        const readingListEntry = book.sourceFilename ? readingListEntries[book.sourceFilename] : undefined;
        const progressPercentage = progress?.percentage || readingListEntry?.percentage || 0;

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
            progress: progressPercentage,
            currentCfi: progress?.currentCfi || undefined
        };
    }, [book, staticMeta, offloadedBookIds, progress, readingListEntries]);
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
