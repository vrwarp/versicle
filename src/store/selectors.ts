import { useMemo } from 'react';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore, isValidProgress, getMostRecentProgress } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
import type { AnnotationState } from './useAnnotationStore';
import type { UserProgress, UserInventoryItem, UserAnnotation } from '../types/db';
import { getDeviceId } from '../lib/device-id';
import { generateMatchKey } from '../lib/entity-resolution';

// Module-level caches for useAllBooks to avoid strict-mode ref mutation issues
// Using a function cache prevents React ESLint from tracking mutations.
const createModuleCache = () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseBookCache: new WeakMap<UserInventoryItem, any>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseBooks: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastDeps: { books: null, staticMetadata: null, offloadedBookIds: null } as { books: any, staticMetadata: any, offloadedBookIds: any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previousResultsCache: {} as Record<string, { result: any, base: any, rawBookProgress: any, rawReadingListEntry: any }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readingListMatchDeps: { readingListEntries: null } as { readingListEntries: any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readingListMatchMap: new Map<string, any>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastPhase2Deps: { baseBooks: null, progressMap: null, readingListEntries: null, readingListMatchMap: null } as { baseBooks: any, progressMap: any, readingListEntries: any, readingListMatchMap: any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    memoizedResult: { books: [], cache: {} } as { books: any[], cache: any }
});
const moduleCache = createModuleCache();

/**
 * Resolves the progress for a book using the "Local Priority > Global Recent" strategy.
 * Matches the logic in useReadingStateStore.getProgress().
 */
function resolveProgress(bookProgress: Record<string, UserProgress> | undefined, deviceId: string): UserProgress | null {
    if (!bookProgress) return null;

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
    const progressMapRaw = useReadingStateStore(state => state.progress);
    // OPTIMIZATION: Memoize progressMap fallback to prevent reference changes on every render
    // which would otherwise break downstream useMemo dependency arrays.
    const progressMap = useMemo(() => progressMapRaw || {}, [progressMapRaw]);

    const readingListEntriesRaw = useReadingListStore(state => state.entries);
    const readingListEntries = useMemo(() => readingListEntriesRaw || {}, [readingListEntriesRaw]);

    // OPTIMIZATION: Phase 1 - Base Books
    // Memoize the "static" transformation of books (merging inventory + library metadata).
    // This depends only on 'books', 'staticMetadata', and 'offloadedBookIds', which change rarely.
    // It does NOT depend on 'progressMap', which changes frequently (on every page turn).

    // BOLT OPTIMIZATION / CONCURRENT SAFETY:
    // We use module-level variables for caching instead of `useRef` inside the hook.
    // Mutating `useRef.current` inside the render body violates React's pure render rules
    // and causes issues in Concurrent Mode. We also cannot use `useMemo` because React
    // makes no strict semantic guarantees about retaining `useMemo` caches; if React
    // throws the cache away to save memory, it breaks referential equality of our output array,
    // triggering massive cascading Yjs and UI re-renders.
    // By keeping the caches at the module level, we guarantee strict referential equality
    // for `baseBooks` without mutating hook refs during render.

    const needsRebuildPhase1 = moduleCache.lastDeps.books !== books ||
        moduleCache.lastDeps.staticMetadata !== staticMetadata ||
        moduleCache.lastDeps.offloadedBookIds !== offloadedBookIds;

    if (needsRebuildPhase1) {
        if (
            moduleCache.lastDeps.staticMetadata !== staticMetadata ||
            moduleCache.lastDeps.offloadedBookIds !== offloadedBookIds
        ) {
            // eslint-disable-next-line react-hooks/immutability
            moduleCache.baseBookCache = new WeakMap();
        }

        const booksObj = books || {};
        const staticMetadataObj = staticMetadata || {};
        const offloadedBookIdsSet = offloadedBookIds || new Set();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any[] = [];
        for (const key in booksObj) {
            if (!Object.prototype.hasOwnProperty.call(booksObj, key)) continue;
            const book = booksObj[key];
            // Check cache
            const cached = moduleCache.baseBookCache.get(book);
            if (cached) {
                result.push(cached);
                continue;
            }

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

            moduleCache.baseBookCache.set(book, newBaseBook);
            result.push(newBaseBook);
        }

        // eslint-disable-next-line react-hooks/immutability
        moduleCache.baseBooks = result.sort((a, b) => b.lastInteraction - a.lastInteraction);
        // eslint-disable-next-line react-hooks/immutability
        moduleCache.lastDeps = { books, staticMetadata, offloadedBookIds };
    }

    const baseBooks = moduleCache.baseBooks;

    const previousResultsCache = moduleCache.previousResultsCache;

    // BOLT OPTIMIZATION: Pre-compute match keys for reading list entries to avoid O(N * M)
    // string parsing (generateMatchKey) inside the baseBooks.map fallback loop.
    // Memoized separately to prevent rebuilding the Map on every page turn (when progressMap updates).
    // We iterate using for...in to avoid the array allocation overhead of Object.values().

    const needsRebuildMatchMap = moduleCache.readingListMatchDeps.readingListEntries !== readingListEntries;
    if (needsRebuildMatchMap) {
        const map = new Map<string, typeof readingListEntries[string]>();
        for (const key in readingListEntries) {
            if (!Object.prototype.hasOwnProperty.call(readingListEntries, key)) continue;
            const entry = readingListEntries[key];
            const matchKey = generateMatchKey(entry.title, entry.author);
            if (matchKey) {
                map.set(matchKey, entry);
            }
        }
        // eslint-disable-next-line react-hooks/immutability
        moduleCache.readingListMatchMap = map;
        // eslint-disable-next-line react-hooks/immutability
        moduleCache.readingListMatchDeps = { readingListEntries };
    }
    const readingListMatchMap = moduleCache.readingListMatchMap;

    // OPTIMIZATION: Phase 2 - Progress Merge
    // This runs when 'progressMap' updates (frequently).
    // We iterate over baseBooks and merge the latest progress.
    // BOLT OPTIMIZATION: Use raw reference checks (rawBookProgress) BEFORE calculating derived progress.
    // This skips calling resolveProgress() (which involves localStorage access via getDeviceId) for unchanged books.

    const needsRebuildPhase2 = moduleCache.lastPhase2Deps.baseBooks !== baseBooks ||
        moduleCache.lastPhase2Deps.progressMap !== progressMap ||
        moduleCache.lastPhase2Deps.readingListEntries !== readingListEntries ||
        moduleCache.lastPhase2Deps.readingListMatchMap !== readingListMatchMap;

    if (needsRebuildPhase2) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newCache: Record<string, { result: any, base: any, rawBookProgress: any, rawReadingListEntry: any }> = {};

        const cache = previousResultsCache;

        const currentDeviceId = getDeviceId();

        const result = baseBooks.map(book => {
            const rawBookProgress = progressMap[book.id];
            // Lookup by exact filename first
            let rawReadingListEntry = book.sourceFilename ? readingListEntries[book.sourceFilename] : undefined;

            // Fallback: If missing, try matching by normalized title+author
            if (!rawReadingListEntry && (book.title || book.author)) {
                const bookKey = generateMatchKey(book.title || '', book.author || '');

                if (bookKey) {
                    rawReadingListEntry = readingListMatchMap.get(bookKey);
                }
            }

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
            const bookProgress = resolveProgress(rawBookProgress, currentDeviceId);
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
                lastRead: lastRead,
                allProgress: rawBookProgress
            };

            newCache[book.id] = {
                result: newBook,
                base: book,
                rawBookProgress,
                rawReadingListEntry
            };

            return newBook;
        });

        // eslint-disable-next-line react-hooks/immutability
        moduleCache.memoizedResult = { books: result, cache: newCache };
        // eslint-disable-next-line react-hooks/immutability
        moduleCache.lastPhase2Deps = { baseBooks, progressMap, readingListEntries, readingListMatchMap };
        // eslint-disable-next-line react-hooks/immutability
        moduleCache.previousResultsCache = newCache;
    }

    const memoizedResult = moduleCache.memoizedResult;

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

    // Get reading list entry (with fallback)
    const sourceFilename = book?.sourceFilename;

    // BOLT OPTIMIZATION: Combine sourceFilename and fallback lookups into a single selector.
    // This avoids subscribing to the entire `state.entries` object, preventing unnecessary
    // re-renders of the component whenever *any* reading list entry is updated.
    const readingListEntry = useReadingListStore(state => {
        if (!state.entries) return undefined;
        if (sourceFilename && state.entries[sourceFilename]) {
            return state.entries[sourceFilename];
        }
        if (book?.title || book?.author) {
            const bookKey = generateMatchKey(book.title || '', book.author || '');
            if (bookKey) {
                for (const key in state.entries) {
                    const entry = state.entries[key];
                    if (generateMatchKey(entry.title, entry.author) === bookKey) {
                        return entry;
                    }
                }
            }
        }
        return undefined;
    });

    // Get resolved progress (Local > Recent) across all devices for this book
    const progress = useMemo(() => {
        if (!id) return null;
        return resolveProgress(bookProgressMap, getDeviceId());
    }, [id, bookProgressMap]);

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

/**
 * Returns all pending audio bookmarks across all books.
 */
export const selectPendingAudioBookmarks = (state: AnnotationState): UserAnnotation[] => {
    return Object.values(state.annotations).filter(a => a.type === 'audio-bookmark');
};
