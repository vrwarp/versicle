import { useMemo } from 'react';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore, isValidProgress, getMostRecentProgress } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
import type { AnnotationState } from './useAnnotationStore';
import type { UserProgress, UserAnnotation } from '~types/db';
import { getDeviceId } from '@lib/device-id';
import { generateMatchKey } from '@lib/entity-resolution';
import { coverUrl as buildCoverUrl } from '@data/covers';
import { useLibraryViewStore, ensureLibraryViewStarted } from './libraryViewStore';

export type { LibraryBook } from './libraryViewStore';

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
 * Returns all books with static metadata, progress and the reading-list
 * entry merged.
 *
 * Phase 7 (PR-L5): the render-time module-cache machinery that lived here
 * (`createModuleCache` + render-time fuzzy joins) is REPLACED by the derived
 * `libraryViewStore`, recomputed off-render on input-store subscription
 * deltas. This hook is now a plain subscription; reference stability and
 * the per-book memoization survive in the store (selectors.test.ts /
 * selectors.perf.test.ts pin both).
 */
export const useAllBooks = () => {
    ensureLibraryViewStarted();
    return useLibraryViewStore((state) => state.books);
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
            coverUrl: hasCoverBlob ? buildCoverUrl(book.bookId) : undefined,
            fileHash: staticMeta?.fileHash,
            fileSize: staticMeta?.fileSize,
            totalChars: staticMeta?.totalChars,
            version: staticMeta?.version || undefined,
            baseFontSize: staticMeta?.baseFontSize,
            baseLineHeight: staticMeta?.baseLineHeight,
            syntheticToc: staticMeta?.syntheticToc,
            useSyntheticToc: book.useSyntheticToc,

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
