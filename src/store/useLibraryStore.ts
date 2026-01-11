import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dbService } from '../db/DBService';
import type { BookMetadata, UserInventoryItem } from '../types/db';
import { StorageFullError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { processBatchImport } from '../lib/batch-ingestion';
import { useInventoryStore } from './useInventoryStore'; // Synced Store

export type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * State interface for the Library store.
 */
interface LibraryState {
  /** List of book metadata currently in the library (Merged) */
  books: Record<string, UserInventoryItem>; // Exposing the Yjs record directly for now

  /** Loading & Process State */
  isLoading: boolean;
  isImporting: boolean;
  importProgress: number;
  importStatus: string;
  uploadProgress: number;
  uploadStatus: string;
  error: string | null;

  /** UI View State */
  viewMode: 'grid' | 'list';
  sortOrder: SortOption;

  /** Actions */
  setViewMode: (mode: 'grid' | 'list') => void;
  setSortOrder: (sort: SortOption) => void;
  fetchBooks: () => Promise<void>; // Deprecated but kept for compatibility
  addBook: (file: File) => Promise<void>;
  addBooks: (files: File[]) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  offloadBook: (id: string) => Promise<void>;
  restoreBook: (id: string, file: File) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      books: {}, // Initial state, will be subscribed
      isLoading: false,
      isImporting: false,
      importProgress: 0,
      importStatus: '',
      uploadProgress: 0,
      uploadStatus: '',
      error: null,
      viewMode: 'grid',
      sortOrder: 'last_read',

      setViewMode: (mode) => set({ viewMode: mode }),
      setSortOrder: (sort) => set({ sortOrder: sort }),

      fetchBooks: async () => {
          // No-op or trigger manual sync if needed
      },

      addBook: async (file: File) => {
        set({
            isImporting: true,
            importProgress: 0,
            importStatus: 'Starting import...',
            uploadProgress: 0,
            uploadStatus: '',
            error: null
        });
        try {
          const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

          // 1. Process via DBService
          const metadata = await dbService.addBook(file, {
              abbreviations: [],
              alwaysMerge: [],
              sentenceStarters,
              sanitizationEnabled
          }, (progress, message) => {
              set({ importProgress: progress, importStatus: message });
          });

          // 2. Write to Yjs via InventoryStore
          if (metadata) {
             useInventoryStore.setState({
                 [metadata.id]: {
                   bookId: metadata.id,
                   addedAt: metadata.addedAt,
                   sourceFilename: metadata.filename,
                   tags: [],
                   customTitle: metadata.title,
                   customAuthor: metadata.author,
                   status: 'unread',
                   lastInteraction: Date.now()
               }
             });
          }

          set({ isImporting: false, importProgress: 0, importStatus: '' });
        } catch (err) {
          console.error('Failed to import book:', err);
          let errorMessage = 'Failed to import book.';
          if (err instanceof StorageFullError) {
              errorMessage = 'Device storage full. Please delete some books.';
          }
          set({ error: errorMessage, isImporting: false, importProgress: 0, importStatus: '' });
          throw err;
        }
      },

      addBooks: async (files: File[]) => {
           set({
              isImporting: true,
              importProgress: 0,
              importStatus: 'Pending...',
              uploadProgress: 0,
              uploadStatus: 'Starting processing...',
              error: null
          });
          try {
              const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

              await processBatchImport(
                  files,
                  {
                      abbreviations: [],
                      alwaysMerge: [],
                      sentenceStarters,
                      sanitizationEnabled
                  },
                  (processed, total, filename) => {
                      const percent = Math.round((processed / total) * 100);
                      set({
                          importProgress: percent,
                          importStatus: `Importing ${processed + 1} of ${total}: ${filename}`
                      });
                  },
                  (percent, status) => {
                      set({
                          uploadProgress: percent,
                          uploadStatus: status
                      });
                  },
                  // Callback
                  (metadata) => {
                      if (metadata) {
                          useInventoryStore.setState({
                             [metadata.id]: {
                                   bookId: metadata.id,
                                   addedAt: metadata.addedAt,
                                   sourceFilename: metadata.filename,
                                   tags: [],
                                   customTitle: metadata.title,
                                   customAuthor: metadata.author,
                                   status: 'unread',
                                   lastInteraction: Date.now()
                               }
                          });
                      }
                  }
              );

              set({
                  isImporting: false,
                  importProgress: 0,
                  importStatus: '',
                  uploadProgress: 0,
                  uploadStatus: ''
              });
          } catch (err) {
              console.error('Failed to batch import books:', err);
              let errorMessage = 'Failed to import books.';
              if (err instanceof StorageFullError) {
                  errorMessage = 'Device storage full. Please delete some books.';
              }
              set({
                  error: errorMessage,
                  isImporting: false,
                  importProgress: 0,
                  importStatus: '',
                  uploadProgress: 0,
                  uploadStatus: ''
              });
              throw err;
          }
      },

      removeBook: async (id: string) => {
        try {
          // 1. Remove from Yjs
          // We use replace=true to ensure the key is actually removed from the state object
          useInventoryStore.setState((state) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { [id]: _removed, ...rest } = state;
              return rest;
          }, true);

          // 2. Clean up Static/Cache Stores
          await dbService.deleteBook(id);
        } catch (err) {
          console.error('Failed to remove book:', err);
          set({ error: 'Failed to remove book.' });
        }
      },

      offloadBook: async (id: string) => {
        try {
          await dbService.offloadBook(id);
          // Trigger re-render? Yjs doesn't change.
          // We might need a force update or just rely on component fetching static_resources status.
          // LibraryView fetches 'static_manifests' and checks resources.
          // We can force a fetch there.
          // For now, we assume LibraryView handles it.
        } catch (err) {
          console.error('Failed to offload book:', err);
          set({ error: 'Failed to offload book.' });
        }
      },

      restoreBook: async (id: string, file: File) => {
        set({ isImporting: true, error: null });
        try {
          await dbService.restoreBook(id, file);
          set({ isImporting: false });
        } catch (err) {
          console.error('Failed to restore book:', err);
          set({ error: err instanceof Error ? err.message : 'Failed to restore book.', isImporting: false });
        }
      },
    }),
    {
      name: 'library-ui-storage',
      partialize: (state) => ({
        viewMode: state.viewMode,
        sortOrder: state.sortOrder
      }),
    }
  )
);

// Subscription wiring: Sync InventoryStore -> LibraryStore
useInventoryStore.subscribe((inventory) => {
    useLibraryStore.setState({ books: inventory });
});
