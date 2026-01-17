import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from './db/db';
import { useLibraryStore } from './store/useLibraryStore';
import { useBookStore } from './store/useBookStore';
import { useReaderUIStore } from './store/useReaderUIStore';
import { useReadingStateStore } from './store/useReadingStateStore';
import * as fs from 'fs';
import * as path from 'path';
import type { StaticBookManifest, StaticResource, UserInventoryItem, UserProgress } from './types/db';

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

// Mock ingestion extractBookData (was processEpub)
vi.mock('./lib/ingestion', () => ({
  extractBookData: vi.fn(async (file: File) => {
    const bookId = 'mock-book-id';
    // Return dummy data
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
  })
}));

// Mock epub.js for ReaderView simulation
vi.mock('epubjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('epubjs')>();
  return {
    ...actual,
    default: vi.fn((data, options) => {
      const book = actual.default(data, options);

      // Spy/Mock renderTo
      book.renderTo = vi.fn().mockReturnValue({
        display: vi.fn().mockResolvedValue(undefined),
        getContents: vi.fn().mockReturnValue([{
          document: {
            body: {
              textContent: 'Mock Content',
              querySelectorAll: () => [],
              querySelector: () => null,
              childNodes: [],
              nodeType: 1, // ELEMENT_NODE
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

      // Mock locations.generate if needed to avoid heavy lifting
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
      'user_inventory', 'user_progress', 'user_annotations', 'user_overrides',
      'cache_tts_preparation'
    ], 'readwrite');

    await tx.objectStore('static_manifests').clear();
    await tx.objectStore('static_resources').clear();
    await tx.objectStore('static_structure').clear();
    await tx.objectStore('user_inventory').clear();
    await tx.objectStore('user_progress').clear();
    await tx.objectStore('user_annotations').clear();
    await tx.objectStore('user_overrides').clear();
    await tx.objectStore('cache_tts_preparation').clear();
    await tx.done;

    // Reset stores
    useLibraryStore.setState({ staticMetadata: {}, isLoading: false, isImporting: false, error: null });
    useBookStore.setState({ books: {} });
    useReaderUIStore.getState().reset();
    useReadingStateStore.setState({ progress: {} });

    // Mock global fetch for cover extraction
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

    // Polyfill arrayBuffer if needed
    if (!file.arrayBuffer) {
      file.arrayBuffer = () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
    }

    await store.addBook(file);

    // Verify state after adding
    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    // Get the first book
    const book = Object.values(updatedStore.books)[0];
    expect(book.title).toContain("Alice's Adventures in Wonderland");

    // Verify DB
    const db = await getDB();
    const manifests = await db.getAll('static_manifests');
    expect(manifests).toHaveLength(1);
    const resources = await db.getAll('static_resources');
    expect(resources).toHaveLength(1);

    // 2. Delete Book
    const bookId = book.bookId;
    await store.removeBook(bookId);

    // Verify state after deleting
    const finalStore = useBookStore.getState();
    expect(Object.keys(finalStore.books)).toHaveLength(0);

    // Verify DB empty
    const manifestsAfter = await db.getAll('static_manifests');
    expect(manifestsAfter).toHaveLength(0);
    const resourcesAfter = await db.getAll('static_resources');
    expect(resourcesAfter).toHaveLength(0);
  });

  it('should persist data across store reloads', async () => {
    const db = await getDB();
    const bookId = 'test-id';

    await db.put('static_manifests', {
      bookId, title: 'Persisted Book', author: 'Me', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0
    } as StaticBookManifest);
    await db.put('user_inventory', {
      bookId, title: 'Persisted Book', author: 'Me', addedAt: Date.now(), status: 'unread', tags: [], lastInteraction: Date.now()
    } as UserInventoryItem);
    await db.put('user_progress', {
      bookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);

    // Manually add to Yjs state (simulating sync)
    useBookStore.setState({
      books: {
        'test-id': {
          bookId: 'test-id',
          title: 'Persisted Book',
          author: 'Me',
          addedAt: Date.now(),
          status: 'unread',
          tags: [],
          lastInteraction: Date.now()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      }
    });

    const store = useLibraryStore.getState();
    await store.hydrateStaticMetadata();

    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    expect(updatedStore.books['test-id'].title).toBe('Persisted Book');
  });

  it('should handle annotations (add, list, delete)', async () => {
    const db = await getDB();
    const bookId = 'book-1';

    const annotation = {
      id: 'ann-1',
      bookId,
      cfiRange: 'epubcfi(/6/4[chapter1]!/4/2/1:0)',
      text: 'Selected text',
      color: 'yellow',
      created: Date.now(),
      type: 'highlight' as const
    };

    const tx = db.transaction('user_annotations', 'readwrite');
    await tx.objectStore('user_annotations').add(annotation);
    await tx.done;

    const annotations = await db.getAllFromIndex('user_annotations', 'by_bookId', bookId);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].text).toBe('Selected text');

    const tx2 = db.transaction('user_annotations', 'readwrite');
    await tx2.objectStore('user_annotations').delete('ann-1');
    await tx2.done;

    const annotationsAfter = await db.getAllFromIndex('user_annotations', 'by_bookId', bookId);
    expect(annotationsAfter).toHaveLength(0);
  });

  it('should track reading progress and persist it', async () => {
    // 1. Setup book in DB
    const db = await getDB();
    const bookId = 'reader-test-id';

    const fixturePath = path.resolve(__dirname, './test/fixtures/alice.epub');
    const buffer = fs.readFileSync(fixturePath);

    await db.put('static_manifests', {
      bookId, title: 'Reader Test Book', author: 'Tester', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0
    } as StaticBookManifest);
    await db.put('user_inventory', {
      bookId, title: 'Reader Test Book', author: 'Tester', addedAt: Date.now(), status: 'unread', tags: [], lastInteraction: 0
    } as UserInventoryItem);
    await db.put('user_progress', {
      bookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);
    await db.put('static_resources', { bookId, epubBlob: buffer.buffer } as StaticResource);

    // 2. Initialize Reader Store (simulating component mount)
    const readingState = useReadingStateStore.getState();
    const uiStore = useReaderUIStore.getState();
    uiStore.setCurrentBookId(bookId);

    readingState.updateLocation(bookId, 'cfi1', 0.5);
    uiStore.setCurrentSection('Chapter 5', 'section1');

    const state = useReadingStateStore.getState();
    const uiState = useReaderUIStore.getState();
    // Use getProgress for per-device progress structure
    const bookProgress = state.getProgress(bookId);
    expect(bookProgress?.currentCfi).toBe('cfi1');
    expect(bookProgress?.percentage).toBe(0.5);
    expect(uiState.currentSectionTitle).toBe('Chapter 5');

    // Test TOC setting
    const mockToc = [{ id: '1', href: 'chap1.html', label: 'Chapter 1' }];
    useReaderUIStore.getState().setToc(mockToc);
    expect(useReaderUIStore.getState().toc).toEqual(mockToc);

    // Simulate the persistence logic used in ReaderView/DBService
    const saveProgress = async (id: string, cfi: string, prog: number) => {
      const tx = db.transaction('user_progress', 'readwrite');
      const store = tx.objectStore('user_progress');
      const userProg = await store.get(id);
      if (userProg) {
        userProg.currentCfi = cfi;
        userProg.percentage = prog;
        userProg.lastRead = Date.now();
        await store.put(userProg);
      }
      await tx.done;
    };

    await saveProgress(bookId, 'cfi1', 0.5);

    // Verify DB persistence
    const persistedProg = await db.get('user_progress', bookId);
    expect(persistedProg).toBeDefined();
    expect(persistedProg!.currentCfi).toBe('cfi1');
    expect(persistedProg!.percentage).toBe(0.5);
    expect(persistedProg!.lastRead).toBeDefined();
  });

});
