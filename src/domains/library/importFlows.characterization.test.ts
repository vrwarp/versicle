/**
 * Import-flow characterization (Phase 7 entry gate, PR-0a/PR-0b service tier
 * in plan/overhaul/prep/phase7-library-google.md §Execution order).
 *
 * Pins the CURRENT behavior of the five import flows — single, batch, ZIP,
 * restore, reprocess(-shaped restore) — at the service seam (the injected
 * `IDBService` + the synced stores), so the ImportOrchestrator cutover
 * (PR-L2) can prove behavior preservation. Two assertions intentionally pin
 * P0-era GAPS that PR-L2 closes on purpose (marked inline): batch import
 * bypasses ghost matching and creates no ReadingListEntry. Those assertions
 * are updated in the SAME commit that changes the behavior, never silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { createLibraryStore, useBookStore } from '@store/useLibraryStore';
import { useReadingListStore } from '@store/useReadingListStore';
import {
  autoResetStores,
  makeLibraryDbDouble,
  makeBookMetadata,
  makeInventoryItem,
} from '@test/harness';
import { DuplicateBookError } from '~types/errors';
import type { StaticBookManifest } from '~types/db';
import { extractEpubsFromZip, processBatchImport } from '@lib/batch-ingestion';
import { extractBookMetadata } from '@lib/ingestion';

vi.mock('@lib/ingestion', () => ({
  extractBookMetadata: vi.fn(),
}));

vi.mock('@lib/batch-ingestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/batch-ingestion')>();
  return { ...actual, processBatchImport: vi.fn() };
});

const mockExtractBookMetadata = vi.mocked(extractBookMetadata);
const mockProcessBatchImport = vi.mocked(processBatchImport);

function makeManifest(overrides: Partial<StaticBookManifest> & Pick<StaticBookManifest, 'bookId'>): StaticBookManifest {
  return {
    title: `Title ${overrides.bookId}`,
    author: 'Imported Author',
    fileHash: 'legacy-fingerprint',
    fileSize: 123,
    totalChars: 1000,
    schemaVersion: 3,
    ...overrides,
  };
}

const epubFile = (name = 'test.epub') => new File(['epub-bytes'], name, { type: 'application/epub+zip' });

describe('import flows characterization', () => {
  autoResetStores(useBookStore, useReadingListStore);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the ghost probe finds nothing.
    mockExtractBookMetadata.mockResolvedValue({
      title: 'Unmatched Title',
      author: 'Unmatched Author',
      description: '',
      fileHash: 'probe-hash',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('single import', () => {
    it('registers inventory + reading-list entry + static metadata, clears offloaded, resets progress flags', async () => {
      const manifest = makeManifest({ bookId: 'b1', title: 'Moby Dick', author: 'Melville', coverPalette: [1, 2, 3] });
      const db = makeLibraryDbDouble({
        addBook: vi.fn(async () => manifest),
        getBookIdByFilename: vi.fn(() => undefined),
      });
      const store = createLibraryStore(db);
      store.setState({ offloadedBookIds: new Set(['b1']) });

      await store.getState().addBook(epubFile());

      const inv = useBookStore.getState().books['b1'];
      expect(inv).toMatchObject({
        bookId: 'b1',
        title: 'Moby Dick',
        author: 'Melville',
        sourceFilename: 'test.epub',
        status: 'unread',
        coverPalette: [1, 2, 3],
      });

      const entry = useReadingListStore.getState().entries['test.epub'];
      expect(entry).toMatchObject({
        filename: 'test.epub',
        title: 'Moby Dick',
        author: 'Melville',
        percentage: 0,
        status: 'to-read',
      });

      expect(store.getState().staticMetadata['b1']?.title).toBe('Moby Dick');
      expect(store.getState().offloadedBookIds.has('b1')).toBe(false);
      expect(store.getState().isImporting).toBe(false);
      expect(store.getState().importProgress).toBe(0);
    });

    it('throws DuplicateBookError on a filename already in the inventory, without importing', async () => {
      const db = makeLibraryDbDouble({
        addBook: vi.fn(async () => makeManifest({ bookId: 'never' })),
        getBookIdByFilename: vi.fn(() => undefined),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({
        books: { existing: makeInventoryItem({ bookId: 'existing', sourceFilename: 'test.epub' }) },
      });

      await expect(store.getState().addBook(epubFile())).rejects.toBeInstanceOf(DuplicateBookError);
      expect(db.addBook).not.toHaveBeenCalled();
      expect(store.getState().isImporting).toBe(false);
    });

    it('falls back to the DB filename index for duplicate detection', async () => {
      const db = makeLibraryDbDouble({
        addBook: vi.fn(async () => makeManifest({ bookId: 'never' })),
        getBookIdByFilename: vi.fn(() => 'db-hit'),
      });
      const store = createLibraryStore(db);

      await expect(store.getState().addBook(epubFile())).rejects.toBeInstanceOf(DuplicateBookError);
      expect(db.getBookIdByFilename).toHaveBeenCalledWith('test.epub');
    });

    it('overwrite replaces content but preserves addedAt/status/tags/rating and reading-list progress', async () => {
      const manifest = makeManifest({ bookId: 'b1', title: 'New Title', author: 'New Author' });
      const db = makeLibraryDbDouble({
        importBookWithId: vi.fn(async () => manifest),
        getBookIdByFilename: vi.fn(() => undefined),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({
        books: {
          b1: makeInventoryItem({
            bookId: 'b1',
            title: 'Old Title',
            sourceFilename: 'test.epub',
            addedAt: 111,
            status: 'completed',
            tags: ['keeper'],
            rating: 4,
          }),
        },
      });
      useReadingListStore.getState().upsertEntry({
        filename: 'test.epub',
        title: 'Old Title',
        author: 'Old Author',
        percentage: 0.5,
        lastUpdated: 1,
        status: 'currently-reading',
        rating: 0,
      });

      await store.getState().addBook(epubFile(), { overwrite: true });

      expect(db.importBookWithId).toHaveBeenCalledWith('b1', expect.any(File), expect.anything(), expect.any(Function));
      const inv = useBookStore.getState().books['b1'];
      expect(inv).toMatchObject({
        title: 'New Title',
        author: 'New Author',
        addedAt: 111,
        status: 'completed',
        tags: ['keeper'],
        rating: 4,
      });
      const entry = useReadingListStore.getState().entries['test.epub'];
      expect(entry).toMatchObject({ title: 'New Title', percentage: 0.5 });
    });

    it('links the binary to a ghost book matched by title+author instead of creating a new entry', async () => {
      mockExtractBookMetadata.mockResolvedValue({
        title: 'Ghost Title',
        author: 'Ghost Author',
        description: '',
        fileHash: 'probe-hash',
      });
      const manifest = makeManifest({ bookId: 'ghost-1', title: 'Ghost Title', author: 'Ghost Author' });
      const db = makeLibraryDbDouble({
        importBookWithId: vi.fn(async () => manifest),
        getBookIdByFilename: vi.fn(() => undefined),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({
        books: {
          'ghost-1': makeInventoryItem({
            bookId: 'ghost-1',
            title: 'Ghost Title',
            author: 'Ghost Author',
            sourceFilename: 'other-name.epub',
          }),
        },
      });

      await store.getState().addBook(epubFile('renamed.epub'));

      expect(db.importBookWithId).toHaveBeenCalledWith('ghost-1', expect.any(File), expect.anything(), expect.any(Function));
      expect(Object.keys(useBookStore.getState().books)).toEqual(['ghost-1']);
      expect(store.getState().staticMetadata['ghost-1']).toBeDefined();
    });
  });

  describe('batch import', () => {
    it('surfaces per-file outcomes {imported, skipped, failed} and upserts inventory in one batch', async () => {
      mockProcessBatchImport.mockResolvedValue({
        successful: [
          { manifest: makeManifest({ bookId: 'm1' }), sourceFilename: 'a.epub' },
          { manifest: makeManifest({ bookId: 'm2' }), sourceFilename: 'b.epub' },
        ],
        skipped: ['dup.epub'],
        failed: [{ filename: 'bad.zip', reason: 'corrupted' }],
      });
      const db = makeLibraryDbDouble({
        getBookMetadata: vi.fn(async (id: string) => makeBookMetadata({ id })),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
        getBookIdByFilename: vi.fn(() => undefined),
      });
      const store = createLibraryStore(db);

      await store.getState().addBooks([epubFile('a.epub'), epubFile('b.epub')]);

      expect(useBookStore.getState().books['m1']?.sourceFilename).toBe('a.epub');
      expect(useBookStore.getState().books['m2']?.sourceFilename).toBe('b.epub');
      expect(store.getState().batchImportSummary).toEqual({
        imported: 2,
        skipped: ['dup.epub'],
        failed: [{ filename: 'bad.zip', reason: 'corrupted' }],
      });
      expect(store.getState().isImporting).toBe(false);

      // PINNED P0 GAP (deliberately closed by PR-L2, phase7 doc §B): the
      // batch path registers NO reading-list entries today.
      expect(Object.keys(useReadingListStore.getState().entries)).toEqual([]);
      // PINNED P0 GAP: the batch path never runs the ghost probe today.
      expect(mockExtractBookMetadata).not.toHaveBeenCalled();
    });

    it('wires the same filename duplicate detection as the single path into the batch checks', async () => {
      mockProcessBatchImport.mockResolvedValue({ successful: [], skipped: [], failed: [] });
      const db = makeLibraryDbDouble({
        getBookMetadata: vi.fn(async (id: string) => makeBookMetadata({ id })),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
        getBookIdByFilename: vi.fn((name: string) => (name === 'in-db.epub' ? 'db-id' : undefined)),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({
        books: { inv1: makeInventoryItem({ bookId: 'inv1', sourceFilename: 'in-store.epub' }) },
      });

      await store.getState().addBooks([epubFile('a.epub')]);

      const checks = mockProcessBatchImport.mock.calls[0][4];
      expect(checks?.isDuplicate).toBeDefined();
      await expect(checks!.isDuplicate!('in-store.epub')).resolves.toBe(true);
      await expect(checks!.isDuplicate!('in-db.epub')).resolves.toBe(true);
      await expect(checks!.isDuplicate!('fresh.epub')).resolves.toBe(false);
    });
  });

  describe('restore', () => {
    it('uses the binary-restore path when a local manifest exists', async () => {
      const db = makeLibraryDbDouble({
        getBookMetadata: vi.fn(async (id: string) => makeBookMetadata({ id })),
        restoreBook: vi.fn(async () => undefined),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1' }) } });
      store.setState({ offloadedBookIds: new Set(['b1']) });

      await store.getState().restoreBook('b1', epubFile());

      expect(db.restoreBook).toHaveBeenCalledWith('b1', expect.any(File));
      expect(store.getState().offloadedBookIds.has('b1')).toBe(false);
      expect(store.getState().isImporting).toBe(false);
    });

    it('falls back to a full import-with-id when no local manifest exists (synced-book download)', async () => {
      const manifest = makeManifest({ bookId: 'b1', title: 'Downloaded' });
      const getBookMetadata = vi
        .fn<(id: string) => Promise<ReturnType<typeof makeBookMetadata> | undefined>>()
        .mockResolvedValueOnce(undefined) // restore probe: no manifest
        .mockResolvedValue(makeBookMetadata({ id: 'b1', title: 'Downloaded' }));
      const db = makeLibraryDbDouble({
        getBookMetadata,
        importBookWithId: vi.fn(async () => manifest),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
      });
      const store = createLibraryStore(db);
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1', addedAt: 42 }) } });

      await store.getState().restoreBook('b1', epubFile());

      expect(db.importBookWithId).toHaveBeenCalledWith('b1', expect.any(File), expect.anything(), expect.any(Function));
      expect(store.getState().staticMetadata['b1']?.title).toBe('Downloaded');
      expect(store.getState().staticMetadata['b1']?.addedAt).toBe(42);
    });
  });

  describe('ZIP expansion (real archive)', () => {
    it('extracts every .epub from a ZIP (nested paths flattened to basenames), skipping non-epubs', async () => {
      const zip = new JSZip();
      zip.file('one.epub', 'epub-one');
      zip.file('nested/two.epub', 'epub-two');
      zip.file('notes.txt', 'not an epub');
      const blob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([blob], 'books.zip', { type: 'application/zip' });

      const files = await extractEpubsFromZip(zipFile);

      expect(files.map((f) => f.name).sort()).toEqual(['one.epub', 'two.epub']);
      expect(files.every((f) => f.type === 'application/epub+zip')).toBe(true);
    });

    it('throws a descriptive error for a corrupted archive', async () => {
      const broken = new File(['definitely not a zip'], 'broken.zip', { type: 'application/zip' });
      await expect(extractEpubsFromZip(broken)).rejects.toThrow(/Failed to process ZIP file/);
    });
  });
});
