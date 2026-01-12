import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';

// Mock DBService
vi.mock('../db/DBService', () => ({
  dbService: {
    getLibrary: vi.fn(),
    addBook: vi.fn(),
    deleteBook: vi.fn(),
    ingestBook: vi.fn(),
  }
}));

// Mock zustand persistence
vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...actual,
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
  };
});

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  extractBookData: vi.fn(),
}));

// Mock AudioPlayerService
vi.mock('../lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: () => ({
      subscribe: vi.fn(),
    }),
  },
}));

describe('useLibraryStore', () => {
  const mockFile = new File([''], 'test.epub', { type: 'application/epub+zip' });
  const mockBook: BookMetadata = {
    id: 'test-id',
    title: 'Test Book',
    author: 'Test Author',
    addedAt: 1000,
    bookId: 'test-id',
    description: 'Desc',
    filename: 'test.epub',
    fileHash: 'hash',
    fileSize: 100,
    totalChars: 1000,
    version: 1,
    lastRead: 0,
    progress: 0,
    currentCfi: '',
    lastPlayedCfi: '',
    isOffloaded: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({
      books: {},
      isLoading: false,
      error: null,
      sortOrder: 'last_read',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    expect(state.books).toEqual({});
    expect(state.isLoading).toBe(false);
  });

  it('should add a book calling dbService', async () => {
    // Mock successful add
    vi.mocked(dbService.addBook).mockResolvedValue(undefined);
    // Mock fetchBooks after add
    vi.mocked(dbService.getLibrary).mockResolvedValue([mockBook]);

    await useLibraryStore.getState().addBook(mockFile);

    expect(dbService.addBook).toHaveBeenCalledWith(mockFile, expect.anything(), expect.anything());
    expect(dbService.getLibrary).toHaveBeenCalled();

    // State should be updated via fetchBooks
    const state = useLibraryStore.getState();
    expect(state.books['test-id']).toEqual(mockBook);
    expect(state.isLoading).toBe(false);
  });

  it('should handle add book error', async () => {
    const error = new Error('Add failed');
    vi.mocked(dbService.addBook).mockRejectedValue(error);

    await expect(useLibraryStore.getState().addBook(mockFile)).rejects.toThrow('Add failed');

    const state = useLibraryStore.getState();
    // Store sets a generic error message for UI
    expect(state.error).toBe('Failed to import book.');
    expect(state.isLoading).toBe(false);
  });

  it('should remove a book calling dbService', async () => {
    // Setup initial state
    useLibraryStore.setState({ books: { 'test-id': mockBook } });

    vi.mocked(dbService.deleteBook).mockResolvedValue(undefined);

    await useLibraryStore.getState().removeBook('test-id');

    expect(dbService.deleteBook).toHaveBeenCalledWith('test-id');
    const state = useLibraryStore.getState();
    expect(state.books['test-id']).toBeUndefined();
  });

  it('should refresh library from DB', async () => {
    vi.mocked(dbService.getLibrary).mockResolvedValue([mockBook]);

    await useLibraryStore.getState().fetchBooks();

    expect(dbService.getLibrary).toHaveBeenCalled();
    const state = useLibraryStore.getState();
    expect(state.books['test-id']).toEqual(mockBook);
  });

  it('should update and persist sort order', () => {
    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });
});
