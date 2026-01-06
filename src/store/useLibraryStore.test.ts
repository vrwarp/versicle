import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { crdtService } from '../lib/crdt/CRDTService';
import type { BookMetadata, LexiconRule } from '../types/db';

// Mock DBService completely to avoid IndexedDB errors
vi.mock('../db/DBService', () => ({
  dbService: {
    addBook: vi.fn(),
    getBookMetadata: vi.fn(),
    deleteBook: vi.fn(),
    offloadBook: vi.fn(),
    restoreBook: vi.fn(),
    getLibrary: vi.fn(), // used by MigrationService
    getAnnotations: vi.fn(),
    getReadingHistoryEntry: vi.fn(),
    getReadingList: vi.fn(),
  }
}));

// Mock ingestion (though likely unused if dbService.addBook is mocked)
vi.mock('../lib/ingestion', () => ({
  processEpub: vi.fn(),
}));

import { dbService } from '../db/DBService';

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

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset Zustand store
    useLibraryStore.setState({
      books: [],
      isLoading: false,
      initialized: false,
      sortOrder: 'last_read',
    });

    // Clear CRDT
    crdtService.doc.transact(() => {
        crdtService.books.clear();
        crdtService.annotations.clear();
    });

    // Setup default DBService mock responses
    vi.mocked(dbService.addBook).mockResolvedValue('test-id');
    vi.mocked(dbService.getBookMetadata).mockResolvedValue(mockBook);
    vi.mocked(dbService.getLibrary).mockResolvedValue([]);
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

  it('should add a book (dual-write)', async () => {
    await useLibraryStore.getState().addBook(mockFile);

    // Verify DBService calls
    expect(dbService.addBook).toHaveBeenCalledWith(mockFile, expect.any(Object), expect.any(Function));
    expect(dbService.getBookMetadata).toHaveBeenCalledWith('test-id');

    // Verify CRDT update
    expect(crdtService.books.has('test-id')).toBe(true);
    expect(crdtService.books.get('test-id')).toEqual(mockBook);
  });

  it('should remove a book (dual-delete)', async () => {
    // Setup initial state: book exists
    crdtService.books.set('test-id', mockBook);
    useLibraryStore.setState({ books: [mockBook] });

    await useLibraryStore.getState().removeBook('test-id');

    // Verify CRDT update
    expect(crdtService.books.has('test-id')).toBe(false);

    // Verify DBService call
    expect(dbService.deleteBook).toHaveBeenCalledWith('test-id');
  });

  it('should init library from CRDT/DB', async () => {
    // Setup DB to return one book for migration
    vi.mocked(dbService.getLibrary).mockResolvedValue([mockBook]);

    // Initial state empty
    expect(useLibraryStore.getState().books).toHaveLength(0);

    // Run init
    await useLibraryStore.getState().init();

    // Verify migration ran (checks DB)
    expect(dbService.getLibrary).toHaveBeenCalled();

    // Verify CRDT populated
    expect(crdtService.books.has('test-id')).toBe(true);

    // Verify store updated (via observer)
    expect(useLibraryStore.getState().books).toHaveLength(1);
    expect(useLibraryStore.getState().books[0].id).toBe('test-id');
  });

  it('should update and persist sort order', () => {
    const state = useLibraryStore.getState();
    expect(state.sortOrder).toBe('last_read');

    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });

  it('should handle offload book', async () => {
      // Setup
      crdtService.books.set('test-id', mockBook);
      useLibraryStore.setState({ books: [mockBook] });

      await useLibraryStore.getState().offloadBook('test-id');

      // Verify DB call
      expect(dbService.offloadBook).toHaveBeenCalledWith('test-id');

      // Verify CRDT update (isOffloaded flag)
      const book = crdtService.books.get('test-id');
      expect(book.isOffloaded).toBe(true);
  });

  it('should handle restore book', async () => {
      // Setup: Offloaded book
      const offloadedBook = { ...mockBook, isOffloaded: true };
      crdtService.books.set('test-id', offloadedBook);
      useLibraryStore.setState({ books: [offloadedBook] });

      await useLibraryStore.getState().restoreBook('test-id', mockFile);

      // Verify DB call
      expect(dbService.restoreBook).toHaveBeenCalledWith('test-id', mockFile);

      // Verify CRDT update
      const book = crdtService.books.get('test-id');
      expect(book.isOffloaded).toBe(false);
  });
});
