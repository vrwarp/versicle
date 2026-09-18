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
        (set, get) => ({
            lastReadBookId: null,
            // perf(store): bail BEFORE set() on an unchanged id. The hot
            // writers (every page turn + every TTS sentence, via
            // useReadingStateStore) call this with the same id over and over;
            // zustand's persist middleware wraps the config `set` as
            // `set(...); setItem()` — setItem runs even when the inner set
            // short-circuits on Object.is, so a no-op write would still cost a
            // JSON.stringify + a synchronous localStorage.setItem.
            setLastReadBookId: (id) => {
                if (get().lastReadBookId === id) return;
                set({ lastReadBookId: id });
            },
        }),
        {
            name: 'local-history-storage',
        }
    )
);
