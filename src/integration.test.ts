import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from './db/db';
import { useLibraryStore } from './store/useLibraryStore';
import { useReaderStore } from './store/useReaderStore';
import * as fs from 'fs';
import * as path from 'path';

// Mock epub.js but preserve behavior for ingestion (metadata)
// while mocking behavior for Reader (rendering)
vi.mock('epubjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('epubjs')>();
  return {
    ...actual,
    default: vi.fn((data, options) => {
      const book = actual.default(data, options);

      // Spy/Mock renderTo
      book.renderTo = vi.fn().mockReturnValue({
        display: vi.fn(),
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
  beforeEach(async () => {
    // Clear DB
    const db = await getDB();
    const tx = db.transaction(['books', 'files', 'annotations'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.objectStore('annotations').clear();
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
    expect(updatedStore.books[0].coverBlob).toBeDefined();

    // Verify DB
    const db = await getDB();
    const booksInDb = await db.getAll('books');
    expect(booksInDb).toHaveLength(1);
    const filesInDb = await db.getAll('files');
    expect(filesInDb).toHaveLength(1);

    // 2. Delete Book
    const bookId = updatedStore.books[0].id;
    await store.removeBook(bookId);

    // Verify state after deleting
    const finalStore = useLibraryStore.getState();
    expect(finalStore.books).toHaveLength(0);

    // Verify DB empty
    const booksInDbAfter = await db.getAll('books');
    expect(booksInDbAfter).toHaveLength(0);
    const filesInDbAfter = await db.getAll('files');
    expect(filesInDbAfter).toHaveLength(0);
  });

  it('should persist data across store reloads', async () => {
    const db = await getDB();
    const bookId = 'test-id';
    await db.put('books', {
        id: bookId,
        title: 'Persisted Book',
        author: 'Me',
        addedAt: Date.now(),
    });

    const store = useLibraryStore.getState();
    await store.fetchBooks();

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
        createdAt: Date.now()
    };

    const tx = db.transaction('annotations', 'readwrite');
    await tx.objectStore('annotations').add(annotation);
    await tx.done;

    const annotations = await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].text).toBe('Selected text');

    const tx2 = db.transaction('annotations', 'readwrite');
    await tx2.objectStore('annotations').delete('ann-1');
    await tx2.done;

    const annotationsAfter = await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    expect(annotationsAfter).toHaveLength(0);
  });

  it('should track reading progress and persist it', async () => {
      // 1. Setup book in DB
      const db = await getDB();
      const bookId = 'reader-test-id';

      const fixturePath = path.resolve(__dirname, './test/fixtures/alice.epub');
      const buffer = fs.readFileSync(fixturePath);

      await db.put('books', {
          id: bookId,
          title: 'Reader Test Book',
          author: 'Tester',
          addedAt: Date.now(),
          progress: 0
      });
      await db.put('files', buffer.buffer, bookId); // Store as ArrayBuffer with key

      // 2. Initialize Reader Store (simulating component mount)
      const readerStore = useReaderStore.getState();
      readerStore.setCurrentBookId(bookId);

      readerStore.updateLocation('cfi1', 0.5, 'Chapter 5');

      const state = useReaderStore.getState();
      expect(state.currentCfi).toBe('cfi1');
      expect(state.progress).toBe(0.5);
      expect(state.currentChapterTitle).toBe('Chapter 5');

      // Test TOC setting
      const mockToc = [{ id: '1', href: 'chap1.html', label: 'Chapter 1' }];
      readerStore.setToc(mockToc);
      expect(useReaderStore.getState().toc).toEqual(mockToc);

      // Simulate the persistence logic used in ReaderView
      const saveProgress = async (id: string, cfi: string, prog: number) => {
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const book = await store.get(id);
        if (book) {
            book.currentCfi = cfi;
            book.progress = prog;
            book.lastRead = Date.now();
            await store.put(book);
        }
        await tx.done;
      };

      await saveProgress(bookId, 'cfi1', 0.5);

      // Verify DB persistence
      const persistedBook = await db.get('books', bookId);
      expect(persistedBook.currentCfi).toBe('cfi1');
      expect(persistedBook.progress).toBe(0.5);
      expect(persistedBook.lastRead).toBeDefined();
  });
});
