import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { UserInventoryItem } from '~types/user-data';

/**
 * Replication declaration (aggregated by src/store/registry.ts).
 * Y.Map 'library' — matches the existing data structure for 'books'.
 * Flipped to merge-defaults + scopedDiff in flip wave 4 (phase2-fork-surgery.md
 * §2.6 #8): the inventory — highest user-data criticality, flipped after the
 * pattern was proven on six stores. Its four `state.books || {}` fallbacks
 * (plus selectors.ts and the FirestoreSyncManager clean-client check) were
 * deleted as the flip canaries.
 */
export const LIBRARY_STORE_DEF: SyncedStoreDef<'books'> = {
    name: 'library',
    syncedKeys: ['books'],
    hydration: 'merge-defaults',
    scopedDiff: true,
};

/**
 * State interface for the Book store (Synced).
 * 
 * This store handles ONLY the synced book inventory data.
 * It is wrapped with yjs() middleware to sync with other devices.
 */
interface BookState {
    // === SYNCED STATE (persisted to Yjs) ===
    /**
     * Schema version marker (implicitly synced; the middleware's poison pill
     * and the migration coordinator's dual-write read/write it on this map).
     */
    __schemaVersion: number;
    /** Map of user inventory items (book metadata + user data), keyed by Book ID. */
    books: Record<string, UserInventoryItem>;

    // === ACTIONS ===
    /**
     * Sets the entire books map (internal use or bulk updates).
     */
    setBooks: (books: Record<string, UserInventoryItem>) => void;

    /**
     * Updates a specific book's inventory data.
     */
    updateBook: (id: string, updates: Partial<UserInventoryItem>) => void;

    /**
     * Removes a book from the syned inventory.
     */
    removeBook: (id: string) => void;

    /**
     * Adds a book to the synced inventory.
     */
    addBook: (book: UserInventoryItem) => void;

    /**
     * Adds multiple books to the synced inventory (Optimized for batch operations).
     */
    addBooks: (books: UserInventoryItem[]) => void;
}

export const useBookStore = create<BookState>()(
    defineSyncedStore(
        LIBRARY_STORE_DEF,
        (set) => ({
            __schemaVersion: 1, // Default for empty/new documents
            books: {},

            setBooks: (books) => set({ books }),

            updateBook: (id, updates) =>
                set((state) => {
                    if (!state.books[id]) return state;
                    return {
                        books: {
                            ...state.books,
                            [id]: { ...state.books[id], ...updates }
                        }
                    };
                }),

            removeBook: (id) =>
                set((state) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { [id]: removed, ...remain } = state.books;
                    return { books: remain };
                }),

            addBook: (book) =>
                set((state) => ({
                    books: {
                        ...state.books,
                        [book.bookId]: book
                    }
                })),

            addBooks: (newBooks) =>
                set((state) => {
                    const booksMap = newBooks.reduce((acc, book) => {
                        acc[book.bookId] = book;
                        return acc;
                    }, {} as Record<string, UserInventoryItem>);

                    return {
                        books: {
                            ...state.books,
                            ...booksMap
                        }
                    };
                })
        })
    )
);
