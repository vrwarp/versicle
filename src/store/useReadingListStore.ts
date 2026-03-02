import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc, getYjsOptions } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';
import { undoManager } from '../lib/undo-manager';

interface ReadingListState {
    entries: Record<string, ReadingListEntry>;

    addEntry: (entry: ReadingListEntry) => void;
    removeEntry: (filename: string) => void;
    updateEntry: (filename: string, updates: Partial<ReadingListEntry>) => void;
    upsertEntry: (entry: ReadingListEntry) => void;
}

export const useReadingListStore = create<ReadingListState>()(
    yjs(
        yDoc,
        'reading-list',
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
        }),
        getYjsOptions()
    )
);

undoManager.addTrackedOrigin(useReadingListStore);
