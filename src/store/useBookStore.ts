import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserInventoryItem } from '../types/db';

/**
 * State interface for the Book store (Synced).
 * 
 * This store handles ONLY the synced book inventory data.
 * It is wrapped with yjs() middleware to sync with other devices.
 */
interface BookState {
    // === SYNCED STATE (persisted to Yjs) ===
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
}

export const useBookStore = create<BookState>()(
    yjs(
        yDoc,
        'library', // Share name 'library' to match existing data structure for 'books'
        (set) => ({
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
                }))
        })
    )
);
