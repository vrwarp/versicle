import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserProgress } from '../types/db';

/**
 * Reading state store.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * - `progress` (Record): Synced to yDoc.getMap('progress'), keyed by bookId
 * - `currentBookId`: Transient (device-specific, not synced)
 * - Actions (functions): Not synced, local-only
 */
interface ReadingState {
    // === SYNCED STATE (persisted to Yjs) ===
    /** Map of reading progress keyed by bookId. */
    progress: Record<string, UserProgress>;

    // === TRANSIENT STATE (local-only, not synced) ===
    /** The currently active book on this device. */
    currentBookId: string | null;

    // === ACTIONS (not synced to Yjs) ===
    /**
     * Sets the currently active book.
     * @param id - The book ID, or null to clear.
     */
    setCurrentBookId: (id: string | null) => void;

    /**
     * Updates the reading location for a book.
     * @param bookId - The book ID.
     * @param cfi - The new CFI location.
     * @param percentage - The new progress percentage (0-1).
     */
    updateLocation: (bookId: string, cfi: string, percentage: number) => void;

    /**
     * Gets the progress for a specific book.
     * @param bookId - The book ID.
     * @returns The progress object, or null if not found.
     */
    getProgress: (bookId: string) => UserProgress | null;

    /**
     * Resets all state (used for testing/debugging).
     */
    reset: () => void;
}

/**
 * Zustand store for reading progress and state.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useReadingStateStore = create<ReadingState>()(
    yjs(
        yDoc,
        'progress',
        (set, get) => ({
            // Synced state
            progress: {},

            // Transient state
            currentBookId: null,

            // Actions
            setCurrentBookId: (id) => set({ currentBookId: id }),

            updateLocation: (bookId, cfi, percentage) => {
                set((state) => ({
                    progress: {
                        ...state.progress,
                        [bookId]: {
                            bookId,
                            currentCfi: cfi,
                            percentage,
                            lastRead: Date.now(),
                            completedRanges: state.progress[bookId]?.completedRanges || []
                        }
                    }
                }));
            },

            getProgress: (bookId) => {
                const { progress } = get();
                return progress[bookId] || null;
            },

            reset: () => set({
                progress: {},
                currentBookId: null
            })
        })
    )
);

/**
 * Hook to get progress for a specific book.
 * @param bookId - The book ID, or null.
 * @returns The progress object, or null if not found.
 */
export const useBookProgress = (bookId: string | null) => {
    return useReadingStateStore(state =>
        bookId ? state.progress[bookId] || null : null
    );
};
