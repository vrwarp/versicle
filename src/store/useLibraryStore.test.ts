import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { getDB } from '../db/db';
import type { BookMetadata, LexiconRule } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processEpub: vi.fn(async (file: File) => {
    // Mock implementation of processEpub that just puts a dummy book in DB
    const db = await getDB();
    const mockBook: BookMetadata = {
      id: 'test-id',
      title: 'Test Book',
      author: 'Test Author',
      description: 'Test Description',
      cover: 'cover-data',
      addedAt: 1234567890,
    };
    await db.put('static_books', mockBook);
    await db.put('user_book_states', { bookId: 'test-id' });
    // Use a simpler way to get buffer or just mock data
    await db.put('static_files', new ArrayBuffer(8), 'test-id');
    return 'test-id';
  }),
}));

describe('useLibraryStore', () => {
  const mockBook: BookMetadata = {
    id: 'test-id',
    title: 'Test Book',
    author: 'Test Author',
    description: 'Test Description',
    cover: 'cover-data',
    addedAt: 1234567890,
  };

  // Create a mock file
  const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

  // Polyfill arrayBuffer if missing (JSDOM/Vitest issue sometimes)
  if (!mockFile.arrayBuffer) {
      mockFile.arrayBuffer = async () => new ArrayBuffer(8);
  }

  beforeEach(async () => {
    // Reset Zustand store
    useLibraryStore.setState({
      books: [],
      isLoading: false,
      sortOrder: 'last_read', // Default
    });

    // Clear IndexedDB
    const db = await getDB();
    const tx = db.transaction(['static_books', 'static_files', 'user_annotations', 'user_lexicon', 'user_book_states'], 'readwrite');
    await tx.objectStore('static_books').clear();
    await tx.objectStore('static_files').clear();
    await tx.objectStore('user_annotations').clear();
    await tx.objectStore('user_lexicon').clear();
    await tx.objectStore('user_book_states').clear();
    await tx.done;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    expect(state.books).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.sortOrder).toBe('last_read');
  });

  it('should add a book', async () => {
    await useLibraryStore.getState().addBook(mockFile);

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toMatchObject({ id: mockBook.id });
    expect(state.isLoading).toBe(false);

    // Verify it's in DB
    const db = await getDB();
    const storedBook = await db.get('static_books', 'test-id');
    expect(storedBook).toEqual(mockBook);
  });

  it('should remove a book', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockFile);

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
    const storedBook = await db.get('static_books', 'test-id');
    expect(storedBook).toBeUndefined();

    const storedFile = await db.get('static_files', 'test-id');
    expect(storedFile).toBeUndefined();
  });

  it('should refresh library from DB', async () => {
    // Manually add a book to DB (simulating a fresh load)
    const db = await getDB();
    await db.put('static_books', mockBook);
    await db.put('user_book_states', { bookId: mockBook.id });

    // Initial state should be empty
    expect(useLibraryStore.getState().books).toHaveLength(0);

    // Refresh library
    await useLibraryStore.getState().fetchBooks();

    // State should now have the book
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toMatchObject({ id: mockBook.id });
  });

  it('should sort books by addedAt desc on refresh', async () => {
    const book1 = { ...mockBook, id: '1', addedAt: 100 };
    const book2 = { ...mockBook, id: '2', addedAt: 200 };

    const db = await getDB();
    await db.put('static_books', book1);
    await db.put('static_books', book2);
    await db.put('user_book_states', { bookId: '1' });
    await db.put('user_book_states', { bookId: '2' });

    await useLibraryStore.getState().fetchBooks();

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(2);
    expect(state.books[0].id).toBe('2'); // Newer one first
    expect(state.books[1].id).toBe('1');
  });

  it('should update and persist sort order', () => {
    const state = useLibraryStore.getState();
    expect(state.sortOrder).toBe('last_read');

    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });

  it('should handle annotations deletion when removing a book', async () => {
      // Add a book and an annotation
      await useLibraryStore.getState().addBook(mockFile);

      const db = await getDB();
      const annotation = {
          id: 'note-1',
          bookId: mockBook.id,
          cfiRange: 'epubcfi(...)',
          text: 'Note text',
          color: 'yellow',
          createdAt: Date.now()
      };

      await db.put('user_annotations', annotation);

      // Verify annotation exists
      expect(await db.get('user_annotations', 'note-1')).toEqual(annotation);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBook.id);

      // Verify annotation is deleted
      expect(await db.get('user_annotations', 'note-1')).toBeUndefined();
  });

  it('should delete associated lexicon rules when removing a book', async () => {
      // Add a book
      await useLibraryStore.getState().addBook(mockFile);

      const db = await getDB();
      const rule: LexiconRule = {
          id: 'rule-1',
          bookId: mockBook.id,
          original: 'hello',
          replacement: 'hi',
          created: Date.now()
      };

      await db.put('user_lexicon', rule);

      // Verify rule exists
      expect(await db.get('user_lexicon', 'rule-1')).toEqual(rule);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBook.id);

      // Verify rule is deleted
      expect(await db.get('user_lexicon', 'rule-1')).toBeUndefined();
  });
});
