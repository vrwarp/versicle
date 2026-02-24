import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LocalHistoryState {
    /**
     * The ID of the book most recently read on this device.
     * Stored locally to avoid expensive O(N) iteration over the synced progress map.
     */
    lastReadBookId: string | null;

    /**
     * Updates the locally tracked last read book ID.
     * @param id - The book ID.
     */
    setLastReadBookId: (id: string) => void;
}

/**
 * Store for tracking local reading history metadata.
 * Optimized for performance to avoid iterating large synced structures.
 */
export const useLocalHistoryStore = create<LocalHistoryState>()(
    persist(
        (set) => ({
            lastReadBookId: null,
            setLastReadBookId: (id) => set({ lastReadBookId: id }),
        }),
        {
            name: 'local-history-storage',
        }
    )
);
