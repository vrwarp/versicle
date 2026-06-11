import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { ReadingListEntry } from '~types/db';

/** Replication declaration (aggregated by src/store/registry.ts). */
export const READING_LIST_STORE_DEF: SyncedStoreDef<'entries'> = {
    name: 'reading-list',
    syncedKeys: ['entries'],
    hydration: 'replace',
    scopedDiff: false,
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
                entries: { ...(state.entries || {}), [entry.filename]: entry }
            })),

            removeEntry: (filename) => set((state) => {
                const currentEntries = state.entries || {};
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [filename]: _removed, ...remain } = currentEntries;
                return { entries: remain };
            }),

            updateEntry: (filename, updates) => set((state) => {
                const currentEntries = state.entries || {};
                const existing = currentEntries[filename];
                if (!existing) return state;
                return {
                    entries: {
                        ...currentEntries,
                        [filename]: { ...existing, ...updates }
                    }
                };
            }),

            upsertEntry: (entry) => set((state) => ({
                entries: { ...(state.entries || {}), [entry.filename]: entry }
            }))
        })
    )
);
