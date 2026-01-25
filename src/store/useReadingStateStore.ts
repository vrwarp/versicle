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
     * Gets the progress for a specific book.
     * Strategy:
     * 1. Local Priority: If the current device has progress, return it (even if stale).
     * 2. Global Fallback: If no local progress, return the most recent from any device.
     * @param bookId - The book ID.
     * @returns The selected progress object, or null if not found.
     */
    getProgress: (bookId: string) => UserProgress | null;

    /**
     * Resets all state (used for testing/debugging).
     */
    reset: () => void;
}

const isValidProgress = (p: UserProgress | null | undefined): boolean => {
    return !!(p && p.percentage > 0.005); // > 0.5%
};

/**
 * Get the progress entry with the most recent timestamp for a book.
 * Aggregates across all devices and returns the one with the latest lastRead.
 */
const getMostRecentProgress = (bookProgress: Record<string, UserProgress> | undefined): UserProgress | null => {
    if (!bookProgress) return null;

    let mostRecent: UserProgress | null = null;
    for (const deviceId in bookProgress) {
        const current = bookProgress[deviceId];
        if (!isValidProgress(current)) continue;

        // If we don't have a current best, or if the current one is newer than the best found so far
        if (!mostRecent || current.lastRead > mostRecent.lastRead) {
            mostRecent = current;
        }
    }
    return mostRecent;
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
                const deviceId = getDeviceId();
                const bookProgress = progress[bookId];

                // 1. Try Local (Must be Valid)
                if (bookProgress && bookProgress[deviceId] && isValidProgress(bookProgress[deviceId])) {
                    return bookProgress[deviceId];
                }

                // 2. Fallback to Most Recent (Valid)
                const recent = getMostRecentProgress(bookProgress);
                if (recent) return recent;

                // 3. Final Fallback: Return Local (even if 0%) if exists, else null
                return bookProgress?.[deviceId] || null;
            },

            reset: () => set({
                progress: {},
            })
        })
    )
);

/**
 * Hook to get progress for a specific book.
 * Returns the entry with the MOST RECENT timestamp across all devices.
 * @param bookId - The book ID, or null.
 * @returns The progress object with max percentage, or null if not found.
 */
export const useBookProgress = (bookId: string | null) => {
    return useReadingStateStore(state => {
        if (!bookId) return null;

        // Use the selector logic which now includes local priority
        return state.getProgress(bookId);
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
