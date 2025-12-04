import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processEpub } from './ingestion';
import { getDB } from '../db/db';

// Mock epubjs
vi.mock('epubjs', () => {
  return {
    default: vi.fn(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: 'Mock Title',
          creator: 'Mock Author',
          description: 'Mock Description',
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve('blob:cover')),
      archive: {
        getBlob: vi.fn(() => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' }))),
      },
    })),
  };
});

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    blob: () => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' })),
  } as Response)
);

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

// Mock DB
const mockAdd = vi.fn();
const mockTransaction = {
  objectStore: vi.fn(() => ({
    add: mockAdd,
  })),
  done: Promise.resolve(),
};
const mockDB = {
  transaction: vi.fn(() => mockTransaction),
};

vi.mock('../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve(mockDB)),
}));

describe('ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should process an epub file correctly and store as Blob', async () => {
    const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

    await processEpub(mockFile);

    // Verify metadata storage
    expect(mockTransaction.objectStore).toHaveBeenCalledWith('books');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mock-uuid',
      title: 'Mock Title',
      author: 'Mock Author',
      fileHash: expect.any(String)
    }));

    // Verify file storage
    expect(mockTransaction.objectStore).toHaveBeenCalledWith('files');
    // We want to verify that the second call to add (or one of the calls) was with the file
    // mockAdd is called twice: once for book, once for file.
    // Order depends on implementation, but typically book first then file or vice versa.
    // Let's check all calls.
    const addCalls = mockAdd.mock.calls;
    const fileCall = addCalls.find(call => call[0] instanceof File);

    expect(fileCall).toBeDefined();
    expect(fileCall?.[0]).toBe(mockFile);
    expect(fileCall?.[1]).toBe('mock-uuid');
  });

  it('should handle missing cover gracefully', async () => {
     // Remock for this specific test
     vi.resetModules();
     const epubjs = await import('epubjs');
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: 'No Cover Book',
          creator: 'Unknown',
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)), // No cover
    }));

    // Re-setup mock DB since resetModules might affect it if imported inside functions
    // But getDB is top-level mocked.

    const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

    await processEpub(mockFile);

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        title: 'No Cover Book',
        coverBlob: undefined
    }));
  });

  it('should use default values when metadata is missing', async () => {
     vi.resetModules();
     const epubjs = await import('epubjs');
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
            // Missing title, creator, and description
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
    }));

    const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

    await processEpub(mockFile);

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Untitled',
        author: 'Unknown Author',
        description: ''
    }));
  });
});
