import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from './db/db';
import { useLibraryStore } from './store/useLibraryStore';
import { useReaderStore } from './store/useReaderStore';
import * as fs from 'fs';
import * as path from 'path';
import type { StaticBookManifest, StaticResource, UserInventoryItem, UserProgress } from './types/db';
import { seedLibrary } from './test/seed';

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

// Mock ingestion processEpub to avoid heavy epub.js parsing in JSDOM
vi.mock('./lib/ingestion', () => ({
    processEpub: vi.fn(async (file: File) => {
        // Simulate what processEpub does: writes to v18 stores and returns ID
        const db = await getDB();
        const bookId = 'mock-book-id';

        await db.put('static_manifests', {
            bookId,
            title: "Alice's Adventures in Wonderland",
            author: "Lewis Carroll",
            description: "Mock description",
            schemaVersion: 1,
            fileHash: 'mock-hash',
            fileSize: 0,
            totalChars: 0,
            coverBlob: new Blob(['mock-cover'], { type: 'image/jpeg' })
        } as StaticBookManifest);

        await db.put('user_inventory', {
            bookId,
            addedAt: Date.now(),
            status: 'unread',
            tags: [],
            lastInteraction: Date.now(),
            sourceFilename: 'alice.epub'
        } as UserInventoryItem);

        await db.put('user_progress', {
            bookId,
            percentage: 0,
            lastRead: 0,
            completedRanges: []
        } as UserProgress);

        // Store file
        if (file.arrayBuffer) {
             const buffer = await file.arrayBuffer();
             await db.put('static_resources', { bookId, epubBlob: buffer } as StaticResource);
        } else {
             await db.put('static_resources', { bookId, epubBlob: new ArrayBuffer(0) } as StaticResource);
        }

        return bookId;
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
    useLibraryStore.setState({ books: [], isLoading: false, isImporting: false, error: null });
    useReaderStore.getState().reset();

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
    const updatedStore = useLibraryStore.getState();
    expect(updatedStore.books).toHaveLength(1);
    expect(updatedStore.books[0].title).toContain("Alice's Adventures in Wonderland");

    // Verify DB
    const db = await getDB();
    const manifests = await db.getAll('static_manifests');
    expect(manifests).toHaveLength(1);
    const resources = await db.getAll('static_resources');
    expect(resources).toHaveLength(1);

    // 2. Delete Book
    const bookId = updatedStore.books[0].id;
    await store.removeBook(bookId);

    // Verify state after deleting
    const finalStore = useLibraryStore.getState();
    expect(finalStore.books).toHaveLength(0);

    // Verify DB empty
    const manifestsAfter = await db.getAll('static_manifests');
    expect(manifestsAfter).toHaveLength(0);
    const resourcesAfter = await db.getAll('static_resources');
    expect(resourcesAfter).toHaveLength(0);
  });

  it('should persist data across store reloads', async () => {
    const bookId = 'test-id';

    await seedLibrary([{
        bookId,
        title: 'Persisted Book',
        author: 'Me',
        status: 'unread'
    }]);

    const updatedStore = useLibraryStore.getState();
    expect(updatedStore.books).toHaveLength(1);
    expect(updatedStore.books[0].title).toBe('Persisted Book');
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

      await seedLibrary([{
          bookId,
          title: 'Reader Test Book',
          author: 'Tester',
          status: 'unread',
          lastInteraction: 0,
          epubBlob: buffer.buffer
      }]);

      // 2. Initialize Reader Store (simulating component mount)
      const readerStore = useReaderStore.getState();
      readerStore.setCurrentBookId(bookId);

      readerStore.updateLocation('cfi1', 0.5, 'Chapter 5');

      const state = useReaderStore.getState();
      expect(state.currentCfi).toBe('cfi1');
      expect(state.progress).toBe(0.5);
      expect(state.currentSectionTitle).toBe('Chapter 5');

      // Test TOC setting
      const mockToc = [{ id: '1', href: 'chap1.html', label: 'Chapter 1' }];
      readerStore.setToc(mockToc);
      expect(useReaderStore.getState().toc).toEqual(mockToc);

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
      expect(persistedProg.currentCfi).toBe('cfi1');
      expect(persistedProg.percentage).toBe(0.5);
      expect(persistedProg.lastRead).toBeDefined();
  });

});
