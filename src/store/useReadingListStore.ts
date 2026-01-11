import { create } from 'zustand';
import { yjsMiddleware } from './middleware/yjs';
import { yDoc } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';

interface ReadingListState {
  entries: Record<string, ReadingListEntry>;

  upsertEntry: (entry: ReadingListEntry) => void;
  removeEntry: (filename: string) => void;
  getEntry: (filename: string) => ReadingListEntry | undefined;
}

/**
 * Zustand store for managing the persistent reading history (Shadow Inventory).
 * Keyed by filename.
 */
export const useReadingListStore = create<ReadingListState>()(
  yjsMiddleware(yDoc, 'reading_list', (set, get) => ({
    entries: {},

    upsertEntry: (entry: ReadingListEntry) => {
      set((state) => {
        state.entries[entry.filename] = entry;
      });
    },

    removeEntry: (filename: string) => {
      set((state) => {
        delete state.entries[filename];
      });
    },

    getEntry: (filename: string) => {
      return get().entries[filename];
    },
  }))
);
