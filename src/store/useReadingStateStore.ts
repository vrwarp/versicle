import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SyncOrchestrator } from '../lib/sync/SyncOrchestrator';

interface ReadingState {
    currentBookId: string | null;
    /** Current Canonical Fragment Identifier (CFI) representing the reading position. */
    currentCfi: string | null;
    /** Reading progress percentage (0-100). */
    progress: number;

    setCurrentBookId: (id: string | null) => void;

    /**
     * Updates the current reading location.
     * @param cfi - The new CFI location.
     * @param progress - The new progress percentage.
     */
    updateLocation: (cfi: string, progress: number) => void;

    reset: () => void;
}

export const useReadingStateStore = create<ReadingState>()(
    persist(
        (set) => ({
            currentBookId: null,
            currentCfi: null,
            progress: 0,

            setCurrentBookId: (id) => set({ currentBookId: id }),

            updateLocation: (cfi, progress) => {
                set({ currentCfi: cfi, progress });
                // Trigger sync whenever location updates
                SyncOrchestrator.get()?.scheduleSync();
            },

            reset: () => set({
                currentBookId: null,
                currentCfi: null,
                progress: 0
            })
        }),
        {
            name: 'reading-state',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                currentBookId: state.currentBookId, // In Phase 0 we persist this here. In Yjs it might be different.
                currentCfi: state.currentCfi,
                progress: state.progress
            }),
        }
    )
);
