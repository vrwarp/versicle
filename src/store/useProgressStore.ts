import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
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

            updateProgress: (bookId: string, percentage: number, cfi: string) =>
                set((state: ProgressState) => {
                    const current = state.progress[bookId];
                    const now = Date.now();
                    const newProgress = current
                        ? {
                            ...current,
                            percentage,
                            currentCfi: cfi,
                            lastRead: now,
                        }
                        : {
                            bookId,
                            percentage,
                            currentCfi: cfi,
                            lastRead: now,
                            completedRanges: [],
                        };

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: newProgress,
                        },
                    };
                }),
        })
    )
);

