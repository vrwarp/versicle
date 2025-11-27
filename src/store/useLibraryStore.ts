import { create } from 'zustand';
import { getDB } from '../db/db';
import type { BookMetadata } from '../types/db';
import { processEpub } from '../lib/ingestion';

interface LibraryState {
  books: BookMetadata[];
  isLoading: boolean;
  isImporting: boolean;
  error: string | null;
  fetchBooks: () => Promise<void>;
  addBook: (file: File) => Promise<void>;
}

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
      set({ error: 'Failed to import book.', isImporting: false });
    }
  },
}));
