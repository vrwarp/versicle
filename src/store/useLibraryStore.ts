import { create } from 'zustand';
import { getDB } from '../db/db';
import type { BookMetadata } from '../types/db';
import { processEpub } from '../lib/ingestion';

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
  deleteBook: (id: string) => Promise<void>;
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
      const db = await getDB();
      const books = await db.getAll('books');

      // Sort by addedAt descending
      books.sort((a, b) => b.addedAt - a.addedAt);

      set({ books, isLoading: false });
    } catch (err) {
      console.error('Failed to fetch books:', err);
      set({ error: 'Failed to load library.', isLoading: false });
    }
  },

  addBook: async (file: File) => {
    set({ isImporting: true, error: null });
    try {
      await processEpub(file);
      // Refresh library
      await get().fetchBooks();
      set({ isImporting: false });
    } catch (err) {
      console.error('Failed to import book:', err);
      // Check for QuotaExceededError
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          set({ error: 'Storage quota exceeded. Please delete some books to make space.', isImporting: false });
      } else {
          set({ error: `Failed to import book: ${(err as Error).message}`, isImporting: false });
      }
    }
  },

  deleteBook: async (id: string) => {
    try {
      const db = await getDB();
      const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
      await tx.objectStore('books').delete(id);
      await tx.objectStore('files').delete(id);

      // Delete annotations for this book
      const annotationStore = tx.objectStore('annotations');
      const index = annotationStore.index('by_bookId');

      // Iterate over cursor to delete
      // Note: deleting via cursor while iterating can be tricky in some implementations,
      // but IDB supports it. Alternatively, gather keys and delete.
      let cursor = await index.openCursor(IDBKeyRange.only(id));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }

      await tx.done;

      // Optimistic update or refetch
      // set(state => ({ books: state.books.filter(b => b.id !== id) }));
      // Refetch to be safe and consistent
      await get().fetchBooks();
    } catch (err) {
      console.error('Failed to remove book:', err);
      set({ error: 'Failed to remove book.' });
    }
  },
}));
