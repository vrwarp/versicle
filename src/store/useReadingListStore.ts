import { create } from 'zustand';
import { yjs } from './middleware/yjs';
import { yDoc } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';

// We define the state structure to include both data and actions.
// The middleware will skip function properties.
interface ReadingListState {
  // We flatten the map: key is filename, value is Entry.
  // Wait, if we put actions at root, they might conflict with filenames?
  // Filenames are strings. Actions are specific keys.
  // It's safer to nest data if we want actions in the same store.
  // BUT my middleware expects the root to be the map.

  // Alternative: The store IS the map (Record<string, Entry>).
  // And we use a separate hook or just `setState` for actions?
  // Or we modify middleware to support `state.entries`?

  // My middleware supports `state` = map.
  // So I can't put actions in it easily unless I ensure no key collisions.
  // Filenames *could* be "upsertEntry". Unlikely but possible.

  // Better approach for `useReadingListStore`:
  // The store holds the data.
  // We export standalone actions or use `useReadingListStore.setState`.
}

// Data Store
export type ReadingListData = Record<string, ReadingListEntry>;

export const useReadingListSyncStore = create<ReadingListData>()(
  yjs(
    yDoc,
    'reading_list',
    () => ({})
  )
);

// Facade Hook with Actions
export const useReadingListStore = () => {
  const entries = useReadingListSyncStore();

  return {
    entries,
    upsertEntry: (entry: ReadingListEntry) => {
      useReadingListSyncStore.setState({ [entry.filename]: entry });
    },
    removeEntry: (filename: string) => {
      // To delete, we need to know how my middleware handles it.
      // My middleware: if val is undefined, delete.
      useReadingListSyncStore.setState({ [filename]: undefined as unknown as ReadingListEntry });
    }
  };
};
