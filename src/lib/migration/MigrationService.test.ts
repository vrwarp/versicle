import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationService } from './MigrationService';
import { dbService } from '../../db/DBService';
import { crdtService } from '../crdt/CRDTService';
import { BookMetadata, ReadingListEntry, LexiconRule, Annotation } from '../../types/db';

// Mock dependencies
vi.mock('../../db/DBService', () => ({
  dbService: {
    getLibrary: vi.fn(),
    getReadingList: vi.fn(),
    getAllLexiconRules: vi.fn(),
    getAnnotations: vi.fn(),
    getDB: vi.fn(),
  }
}));

vi.mock('../crdt/CRDTService', () => {
    // We need a semi-functional mock for Yjs interactions
    const books = { size: 0, set: vi.fn(), get: vi.fn() };
    const readingList = { set: vi.fn() };
    const annotations = { push: vi.fn() };
    const lexicon = { push: vi.fn() };
    const settings = { get: vi.fn(), set: vi.fn() };

    return {
        crdtService: {
            waitForReady: vi.fn().mockResolvedValue(undefined),
            books: books,
            readingList: readingList,
            annotations: annotations,
            lexicon: lexicon,
            settings: settings,
            doc: {
                transact: (cb: Function) => cb()
            }
        }
    };
});

describe('MigrationService', () => {
  let migrationService: MigrationService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    // Re-instantiate service (it's stateless but good practice if we add state)
    // Actually it's exported as a singleton instance in source, so we just import the class
    // But for testing the logic, we can just use the exported instance if we mocked the deps correctly.
    // However, since we mocked the modules, the imported 'migrationService' might be using the mocked deps.
    // Let's rely on re-importing or just using the one we have.
    // Since we are unit testing the class logic, let's try to grab the class from the module if exported, or just use the instance.
    // The file exports `export class MigrationService` and `export const migrationService`.
  });

  it('should skip hydration if CRDT is already populated', async () => {
    // Setup
    vi.mocked(crdtService.settings.get).mockReturnValue(true);

    const ms = new MigrationService();
    await ms.hydrateIfNeeded();

    expect(dbService.getLibrary).not.toHaveBeenCalled();
  });

  it('should skip hydration if legacy DB is empty', async () => {
    vi.mocked(crdtService.settings.get).mockReturnValue(false);
    vi.mocked(dbService.getLibrary).mockResolvedValue([]);

    const ms = new MigrationService();
    await ms.hydrateIfNeeded();

    expect(dbService.getLibrary).toHaveBeenCalled();
    expect(dbService.getReadingList).not.toHaveBeenCalled();
  });

  it('should hydrate lexicon, reading list, and annotations correctly', async () => {
    vi.mocked(crdtService.settings.get).mockReturnValue(false);

    const mockBook: BookMetadata = { id: 'book-1', title: 'Test Book', author: 'Test Author', addedAt: 100 };
    vi.mocked(dbService.getLibrary).mockResolvedValue([mockBook]);

    const mockLexicon: LexiconRule[] = [
        { id: 'rule1', original: 'foo', replacement: 'bar', created: 100, order: 2 },
        { id: 'rule2', original: 'baz', replacement: 'qux', created: 200, order: 1 }
    ];
    vi.mocked(dbService.getAllLexiconRules).mockResolvedValue(mockLexicon);

    const mockReadingList: ReadingListEntry[] = [
        { filename: 'book.epub', title: 'Test Book', author: 'Test Author', percentage: 0.5, lastUpdated: 100 }
    ];
    vi.mocked(dbService.getReadingList).mockResolvedValue(mockReadingList);

    const mockAnnotations: Annotation[] = [
        { id: 'ann1', bookId: 'book-1', cfiRange: 'cfi1', text: 'txt', type: 'highlight', color: 'yellow', created: 100 }
    ];
    vi.mocked(dbService.getAnnotations).mockResolvedValue(mockAnnotations);

    const ms = new MigrationService();
    await ms.hydrateIfNeeded();

    // Verify calls
    expect(dbService.getAllLexiconRules).toHaveBeenCalled();
    expect(dbService.getReadingList).toHaveBeenCalled();
    expect(dbService.getAnnotations).toHaveBeenCalledWith('book-1');

    // Verify CRDT updates
    // Lexicon (should be sorted by order)
    expect(crdtService.lexicon.push).toHaveBeenCalledWith([
        mockLexicon[1], // order 1
        mockLexicon[0]  // order 2
    ]);

    // Reading List
    expect(crdtService.readingList.set).toHaveBeenCalledWith('book.epub', mockReadingList[0]);

    // Annotations
    expect(crdtService.annotations.push).toHaveBeenCalledWith(mockAnnotations);

    // Verify completion flag
    expect(crdtService.settings.set).toHaveBeenCalledWith('migration_phase_2c_complete', true);
  });
});
