import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';

interface QueryHistoryItem {
  query: string;
  lastUsedAt: number;
  isSaved: boolean;
}

export const SEARCH_HISTORY_STORE_DEF: SyncedStoreDef<'recentQueries' | 'savedQueries'> = {
  name: 'searchHistory',
  syncedKeys: ['recentQueries', 'savedQueries'],
  hydration: 'merge-defaults',
  scopedDiff: false,
};

interface SearchHistoryState {
  recentQueries: QueryHistoryItem[];
  savedQueries: QueryHistoryItem[];

  addQuery: (query: string) => void;
  toggleSaved: (query: string) => void;
  deleteQuery: (query: string) => void;
  clearHistory: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>()(
  defineSyncedStore(
    SEARCH_HISTORY_STORE_DEF,
    (set) => ({
      recentQueries: [],
      savedQueries: [],

      addQuery: (queryText) => set((state) => {
        const trimmed = queryText.trim();
        if (!trimmed) return state;

        const now = Date.now();

        // 1. If in savedQueries, update timestamp
        const savedIndex = state.savedQueries.findIndex((q) => q.query === trimmed);
        if (savedIndex !== -1) {
          const updatedSaved = [...state.savedQueries];
          updatedSaved[savedIndex] = { ...updatedSaved[savedIndex], lastUsedAt: now };
          return { savedQueries: updatedSaved };
        }

        // 2. Otherwise update or add to recentQueries
        let updatedRecent = state.recentQueries.filter((q) => q.query !== trimmed);
        updatedRecent.unshift({ query: trimmed, lastUsedAt: now, isSaved: false });

        // Cap at 20 recent items
        if (updatedRecent.length > 20) {
          updatedRecent = updatedRecent.slice(0, 20);
        }

        return { recentQueries: updatedRecent };
      }),

      toggleSaved: (queryText) => set((state) => {
        const trimmed = queryText.trim();
        if (!trimmed) return state;

        const now = Date.now();
        const savedIndex = state.savedQueries.findIndex((q) => q.query === trimmed);

        if (savedIndex !== -1) {
          // Unsave: remove from savedQueries, add to recentQueries
          const item = state.savedQueries[savedIndex];
          const updatedSaved = state.savedQueries.filter((q) => q.query !== trimmed);

          let updatedRecent = state.recentQueries.filter((q) => q.query !== trimmed);
          updatedRecent.unshift({ ...item, isSaved: false, lastUsedAt: now });
          if (updatedRecent.length > 20) {
            updatedRecent = updatedRecent.slice(0, 20);
          }

          return {
            savedQueries: updatedSaved,
            recentQueries: updatedRecent,
          };
        } else {
          // Save: find in recentQueries (or create new), add to savedQueries
          const recentIndex = state.recentQueries.findIndex((q) => q.query === trimmed);
          const item = recentIndex !== -1
            ? state.recentQueries[recentIndex]
            : { query: trimmed, lastUsedAt: now, isSaved: false };

          const updatedRecent = state.recentQueries.filter((q) => q.query !== trimmed);
          const updatedSaved = [...state.savedQueries];
          updatedSaved.unshift({ ...item, isSaved: true, lastUsedAt: now });

          return {
            recentQueries: updatedRecent,
            savedQueries: updatedSaved,
          };
        }
      }),

      deleteQuery: (queryText) => set((state) => {
        const trimmed = queryText.trim();
        return {
          recentQueries: state.recentQueries.filter((q) => q.query !== trimmed),
          savedQueries: state.savedQueries.filter((q) => q.query !== trimmed),
        };
      }),

      clearHistory: () => set({ recentQueries: [] }),
    })
  )
);
