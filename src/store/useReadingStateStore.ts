import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { UserProgress, ReadingEventType, ReadingSession, ReadingListEntry } from '~types/user-data';
import { useLibraryStore, useBookStore } from './useLibraryStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
import { getDeviceId } from '@lib/device-id';
import { mergeCfiRanges } from '@kernel/cfi';

const MAX_READING_SESSIONS = 500;
const HISTORY_PRUNE_SIZE = 200;
const MERGE_TIME_WINDOW = 20 * 60 * 1000; // 20 minutes

/**
 * perf: structural equality for the CFI-range arrays. `mergeCfiRanges` ALWAYS
 * returns a fresh array, so a merge that changed nothing still handed the Yjs
 * scoped diff a new identity — and the diff Object.is-skips unchanged arrays
 * but DEEP-diffs new ones (toJSON + per-element compare, up to
 * MAX_READING_SESSIONS entries). Keeping the stored identity when the content
 * is unchanged turns that back into an Object.is skip.
 */
const sameCfiRanges = (a: string[], b: string[]): boolean =>
    a === b || (a.length === b.length && a.every((value, i) => value === b[i]));

/**
 * Mirror a book's progress into the reading-list projection.
 *
 * perf: the two callers run on EVERY page turn (and every TTS sentence).
 * `upsertEntry` spreads the whole entries map (O(M)) and opens a SECOND Yjs
 * transaction, and libraryViewStore subscribes to both stores — so an
 * unconditional upsert made every page turn recompute the library projection
 * twice. The write is now skipped while no user-visible field moved;
 * `percentage` is compared at DISPLAY precision (ReadingListDialog and the CSV
 * export both render `Math.round(percentage * 100)`), so the stored value may
 * trail by under half a percent until the next visible change.
 *
 * fix: the entry also carries the `bookId` FK (types/user-data.ts §D). The
 * previous whole-entry rebuild omitted it, so every page turn DROPPED the FK
 * the v8 linker wrote — which pushed libraryViewStore's `useBook` reading-list
 * join off its O(1) FK lookup and back onto the O(M) scans.
 */
function syncReadingListEntry(bookId: string, percentage: number, now: number): void {
    const book = useBookStore.getState().books?.[bookId];
    if (!book || !book.sourceFilename) return;

    const { staticMetadata } = useLibraryStore.getState();
    const meta = staticMetadata[bookId];

    const next: ReadingListEntry = {
        filename: book.sourceFilename,
        bookId,
        title: meta?.title || book.title || 'Unknown',
        author: meta?.author || book.author || 'Unknown',
        percentage,
        lastUpdated: now,
        status: percentage > 0.98 ? 'read' : 'currently-reading',
        rating: book.rating
    };

    const existing = useReadingListStore.getState().entries?.[next.filename];
    if (
        existing &&
        existing.bookId === next.bookId &&
        existing.title === next.title &&
        existing.author === next.author &&
        existing.status === next.status &&
        existing.rating === next.rating &&
        Math.round(existing.percentage * 100) === Math.round(next.percentage * 100)
    ) {
        return;
    }

    useReadingListStore.getState().upsertEntry(next);
}

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
/**
 * Represents a single update to the reading session history.
 */
type SessionUpdate = {
    range: string;
    type?: ReadingEventType;
    label?: string;
};

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
     * Also records a ReadingSession with type and optional label.
     */
    addCompletedRange: (bookId: string, range: string, type?: ReadingEventType, label?: string) => void;

    /**
     * Consolidates multiple updates into a single transaction.
     * Updates current location (cfi, percentage) and adds multiple history entries/ranges.
     */
    updateReadingSession: (
        bookId: string,
        currentCfi: string,
        percentage: number,
        updates: SessionUpdate[]
    ) => void;

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

export const isValidProgress = (p: UserProgress | null | undefined): boolean => {
    return !!(p && p.percentage > 0.005); // > 0.5%
};

/**
 * Get the progress entry with the most recent timestamp for a book.
 * Aggregates across all devices and returns the one with the latest lastRead.
 */
export const getMostRecentProgress = (bookProgress: Record<string, UserProgress> | undefined): UserProgress | null => {
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
 * Replication declaration (aggregated by src/store/registry.ts).
 * Flipped to merge-defaults + scopedDiff LAST (flip wave 5,
 * phase2-fork-surgery.md §2.6 #9): the hottest write path — every page turn
 * writes here — flipped only after the pattern was proven on the other
 * eight stores and verified against selectors.perf.test.ts. The only
 * deleted canary was the selectors.ts `progressMapRaw || {}` memo; the
 * per-book `state.progress[bookId] || {}` guards in the actions below are
 * SECOND-LEVEL guards for a legitimately absent book (census ▲5), not
 * hydration fallbacks — they stay.
 */
export const PROGRESS_STORE_DEF: SyncedStoreDef<'progress'> = {
    name: 'progress',
    syncedKeys: ['progress'],
    hydration: 'merge-defaults',
    scopedDiff: true,
};

/**
 * Zustand store for reading progress and state.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useReadingStateStore = create<ReadingState>()(
    defineSyncedStore(
        PROGRESS_STORE_DEF,
        (set, get) => ({
            // Synced state (per-device structure)
            progress: {},

            // Actions
            updateLocation: (bookId, cfi, percentage) => {
                const deviceId = getDeviceId();
                useLocalHistoryStore.getState().setLastReadBookId(bookId);

                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existingDeviceProgress = bookProgress[deviceId];

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existingDeviceProgress,
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
                syncReadingListEntry(bookId, percentage, Date.now());
            },

            addCompletedRange: (bookId, range, type = 'page', label) => {
                const deviceId = getDeviceId();
                useLocalHistoryStore.getState().setLastReadBookId(bookId);

                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existing = bookProgress[deviceId] || {
                        bookId,
                        percentage: 0,
                        currentCfi: '',
                        lastRead: Date.now(),
                        completedRanges: []
                    };

                    // Keep the stored identity when the merge was a no-op (the
                    // range is already covered) — see sameCfiRanges. The session
                    // list below is NOT lazily copied: this action always either
                    // merges into the last session or pushes a new one.
                    const baseRanges = existing.completedRanges || [];
                    const mergedRanges = mergeCfiRanges(baseRanges, range);
                    const newRanges = sameCfiRanges(mergedRanges, baseRanges) ? baseRanges : mergedRanges;

                    // Build updated sessions list
                    const now = Date.now();
                    const sessions = [...(existing.readingSessions || [])];
                    const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

                    let merged = false;

                    // Try to merge with last session if it's the same type, same section, and recent enough
                    if (lastSession && lastSession.type === type && lastSession.label === label) {
                        const timeDiff = now - lastSession.endTime;
                        if (timeDiff < MERGE_TIME_WINDOW) {
                            const currentRanges = lastSession.cfiRanges || [lastSession.cfiRange];
                            const mergedRanges = mergeCfiRanges(currentRanges, range);

                            sessions[sessions.length - 1] = {
                                ...lastSession,
                                cfiRange: mergedRanges[0],
                                cfiRanges: mergedRanges,
                                endTime: now
                            };
                            merged = true;
                        }
                    }

                    if (!merged) {
                        const newSession: ReadingSession = {
                            cfiRange: range,
                            cfiRanges: [range],
                            startTime: now,
                            endTime: now,
                            type,
                            ...(label ? { label } : {})
                        };
                        sessions.push(newSession);
                    }

                    // Cap at MAX_READING_SESSIONS
                    const trimmedSessions = sessions.length > MAX_READING_SESSIONS
                        ? sessions.slice(-(MAX_READING_SESSIONS - HISTORY_PRUNE_SIZE))
                        : sessions;

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existing,
                                    completedRanges: newRanges,
                                    readingSessions: trimmedSessions,
                                    lastRead: now
                                }
                            }
                        }
                    };
                });
            },

            updateReadingSession: (bookId, currentCfi, percentage, updates) => {
                const deviceId = getDeviceId();
                const now = Date.now();
                useLocalHistoryStore.getState().setLastReadBookId(bookId);

                set((state) => {
                    const bookProgress = state.progress[bookId] || {};
                    const existing = bookProgress[deviceId] || {
                        bookId,
                        percentage: 0,
                        currentCfi: '',
                        lastRead: now,
                        completedRanges: []
                    };

                    // 1. Merge all ranges — keeping the stored identity while the
                    // merges are no-ops (see sameCfiRanges).
                    const baseRanges = existing.completedRanges || [];
                    let newRanges = baseRanges;
                    updates.forEach(u => {
                        const merged = mergeCfiRanges(newRanges, u.range);
                        if (!sameCfiRanges(merged, newRanges)) newRanges = merged;
                    });

                    // 2. Append history sessions. The array is copied LAZILY: a
                    // pass that neither merges into the last session nor appends
                    // one (e.g. a location-only update carrying no `type`) keeps
                    // the stored array, so the Yjs diff can Object.is-skip a list
                    // that grows to MAX_READING_SESSIONS entries.
                    const baseSessions = existing.readingSessions || [];
                    let sessions = baseSessions;
                    const mutableSessions = (): ReadingSession[] => {
                        if (sessions === baseSessions) sessions = [...baseSessions];
                        return sessions;
                    };

                    updates.forEach(u => {
                        const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
                        let merged = false;

                        if (lastSession && lastSession.type === (u.type || 'page') && lastSession.label === u.label) {
                            const timeDiff = now - lastSession.endTime;
                            if (timeDiff < MERGE_TIME_WINDOW) {
                                const currentRanges = lastSession.cfiRanges || [lastSession.cfiRange];
                                const mergedRanges = mergeCfiRanges(currentRanges, u.range);

                                const target = mutableSessions();
                                target[target.length - 1] = {
                                    ...lastSession,
                                    cfiRange: mergedRanges[0],
                                    cfiRanges: mergedRanges,
                                    endTime: now
                                };
                                merged = true;
                            }
                        }

                        if (!merged && u.type) { // Only add to history if type is provided
                            mutableSessions().push({
                                cfiRange: u.range,
                                cfiRanges: [u.range],
                                startTime: now,
                                endTime: now,
                                type: u.type,
                                ...(u.label ? { label: u.label } : {})
                            });
                        }
                    });

                    // Cap at MAX_READING_SESSIONS
                    if (sessions.length > MAX_READING_SESSIONS) {
                        sessions = sessions.slice(-(MAX_READING_SESSIONS - HISTORY_PRUNE_SIZE));
                    }

                    return {
                        progress: {
                            ...state.progress,
                            [bookId]: {
                                ...bookProgress,
                                [deviceId]: {
                                    ...existing,
                                    bookId,
                                    currentCfi,
                                    percentage,
                                    completedRanges: newRanges,
                                    readingSessions: sessions,
                                    lastRead: now
                                }
                            }
                        }
                    };
                });

                syncReadingListEntry(bookId, percentage, now);
            },

            updatePlaybackPosition: (bookId, lastPlayedCfi) => {
                const deviceId = getDeviceId();
                useLocalHistoryStore.getState().setLastReadBookId(bookId);

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
                useLocalHistoryStore.getState().setLastReadBookId(bookId);

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
                // Handle potential transient undefined state from Yjs
                if (!progress) return null;

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
 * Applies the same priority logic as getProgress() — local device first (if valid),
 * then most-recent across all devices, then local as final fallback — but does so
 * entirely from the `state` selector argument so Zustand can track dependencies
 * reactively. (Calling state.getProgress() internally uses the store's `get()`
 * closure, which means the selector result doesn't change from Zustand's perspective
 * even when the underlying progress data changes.)
 */
export const useBookProgress = (bookId: string | null) => {
    const deviceId = getDeviceId();
    return useReadingStateStore(state => {
        if (!bookId) return null;
        const bookProgress = state.progress?.[bookId];
        if (!bookProgress) return null;

        // 1. Prefer current device if valid (> 0.5%)
        const local = bookProgress[deviceId];
        if (local && local.percentage > 0.005) return local;

        // 2. Fall back to most recent valid entry across all devices
        let mostRecent: UserProgress | null = null;
        for (const id in bookProgress) {
            const p = bookProgress[id];
            if (p && p.percentage > 0.005) {
                if (!mostRecent || p.lastRead > mostRecent.lastRead) {
                    mostRecent = p;
                }
            }
        }
        if (mostRecent) return mostRecent;

        // 3. Final fallback: local entry even if below threshold
        return local || null;
    });
};

/**
 * The resolved percentage for a book (same Local > Most-recent > Local
 * fallback as {@link useBookProgress}) as a plain NUMBER.
 *
 * perf: a progress entry is a fresh object on EVERY write, so subscribing to
 * it re-renders the consumer on writes that move nothing it displays — a TTS
 * queue tick, a playback-position save, a re-relocation to the same page. A
 * number is Object.is-comparable, so those writes stop at the selector.
 */
export const useBookPercentage = (bookId: string | null): number => {
    const deviceId = getDeviceId();
    return useReadingStateStore(state => {
        if (!bookId) return 0;
        const bookProgress = state.progress?.[bookId];
        if (!bookProgress) return 0;

        const local = bookProgress[deviceId];
        if (local && local.percentage > 0.005) return local.percentage;

        let mostRecent: UserProgress | null = null;
        for (const id in bookProgress) {
            const p = bookProgress[id];
            if (p && p.percentage > 0.005) {
                if (!mostRecent || p.lastRead > mostRecent.lastRead) mostRecent = p;
            }
        }
        if (mostRecent) return mostRecent.percentage;

        return local?.percentage || 0;
    });
};

/**
 * The CURRENT device's percentage for a book, as a number. Same rationale as
 * {@link useBookPercentage}.
 */
export const useCurrentDevicePercentage = (bookId: string | null): number => {
    const deviceId = getDeviceId();
    return useReadingStateStore(state => {
        if (!bookId) return 0;
        return state.progress?.[bookId]?.[deviceId]?.percentage || 0;
    });
};

// @ts-expect-error Exposing store for debugging
window.useReadingStateStore = useReadingStateStore;
