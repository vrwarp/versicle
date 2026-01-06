import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MigrationService } from '../../MigrationService';
import { CRDTService } from '../../CRDTService';
import { dbService } from '../../../../db/DBService';
import { CRDT_KEYS } from '../../types';

// Mock DBService
vi.mock('../../../../db/DBService', () => ({
  dbService: {
    getLibrary: vi.fn(),
    getAnnotations: vi.fn(),
    getReadingHistoryEntry: vi.fn(),
    getReadingList: vi.fn(),
  },
}));

// Mock CRDTService
vi.mock('../../CRDTService', async (importOriginal) => {
    // Basic mock of CRDTService that uses a real Y.Doc for logic verification
    const Y = await import('yjs');
    const doc = new Y.Doc();
    const CRDT_KEYS = {
        BOOKS: 'books',
        ANNOTATIONS: 'annotations',
        LEXICON: 'lexicon',
        HISTORY: 'history',
        READING_LIST: 'readingList',
        TRANSIENT: 'transient',
    };
    return {
        CRDTService: vi.fn().mockImplementation(() => ({
            doc: doc,
            waitForReady: vi.fn().mockResolvedValue(undefined),
            books: doc.getMap(CRDT_KEYS.BOOKS),
            annotations: doc.getArray(CRDT_KEYS.ANNOTATIONS),
            history: doc.getMap(CRDT_KEYS.HISTORY),
            readingList: doc.getMap(CRDT_KEYS.READING_LIST),
        })),
        crdtService: { // Mock the singleton export
             doc: doc,
             waitForReady: vi.fn().mockResolvedValue(undefined),
             books: doc.getMap(CRDT_KEYS.BOOKS),
             annotations: doc.getArray(CRDT_KEYS.ANNOTATIONS),
             history: doc.getMap(CRDT_KEYS.HISTORY),
             readingList: doc.getMap(CRDT_KEYS.READING_LIST),
        }
    };
});

describe('MigrationService', () => {
  let crdtServiceMock: any;
  let migrationService: MigrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-instantiate Y.Doc for fresh state
    const doc = new Y.Doc();
    crdtServiceMock = {
        doc,
        waitForReady: vi.fn().mockResolvedValue(undefined),
        books: doc.getMap('books'),
        annotations: doc.getArray('annotations'),
        history: doc.getMap('history'),
        readingList: doc.getMap('readingList'),
    };
    migrationService = new MigrationService(crdtServiceMock as unknown as CRDTService);
  });

  it('should skip migration if CRDT is already populated', async () => {
    crdtServiceMock.books.set('existing-book', { id: 'existing-book' });

    await migrationService.migrateIfNeeded();

    expect(dbService.getLibrary).not.toHaveBeenCalled();
  });

  it('should skip migration if legacy DB is empty', async () => {
    vi.mocked(dbService.getLibrary).mockResolvedValue([]);

    await migrationService.migrateIfNeeded();

    expect(dbService.getLibrary).toHaveBeenCalled();
    expect(crdtServiceMock.books.size).toBe(0);
  });

  it('should migrate books, annotations, and history from legacy DB', async () => {
    const mockBook = { id: 'book-1', title: 'Legacy Book' };
    const mockAnnotation = { id: 'anno-1', bookId: 'book-1', text: 'Note' };
    const mockHistory = { bookId: 'book-1', readRanges: ['cfi:/2/4'] };
    const mockReadingList = [{ filename: 'book.epub', percentage: 0.5 }];

    vi.mocked(dbService.getLibrary).mockResolvedValue([mockBook as any]);
    vi.mocked(dbService.getAnnotations).mockResolvedValue([mockAnnotation as any]);
    vi.mocked(dbService.getReadingHistoryEntry).mockResolvedValue(mockHistory as any);
    vi.mocked(dbService.getReadingList).mockResolvedValue(mockReadingList as any);

    await migrationService.migrateIfNeeded();

    // Verify Books
    expect(crdtServiceMock.books.has('book-1')).toBe(true);
    expect(crdtServiceMock.books.get('book-1')).toEqual(mockBook);

    // Verify Annotations
    expect(crdtServiceMock.annotations.length).toBe(1);
    expect(crdtServiceMock.annotations.get(0)).toEqual(mockAnnotation);

    // Verify History
    expect(crdtServiceMock.history.has('book-1')).toBe(true);
    expect(crdtServiceMock.history.get('book-1').toArray()).toEqual(['cfi:/2/4']);

    // Verify Reading List
    expect(crdtServiceMock.readingList.has('book.epub')).toBe(true);
    expect(crdtServiceMock.readingList.get('book.epub')).toEqual(mockReadingList[0]);
  });
});
