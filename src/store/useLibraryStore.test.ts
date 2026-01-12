import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createLibraryStore } from './useLibraryStore';
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
    useLibraryStore = createLibraryStore(mockDBService as any);
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
    vi.mocked(mockDBService.addBook).mockResolvedValue(mockManifest as any);

    await useLibraryStore.getState().addBook(mockFile);

    expect(mockDBService.addBook).toHaveBeenCalledWith(mockFile, expect.anything(), expect.anything());

    // State should be updated via Yjs sync (book added to store)
    const state = useLibraryStore.getState();
    expect(state.books['test-id']).toBeDefined();
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

  it('should remove a book calling dbService', async () => {
    // Setup initial state
    useLibraryStore.setState({ books: { 'test-id': { ...mockBook, lastInteraction: 1000, tags: [], status: 'unread' } as any } });

    vi.mocked(mockDBService.deleteBook).mockResolvedValue(undefined);

    await useLibraryStore.getState().removeBook('test-id');

    expect(mockDBService.deleteBook).toHaveBeenCalledWith('test-id');
    const state = useLibraryStore.getState();
    expect(state.books['test-id']).toBeUndefined();
  });

  it('should hydrate static metadata from DB', async () => {
    // Setup book in Yjs state first
    useLibraryStore.setState({
      books: {
        'test-id': {
          bookId: 'test-id',
          title: 'Test',
          author: 'Author',
          addedAt: 1000,
          status: 'unread',
          tags: [],
          lastInteraction: 1000
        } as any
      }
    });

    // Mock DBService to return static metadata
    vi.mocked(mockDBService.getLibrary).mockResolvedValue([mockBook]);
    vi.mocked(mockDBService.getBookMetadata).mockResolvedValue(mockBook);

    // Setup initial state with a book so hydration has something to do
    useLibraryStore.setState({
      books: { 'test-id': mockBook as any }
    });

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
