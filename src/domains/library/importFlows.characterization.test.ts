/**
 * Import-flow characterization (Phase 7; entry gate PR-0a → cutover PR-L2).
 *
 * Written at the phase entry gate against the legacy `useLibraryStore`
 * workflows; now exercises the SAME flows through the ImportOrchestrator
 * with the persistence seam injected. Two assertions that pinned P0-era
 * GAPS flipped DELIBERATELY in the cutover commit (marked inline): the
 * batch path now runs ghost matching and registers reading-list entries.
 *
 * Absorbs (ledger rows 10–11): BookImportService.test.ts (restore
 * fingerprint verification → the acceptance cases below; the id-rewrite
 * assertions live in import/persist.test.ts) and batch-ingestion.test.ts
 * (per-file accounting; ZIP expansion pins live here + import/zip).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { useBookStore } from '@store/useBookStore';
import { useReadingListStore } from '@store/useReadingListStore';
import { useLibraryStore } from '@store/useLibraryStore';
import {
  autoResetStores,
  makeLibraryPersistenceDouble,
  makeTestLibrary,
  makeFullExtraction,
  makeBookMetadata,
  makeInventoryItem,
} from '@test/harness';
import type { LibraryPersistence, ImportOrchestratorDeps } from '@domains/library';
import { extractEpubsFromZip, computeLegacyFingerprint, computeContentHash } from '@domains/library';
import type { BookMetadataExtraction } from '@domains/library';

const epubFile = (name = 'test.epub') => new File(['epub-bytes'], name, { type: 'application/epub+zip' });

/** Fake extractor: depth-aware, deterministic ids derived from the filename. */
function makeFakeExtract(meta: { title?: string; author?: string } = {}): ImportOrchestratorDeps['extract'] {
  const fake = (async (file: File, opts: { depth: 'metadata' | 'full' }) => {
    const bookId = `id-${file.name.replace(/\W/g, '_')}`;
    const title = meta.title ?? `Title of ${file.name}`;
    const author = meta.author ?? 'Extracted Author';
    if (opts.depth === 'metadata') {
      const probe: BookMetadataExtraction = {
        depth: 'metadata',
        title,
        author,
        description: '',
        language: 'en',
        contentHash: `sha-${bookId}`,
        legacyFingerprint: `${file.name}-${title}-${author}-aa-bb`,
        toc: [],
      };
      return probe;
    }
    const full = makeFullExtraction({ bookId, title, author });
    return {
      ...full,
      inventory: { ...full.inventory, sourceFilename: file.name },
      readingListEntry: { ...full.readingListEntry, filename: file.name },
    };
  }) as ImportOrchestratorDeps['extract'];
  return fake;
}

function makeOrchestrator(
  db: Partial<LibraryPersistence>,
  opts: { extract?: ImportOrchestratorDeps['extract']; meta?: { title?: string; author?: string } } = {},
) {
  const persistence = makeLibraryPersistenceDouble({
    getBookIdByFilename: () => undefined,
    ingest: vi.fn(async () => undefined),
    ...db,
  });
  const lib = makeTestLibrary({
    persistence,
    extract: opts.extract ?? makeFakeExtract(opts.meta),
  });
  return { ...lib, persistence };
}

function resetProjection(): void {
  useLibraryStore.setState({
    staticMetadata: {},
    offloadedBookIds: new Set<string>(),
    isImporting: false,
    batchImportSummary: null,
    error: null,
  });
}

describe('import flows characterization', () => {
  autoResetStores(useBookStore, useReadingListStore);

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjection();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('single import', () => {
    it('registers inventory + reading-list entry (WITH bookId FK) + static metadata, clears offloaded, resets flags', async () => {
      const { orchestrator } = makeOrchestrator({});
      useLibraryStore.setState({ offloadedBookIds: new Set(['id-test_epub']) });

      const result = await orchestrator.importFile(epubFile());

      expect(result).toMatchObject({ status: 'imported', bookId: 'id-test_epub' });

      const inv = useBookStore.getState().books['id-test_epub'];
      expect(inv).toMatchObject({
        bookId: 'id-test_epub',
        title: 'Title of test.epub',
        author: 'Extracted Author',
        sourceFilename: 'test.epub',
        status: 'unread',
      });

      const entry = useReadingListStore.getState().entries['test.epub'];
      expect(entry).toMatchObject({
        filename: 'test.epub',
        title: 'Title of test.epub',
        percentage: 0,
        status: 'to-read',
        // Phase 7 §D: the FK is written at registration time.
        bookId: 'id-test_epub',
      });

      const state = useLibraryStore.getState();
      expect(state.staticMetadata['id-test_epub']?.title).toBe('Title of test.epub');
      expect(state.offloadedBookIds.has('id-test_epub')).toBe(false);
      expect(state.isImporting).toBe(false);
      expect(state.importProgress).toBe(0);
    });

    it("returns 'duplicate' for a filename already in the inventory, without importing", async () => {
      const { orchestrator, persistence } = makeOrchestrator({});
      useBookStore.setState({
        books: { existing: makeInventoryItem({ bookId: 'existing', sourceFilename: 'test.epub' }) },
      });

      const result = await orchestrator.importFile(epubFile());

      expect(result).toEqual({ status: 'duplicate', existingBookId: 'existing' });
      expect(persistence.ingest).not.toHaveBeenCalled();
      expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('falls back to the DB filename index for duplicate detection', async () => {
      const getBookIdByFilename = vi.fn(() => 'db-hit');
      const { orchestrator } = makeOrchestrator({ getBookIdByFilename });

      const result = await orchestrator.importFile(epubFile());

      expect(result).toEqual({ status: 'duplicate', existingBookId: 'db-hit' });
      expect(getBookIdByFilename).toHaveBeenCalledWith('test.epub');
    });

    it('replace preserves addedAt/status/tags/rating and reading-list progress', async () => {
      const ingest = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator({ ingest }, { meta: { title: 'New Title', author: 'New Author' } });
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

      const result = await orchestrator.importFile(epubFile(), { onDuplicate: 'replace' });

      expect(result).toMatchObject({ status: 'replaced', bookId: 'b1' });
      // The extraction is retargeted onto the EXISTING id and overwritten in place.
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 'b1' }),
        { mode: 'overwrite' },
      );
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
      expect(entry).toMatchObject({ title: 'New Title', percentage: 0.5, bookId: 'b1' });
    });

    it("skips with onDuplicate:'skip' (the batch policy)", async () => {
      const { orchestrator, persistence } = makeOrchestrator({});
      useBookStore.setState({
        books: { existing: makeInventoryItem({ bookId: 'existing', sourceFilename: 'test.epub' }) },
      });

      const result = await orchestrator.importFile(epubFile(), { onDuplicate: 'skip' });

      expect(result).toEqual({ status: 'skipped', filename: 'test.epub' });
      expect(persistence.ingest).not.toHaveBeenCalled();
    });

    it('links the binary to a ghost book matched by title+author instead of creating a new entry', async () => {
      const ingest = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator(
        { ingest },
        { meta: { title: 'Ghost Title', author: 'Ghost Author' } },
      );
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

      const result = await orchestrator.importFile(epubFile('renamed.epub'));

      expect(result).toMatchObject({ status: 'imported', bookId: 'ghost-1', adoptedGhost: true });
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 'ghost-1' }),
        { mode: 'overwrite' },
      );
      expect(Object.keys(useBookStore.getState().books)).toEqual(['ghost-1']);
      expect(useLibraryStore.getState().staticMetadata['ghost-1']).toBeDefined();
    });

    it('a failed extraction projects the error message and returns failed', async () => {
      const extract = vi.fn(async () => {
        throw new Error('Invalid file format. File must be a valid EPUB (ZIP archive).');
      }) as unknown as ImportOrchestratorDeps['extract'];
      const { orchestrator } = makeOrchestrator({}, { extract });

      const result = await orchestrator.importFile(epubFile());

      expect(result.status).toBe('failed');
      expect(useLibraryStore.getState().error).toBe('Failed to import book.');
      expect(useLibraryStore.getState().isImporting).toBe(false);
    });
  });

  describe('batch import', () => {
    it('surfaces per-file outcomes {imported, skipped, failed} and — closing the P0 gaps — registers reading-list entries with ghost matching', async () => {
      const { orchestrator } = makeOrchestrator({});
      useBookStore.setState({
        books: { dup: makeInventoryItem({ bookId: 'dup', sourceFilename: 'dup.epub' }) },
      });

      const summary = await orchestrator.importFiles([
        epubFile('a.epub'),
        epubFile('b.epub'),
        epubFile('dup.epub'),
        new File(['x'], 'notes.txt'),
      ]);

      expect(summary).toEqual({
        imported: 2,
        skipped: ['dup.epub'],
        failed: [{ filename: 'notes.txt', reason: 'Unsupported file type (expected .epub or .zip).' }],
      });
      expect(useLibraryStore.getState().batchImportSummary).toEqual(summary);

      expect(useBookStore.getState().books['id-a_epub']?.sourceFilename).toBe('a.epub');
      expect(useBookStore.getState().books['id-b_epub']?.sourceFilename).toBe('b.epub');

      // FLIPPED P0 PIN (entry gate pinned "no reading-list entries on the
      // batch path"; PR-L2 closes the gap deliberately — phase7 doc §B):
      expect(useReadingListStore.getState().entries['a.epub']).toMatchObject({ bookId: 'id-a_epub' });
      expect(useReadingListStore.getState().entries['b.epub']).toMatchObject({ bookId: 'id-b_epub' });
      expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('adopts ghosts on the batch path (the second flipped P0 pin)', async () => {
      const ingest = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator(
        { ingest },
        { meta: { title: 'Ghost Title', author: 'Ghost Author' } },
      );
      useBookStore.setState({
        books: {
          'ghost-1': makeInventoryItem({
            bookId: 'ghost-1',
            title: 'Ghost Title',
            author: 'Ghost Author',
            sourceFilename: 'elsewhere.epub',
          }),
        },
      });

      const summary = await orchestrator.importFiles([epubFile('renamed.epub')]);

      expect(summary.imported).toBe(1);
      // Linked to the existing record — no second inventory entry.
      expect(Object.keys(useBookStore.getState().books)).toEqual(['ghost-1']);
    });

    it('expands ZIPs and accounts for corrupted archives as failures', async () => {
      const expandZip = vi.fn(async (file: File) => {
        if (file.name === 'bad.zip') throw new Error('Failed to process ZIP file.');
        return [epubFile('inside.epub')];
      }) as unknown as ImportOrchestratorDeps['expandZip'];
      const persistence = makeLibraryPersistenceDouble({
        getBookIdByFilename: () => undefined,
        ingest: vi.fn(async () => undefined),
      });
      const { orchestrator } = makeTestLibrary({
        persistence,
        extract: makeFakeExtract(),
        expandZip,
      });

      const summary = await orchestrator.importFiles([
        new File(['z'], 'good.zip'),
        new File(['z'], 'bad.zip'),
      ]);

      expect(summary.imported).toBe(1);
      expect(summary.failed).toEqual([{ filename: 'bad.zip', reason: 'Failed to process ZIP file.' }]);
      expect(useBookStore.getState().books['id-inside_epub']).toBeDefined();
    });
  });

  describe('restore', () => {
    it('verifies via contentHash when the manifest has one, then restores the binary', async () => {
      const file = epubFile();
      const restoreResource = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator({
        getManifest: vi.fn(async () => ({
          bookId: 'b1',
          title: 'T',
          author: 'A',
          fileHash: 'legacy',
          contentHash: await computeContentHash(file),
          fileSize: 1,
          totalChars: 1,
          schemaVersion: 3,
        })),
        restoreResource,
        getBookMetadata: vi.fn(async () => makeBookMetadata({ id: 'b1' })),
      });
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1' }) } });
      useLibraryStore.setState({ offloadedBookIds: new Set(['b1']) });

      await orchestrator.restore('b1', file);

      expect(restoreResource).toHaveBeenCalledWith('b1', file);
      expect(useLibraryStore.getState().offloadedBookIds.has('b1')).toBe(false);
      expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('regression: accepts a RENAMED byte-identical file via the legacy tail and lazily upgrades the manifest (D7)', async () => {
      const original = epubFile('original.epub');
      const renamed = epubFile('renamed-by-the-os (1).epub');
      const storedFileHash = await computeLegacyFingerprint(original, {
        title: 'T',
        author: 'A',
        filename: 'original.epub',
      });

      const writeContentHash = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator({
        getManifest: vi.fn(async () => ({
          bookId: 'b1',
          title: 'T',
          author: 'A',
          fileHash: storedFileHash, // pre-P7 manifest: no contentHash
          fileSize: 1,
          totalChars: 1,
          schemaVersion: 3,
        })),
        restoreResource: vi.fn(async () => undefined),
        writeContentHash,
        getBookMetadata: vi.fn(async () => makeBookMetadata({ id: 'b1' })),
      });
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1' }) } });

      await orchestrator.restore('b1', renamed);

      expect(writeContentHash).toHaveBeenCalledWith('b1', await computeContentHash(renamed));
    });

    it('regression: rejects mismatched content with INGEST_FILE_MISMATCH (absorbed from BookImportService.test.ts)', async () => {
      const original = epubFile('book.epub');
      const storedFileHash = await computeLegacyFingerprint(original, {
        title: 'T',
        author: 'A',
        filename: 'book.epub',
      });
      const { orchestrator } = makeOrchestrator({
        getManifest: vi.fn(async () => ({
          bookId: 'b1',
          title: 'T',
          author: 'A',
          fileHash: storedFileHash,
          fileSize: 1,
          totalChars: 1,
          schemaVersion: 3,
        })),
      });

      const impostor = new File(['completely different bytes'], 'book.epub');
      await expect(orchestrator.restore('b1', impostor)).rejects.toMatchObject({
        code: 'INGEST_FILE_MISMATCH',
      });
      expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('falls back to a full import-with-id when no local manifest exists (synced-book download)', async () => {
      const ingest = vi.fn(async () => undefined);
      const { orchestrator } = makeOrchestrator({
        getManifest: vi.fn(async () => undefined),
        ingest,
      });
      useBookStore.setState({ books: { 'id-test_epub': makeInventoryItem({ bookId: 'id-test_epub', addedAt: 42 }) } });

      await orchestrator.restore('id-test_epub', epubFile());

      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 'id-test_epub' }),
        { mode: 'overwrite' },
      );
      expect(useLibraryStore.getState().staticMetadata['id-test_epub']?.addedAt).toBe(42);
    });
  });

  describe('reprocess (D6: same-book overlap is impossible)', () => {
    it('routes through the queue, updates the palette, refreshes the projection', async () => {
      const reprocess = vi.fn(async () => ({
        coverPalette: [9, 9, 9],
        perceptualPalette: undefined,
        searchText: { extractionVersion: 3, sections: [] },
      }));
      const { orchestrator } = makeOrchestrator({
        reprocess,
        getBookMetadata: vi.fn(async () => makeBookMetadata({ id: 'b1', title: 'Reprocessed' })),
      });
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1' }) } });

      await orchestrator.reprocess('b1');

      expect(reprocess).toHaveBeenCalledWith('b1', expect.objectContaining({ extraction: expect.anything() }));
      expect(useBookStore.getState().books['b1']?.coverPalette).toEqual([9, 9, 9]);
      expect(useLibraryStore.getState().staticMetadata['b1']?.title).toBe('Reprocessed');
    });

    it('serializes concurrent reprocess runs for the same book on its mutex', async () => {
      const order: string[] = [];
      const reprocess = vi.fn(async () => {
        order.push('start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('end');
        return { coverPalette: undefined, perceptualPalette: undefined, searchText: { extractionVersion: 3, sections: [] } };
      });
      const { orchestrator } = makeOrchestrator({
        reprocess,
        getBookMetadata: vi.fn(async () => undefined),
      });
      useBookStore.setState({ books: { b1: makeInventoryItem({ bookId: 'b1' }) } });

      await Promise.all([orchestrator.reprocess('b1'), orchestrator.reprocess('b1')]);

      // Never interleaved: start,end,start,end.
      expect(order).toEqual(['start', 'end', 'start', 'end']);
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
