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
    await db.put('books', mockBook);
    // Use a simpler way to get buffer or just mock data
    await db.put('files', new ArrayBuffer(8), 'test-id');
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
    });

    // Clear IndexedDB
    const db = await getDB();
    const tx = db.transaction(['books', 'files', 'annotations', 'lexicon'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.objectStore('annotations').clear();
    await tx.objectStore('lexicon').clear();
    await tx.done;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    expect(state.books).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should add a book', async () => {
    await useLibraryStore.getState().addBook(mockFile);

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]).toEqual(mockBook);
    expect(state.isLoading).toBe(false);

    // Verify it's in DB
    const db = await getDB();
    const storedBook = await db.get('books', 'test-id');
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
    await useLibraryStore.getState().fetchBooks();

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

    await useLibraryStore.getState().fetchBooks();

    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(2);
    expect(state.books[0].id).toBe('2'); // Newer one first
    expect(state.books[1].id).toBe('1');
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

      await db.put('annotations', annotation);

      // Verify annotation exists
      expect(await db.get('annotations', 'note-1')).toEqual(annotation);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBook.id);

      // Verify annotation is deleted
      expect(await db.get('annotations', 'note-1')).toBeUndefined();
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

      await db.put('lexicon', rule);

      // Verify rule exists
      expect(await db.get('lexicon', 'rule-1')).toEqual(rule);

      // Remove the book
      await useLibraryStore.getState().removeBook(mockBook.id);

      // Verify rule is deleted
      expect(await db.get('lexicon', 'rule-1')).toBeUndefined();
  });
});
