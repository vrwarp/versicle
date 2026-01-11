import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';

interface ReadingListState {
    entries: Record<string, ReadingListEntry>;

    upsertEntry: (entry: ReadingListEntry) => void;
    removeEntry: (filename: string) => void;
}

export const useReadingListStore = create<ReadingListState>()(
    yjs(
        yDoc,
        'reading_list',
        (set, get) => ({
            entries: {},

            upsertEntry: (entry) =>
                set((state) => {
                    // Use filename as the key
                    state.entries[entry.filename] = entry;
                }),

            removeEntry: (filename) =>
                set((state) => {
                    delete state.entries[filename];
                }),
        })
    )
);
