import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { ReadingListEntry } from '~types/user-data';

/**
 * Replication declaration (aggregated by src/store/registry.ts).
 * Flipped to merge-defaults + scopedDiff in flip wave 2 (phase2-fork-surgery.md
 * §2.6 #5): entries are re-upserted from progress updates — a self-healing
 * projection. Its four `state.entries || {}` fallbacks (plus the selectors.ts
 * one) were deleted as the flip canaries.
 */
export const READING_LIST_STORE_DEF: SyncedStoreDef<'entries'> = {
    name: 'reading-list',
    syncedKeys: ['entries'],
    hydration: 'merge-defaults',
    scopedDiff: true,
};

interface ReadingListState {
    entries: Record<string, ReadingListEntry>;

    addEntry: (entry: ReadingListEntry) => void;
    removeEntry: (filename: string) => void;
    updateEntry: (filename: string, updates: Partial<ReadingListEntry>) => void;
    upsertEntry: (entry: ReadingListEntry) => void;
}

export const useReadingListStore = create<ReadingListState>()(
    defineSyncedStore(
        READING_LIST_STORE_DEF,
        (set) => ({
            entries: {},

            addEntry: (entry) => set((state) => ({
                entries: { ...state.entries, [entry.filename]: entry }
            })),

            removeEntry: (filename) => set((state) => {
                const { [filename]: _removed, ...remain } = state.entries;
                return { entries: remain };
            }),

            updateEntry: (filename, updates) => set((state) => {
                const existing = state.entries[filename];
                if (!existing) return state;
                return {
                    entries: {
                        ...state.entries,
                        [filename]: { ...existing, ...updates }
                    }
                };
            }),

            upsertEntry: (entry) => set((state) => ({
                entries: { ...state.entries, [entry.filename]: entry }
            }))
        })
    )
);
