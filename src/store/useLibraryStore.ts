import { create } from 'zustand';
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
}

/**
 * Zustand store for managing the user's library of books.
 * Handles fetching, adding, and removing books from IndexedDB.
 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  isLoading: false,
  isImporting: false,
  error: null,

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
}));
