import { useLibraryStore } from './useLibraryStore';
import { useReadingStateStore } from './useReadingStateStore';

/**
 * Returns all books with static metadata merged.
 * Static metadata (cover, full title/author) is used if available,
 * otherwise falls back to Ghost Book metadata from Yjs inventory.
 */
export const useAllBooks = () => {
    const books = useLibraryStore(state => state.books);
    const staticMetadata = useLibraryStore(state => state.staticMetadata);
    const offloadedBookIds = useLibraryStore(state => state.offloadedBookIds);
    // Subscribe to progress changes
    const progressMap = useReadingStateStore(state => state.progress);

    return Object.values(books).map(book => ({
        ...book,
        // Merge static metadata if available, otherwise use Ghost Book snapshots
        id: book.bookId,  // Alias for backwards compatibility
        title: staticMetadata[book.bookId]?.title || book.title,
        author: staticMetadata[book.bookId]?.author || book.author,
        coverBlob: staticMetadata[book.bookId]?.coverBlob || undefined,
        version: staticMetadata[book.bookId]?.version || undefined,
        coverUrl: (staticMetadata[book.bookId]?.coverBlob instanceof Blob)
            ? URL.createObjectURL(staticMetadata[book.bookId]!.coverBlob!)
            : undefined,
        // Add other static fields for compatibility
        fileHash: staticMetadata[book.bookId]?.fileHash,
        fileSize: staticMetadata[book.bookId]?.fileSize,
        totalChars: staticMetadata[book.bookId]?.totalChars,

        // Derive offloaded status from local set
        isOffloaded: offloadedBookIds.has(book.bookId),
        // Merge progress from reading state store
        progress: progressMap[book.bookId]?.percentage || 0,
        currentCfi: progressMap[book.bookId]?.currentCfi || undefined
    })).sort((a, b) => b.lastInteraction - a.lastInteraction);
};

/**
 * Returns a single book by ID with static metadata merged.
 */
export const useBook = (id: string | null) => {
    const book = useLibraryStore(state => id ? state.books[id] : null);
    const staticMeta = useLibraryStore(state => id ? state.staticMetadata[id] : null);
    const offloadedBookIds = useLibraryStore(state => state.offloadedBookIds);
    const progress = useReadingStateStore(state => id ? state.progress[id] : null);

    if (!book) return null;

    return {
        ...book,
        id: book.bookId,  // Alias
        title: staticMeta?.title || book.title,
        author: staticMeta?.author || book.author,
        coverBlob: staticMeta?.coverBlob || null,
        coverUrl: (staticMeta?.coverBlob instanceof Blob) ? URL.createObjectURL(staticMeta.coverBlob!) : undefined,
        fileHash: staticMeta?.fileHash,
        fileSize: staticMeta?.fileSize,
        totalChars: staticMeta?.totalChars,
        version: staticMeta?.version || undefined,

        isOffloaded: offloadedBookIds.has(book.bookId),

        // Merge progress
        progress: progress?.percentage || 0,
        currentCfi: progress?.currentCfi || undefined
    };
};
