import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getConnection as getDB } from './data/connection';
import { useLibraryStore } from './store/useLibraryStore';
import { useBookStore } from './store/useBookStore';
import { useReaderUIStore } from './store/useReaderUIStore';
import { useReadingStateStore } from './store/useReadingStateStore';
import { libraryController } from './app/library/useImportController';
import { makeFullExtraction } from './test/harness/library';
import type { StaticBookManifest } from '~types/book';

// Mock zustand persistence
vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
  };
});

// Mock the extractor (Phase 7: the orchestrator's only heavy pure stage) —
// everything BELOW it (orchestrator → persistence → real IDB via
// fake-indexeddb → zustand/yjs stores) runs for real.
vi.mock('./domains/library/import/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./domains/library/import/extract')>();
  return {
    ...actual,
    extractBook: vi.fn(async (file: File, opts: { depth: 'metadata' | 'full' }) => {
      const { makeFullExtraction: make } = await import('./test/harness/library');
      const full = make({
        bookId: 'mock-book-id',
        title: "Alice's Adventures in Wonderland",
        author: 'Lewis Carroll',
      });
      const adjusted = {
        ...full,
        resource: { bookId: 'mock-book-id', epubBlob: file },
        inventory: { ...full.inventory, sourceFilename: file.name },
        readingListEntry: { ...full.readingListEntry, filename: file.name },
      };
      if (opts.depth === 'metadata') {
        return {
          depth: 'metadata' as const,
          title: adjusted.title,
          author: adjusted.author,
          description: '',
          language: 'en',
          contentHash: adjusted.contentHash,
          legacyFingerprint: adjusted.legacyFingerprint,
          toc: [],
        };
      }
      return adjusted;
    }),
  };
});

describe('Feature Integration Tests', () => {
  vi.setConfig({ testTimeout: 120000 });
  beforeEach(async () => {
    // Clear DB (per-store one-shot clears — raw readwrite transactions are
    // banned outside src/data at Phase 3 exit)
    const db = await getDB();
    await db.clear('static_manifests');
    await db.clear('static_resources');
    await db.clear('static_structure');
    await db.clear('cache_tts_preparation');
    await db.clear('cache_search_text');

    // Reset stores
    useLibraryStore.setState({ staticMetadata: {}, isLoading: false, isImporting: false, error: null });
    useBookStore.setState({ books: {} });
    useReaderUIStore.getState().reset();
    useReadingStateStore.setState({ progress: {} });
  });

  it('should add a book, list it, and delete it (Library Management)', async () => {
    // 1. Add Book — through the ONE orchestrator entry (Phase 7 §B).
    const file = new File(['mock epub bytes'], 'alice.epub', { type: 'application/epub+zip' });
    await libraryController.importFile(file);

    // Verify Yjs state
    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    const book = Object.values(updatedStore.books)[0];
    expect(book.title).toContain("Alice's Adventures in Wonderland");

    // Verify IDB Static Content (the real ingest transaction ran)
    const db = await getDB();
    const manifests = await db.getAll('static_manifests');
    expect(manifests).toHaveLength(1);
    const resources = await db.getAll('static_resources');
    expect(resources).toHaveLength(1);
    // Phase 7 §F: the search corpus rides the ingest.
    const corpus = await db.get('cache_search_text', book.bookId);
    expect(corpus?.sections.length).toBeGreaterThan(0);

    // 2. Delete Book
    const bookId = book.bookId;
    await libraryController.removeBook(bookId);

    // Verify Yjs state
    const finalStore = useBookStore.getState();
    expect(Object.keys(finalStore.books)).toHaveLength(0);

    // Verify IDB empty (search corpus dies with the book)
    expect(await db.getAll('static_manifests')).toHaveLength(0);
    expect(await db.getAll('static_resources')).toHaveLength(0);
    expect(await db.get('cache_search_text', bookId)).toBeUndefined();
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

    await libraryController.hydrate();

    const updatedStore = useBookStore.getState();
    expect(Object.keys(updatedStore.books)).toHaveLength(1);
    expect(updatedStore.books['test-id'].title).toBe('Persisted Book');
    // The projection hydrated the manifest from IDB.
    expect(useLibraryStore.getState().staticMetadata['test-id']?.title).toBe('Persisted Book');
  });

  it('keeps the fixture factory honest (sanity)', () => {
    const extraction = makeFullExtraction({ bookId: 'sanity' });
    expect(extraction.searchText.sections.length).toBeGreaterThan(0);
  });
});
