import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from './db/db';
import { useLibraryStore } from './store/useLibraryStore';
import { useReaderStore } from './store/useReaderStore';
import { useInventoryStore } from './store/useInventoryStore';
import { useAnnotationStore } from './store/useAnnotationStore';
import * as fs from 'fs';
import * as path from 'path';
import { CURRENT_BOOK_VERSION } from './lib/constants';
import type { StaticBookManifest, StaticResource, UserInventoryItem, UserProgress } from './types/db';

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
    // Simulate what processEpub does: writes to v18 stores and returns Metadata
    const db = await getDB();
    const bookId = 'mock-book-id';
    const title = "Alice's Adventures in Wonderland";
    const author = "Lewis Carroll";

    await db.put('static_manifests', {
      bookId,
      title,
      author,
      description: "Mock description",
      schemaVersion: CURRENT_BOOK_VERSION,
      fileHash: 'mock-hash',
      fileSize: 0,
      totalChars: 0,
      // Removed coverBlob to avoid fake-indexeddb issues
    } as StaticBookManifest);

    await db.put('user_inventory', {
      bookId,
      addedAt: Date.now(),
      status: 'unread',
      tags: [],
      lastInteraction: Date.now(),
      sourceFilename: 'alice.epub',
      // Explicitly set customTitle for the test expectation if store uses DB
      customTitle: title
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

    return {
        id: bookId,
        bookId,
        title,
        author,
        description: "Mock description",
        addedAt: Date.now(),
        filename: 'alice.epub',
        fileHash: 'mock-hash',
        fileSize: 0,
        totalChars: 0,
        version: CURRENT_BOOK_VERSION,
        progress: 0,
        isOffloaded: false
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
    useLibraryStore.setState({ isImporting: false, error: null });
    // Reset Inventory
    useInventoryStore.setState({ books: {} });
    useReaderStore.getState().reset();
    useAnnotationStore.setState({ annotations: {} });

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
    const updatedInventory = useInventoryStore.getState();
    const books = Object.values(updatedInventory.books);
    expect(books).toHaveLength(1);
    expect(books[0].customTitle).toContain("Alice's Adventures in Wonderland");

    // Verify DB
    const db = await getDB();
    const manifests = await db.getAll('static_manifests');
    expect(manifests).toHaveLength(1);
    const resources = await db.getAll('static_resources');
    expect(resources).toHaveLength(1);

    // 2. Delete Book
    const bookId = books[0].bookId;
    await store.removeBook(bookId);

    // Verify state after deleting
    const finalInventory = useInventoryStore.getState();
    const finalBooks = Object.values(finalInventory.books);
    expect(finalBooks).toHaveLength(0);

    // Verify DB empty
    const manifestsAfter = await db.getAll('static_manifests');
    expect(manifestsAfter).toHaveLength(0);
    const resourcesAfter = await db.getAll('static_resources');
    expect(resourcesAfter).toHaveLength(0);
  });

  it('should persist data updates in store', async () => {
    // Should verify that updates to the store are reflected
    const bookId = 'test-id';

    // Use Store Action
    useInventoryStore.getState().upsertBook({
      bookId, addedAt: Date.now(), status: 'unread', tags: [], lastInteraction: Date.now(), sourceFilename: 'test.epub'
    } as UserInventoryItem);

    // Verify
    const updatedStore = useInventoryStore.getState();
    expect(updatedStore.books[bookId]).toBeDefined();
    expect(updatedStore.books[bookId].status).toBe('unread');
  });

  it('should handle annotations (add, list, delete)', async () => {
    const bookId = 'book-1';

    // Use Annotation Store
    const store = useAnnotationStore.getState();
    const annotation = {
      // id is ignored by addAnnotation
      bookId,
      cfiRange: 'epubcfi(/6/4[chapter1]!/4/2/1:0)',
      text: 'Selected text',
      color: 'yellow',
      type: 'highlight',
      note: ''
    };

    // Add
    store.addAnnotation(annotation as any);

    // Verify
    const annotations = Object.values(useAnnotationStore.getState().annotations);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].text).toBe('Selected text');

    // Get the generated ID
    const generatedId = annotations[0].id;

    // Delete using the real ID
    store.deleteAnnotation(generatedId);

    // Verify
    const annotationsAfter = Object.values(useAnnotationStore.getState().annotations);
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
      bookId, addedAt: Date.now(), status: 'unread', tags: [], lastInteraction: 0
    } as UserInventoryItem);
    await db.put('user_progress', {
      bookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);
    await db.put('static_resources', { bookId, epubBlob: buffer.buffer } as StaticResource);

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
    expect(persistedProg).toBeDefined();
    if (persistedProg) {
      expect(persistedProg.currentCfi).toBe('cfi1');
      expect(persistedProg.percentage).toBe(0.5);
      expect(persistedProg.lastRead).toBeDefined();
    }
  });

});
