import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserInventoryItem } from '../types/db';

interface InventoryState {
    /**
     * Map of user inventory (books) keyed by bookId.
     */
    books: Record<string, UserInventoryItem>;

    upsertBook: (book: UserInventoryItem) => void;
    removeBook: (bookId: string) => void;
}

export const useInventoryStore = create<InventoryState>()(
    yjs(
        yDoc,
        'inventory',
        (set) => ({
            books: {},

            upsertBook: (book: UserInventoryItem) =>
                set((state: InventoryState) => ({
                    books: {
                        ...state.books,
                        [book.bookId]: book,
                    },
                })),

            removeBook: (bookId: string) =>
                set((state: InventoryState) => {
                    const newBooks = { ...state.books };
                    delete newBooks[bookId];
                    return { books: newBooks };
                }),
        })
    )
);


