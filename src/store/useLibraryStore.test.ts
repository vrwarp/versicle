import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { initDB, getDB } from '../db';
import type { BookMetadata } from '../types/db';

// The fake-indexeddb/auto import in setup.ts handles the IDB mocking
// We just need to make sure we clear the DB between tests

describe('useLibraryStore', () => {
  const mockBook: BookMetadata = {
    id: 'test-id',
    title: 'Test Book',
    author: 'Test Author',
    description: 'Test Description',
    cover: 'cover-data',
    addedAt: 1234567890,
  };

  const mockFile = new ArrayBuffer(8);

  beforeEach(async () => {
    // Reset Zustand store
    useLibraryStore.setState({
      books: [],
      isLoading: false,
    });

    // Clear IndexedDB
    const db = await getDB();
    const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.objectStore('annotations').clear();
    await tx.done;
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    expect(state.books).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should add a book', async () => {
    await useLibraryStore.getState().addBook(mockBook, mockFile);

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toEqual(mockBook);
    expect(state.isLoading).toBe(false);

    // Verify it's in DB
    const db = await getDB();
    const storedBook = await db.get('books', 'test-id');
    expect(storedBook).toEqual(mockBook);

    const storedFile = await db.get('files', 'test-id');
    expect(storedFile).toEqual(mockFile);
  });

  it('should remove a book', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockBook, mockFile);

    // Verify it was added
    expect(useLibraryStore.getState().books).toHaveLength(1);

    // Then remove it
    await useLibraryStore.getState().removeBook(mockBook.id);

    // Verify it's gone from state
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(0);
    expect(state.isLoading).toBe(false);

    // Verify it's gone from DB
    const db = await getDB();
    const storedBook = await db.get('books', 'test-id');
    expect(storedBook).toBeUndefined();

    const storedFile = await db.get('files', 'test-id');
    expect(storedFile).toBeUndefined();
  });

  it('should refresh library from DB', async () => {
    // Manually add a book to DB (simulating a fresh load)
    const db = await getDB();
    await db.put('books', mockBook);

    // Initial state should be empty
    expect(useLibraryStore.getState().books).toHaveLength(0);

    // Refresh library
    await useLibraryStore.getState().refreshLibrary();

    // State should now have the book
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toEqual(mockBook);
  });

  it('should sort books by addedAt desc on refresh', async () => {
    const book1 = { ...mockBook, id: '1', addedAt: 100 };
    const book2 = { ...mockBook, id: '2', addedAt: 200 };

    const db = await getDB();
    await db.put('books', book1);
    await db.put('books', book2);

    await useLibraryStore.getState().refreshLibrary();

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(2);
    expect(state.books[0].id).toBe('2'); // Newer one first
    expect(state.books[1].id).toBe('1');
  });

  it('should handle annotations deletion when removing a book', async () => {
      // Add a book and an annotation
      await useLibraryStore.getState().addBook(mockBook, mockFile);

      const db = await getDB();
      const annotation = {
          id: 'note-1',
          bookId: mockBook.id,
          cfiRange: 'epubcfi(...)',
          text: 'Note text',
          color: 'yellow',
          createdAt: Date.now()
      };

      await db.put('annotations', annotation);

      // Verify annotation exists
      expect(await db.get('annotations', 'note-1')).toEqual(annotation);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBook.id);

      // Verify annotation is deleted
      expect(await db.get('annotations', 'note-1')).toBeUndefined();
  });
});
