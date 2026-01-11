import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserProgress } from '../types/db';

interface ProgressState {
    /**
     * Map of user progress keyed by bookId.
     */
    progress: Record<string, UserProgress>;

    updateProgress: (bookId: string, percentage: number, cfi: string) => void;
}

export const useProgressStore = create<ProgressState>()(
    yjs(
        yDoc,
        'progress',
        (set) => ({
            progress: {},

            updateProgress: (bookId, percentage, cfi) =>
                set((state) => {
                    const current = state.progress[bookId];
                    const now = Date.now();
                    if (current) {
                        // Update if newer or further (logic can be refined)
                        // LWW handled by Yjs, but we want to update the fields.
                        state.progress[bookId] = {
                            ...current,
                            percentage,
                            currentCfi: cfi,
                            lastRead: now
                        };
                    } else {
                        state.progress[bookId] = {
                            bookId,
                            percentage,
                            currentCfi: cfi, // Updated to include required fields
                            lastRead: now,
                            completedRanges: []
                        };
                    }
                }),
        })
    )
);
