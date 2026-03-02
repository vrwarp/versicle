import { useMemo, useRef, useEffect } from 'react';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore, isValidProgress, getMostRecentProgress } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
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
    const booksRaw = useBookStore(state => state.books);
    const staticMetadataRaw = useLibraryStore(state => state.staticMetadata);
    const offloadedBookIdsRaw = useLibraryStore(state => state.offloadedBookIds);

    // Memoize the defaults to prevent reference changes on every render when nullish
    const books = useMemo(() => booksRaw || {}, [booksRaw]);
    const staticMetadata = useMemo(() => staticMetadataRaw || {}, [staticMetadataRaw]);
    const offloadedBookIds = useMemo(() => offloadedBookIdsRaw || new Set(), [offloadedBookIdsRaw]);

    // Subscribe to progress changes (per-device structure)
    // Use let to handle potential undefined state during Yjs transients
    let progressMap = useReadingStateStore(state => state.progress);
    if (!progressMap) {
        // Fallback to empty object if progressMap is undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (progressMap as any) = {};
    }
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
    if (prevDepsRef.current.staticMetadata !== staticMetadata ||
        prevDepsRef.current.offloadedBookIds !== offloadedBookIds) {
        baseBookCacheRef.current = new WeakMap();
        prevDepsRef.current = { staticMetadata, offloadedBookIds };
    }

    const baseBooks = useMemo(() => {
        const booksObj = books || {};
        const staticMetadataObj = staticMetadata || {};
        const offloadedBookIdsSet = offloadedBookIds || new Set();

        return Object.values(booksObj).map(book => {
            // Check cache
            const cached = baseBookCacheRef.current.get(book);
            if (cached) return cached;

            if (!staticMetadataObj) {
                console.error('staticMetadata is undefined in useAllBooks');
            }
            if (!book) {
                console.error('book is undefined in useAllBooks iteration');
            }

            const hasCoverBlob = staticMetadataObj?.[book.bookId]?.coverBlob instanceof Blob;

            const newBaseBook = {
                ...book,
                // Merge static metadata if available, otherwise use Ghost Book snapshots
                id: book.bookId,  // Alias for backwards compatibility
                // Prioritize user overrides (Yjs) > Static/Legacy Metadata > Snapshot
                title: book.customTitle || staticMetadataObj[book.bookId]?.title || book.title,
                author: book.customAuthor || staticMetadataObj[book.bookId]?.author || book.author,
                coverBlob: staticMetadataObj[book.bookId]?.coverBlob || undefined,
                version: staticMetadataObj[book.bookId]?.version || undefined,
                // OPTIMIZATION: Use Service Worker route for covers instead of creating blob URLs.
                // This prevents memory leaks from unrevoked createObjectURL calls and avoids sync overhead.
                coverUrl: hasCoverBlob
                    ? `/__versicle__/covers/${book.bookId}`
                    : undefined,
                // Add other static fields for compatibility
                fileHash: staticMetadataObj[book.bookId]?.fileHash,
                fileSize: staticMetadataObj[book.bookId]?.fileSize,
                totalChars: staticMetadataObj[book.bookId]?.totalChars,

                // Derive offloaded status from local set
                isOffloaded: offloadedBookIdsSet.has(book.bookId),
            };

            baseBookCacheRef.current.set(book, newBaseBook);
            return newBaseBook;
        }).sort((a, b) => b.lastInteraction - a.lastInteraction);
    }, [books, staticMetadata, offloadedBookIds]);

    // OPTIMIZATION: Use a cache to maintain stable object references.
    // We only want to return a new object if the underlying data actually changed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousResultsRef = useRef<Record<string, { result: any, base: any, rawBookProgress: any, rawReadingListEntry: any }>>({});

    // OPTIMIZATION: Phase 2 - Progress Merge
    // This memo runs when 'progressMap' updates (frequently).
    // We iterate over baseBooks and merge the latest progress.
    // BOLT OPTIMIZATION: Use raw reference checks (rawBookProgress) BEFORE calculating derived progress.
    // This skips calling resolveProgress() (which involves localStorage access via getDeviceId) for unchanged books.
    const memoizedResult = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newCache: Record<string, { result: any, base: any, rawBookProgress: any, rawReadingListEntry: any }> = {};

        const cache = previousResultsRef.current;

        const result = baseBooks.map(book => {
            const rawBookProgress = progressMap[book.id];
            const rawReadingListEntry = book.sourceFilename ? readingListEntries[book.sourceFilename] : undefined;

            // Check cache for reuse
            const prev = cache[book.id];

            // Reuse if:
            // 1. Previous entry exists
            // 2. Base book object is referentially identical (Phase 1 didn't change it)
            // 3. Raw input references are identical (avoiding expensive resolveProgress)
            if (prev &&
                prev.base === book &&
                prev.rawBookProgress === rawBookProgress &&
                prev.rawReadingListEntry === rawReadingListEntry
            ) {
                newCache[book.id] = prev;
                return prev.result;
            }

            // Cache Miss: Calculate derived values
            // This involves resolveProgress which calls getDeviceId -> localStorage.getItem (slow)
            const bookProgress = resolveProgress(rawBookProgress);
            const progress = bookProgress?.percentage || rawReadingListEntry?.percentage || 0;
            const currentCfi = bookProgress?.currentCfi || undefined;
            const lastRead = bookProgress?.lastRead || rawReadingListEntry?.lastUpdated || 0;

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
                rawBookProgress,
                rawReadingListEntry
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
    // OPTIMIZATION: Use fine-grained selectors to avoid re-rendering when other books change
    const book = useBookStore(state => id && state.books ? state.books[id] : null);

    const staticMeta = useLibraryStore(state => id && state.staticMetadata ? state.staticMetadata[id] : null);

    // Set.has is safe to call even if the set is empty, but we must handle null offloadedBookIds
    const isOffloaded = useLibraryStore(state => id && state.offloadedBookIds ? state.offloadedBookIds.has(id) : false);

    // Subscribe to progress changes ONLY for this specific book
    const bookProgressMap = useReadingStateStore(state => id && state.progress ? state.progress[id] : undefined);

    // Only subscribe to the specific reading list entry if we have a source filename
    const sourceFilename = book?.sourceFilename;
    const readingListEntry = useReadingListStore(state => sourceFilename && state.entries ? state.entries[sourceFilename] : undefined);

    // Get resolved progress (Local > Recent) across all devices for this book
    const progress = id ? resolveProgress(bookProgressMap) : null;

    // OPTIMIZATION: Memoize the single book result
    return useMemo(() => {
        if (!book) return null;

        const hasCoverBlob = staticMeta?.coverBlob instanceof Blob;
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

            isOffloaded,

            // Merge progress (max across all devices)
            progress: progressPercentage,
            currentCfi: progress?.currentCfi || undefined
        };
    }, [book, staticMeta, isOffloaded, progress, readingListEntry]);
};

/**
 * Returns the ID of the most recently read book.
 *
 * OPTIMIZATION: Efficiently scans the progress map to find the book with the latest timestamp.
 * This avoids iterating over the entire book library or creating large intermediate arrays.
 *
 * BOLT OPTIMIZATION: Uses `useLocalHistoryStore` (persisted local state) to avoid
 * iterating the `progressMap` on every page turn. Also uses conditional subscription
 * to avoid re-rendering when `progressMap` updates if a local ID is already found.
 */
export const useLastReadBookId = () => {
    const localId = useLocalHistoryStore(state => state.lastReadBookId);

    // Only subscribe to progressMap if localId is missing (first run or reset)
    // If localId is present, we return null for progressMap to avoid re-rendering when progress changes.
    // This is critical for performance during reading, as progressMap updates on every page turn.
    const progressMap = useReadingStateStore(state => !localId ? state.progress : null);

    return useMemo(() => {
        if (localId) return localId;
        if (!progressMap) return null;

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
    }, [localId, progressMap]);
};

/**
 * Returns the most recently read book with metadata merged.
 * Uses useLastReadBookId and useBook to avoid full library iteration.
 */
export const useLastReadBook = () => {
    const id = useLastReadBookId();
    return useBook(id);
};
