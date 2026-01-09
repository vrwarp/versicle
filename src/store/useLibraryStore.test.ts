import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { getDB } from '../db/db';
import type { BookMetadata, LexiconRule, Book, BookSource, BookState } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processEpub: vi.fn(async (file: File) => {
    // Mock implementation of processEpub that just puts a dummy book in DB
    const db = await getDB();
    const bookId = 'test-id';

    const mockBook: Book = {
      id: bookId,
      title: 'Test Book',
      author: 'Test Author',
      description: 'Test Description',
      addedAt: 1234567890,
      // coverBlob moved to cache_covers
    };

    const mockSource: BookSource = {
        bookId,
        filename: 'test.epub',
        fileHash: 'hash',
        fileSize: 1000,
        totalChars: 1000,
        syntheticToc: [],
        version: 1
    };

    const mockState: BookState = {
        bookId,
        isOffloaded: false,
        progress: 0
    };

    await db.put('static_books', mockBook);
    await db.put('static_book_sources', mockSource);
    await db.put('user_book_states', mockState);
    await db.put('cache_covers', new Blob(['cover-data']), bookId);

    // Use a simpler way to get buffer or just mock data
    await db.put('static_files', new ArrayBuffer(8), bookId);
    return bookId;
  }),
}));

describe('useLibraryStore', () => {
  const mockBookId = 'test-id';
  // Expected metadata after join
  const expectedMetadata: Partial<BookMetadata> = {
    id: mockBookId,
    title: 'Test Book',
    author: 'Test Author',
    description: 'Test Description',
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
    const tx = db.transaction(['static_books', 'static_book_sources', 'user_book_states', 'static_files', 'user_annotations', 'user_lexicon', 'cache_covers'], 'readwrite');
    await tx.objectStore('static_books').clear();
    await tx.objectStore('static_book_sources').clear();
    await tx.objectStore('user_book_states').clear();
    await tx.objectStore('static_files').clear();
    await tx.objectStore('user_annotations').clear();
    await tx.objectStore('user_lexicon').clear();
    await tx.objectStore('cache_covers').clear();
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
    expect(state.books[0]).toMatchObject(expectedMetadata);
    expect(state.isLoading).toBe(false);

    // Verify it's in DB
    const db = await getDB();
    const storedBook = await db.get('static_books', mockBookId);
    expect(storedBook).toMatchObject(expectedMetadata);
  });

  it('should remove a book', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockFile);

    // Verify it was added
    expect(useLibraryStore.getState().books).toHaveLength(1);

    // Then remove it
    await useLibraryStore.getState().removeBook(mockBookId);

    // Verify it's gone from state
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(0);
    expect(state.isLoading).toBe(false);

    // Verify it's gone from DB
    const db = await getDB();
    const storedBook = await db.get('static_books', mockBookId);
    expect(storedBook).toBeUndefined();

    const storedFile = await db.get('static_files', mockBookId);
    expect(storedFile).toBeUndefined();
  });

  it('should refresh library from DB', async () => {
    // Manually add a book to DB (simulating a fresh load)
    const db = await getDB();
    const book: Book = { id: mockBookId, title: 'Test Book', author: 'Test Author', addedAt: 1234567890 };
    await db.put('static_books', book);
    await db.put('user_book_states', { bookId: mockBookId });

    // Initial state should be empty
    expect(useLibraryStore.getState().books).toHaveLength(0);

    // Refresh library
    await useLibraryStore.getState().fetchBooks();

    // State should now have the book
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toMatchObject(book);
  });

  it('should sort books by addedAt desc on refresh', async () => {
    const book1: Book = { id: '1', title: 'B1', author: 'A', addedAt: 100 };
    const book2: Book = { id: '2', title: 'B2', author: 'A', addedAt: 200 };

    const db = await getDB();
    await db.put('static_books', book1);
    await db.put('user_book_states', { bookId: '1' });
    await db.put('static_books', book2);
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
          bookId: mockBookId,
          cfiRange: 'epubcfi(...)',
          text: 'Note text',
          color: 'yellow',
          created: Date.now(),
          type: 'highlight' as const // fix type
      };

      await db.put('user_annotations', annotation);

      // Verify annotation exists
      expect(await db.get('user_annotations', 'note-1')).toEqual(annotation);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBookId);

      // Verify annotation is deleted
      expect(await db.get('user_annotations', 'note-1')).toBeUndefined();
  });

  it('should delete associated lexicon rules when removing a book', async () => {
      // Add a book
      await useLibraryStore.getState().addBook(mockFile);

      const db = await getDB();
      const rule: LexiconRule = {
          id: 'rule-1',
          bookId: mockBookId,
          original: 'hello',
          replacement: 'hi',
          created: Date.now()
      };

      await db.put('user_lexicon', rule);

      // Verify rule exists
      expect(await db.get('user_lexicon', 'rule-1')).toEqual(rule);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBookId);

      // Verify rule is deleted
      expect(await db.get('user_lexicon', 'rule-1')).toBeUndefined();
  });
});
