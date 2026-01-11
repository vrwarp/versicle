import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { useInventoryStore } from './useInventoryStore';
import { getDB } from '../db/db';

// Mock DBService
vi.mock('../db/DBService', () => ({
  dbService: {
    addBook: vi.fn(async (file: File) => {
      return {
        id: 'test-id',
        title: 'Test Book',
        author: 'Test Author',
        filename: file.name,
        addedAt: Date.now(),
        // Mock returning the bookId as id
        bookId: 'test-id'
      };
    }),
    deleteBook: vi.fn(),
    offloadBook: vi.fn(),
    restoreBook: vi.fn(),
  }
}));

// Mock Yjs middleware to be a simple pass-through for synchronous state updates
vi.mock('zustand-middleware-yjs', () => {
  return {
    default: (doc: any, name: any, config: any) => (set: any, get: any, api: any) => config(set, get, api)
  };
});

describe('useLibraryStore', () => {
  const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

  if (!mockFile.arrayBuffer) {
    mockFile.arrayBuffer = async () => new ArrayBuffer(8);
  }

  beforeEach(async () => {
    // Reset Zustand stores
    useLibraryStore.setState({
      isLoading: false,
      sortOrder: 'last_read',
      error: null,
      books: [] // Reset legacy books array if used
    });

    useInventoryStore.setState({ books: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.sortOrder).toBe('last_read');
  });

  it('should add a book and update inventory', async () => {
    await useLibraryStore.getState().addBook(mockFile);

    // Check Inventory Store
    const inventory = useInventoryStore.getState();
    const books = Object.values(inventory.books);

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ bookId: 'test-id', customTitle: 'Test Book' });

    // Check UI state
    const state = useLibraryStore.getState();
    expect(state.isLoading).toBe(false);
  });

  it('should remove a book from inventory', async () => {
    // First add a book
    await useLibraryStore.getState().addBook(mockFile);

    // Verify it was added
    expect(Object.keys(useInventoryStore.getState().books)).toHaveLength(1);

    // Then remove it
    await useLibraryStore.getState().removeBook('test-id');

    // Verify it's gone from inventory
    expect(Object.keys(useInventoryStore.getState().books)).toHaveLength(0);
  });

  it('should update and persist sort order', () => {
    const state = useLibraryStore.getState();
    expect(state.sortOrder).toBe('last_read');

    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });

  it('should call dbService.deleteBook when removing a book', async () => {
    const { dbService } = await import('../db/DBService');
    await useLibraryStore.getState().removeBook('test-id');
    expect(dbService.deleteBook).toHaveBeenCalledWith('test-id');
  });
});
