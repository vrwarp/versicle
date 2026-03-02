import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc, getYjsOptions } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';

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
                entries: { ...state.entries, [entry.filename]: entry }
            })),

            removeEntry: (filename) => set((state) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        }),
        getYjsOptions()
    )
);
