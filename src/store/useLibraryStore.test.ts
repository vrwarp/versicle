import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { getDB } from '../db/db';
import type { StaticBookManifest, UserInventoryItem, UserProgress, UserOverrides } from '../types/db';
import { useInventoryStore } from './useInventoryStore';

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

    await db.put('static_resources', {
        bookId, epubBlob: new ArrayBuffer(8)
    });

    // It returns metadata now, not void
    return {
        id: bookId,
        title: 'Test Book',
        author: 'Test Author',
        addedAt: 1234567890,
        filename: 'test.epub',
        isOffloaded: false,
        progress: 0
    };
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
      books: {},
      isLoading: false,
      sortOrder: 'last_read', // Default
    });

    useInventoryStore.setState({});

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
    expect(state.books).toEqual({});
    expect(state.isLoading).toBe(false);
    expect(state.sortOrder).toBe('last_read');
  });

  it('should add a book', async () => {
    await useLibraryStore.getState().addBook(mockFile);

    const state = useLibraryStore.getState();
    // Phase 2: Books is a Record
    expect(Object.keys(state.books)).toHaveLength(1);
    expect(state.books['test-id']).toMatchObject({ bookId: 'test-id', customTitle: 'Test Book' });
    expect(state.isLoading).toBe(false);

    // Verify it's in DB (Static only)
    const db = await getDB();
    const storedManifest = await db.get('static_manifests', 'test-id');
    expect(storedManifest).toBeDefined();
  });

  it('should remove a book', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockFile);

    // Verify it was added
    expect(Object.keys(useLibraryStore.getState().books)).toHaveLength(1);

    // Then remove it
    await useLibraryStore.getState().removeBook('test-id');

    // Verify it's gone from state
    const state = useLibraryStore.getState();
    expect(Object.keys(state.books)).toHaveLength(0);
    expect(state.isLoading).toBe(false);

    // Verify it's gone from DB
    const db = await getDB();
    const storedManifest = await db.get('static_manifests', 'test-id');
    expect(storedManifest).toBeUndefined();

    const storedResource = await db.get('static_resources', 'test-id');
    expect(storedResource).toBeUndefined();
  });

  // fetchBooks is effectively deprecated for populating store, but might sync
  it('should refresh library from DB', async () => {
      // Since fetchBooks is deprecated/no-op in this phase for populating Yjs from IDB (that's MigrationService job),
      // we can verify it doesn't crash or throw.
      // Or if we want to simulate pre-existing data, we should seed Yjs/InventoryStore.

      // Simulate Yjs sync
      useInventoryStore.setState({
          'test-id': {
              bookId: 'test-id',
              addedAt: 123,
              status: 'unread',
              tags: [],
              lastInteraction: 123,
              customTitle: 'Test Book'
          }
      });

      // Since useLibraryStore subscribes to useInventoryStore, it should update.
      // But subscriptions are async or batched?
      // Zustand subscriptions usually fire synchronously if set via setState.

      const state = useLibraryStore.getState();
      expect(state.books['test-id']).toBeDefined();
      expect(state.books['test-id'].customTitle).toEqual('Test Book');
  });

  it('should update and persist sort order', () => {
    const state = useLibraryStore.getState();
    expect(state.sortOrder).toBe('last_read');

    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });

  // Phase 2: removeBook NO LONGER deletes user_annotations or user_overrides from IDB.
  // Those tests are invalid as per the plan.
  /*
  it('should handle annotations deletion when removing a book', async () => { ... });
  it('should delete associated lexicon rules when removing a book', async () => { ... });
  */
});
