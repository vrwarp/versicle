import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { Annotation, BookMetadata, LexiconRule, ReadingListEntry } from '../../types/db';

// Mock dependencies BEFORE importing the service
vi.mock('../../db/DBService', () => ({
  dbService: {
    getLibrary: vi.fn(),
    getAllLexiconRules: vi.fn(),
    getReadingList: vi.fn(),
    getAnnotations: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  Logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Use async mock factory to ensure we use the same Yjs instance
vi.mock('../../lib/crdt/CRDTService', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();

  const service = {
    doc: doc,
    waitForReady: vi.fn().mockResolvedValue(true),
    get books() { return doc.getMap('books'); },
    get lexicon() { return doc.getArray('lexicon'); },
    get readingList() { return doc.getMap('readingList'); },
    get annotations() { return doc.getArray('annotations'); },
    get settings() { return doc.getMap('settings'); },
  };

  return {
    crdtService: service,
  };
});

// Import AFTER mocks
import { MigrationService } from '../MigrationService';
import { dbService } from '../../db/DBService';
import { crdtService } from '../../lib/crdt/CRDTService';

describe('MigrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Explicitly clear all data using Yjs transaction
    crdtService.doc.transact(() => {
      // Clear all keys from maps
      Array.from(crdtService.books.keys()).forEach(k => crdtService.books.delete(k));
      Array.from(crdtService.readingList.keys()).forEach(k => crdtService.readingList.delete(k));
      Array.from(crdtService.settings.keys()).forEach(k => crdtService.settings.delete(k));

      // Clear arrays
      if (crdtService.lexicon.length > 0) crdtService.lexicon.delete(0, crdtService.lexicon.length);
      if (crdtService.annotations.length > 0) crdtService.annotations.delete(0, crdtService.annotations.length);
    });
  });

  it('should skip migration if already completed', async () => {
    crdtService.settings.set('migration_phase_2c_complete', true);

    await MigrationService.hydrateIfNeeded();

    expect(dbService.getLibrary).not.toHaveBeenCalled();
    expect(dbService.getAllLexiconRules).not.toHaveBeenCalled();
  });

  it('should hydrate lexicon rules', async () => {
    const rules: LexiconRule[] = [
      { id: '1', original: 'foo', replacement: 'bar', created: 100, order: 2 },
      { id: '2', original: 'baz', replacement: 'qux', created: 100, order: 1 },
    ];
    vi.mocked(dbService.getAllLexiconRules).mockResolvedValue(rules);
    vi.mocked(dbService.getLibrary).mockResolvedValue([]);
    vi.mocked(dbService.getReadingList).mockResolvedValue([]);

    await MigrationService.hydrateIfNeeded();

    expect(crdtService.lexicon.length).toBe(2);
    const storedRules = crdtService.lexicon.toArray();
    expect(storedRules[0].id).toBe('2'); // Order 1
    expect(storedRules[1].id).toBe('1'); // Order 2
    expect(crdtService.settings.get('migration_phase_2c_complete')).toBe(true);
  });

  it('should hydrate reading list', async () => {
    const entries: ReadingListEntry[] = [
      { filename: 'book1.epub', title: 'Book 1', author: 'Author 1', percentage: 0.5, lastUpdated: 100 },
      { filename: 'book2.epub', title: 'Book 2', author: 'Author 2', percentage: 0.1, lastUpdated: 200 },
    ];
    vi.mocked(dbService.getReadingList).mockResolvedValue(entries);
    vi.mocked(dbService.getAllLexiconRules).mockResolvedValue([]);
    vi.mocked(dbService.getLibrary).mockResolvedValue([]);

    await MigrationService.hydrateIfNeeded();

    expect(crdtService.readingList.size).toBe(2);
    expect(crdtService.readingList.get('book1.epub')).toEqual(entries[0]);
    expect(crdtService.readingList.get('book2.epub')).toEqual(entries[1]);
  });

  it('should hydrate annotations', async () => {
    const books: BookMetadata[] = [
      { id: 'book1', title: 'Book 1', author: 'Author 1', addedAt: 100 },
    ];
    const annotations: Annotation[] = [
      { id: 'a1', bookId: 'book1', cfiRange: 'cfi1', text: 'text1', type: 'highlight', color: 'red', created: 100 },
    ];

    vi.mocked(dbService.getLibrary).mockResolvedValue(books);
    vi.mocked(dbService.getAnnotations).mockResolvedValue(annotations);
    vi.mocked(dbService.getAllLexiconRules).mockResolvedValue([]);
    vi.mocked(dbService.getReadingList).mockResolvedValue([]);

    await MigrationService.hydrateIfNeeded();

    expect(crdtService.annotations.length).toBe(1);
    expect(crdtService.annotations.get(0)).toEqual(annotations[0]);
  });

  it('should hydrate books metadata', async () => {
    const books: BookMetadata[] = [
      { id: 'book1', title: 'Book 1', author: 'Author 1', addedAt: 100 },
    ];
    vi.mocked(dbService.getLibrary).mockResolvedValue(books);
    vi.mocked(dbService.getAllLexiconRules).mockResolvedValue([]);
    vi.mocked(dbService.getReadingList).mockResolvedValue([]);
    vi.mocked(dbService.getAnnotations).mockResolvedValue([]);

    await MigrationService.hydrateIfNeeded();

    // Verify it exists in CRDT
    const bookMap = crdtService.books.get('book1');
    expect(bookMap).toBeDefined();

    // Check fields inside the Y.Map
    expect(bookMap.get('title')).toBe('Book 1');
    expect(bookMap.get('author')).toBe('Author 1');
  });
});
