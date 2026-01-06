import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dbService } from '../db/DBService';
import { crdtService } from '../lib/crdt/CRDTService';
import { MigrationService } from '../lib/crdt/MigrationService';
import type { BookMetadata } from '../types/db';
import { StorageFullError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { processBatchImport } from '../lib/batch-ingestion';

export type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * State interface for the Library store.
 */
interface LibraryState {
  /** List of book metadata currently in the library. */
  books: BookMetadata[];
  /** Flag indicating if the library is currently loading. */
  isLoading: boolean;
  /** Flag indicating if the library is initialized (subscribed to CRDT). */
  initialized: boolean;
  /** Flag indicating if a book is currently being imported. */
  isImporting: boolean;
  /** Progress percentage of the current import (0-100). */
  importProgress: number;
  /** Status message of the current import. */
  importStatus: string;
  /** Progress percentage of the current upload/extraction (0-100). */
  uploadProgress: number;
  /** Status message of the current upload/extraction. */
  uploadStatus: string;
  /** Error message if an operation failed, or null. */
  error: string | null;
  /** The current view mode of the library. */
  viewMode: 'grid' | 'list';
  /** The current sort order of the library. */
  sortOrder: SortOption;
  /**
   * Sets the view mode of the library.
   * @param mode - The new view mode.
   */
  setViewMode: (mode: 'grid' | 'list') => void;
  /**
   * Sets the sort order of the library.
   * @param sort - The new sort order.
   */
  setSortOrder: (sort: SortOption) => void;
  /**
   * Initializes the library store (migrates data and subscribes to CRDT).
   */
  init: () => Promise<void>;
  /**
   * Imports a new EPUB file into the library.
   * @param file - The EPUB file to import.
   */
  addBook: (file: File) => Promise<void>;
  /**
   * Imports multiple files (EPUBs or ZIPs) into the library.
   * @param files - The array of files to import.
   */
  addBooks: (files: File[]) => Promise<void>;
  /**
   * Removes a book and its associated data (files, annotations) from the library.
   * @param id - The unique identifier of the book to remove.
   */
  removeBook: (id: string) => Promise<void>;

  /**
   * Offloads the binary file of a book to save space, retaining metadata.
   * @param id - The unique identifier of the book to offload.
   */
  offloadBook: (id: string) => Promise<void>;

  /**
   * Restores the binary file of an offloaded book.
   * @param id - The unique identifier of the book to restore.
   * @param file - The EPUB file to upload.
   */
  restoreBook: (id: string, file: File) => Promise<void>;
}

/**
 * Zustand store for managing the user's library of books.
 * Handles fetching, adding, and removing books from IndexedDB.
 */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      books: [],
      isLoading: false,
      initialized: false,
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

      init: async () => {
        if (get().initialized) return;

        set({ isLoading: true, error: null });
        try {
          const migration = new MigrationService(crdtService);
          await migration.migrateIfNeeded();

          // Subscribe to CRDT updates
          crdtService.books.observe(() => {
            set({ books: Array.from(crdtService.books.values()) as unknown as BookMetadata[] });
          });

          // Initial load
          set({
            books: Array.from(crdtService.books.values()) as unknown as BookMetadata[],
            isLoading: false,
            initialized: true
          });

        } catch (err) {
          console.error('Failed to init library:', err);
          set({ error: 'Failed to load library.', isLoading: false });
        }
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
          // Maximal Splitting: Ingest with empty abbreviations to maximize segments.
          // Merging will happen dynamically during playback.
          // 1. Process File & Metadata (Legacy DB for Binary + Backup)
          const bookId = await dbService.addBook(file, {
              abbreviations: [],
              alwaysMerge: [],
              sentenceStarters,
              sanitizationEnabled
          }, (progress, message) => {
              set({ importProgress: progress, importStatus: message });
          }) as unknown as string; // dbService.addBook returns Promise<string> but types are messing up?

          // 2. Sync Metadata to Yjs (Moral Layer)
          const metadata = await dbService.getBookMetadata(bookId);
          if (metadata) {
             crdtService.books.set(bookId, metadata as any);
          }

          set({ isImporting: false, importProgress: 0, importStatus: '' });
        } catch (err) {
          console.error('Failed to import book:', err);
          let errorMessage = 'Failed to import book.';
          if (err instanceof StorageFullError) {
              errorMessage = 'Device storage full. Please delete some books.';
          }
          set({ error: errorMessage, isImporting: false, importProgress: 0, importStatus: '' });
          throw err; // Re-throw so components can handle UI feedback (e.g. Toasts)
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
              // Maximal Splitting: Ingest with empty abbreviations to maximize segments.
              // Merging will happen dynamically during playback.
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
                  }
              );

              // Note: processBatchImport uses dbService internally.
              // We need to sync newly added books to Yjs.
              // Since batch import returns void, we can scan the legacy DB or assume batch import
              // logic needs to be aware.
              // For now, simpler: Just re-read legacy DB for new items or
              // trust that processEpub was called inside batch import?
              // `processBatchImport` calls `processEpub`.
              // We can't easily hook into that without changing batch ingestion.
              //
              // Workaround: Re-fetch all from DBService and update Yjs for missing ones?
              // Or rely on MigrationService on next reload? No, need immediate update.
              //
              // Let's iterate all legacy books and ensure they are in Yjs.
              const allBooks = await dbService.getLibrary();
              crdtService.doc.transact(() => {
                 for(const book of allBooks) {
                     if (!crdtService.books.has(book.id)) {
                         crdtService.books.set(book.id, book as any);
                     }
                 }
              });

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
          crdtService.books.delete(id);
          // 2. Remove from Legacy DB (Binaries + Backup)
          await dbService.deleteBook(id);
        } catch (err) {
          console.error('Failed to remove book:', err);
          set({ error: 'Failed to remove book.' });
        }
      },

      offloadBook: async (id: string) => {
        try {
          await dbService.offloadBook(id);
          // Update Yjs metadata
          const book = crdtService.books.get(id);
          if (book) {
              crdtService.books.set(id, { ...book, isOffloaded: true } as any);
          }
        } catch (err) {
          console.error('Failed to offload book:', err);
          set({ error: 'Failed to offload book.' });
        }
      },

      restoreBook: async (id: string, file: File) => {
        set({ isImporting: true, error: null });
        try {
          await dbService.restoreBook(id, file);
          // Update Yjs metadata
          const book = crdtService.books.get(id);
          if (book) {
             crdtService.books.set(id, { ...book, isOffloaded: false } as any);
          }
          set({ isImporting: false });
        } catch (err) {
          console.error('Failed to restore book:', err);
          // Ensure we expose the error message to the UI
          set({ error: err instanceof Error ? err.message : 'Failed to restore book.', isImporting: false });
        }
      },
    }),
    {
      name: 'library-storage',
      partialize: (state) => ({
        viewMode: state.viewMode,
        sortOrder: state.sortOrder
      }),
    }
  )
);
