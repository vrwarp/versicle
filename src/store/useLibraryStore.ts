import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dbService } from '../db/DBService';
import type { BookMetadata, UserInventoryItem } from '../types/db';
import { StorageFullError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { processBatchImport } from '../lib/batch-ingestion';
import { useInventoryStore } from './useInventoryStore';
import { useReadingListStore } from './useReadingListStore';

export type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * State interface for the Library UI store.
 * Handles transient state (importing, views) and coordinates actions.
 */
interface LibraryUIState {
  isImporting: boolean;
  importProgress: number;
  importStatus: string;
  uploadProgress: number;
  uploadStatus: string;
  error: string | null;
  viewMode: 'grid' | 'list';
  sortOrder: SortOption;

  setViewMode: (mode: 'grid' | 'list') => void;
  setSortOrder: (sort: SortOption) => void;

  addBook: (file: File) => Promise<void>;
  addBooks: (files: File[]) => Promise<void>;
  removeBook: (id: string) => Promise<void>;

  offloadBook: (id: string) => Promise<void>;
  restoreBook: (id: string, file: File) => Promise<void>;

  // Legacy fetchBooks to satisfy imports, though it might do nothing now or trigger a sync check
  fetchBooks: () => Promise<void>;
}

const mapMetadataToInventory = (metadata: BookMetadata): UserInventoryItem => ({
  bookId: metadata.id,
  addedAt: metadata.addedAt,
  sourceFilename: metadata.filename,
  tags: [],
  status: 'unread',
  lastInteraction: Date.now(),
  rating: 0,
  customTitle: metadata.title,
  customAuthor: metadata.author
});

export const useLibraryStore = create<LibraryUIState>()(
  persist(
    (set, get) => ({
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
        // No-op or trigger migration check?
        // The components should bind to useInventoryStore.books directly.
        // We can leave this empty to avoid breaking calls.
        return Promise.resolve();
      },

      addBook: async (file: File) => {
        set({
          isImporting: true,
          importProgress: 0,
          importStatus: 'Starting import...',
          error: null
        });
        try {
          const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

          const metadata = await dbService.addBook(file, {
            abbreviations: [],
            alwaysMerge: [],
            sentenceStarters,
            sanitizationEnabled
          }, (progress, message) => {
            set({ importProgress: progress, importStatus: message });
          });

          // Update Synced Stores
          const inventoryItem = mapMetadataToInventory(metadata);
          useInventoryStore.getState().upsertBook(inventoryItem);

          // Also update Reading List
          if (metadata.filename) {
            useReadingListStore.getState().upsertEntry({
              filename: metadata.filename,
              title: metadata.title,
              author: metadata.author,
              percentage: 0,
              lastUpdated: Date.now(),
              status: 'to-read'
            });
          }

          set({ isImporting: false, importProgress: 0, importStatus: '' });
        } catch (err) {
          console.error('Failed to import book:', err);
          let errorMessage = 'Failed to import book.';
          if (err instanceof StorageFullError) {
            errorMessage = 'Device storage full. Please delete some books.';
          }
          set({ error: errorMessage, isImporting: false });
          throw err;
        }
      },

      addBooks: async (files: File[]) => {
        set({
          isImporting: true,
          importProgress: 0,
          importStatus: 'Pending...',
          error: null
        });
        try {
          const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

          await processBatchImport(
            files,
            {
              ttsOptions: {
                abbreviations: [],
                alwaysMerge: [],
                sentenceStarters,
                sanitizationEnabled
              },
              onBookProcessed: (metadata) => {
                // Update Synced Stores per book
                const inventoryItem = mapMetadataToInventory(metadata);
                useInventoryStore.getState().upsertBook(inventoryItem);

                if (metadata.filename) {
                  useReadingListStore.getState().upsertEntry({
                    filename: metadata.filename,
                    title: metadata.title,
                    author: metadata.author,
                    percentage: 0,
                    lastUpdated: Date.now(),
                    status: 'to-read'
                  });
                }
              }
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
          set({
            error: 'Failed to import books.',
            isImporting: false
          });
          throw err;
        }
      },

      removeBook: async (id: string) => {
        try {
          useInventoryStore.getState().removeBook(id);
          await dbService.deleteBook(id);
        } catch (err) {
          console.error('Failed to remove book:', err);
          set({ error: 'Failed to remove book.' });
        }
      },

      offloadBook: async (id: string) => {
        await dbService.offloadBook(id);
      },

      restoreBook: async (id: string, file: File) => {
        set({ isImporting: true });
        try {
          await dbService.restoreBook(id, file);
          set({ isImporting: false });
        } catch (err) {
          set({ isImporting: false, error: 'Failed to restore' });
        }
      }
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
