import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
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
        (set) => ({
            entries: {},

            upsertEntry: (entry: ReadingListEntry) =>
                set((state: ReadingListState) => ({
                    entries: {
                        ...state.entries,
                        [entry.filename]: entry,
                    },
                })),

            removeEntry: (filename: string) =>
                set((state: ReadingListState) => {
                    const newEntries = { ...state.entries };
                    delete newEntries[filename];
                    return { entries: newEntries };
                }),
        })
    )
);


