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

describe('ingestion', () => {
  beforeEach(async () => {
    const db = await getDB();
    const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.done;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should process an epub file correctly', async () => {
    const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });
    if (!mockFile.arrayBuffer) {
        mockFile.arrayBuffer = async () => new ArrayBuffer(8);
    }

    const bookId = await processEpub(mockFile);

    expect(bookId).toBe('mock-uuid');

    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('Mock Title');
    expect(book?.author).toBe('Mock Author');
    expect(book?.description).toBe('Mock Description');
    expect(book?.id).toBe('mock-uuid');
    expect(book?.coverBlob).toBeDefined();

    const storedFile = await db.get('files', bookId);
    expect(storedFile).toBeDefined();
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

    const mockFile = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });
    if (!mockFile.arrayBuffer) {
        mockFile.arrayBuffer = async () => new ArrayBuffer(8);
    }

    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('No Cover Book');
    expect(book?.coverBlob).toBeUndefined();
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
    if (!mockFile.arrayBuffer) {
        mockFile.arrayBuffer = async () => new ArrayBuffer(8);
    }

    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('Untitled');
    expect(book?.author).toBe('Unknown Author');
    expect(book?.description).toBe('');
  });
});
