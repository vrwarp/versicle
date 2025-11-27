import { create } from 'zustand';
import type { BookMetadata } from '../types/db';
import { getDB } from '../db';

interface LibraryState {
  books: BookMetadata[];
  isLoading: boolean;
  refreshLibrary: () => Promise<void>;
  addBook: (book: BookMetadata, file: ArrayBuffer) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  isLoading: false,

  refreshLibrary: async () => {
    set({ isLoading: true });
    try {
      const db = await getDB();
      const books = await db.getAll('books');
      // Sort by addedAt desc
      books.sort((a, b) => b.addedAt - a.addedAt);
      set({ books });
    } catch (error) {
      console.error('Failed to refresh library:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  addBook: async (book, file) => {
    set({ isLoading: true });
    try {
      const db = await getDB();
      const tx = db.transaction(['books', 'files'], 'readwrite');
      await tx.objectStore('books').put(book);
      await tx.objectStore('files').put(file, book.id);
      await tx.done;

      // Update local state
      set((state) => ({
        books: [book, ...state.books],
      }));
    } catch (error) {
      console.error('Failed to add book:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeBook: async (id) => {
    set({ isLoading: true });
    try {
      const db = await getDB();
      const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
      await tx.objectStore('books').delete(id);
      await tx.objectStore('files').delete(id);
      // Also delete annotations for this book
      const annotationsIndex = tx.objectStore('annotations').index('by_bookId');
      const annotations = await annotationsIndex.getAllKeys(id);
      for (const annotationId of annotations) {
        await tx.objectStore('annotations').delete(annotationId);
      }
      await tx.done;

      set((state) => ({
        books: state.books.filter((b) => b.id !== id),
      }));
    } catch (error) {
      console.error('Failed to remove book:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
