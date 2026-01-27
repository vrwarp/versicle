import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from './db/db';
import { useLibraryStore } from './store/useLibraryStore';
import { useBookStore } from './store/useBookStore';
import { useReaderUIStore } from './store/useReaderUIStore';
import { useReadingStateStore } from './store/useReadingStateStore';
import * as fs from 'fs';
import * as path from 'path';
import type { StaticBookManifest, StaticResource } from './types/db';

// Mock zustand persistence
vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
  };
});

// Mock offscreen renderer
vi.mock('./lib/offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn(async () => {
    return [
      {
        href: 'chapter1.html',
        sentences: [{ text: 'Mock Sentence', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
        textContent: 'Mock Content',
        title: 'Mock Chapter'
      }
    ];
  })
}));

// Mock ingestion extractBookData
vi.mock('./lib/ingestion', () => ({
  extractBookData: vi.fn(async (file: File) => {
    const bookId = 'mock-book-id';
    return {
      bookId,
      manifest: {
        bookId,
        title: "Alice's Adventures in Wonderland",
        author: "Lewis Carroll",
        description: "Mock description",
        schemaVersion: 1,
        fileHash: 'mock-hash',
        fileSize: 0,
        totalChars: 0,
        coverBlob: new Blob(['mock-cover'], { type: 'image/jpeg' })
      },
      inventory: {
        bookId,
        addedAt: Date.now(),
        status: 'unread',
        tags: [],
        lastInteraction: Date.now(),
        sourceFilename: 'alice.epub'
      },
      progress: {
        bookId,
        percentage: 0,
        lastRead: 0,
        completedRanges: []
      },
      resource: { bookId, epubBlob: file.arrayBuffer ? await file.arrayBuffer() : new ArrayBuffer(0) },
      structure: { bookId, toc: [], spineItems: [] },
      overrides: { bookId, lexicon: [] },
      readingListEntry: { filename: 'alice.epub', title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", status: 'to-read', lastUpdated: Date.now(), percentage: 0 },
      ttsContentBatches: [],
      tableBatches: []
    };
  }),
  extractBookMetadata: vi.fn(async () => {
    return {
      title: "Alice's Adventures in Wonderland",
      author: "Lewis Carroll",
      description: "Mock description",
      fileHash: 'mock-hash',
    };
  })
}));

// Mock epub.js
vi.mock('epubjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('epubjs')>();
  return {
    ...actual,
    default: vi.fn((data, options) => {
      const book = actual.default(data, options);
      book.renderTo = vi.fn().mockReturnValue({
        display: vi.fn().mockResolvedValue(undefined),
        getContents: vi.fn().mockReturnValue([{
          document: {
            body: {
              textContent: 'Mock Content',
              querySelectorAll: () => [],
              querySelector: () => null,
              childNodes: [],
              nodeType: 1,
              tagName: 'BODY',
              ownerDocument: { createRange: () => ({ setStart: vi.fn(), setEnd: vi.fn() }) }
            }
          },
          cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0)'),
        }]),
        themes: {
          register: vi.fn(),
          select: vi.fn(),
          fontSize: vi.fn(),
        },
        on: vi.fn(),
        next: vi.fn(),
        prev: vi.fn(),
        destroy: vi.fn(),
      });
      book.locations.generate = vi.fn().mockResolvedValue(['cfi1', 'cfi2']);
      return book;
    }),
  };
});

describe('Feature Integration Tests', () => {
  vi.setConfig({ testTimeout: 120000 });
  beforeEach(async () => {
    // Clear DB
    const db = await getDB();
    const tx = db.transaction([
      'static_manifests', 'static_resources', 'static_structure',
      'cache_tts_preparation'
    ], 'readwrite');

    await tx.objectStore('static_manifests').clear();
    await tx.objectStore('static_resources').clear();
    await tx.objectStore('static_structure').clear();
    await tx.objectStore('cache_tts_preparation').clear();
    await tx.done;

    // Reset stores
    useLibraryStore.setState({ staticMetadata: {}, isLoading: false, isImporting: false, error: null });
    useBookStore.setState({ books: {} });
    useReaderUIStore.getState().reset();
    useReadingStateStore.setState({ progress: {} });

    // Mock global fetch
    global.fetch = vi.fn((url) => {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        return Promise.resolve({
          blob: () => Promise.resolve(new Blob(['mock-cover'], { type: 'image/jpeg' })),
        } as Response);
      }
      return Promise.reject('Not mocked');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should add a book, list it, and delete it (Library Management)', async () => {
    const store = useLibraryStore.getState();

    // 1. Add Book
    const fixturePath = path.resolve(__dirname, './test/fixtures/alice.epub');
    const buffer = fs.readFileSync(fixturePath);
    const file = new File([buffer], 'alice.epub', { type: 'application/epub+zip' });

    if (!file.arrayBuffer) {
      file.arrayBuffer = () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
    }

    await store.addBook(file);

    // Verify Yjs state
    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    const book = Object.values(updatedStore.books)[0];
    expect(book.title).toContain("Alice's Adventures in Wonderland");

    // Verify IDB Static Content
    const db = await getDB();
    const manifests = await db.getAll('static_manifests');
    expect(manifests).toHaveLength(1);
    const resources = await db.getAll('static_resources');
    expect(resources).toHaveLength(1);

    // 2. Delete Book
    const bookId = book.bookId;
    await store.removeBook(bookId);

    // Verify Yjs state
    const finalStore = useBookStore.getState();
    expect(Object.keys(finalStore.books)).toHaveLength(0);

    // Verify IDB empty
    const manifestsAfter = await db.getAll('static_manifests');
    expect(manifestsAfter).toHaveLength(0);
    const resourcesAfter = await db.getAll('static_resources');
    expect(resourcesAfter).toHaveLength(0);
  });

  it('should persist data across store reloads', async () => {
    const db = await getDB();
    const bookId = 'test-id';

    // Seed Static Data in IDB
    await db.put('static_manifests', {
      bookId, title: 'Persisted Book', author: 'Me', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0
    } as StaticBookManifest);

    // Seed User Data in Yjs (simulating persistence)
    useBookStore.setState({
      books: {
        'test-id': {
          bookId: 'test-id',
          title: 'Persisted Book',
          author: 'Me',
          addedAt: Date.now(),
          status: 'unread',
          tags: [],
          lastInteraction: Date.now(),
          sourceFilename: 'file.epub'
        }
      }
    });

    const store = useLibraryStore.getState();
    await store.hydrateStaticMetadata();

    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    expect(updatedStore.books['test-id'].title).toBe('Persisted Book');
  });
});
