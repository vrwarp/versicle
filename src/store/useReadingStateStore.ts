import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserProgress } from '../types/db';
import { useLibraryStore, useBookStore } from './useLibraryStore';
import { useReadingListStore } from './useReadingListStore';
import { getDeviceId } from '../lib/device-id';
import { mergeCfiRanges } from '../lib/cfi-utils';

/**
 * Per-device progress structure.
 * Maps bookId -> deviceId -> UserProgress
 * 
 * This allows each device to track its own reading position,
 * and the selector aggregates to return the max progress.
 */
type PerDeviceProgress = Record<string, Record<string, UserProgress>>;

/**
 * Reading state store.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * - `progress` (Record): Synced to yDoc.getMap('progress'), keyed by bookId then deviceId
 * - Actions (functions): Not synced, local-only
 */
interface ReadingState {
    // === SYNCED STATE (persisted to Yjs) ===
    /** Map of reading progress keyed by bookId, then deviceId. */
    progress: PerDeviceProgress;

    // === ACTIONS (not synced to Yjs) ===
    /**
     * Updates the reading location for a book on this device.
     * @param bookId - The book ID.
     * @param cfi - The new CFI location.
     * @param percentage - The new progress percentage (0-1).
     */
    updateLocation: (bookId: string, cfi: string, percentage: number) => void;

    /**
     * Adds a completed range to the progress, merging overlapping ranges.
     */
    addCompletedRange: (bookId: string, range: string) => void;

    /**
     * Updates the last played CFI position (TTS).
     */
    updatePlaybackPosition: (bookId: string, lastPlayedCfi: string) => void;

    /**
     * Updates the TTS queue position.
     */
    updateTTSProgress: (bookId: string, index: number, sectionIndex: number) => void;

    /**
     * Gets the progress for a specific book (aggregated across all devices).
     * Returns the entry with the highest percentage.
     * @param bookId - The book ID.
     * @returns The progress object with max percentage, or null if not found.
     */
    getProgress: (bookId: string) => UserProgress | null;

    /**
     * Resets all state (used for testing/debugging).
     */
    reset: () => void;
}

/**
 * Get the progress entry with the highest percentage for a book.
 * Aggregates across all devices and returns the max.
 */
const getMaxProgress = (bookProgress: Record<string, UserProgress> | undefined): UserProgress | null => {
    if (!bookProgress) return null;

    const entries = Object.values(bookProgress);
    if (entries.length === 0) return null;

    // Find the entry with the highest percentage
    return entries.reduce((max, current) => {
        if (!max) return current;
        return (current.percentage > max.percentage) ? current : max;
    }, null as UserProgress | null);
};

/**
 * Zustand store for reading progress and state.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useReadingStateStore = create<ReadingState>()(
    yjs(
        yDoc,
        'progress',
        (set, get) => ({
            // Synced state (per-device structure)
            progress: {},

            // Actions
            updateLocation: (bookId, cfi, percentage) => {
                const deviceId = getDeviceId();

                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existingDeviceProgress = bookProgress[deviceId];

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    bookId,
                                    currentCfi: cfi,
                                    percentage,
                                    lastRead: Date.now(),
                                    completedRanges: existingDeviceProgress?.completedRanges || []
                                }
                            }
                        }
                    };
                });

                // Sync to Reading List
                // We do this outside the set() to avoid side-effects during state calculation,
                // and because it affects a different store.
                const book = useBookStore.getState().books[bookId];
                if (book && book.sourceFilename) {
                    const { staticMetadata } = useLibraryStore.getState();
                    const meta = staticMetadata[bookId];

                    useReadingListStore.getState().upsertEntry({
                        filename: book.sourceFilename,
                        title: meta?.title || book.title || 'Unknown',
                        author: meta?.author || book.author || 'Unknown',
                        percentage,
                        lastUpdated: Date.now(),
                        status: percentage > 0.98 ? 'read' : 'currently-reading',
                        rating: book.rating
                    });
                }
            },

            addCompletedRange: (bookId, range) => {
                const deviceId = getDeviceId();
                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existing = bookProgress[deviceId] || {
                        bookId,
                        percentage: 0,
                        currentCfi: '',
                        lastRead: Date.now(),
                        completedRanges: []
                    };

                    const newRanges = mergeCfiRanges(existing.completedRanges || [], range);

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existing,
                                    completedRanges: newRanges,
                                    lastRead: Date.now()
                                }
                            }
                        }
                    };
                });
            },

            updatePlaybackPosition: (bookId, lastPlayedCfi) => {
                const deviceId = getDeviceId();
                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existing = bookProgress[deviceId] || {
                        bookId,
                        percentage: 0,
                        currentCfi: '',
                        lastRead: Date.now(),
                        completedRanges: []
                    };

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existing,
                                    lastPlayedCfi
                                }
                            }
                        }
                    };
                });
            },

            updateTTSProgress: (bookId, index, sectionIndex) => {
                const deviceId = getDeviceId();
                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existing = bookProgress[deviceId] || {
                        bookId,
                        percentage: 0,
                        currentCfi: '',
                        lastRead: Date.now(),
                        completedRanges: []
                    };

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existing,
                                    currentQueueIndex: index,
                                    currentSectionIndex: sectionIndex,
                                    lastRead: Date.now()
                                }
                            }
                        }
                    };
                });
            },

            getProgress: (bookId) => {
                const { progress } = get();
                return getMaxProgress(progress[bookId]);
            },

            reset: () => set({
                progress: {},
            })
        })
    )
);

/**
 * Hook to get progress for a specific book.
 * Returns the entry with the HIGHEST percentage across all devices.
 * @param bookId - The book ID, or null.
 * @returns The progress object with max percentage, or null if not found.
 */
export const useBookProgress = (bookId: string | null) => {
    return useReadingStateStore(state => {
        if (!bookId) return null;
        return getMaxProgress(state.progress[bookId]);
    });
};

/**
 * Hook to get the current device's progress for a book.
 * @param bookId - The book ID, or null.
 * @returns The current device's progress, or null if not found.
 */
export const useCurrentDeviceProgress = (bookId: string | null) => {
    const deviceId = getDeviceId();
    return useReadingStateStore(state => {
        if (!bookId) return null;
        return state.progress[bookId]?.[deviceId] || null;
    });
};
