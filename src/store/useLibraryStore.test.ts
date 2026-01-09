import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { getDB } from '../db/db';
import type { StaticBookManifest, UserInventoryItem, UserProgress, UserOverrides } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processEpub: vi.fn(async (file: File) => {
    // Mock implementation of processEpub that just puts a dummy book in DB (v18 style)
    const db = await getDB();
    const bookId = 'test-id';

    await db.put('static_manifests', {
        bookId, title: 'Test Book', author: 'Test Author', schemaVersion: 1, fileHash: 'hash', fileSize: 0, totalChars: 0
    } as StaticBookManifest);

    await db.put('user_inventory', {
        bookId, addedAt: 1234567890, status: 'unread', tags: [], lastInteraction: 1234567890
    } as UserInventoryItem);

    await db.put('user_progress', {
        bookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);

    await db.put('static_resources', {
        bookId, epubBlob: new ArrayBuffer(8)
    });

    return bookId;
  }),
}));

describe('useLibraryStore', () => {
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

    // Clear IndexedDB (v18 stores)
    const db = await getDB();
    const tx = db.transaction([
        'static_manifests', 'static_resources', 'user_inventory',
        'user_progress', 'user_annotations', 'user_overrides'
    ], 'readwrite');

    await tx.objectStore('static_manifests').clear();
    await tx.objectStore('static_resources').clear();
    await tx.objectStore('user_inventory').clear();
    await tx.objectStore('user_progress').clear();
    await tx.objectStore('user_annotations').clear();
    await tx.objectStore('user_overrides').clear();
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
    // Partial match as composite construction might have undefineds
    expect(state.books[0]).toMatchObject({ id: 'test-id', title: 'Test Book' });
    expect(state.isLoading).toBe(false);

    // Verify it's in DB
    const db = await getDB();
    const storedManifest = await db.get('static_manifests', 'test-id');
    expect(storedManifest).toBeDefined();
  });

  it('should remove a book', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockFile);

    // Verify it was added
    expect(useLibraryStore.getState().books).toHaveLength(1);

    // Then remove it
    await useLibraryStore.getState().removeBook('test-id');

    // Verify it's gone from state
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(0);
    expect(state.isLoading).toBe(false);

    // Verify it's gone from DB
    const db = await getDB();
    const storedManifest = await db.get('static_manifests', 'test-id');
    expect(storedManifest).toBeUndefined();

    const storedResource = await db.get('static_resources', 'test-id');
    expect(storedResource).toBeUndefined();
  });

  it('should refresh library from DB', async () => {
    // Manually add a book to DB (simulating a fresh load)
    const db = await getDB();
    const bookId = 'test-id';
    await db.put('static_manifests', {
        bookId, title: 'Test Book', author: 'Test Author', schemaVersion: 1, fileHash: 'hash', fileSize: 0, totalChars: 0
    } as StaticBookManifest);
    await db.put('user_inventory', {
        bookId, addedAt: 1234567890, status: 'unread', tags: [], lastInteraction: 1234567890
    } as UserInventoryItem);
    await db.put('user_progress', {
        bookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);
    await db.put('static_resources', {
        bookId, epubBlob: new ArrayBuffer(8)
    });

    // Initial state should be empty
    expect(useLibraryStore.getState().books).toHaveLength(0);

    // Refresh library
    await useLibraryStore.getState().fetchBooks();

    // State should now have the book
    const state = useLibraryStore.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0].title).toEqual('Test Book');
  });

  it('should sort books by addedAt desc on refresh', async () => {
    const db = await getDB();

    // Book 1
    await db.put('static_manifests', { bookId: '1', title: 'B1', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
    await db.put('user_inventory', { bookId: '1', addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
    await db.put('user_progress', { bookId: '1', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
    await db.put('static_resources', { bookId: '1', epubBlob: new ArrayBuffer(8) });

    // Book 2 (Newer)
    await db.put('static_manifests', { bookId: '2', title: 'B2', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
    await db.put('user_inventory', { bookId: '2', addedAt: 200, status: 'unread', tags: [], lastInteraction: 200 } as UserInventoryItem);
    await db.put('user_progress', { bookId: '2', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
    await db.put('static_resources', { bookId: '2', epubBlob: new ArrayBuffer(8) });

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
      // Add a book
      await useLibraryStore.getState().addBook(mockFile);

      const db = await getDB();
      const annotation = {
          id: 'note-1',
          bookId: 'test-id',
          cfiRange: 'epubcfi(...)',
          text: 'Note text',
          type: 'note' as const, // Fix literal type
          color: 'yellow',
          created: Date.now()
      };

      await db.put('user_annotations', annotation);

      // Verify annotation exists
      expect(await db.get('user_annotations', 'note-1')).toEqual(annotation);

      // Remove the book
      await useLibraryStore.getState().removeBook('test-id');

      // Verify annotation is deleted
      expect(await db.get('user_annotations', 'note-1')).toBeUndefined();
  });

  it('should delete associated lexicon rules when removing a book', async () => {
      // Add a book
      await useLibraryStore.getState().addBook(mockFile);

      const db = await getDB();
      const overrides: UserOverrides = {
          bookId: 'test-id',
          lexicon: [
              { id: 'rule-1', original: 'hello', replacement: 'hi', created: Date.now() }
          ]
      };

      await db.put('user_overrides', overrides);

      // Verify rules exist
      expect(await db.get('user_overrides', 'test-id')).toBeDefined();

      // Remove the book
      await useLibraryStore.getState().removeBook('test-id');

      // Verify rules are deleted
      expect(await db.get('user_overrides', 'test-id')).toBeUndefined();
  });
});
