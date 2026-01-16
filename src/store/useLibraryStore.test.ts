import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import type { BookMetadata } from '../types/db';

// Mock DBService
const mockDBService = {
  getLibrary: vi.fn(),
  addBook: vi.fn(),
  deleteBook: vi.fn(),
  ingestBook: vi.fn(),
  offloadBook: vi.fn(),
  restoreBook: vi.fn(),
  getBookMetadata: vi.fn(),
  getOffloadedStatus: vi.fn().mockResolvedValue(new Map()),
  getBookIdByFilename: vi.fn(),
};

// Mock DBService methods
vi.mock('../lib/db', () => ({
  dbService: mockDBService,
}));

// Mock zustand persistence
vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
  };
});

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  extractBookData: vi.fn(),
  processBatchImport: vi.fn(), // Mock processBatchImport as it is used in addBooks
}));

// Mock AudioPlayerService
vi.mock('../lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: () => ({
      subscribe: vi.fn(),
    }),
  },
}));

// Mock TTS Store (referenced in addBooks)
vi.mock('./useTTSStore', () => ({
  useTTSStore: {
    getState: () => ({
      sentenceStarters: [],
      sanitizationEnabled: false
    })
  }
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

  let useLibraryStore: ReturnType<typeof createLibraryStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useLibraryStore = createLibraryStore(mockDBService as any);
    useLibraryStore.setState({
      staticMetadata: {},
      isLoading: false,
      error: null,
      sortOrder: 'last_read',
    });
    useBookStore.setState({ books: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have initial state', () => {
    const state = useLibraryStore.getState();
    const bookState = useBookStore.getState();
    expect(bookState.books).toEqual({});
    expect(state.isLoading).toBe(false);
  });

  it('should add a book calling dbService', async () => {
    // Mock successful add - returns StaticBookManifest
    const mockManifest = {
      bookId: 'test-id',
      title: 'Test Book',
      author: 'Test Author',
      fileHash: 'hash',
      fileSize: 100,
      totalChars: 1000,
      schemaVersion: 1
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(mockDBService.addBook).mockResolvedValue(mockManifest as any);

    await useLibraryStore.getState().addBook(mockFile);

    expect(mockDBService.addBook).toHaveBeenCalledWith(mockFile, expect.anything(), expect.anything());

    // State should be updated via Yjs sync (book added to store)
    const state = useLibraryStore.getState();
    const bookState = useBookStore.getState();
    expect(bookState.books['test-id']).toBeDefined();
    expect(state.isLoading).toBe(false);
  });

  it('should handle add book error', async () => {
    const error = new Error('Add failed');
    vi.mocked(mockDBService.addBook).mockRejectedValue(error);

    await expect(useLibraryStore.getState().addBook(mockFile)).rejects.toThrow('Add failed');

    const state = useLibraryStore.getState();
    // Store sets a generic error message for UI
    expect(state.error).toBe('Failed to import book.');
    expect(state.isLoading).toBe(false);
  });

  it('should detect duplicate book and throw error if not overwriting', async () => {
    vi.mocked(mockDBService.getBookIdByFilename).mockResolvedValue('existing-id');

    await expect(useLibraryStore.getState().addBook(mockFile)).rejects.toThrow('A book with the filename "test.epub" already exists.');

    expect(mockDBService.getBookIdByFilename).toHaveBeenCalledWith('test.epub');
    expect(mockDBService.addBook).not.toHaveBeenCalled();
  });

  it('should overwrite duplicate book if requested', async () => {
    vi.mocked(mockDBService.getBookIdByFilename).mockResolvedValue('existing-id');
    vi.mocked(mockDBService.deleteBook).mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(mockDBService.addBook).mockResolvedValue({ bookId: 'new-id', title: 'New', author: 'A', schemaVersion: 1 } as any);

    // Initial state with existing book
    useBookStore.setState({
      books: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'existing-id': { bookId: 'existing-id' } as any
      }
    });

    await useLibraryStore.getState().addBook(mockFile, { overwrite: true });

    expect(mockDBService.getBookIdByFilename).toHaveBeenCalledWith('test.epub');
    expect(mockDBService.deleteBook).toHaveBeenCalledWith('existing-id');
    expect(mockDBService.addBook).toHaveBeenCalled();

    // Verify state
    const bookState = useBookStore.getState();
    expect(bookState.books['existing-id']).toBeUndefined();
    expect(bookState.books['new-id']).toBeDefined();
  });

  it('should remove a book calling dbService', async () => {
    // Setup initial state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useBookStore.setState({ books: { 'test-id': { ...mockBook, lastInteraction: 1000, tags: [], status: 'unread' } as any } });

    vi.mocked(mockDBService.deleteBook).mockResolvedValue(undefined);

    await useLibraryStore.getState().removeBook('test-id');

    expect(mockDBService.deleteBook).toHaveBeenCalledWith('test-id');
    const bookState = useBookStore.getState();
    expect(bookState.books['test-id']).toBeUndefined();
  });

  it('should hydrate static metadata from DB', async () => {
    // Setup book in Yjs state first
    useBookStore.setState({
      books: {
        'test-id': {
          bookId: 'test-id',
          title: 'Test',
          author: 'Author',
          addedAt: 1000,
          status: 'unread',
          tags: [],
          lastInteraction: 1000
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      }
    });

    // Mock DBService to return static metadata
    vi.mocked(mockDBService.getLibrary).mockResolvedValue([mockBook]);
    vi.mocked(mockDBService.getBookMetadata).mockResolvedValue(mockBook);

    await useLibraryStore.getState().hydrateStaticMetadata();

    expect(mockDBService.getBookMetadata).toHaveBeenCalledWith('test-id');
    const state = useLibraryStore.getState();
    expect(state.staticMetadata['test-id']).toBeDefined();
  });

  it('should update and persist sort order', () => {
    useLibraryStore.getState().setSortOrder('author');
    expect(useLibraryStore.getState().sortOrder).toBe('author');
  });
});
