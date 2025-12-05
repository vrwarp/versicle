import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';
import { StorageFullError } from '../types/errors';

/**
 * State interface for the Library store.
 */
interface LibraryState {
  /** List of book metadata currently in the library. */
  books: BookMetadata[];
  /** Flag indicating if the library is currently loading. */
  isLoading: boolean;
  /** Flag indicating if a book is currently being imported. */
  isImporting: boolean;
  /** Error message if an operation failed, or null. */
  error: string | null;
  /** The current view mode of the library. */
  viewMode: 'grid' | 'list';
  /**
   * Sets the view mode of the library.
   * @param mode - The new view mode.
   */
  setViewMode: (mode: 'grid' | 'list') => void;
  /**
   * Fetches all books from the database and updates the store.
   */
  fetchBooks: () => Promise<void>;
  /**
   * Imports a new EPUB file into the library.
   * @param file - The EPUB file to import.
   */
  addBook: (file: File) => Promise<void>;
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
      isImporting: false,
      error: null,
      viewMode: 'grid',

      setViewMode: (mode) => set({ viewMode: mode }),

      fetchBooks: async () => {
        set({ isLoading: true, error: null });
    try {
      const books = await dbService.getLibrary();
      set({ books, isLoading: false });
    } catch (err) {
      console.error('Failed to fetch books:', err);
      set({ error: 'Failed to load library.', isLoading: false });
    }
  },

  addBook: async (file: File) => {
    set({ isImporting: true, error: null });
    try {
      await dbService.addBook(file);
      // Refresh library
      await get().fetchBooks();
      set({ isImporting: false });
    } catch (err) {
      console.error('Failed to import book:', err);
      let errorMessage = 'Failed to import book.';
      if (err instanceof StorageFullError) {
          errorMessage = 'Device storage full. Please delete some books.';
      }
      set({ error: errorMessage, isImporting: false });
      throw err; // Re-throw so components can handle UI feedback (e.g. Toasts)
    }
  },

  removeBook: async (id: string) => {
    try {
      await dbService.deleteBook(id);
      await get().fetchBooks();
    } catch (err) {
      console.error('Failed to remove book:', err);
      set({ error: 'Failed to remove book.' });
    }
  },

  offloadBook: async (id: string) => {
    try {
      await dbService.offloadBook(id);
      await get().fetchBooks();
    } catch (err) {
      console.error('Failed to offload book:', err);
      set({ error: 'Failed to offload book.' });
    }
  },

  restoreBook: async (id: string, file: File) => {
    set({ isImporting: true, error: null });
    try {
      await dbService.restoreBook(id, file);
      await get().fetchBooks();
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
  partialize: (state) => ({ viewMode: state.viewMode }),
}
)
);
