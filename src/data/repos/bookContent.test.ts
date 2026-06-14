/**
 * bookContent repo contract suite (Phase 3 D5.3 / Test plan R).
 *
 * The ingest→read round-trip characterization (P3-1 entry gate) lives in
 * src/db/DBService.test.ts and keeps passing through the deprecated façade
 * until P3-12; this suite pins the surface that is NEW or CHANGED with the
 * carve: the duplicate-add rejection through write() (the old DBService
 * shape left an unhandled tx.done rejection — see the NOTE in the
 * characterization suite), replaceDerivedContent (absorbed from
 * lib/ingestion.ts's raw reprocess transaction), the bulk restore writers,
 * and the orphan scan/prune that moved out of MaintenanceService.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bookContent } from './bookContent';
import { getConnection } from '../connection';
import { idbWriteLockIdle } from '../write-gate';
import { DatabaseError } from '~types/errors';
import type { BookIngestData } from './bookContent';

function makeIngestData(bookId: string, title = 'Ingested Book'): BookIngestData {
  return {
    bookId,
    manifest: {
      bookId,
      title,
      author: 'Author',
      schemaVersion: 1,
      fileHash: `hash-${bookId}`,
      fileSize: 6,
      totalChars: 42,
      coverBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    },
    resource: {
      bookId,
      epubBlob: new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/epub+zip' }),
    },
    structure: {
      bookId,
      toc: [{ id: 'toc-1', href: 'ch1.html', label: 'Chapter 1' }],
      spineItems: [{ id: 'ch1.html', characterCount: 22, index: 0 }],
    },
    ttsContentBatches: [
      {
        id: `${bookId}-ch1.html`,
        bookId,
        sectionId: 'ch1.html',
        sentences: [{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
      },
    ],
    tableBatches: [
      {
        id: `${bookId}-table-cfi`,
        bookId,
        sectionId: 'ch1.html',
        cfi: 'epubcfi(/6/2!/4/8)',
        imageBlob: new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' }),
      },
    ],
  };
}

describe('data/repos/bookContent', () => {
  beforeEach(async () => {
    const db = await getConnection();
    const storeNames = Array.from(db.objectStoreNames);
    for (const store of storeNames) {
      await db.clear(store);
    }
    await idbWriteLockIdle();
  });

  describe("ingest mode 'add' duplicate rejection (pinned through write(), per the P3-1 NOTE)", () => {
    it('rejects a duplicate add with DatabaseError and leaves the original rows intact', async () => {
      await bookContent.ingest(makeIngestData('dup-1', 'Original'), 'add');
      await expect(bookContent.ingest(makeIngestData('dup-1', 'Imposter'), 'add'))
        .rejects.toBeInstanceOf(DatabaseError);

      // write() awaited tx.done inside the gate: no unhandled rejection, and
      // the aborted transaction left the original ingest untouched.
      const bundle = await bookContent.getManifestBundle('dup-1');
      expect(bundle?.manifest.title).toBe('Original');
      expect(bundle?.hasResource).toBe(true);
    });
  });

  describe('replaceDerivedContent (absorbed from ingestion.ts reprocess)', () => {
    it('atomically replaces structure + derived cache rows, dropping stale section rows', async () => {
      await bookContent.ingest(makeIngestData('rep-1'), 'add');

      // Old derived rows exist.
      expect((await bookContent.getTTSPreparation('rep-1', 'ch1.html'))?.sentences).toHaveLength(1);
      expect(await bookContent.getTableImages('rep-1')).toHaveLength(1);

      const manifest = await bookContent.getManifest('rep-1');
      manifest!.totalChars = 99;

      await bookContent.replaceDerivedContent('rep-1', {
        manifest,
        structure: {
          bookId: 'rep-1',
          toc: [{ id: 'toc-new', href: 'ch2.html', label: 'New Chapter' }],
          spineItems: [{ id: 'ch2.html', characterCount: 50, index: 0 }],
        },
        ttsPrep: [
          {
            id: 'rep-1-ch2.html',
            bookId: 'rep-1',
            sectionId: 'ch2.html',
            sentences: [{ text: 'New text.', cfi: 'epubcfi(/6/4!/4/2/1:0)' }],
          },
        ],
        tableImages: [
          {
            id: 'rep-1-new-table',
            bookId: 'rep-1',
            sectionId: 'ch2.html',
            cfi: 'epubcfi(/6/4!/4/8)',
            imageBlob: new Blob([new Uint8Array([9, 9])], { type: 'image/webp' }),
          },
        ],
      });

      // Manifest updated, structure swapped.
      expect((await bookContent.getManifest('rep-1'))?.totalChars).toBe(99);
      expect((await bookContent.getBookStructure('rep-1'))?.toc[0].id).toBe('toc-new');

      // Old per-section rows are GONE; new ones are present.
      expect(await bookContent.getTTSPreparation('rep-1', 'ch1.html')).toBeUndefined();
      expect((await bookContent.getTTSPreparation('rep-1', 'ch2.html'))?.sentences[0].text).toBe('New text.');
      const tables = await bookContent.getTableImages('rep-1');
      expect(tables).toHaveLength(1);
      expect(tables[0].id).toBe('rep-1-new-table');

      // Table image normalized to ArrayBuffer on disk (WebKit policy).
      const db = await getConnection();
      const rawTable = await db.get('cache_table_images', 'rep-1-new-table');
      expect(rawTable?.imageBlob).toBeInstanceOf(ArrayBuffer);
    });

    it('skips the manifest write when the book has no manifest row', async () => {
      await bookContent.replaceDerivedContent('ghost-1', {
        manifest: undefined,
        structure: { bookId: 'ghost-1', toc: [], spineItems: [] },
        ttsPrep: [],
        tableImages: [],
      });
      expect(await bookContent.getManifest('ghost-1')).toBeUndefined();
      expect(await bookContent.getBookStructure('ghost-1')).toBeDefined();
    });
  });

  describe('bulk restore writers (backup restore path)', () => {
    it('putManifests/putLocations write rows readable through the repo', async () => {
      await bookContent.putManifests([
        { bookId: 'pm-1', title: 'T', author: 'A', fileHash: 'h', fileSize: 1, totalChars: 1, schemaVersion: 1 },
      ]);
      await bookContent.putLocations([{ bookId: 'pm-1', locations: '{"x":1}' }]);

      expect((await bookContent.listManifests()).map(m => m.bookId)).toContain('pm-1');
      expect((await bookContent.getLocations('pm-1'))?.locations).toBe('{"x":1}');
      expect((await bookContent.listLocations()).map(l => l.bookId)).toContain('pm-1');
    });
  });

  describe('orphan scan/prune (moved from MaintenanceService raw IDB)', () => {
    it('counts and prunes records whose parent book is unknown', async () => {
      await bookContent.ingest(makeIngestData('keep-1'), 'add');
      await bookContent.ingest(makeIngestData('orphan-1'), 'add');
      await bookContent.saveLocations('orphan-1', 'loc');
      await bookContent.saveLocations('keep-1', 'loc');

      const valid = new Set(['keep-1']);
      const scan = await bookContent.scanOrphans(valid);
      expect(scan).toEqual({ files: 1, locations: 1, tts_prep: 1 });

      await bookContent.pruneOrphans(valid);

      const after = await bookContent.scanOrphans(valid);
      expect(after).toEqual({ files: 0, locations: 0, tts_prep: 0 });

      // The kept book is untouched.
      expect(await bookContent.getBookFile('keep-1')).toBeDefined();
      expect((await bookContent.getLocations('keep-1'))?.locations).toBe('loc');
      expect((await bookContent.getTTSPreparation('keep-1', 'ch1.html'))).toBeDefined();
    });
  });

  // Absorbed VERBATIM (modulo the repo method names) from
  // src/db/DBService.test.ts when the deprecated façade was deleted (P3-12;
  // test-absorption ledger, plan/overhaul/README.md §4 rule 8). This is the
  // P3-1 entry-gate characterization the carve was required to keep green.
  describe('characterization: ingest→read round-trip (absorbed from db/DBService.test.ts, P3-1 entry gate)', () => {
    const COVER_BYTES = [1, 2, 3, 250, 255];
    const EPUB_BYTES = [80, 75, 3, 4, 0, 200];
    const TABLE_IMG_BYTES = [82, 73, 70, 70, 9, 9];

    function makeExtractionData(bookId: string, title = 'Ingested Book'): BookIngestData {
      return {
        bookId,
        manifest: {
          bookId,
          title,
          author: 'Char Author',
          schemaVersion: 1,
          fileHash: `hash-${bookId}`,
          fileSize: EPUB_BYTES.length,
          totalChars: 42,
          coverBlob: new Blob([new Uint8Array(COVER_BYTES)], { type: 'image/jpeg' }),
        },
        resource: {
          bookId,
          epubBlob: new Blob([new Uint8Array(EPUB_BYTES)], { type: 'application/epub+zip' }),
        },
        structure: {
          bookId,
          toc: [{ id: 'toc-1', href: 'ch1.html', label: 'Chapter 1' }],
          spineItems: [
            { id: 'ch2.html', characterCount: 20, index: 1 },
            { id: 'ch1.html', characterCount: 22, index: 0 },
          ],
        },
        ttsContentBatches: [
          {
            id: `${bookId}-ch1.html`,
            bookId,
            sectionId: 'ch1.html',
            sentences: [{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
          },
        ],
        tableBatches: [
          {
            id: `${bookId}-table-cfi`,
            bookId,
            sectionId: 'ch1.html',
            cfi: 'epubcfi(/6/2!/4/8)',
            imageBlob: new Blob([new Uint8Array(TABLE_IMG_BYTES)], { type: 'image/webp' }),
          },
        ],
      };
    }

    it('ingests a 5-store payload and reads every artifact back', async () => {
      const id = 'ingest-rt-1';
      await bookContent.ingest(makeExtractionData(id), 'add');

      // Manifest bundle: manifest row + structure + resource presence.
      const bundle = await bookContent.getManifestBundle(id);
      expect(bundle).toBeDefined();
      expect(bundle!.manifest.title).toBe('Ingested Book');
      expect(bundle!.hasResource).toBe(true);
      expect(bundle!.structure?.toc).toEqual([{ id: 'toc-1', href: 'ch1.html', label: 'Chapter 1' }]);
      expect(bundle!.structure?.spineItems).toHaveLength(2);

      // Bulk read preserves input-index mapping (missing ids stay undefined).
      const bulk = await bookContent.getManifestBundleBulk(['missing-id', id]);
      expect(bulk[0]).toBeUndefined();
      expect(bulk[1]?.manifest.bookId).toBe(id);

      // TTS preparation row readable via the composite key.
      const tts = await bookContent.getTTSPreparation(id, 'ch1.html');
      expect(tts?.sentences).toEqual([{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }]);

      // Sections are derived from spineItems sorted by play order.
      const sections = await bookContent.getSections(id);
      expect(sections.map(s => s.sectionId)).toEqual(['ch1.html', 'ch2.html']);
      expect(sections.map(s => s.playOrder)).toEqual([0, 1]);
    });

    it('normalizes every Blob to ArrayBuffer at write time and back to Blob where reads want one', async () => {
      const id = 'ingest-rt-norm';
      await bookContent.ingest(makeExtractionData(id), 'add');
      const db = await getConnection();

      // Raw rows: covers, EPUB binaries, and table images are stored as
      // ArrayBuffer (never Blob), byte-identical to the source.
      const rawManifest = await db.get('static_manifests', id);
      expect(rawManifest?.coverBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(rawManifest!.coverBlob as ArrayBuffer))).toEqual(COVER_BYTES);

      const rawResource = await db.get('static_resources', id);
      expect(rawResource?.epubBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(rawResource!.epubBlob as ArrayBuffer))).toEqual(EPUB_BYTES);

      const rawTable = await db.get('cache_table_images', `${id}-table-cfi`);
      expect(rawTable?.imageBlob).toBeInstanceOf(ArrayBuffer);

      // getBookFile returns the stored ArrayBuffer as-is.
      const file = await bookContent.getBookFile(id);
      expect(file).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(file as ArrayBuffer))).toEqual(EPUB_BYTES);

      // getTableImages re-wraps the stored ArrayBuffer as a Blob for the UI.
      const tables = await bookContent.getTableImages(id);
      expect(tables).toHaveLength(1);
      expect(tables[0].imageBlob).toBeInstanceOf(Blob);
      const tableBytes = new Uint8Array(await tables[0].imageBlob.arrayBuffer());
      expect(Array.from(tableBytes)).toEqual(TABLE_IMG_BYTES);
    });

    it("mode 'overwrite' replaces a previously ingested book in place", async () => {
      const id = 'ingest-rt-dup';
      await bookContent.ingest(makeExtractionData(id), 'add');
      expect((await bookContent.getManifestBundle(id))?.manifest.title).toBe('Ingested Book');

      await bookContent.ingest(makeExtractionData(id, 'Overwritten'), 'overwrite');
      expect((await bookContent.getManifestBundle(id))?.manifest.title).toBe('Overwritten');
    });

    it('offload deletes the binary resource; restore writes the new bytes back', async () => {
      const id = 'ingest-rt-off';
      await bookContent.ingest(makeExtractionData(id), 'add');

      await bookContent.offloadBook(id);
      expect((await bookContent.getManifestBundle(id))?.hasResource).toBe(false);
      expect((await bookContent.getAvailableResourceIds()).has(id)).toBe(false);
      expect(await bookContent.getBookFile(id)).toBeUndefined();

      const restoredBytes = new Uint8Array([7, 7, 7, 7]).buffer;
      await bookContent.restoreResource(id, restoredBytes);
      expect((await bookContent.getManifestBundle(id))?.hasResource).toBe(true);
      const file = await bookContent.getBookFile(id);
      expect(Array.from(new Uint8Array(file as ArrayBuffer))).toEqual([7, 7, 7, 7]);
    });

    it('saveLocations/getLocations round-trips (last write wins)', async () => {
      const id = 'ingest-rt-loc';
      await bookContent.saveLocations(id, 'first');
      await bookContent.saveLocations(id, 'second');
      expect((await bookContent.getLocations(id))?.locations).toBe('second');
    });

    it('deleteBook deletes static and cache rows for the book', async () => {
      const db = await getConnection();
      const id = 'del-1';
      await bookContent.ingest(makeExtractionData(id), 'add');
      await db.put('cache_render_metrics', { bookId: id, locations: 'loc' });
      await db.put('cache_session_state', { bookId: id, playbackQueue: [], updatedAt: 0 });

      await bookContent.deleteBook(id);

      expect(await db.get('static_manifests', id)).toBeUndefined();
      expect(await db.get('static_resources', id)).toBeUndefined();
      expect(await db.get('static_structure', id)).toBeUndefined();
      expect(await db.get('cache_render_metrics', id)).toBeUndefined();
      expect(await db.get('cache_session_state', id)).toBeUndefined();
      expect(await db.get('cache_tts_preparation', `${id}-ch1.html`)).toBeUndefined();
      expect(await db.get('cache_table_images', `${id}-table-cfi`)).toBeUndefined();
    });

    it('updateToc throws DatabaseError when the book structure is missing', async () => {
      await expect(bookContent.updateToc('non-existent-book', []))
        .rejects.toThrow('Book structure not found for non-existent-book');
    });

    it('updateToc updates the toc when the structure exists', async () => {
      const id = 'struct-1';
      await bookContent.ingest(makeExtractionData(id), 'add');

      const newToc = [{ id: '1', href: 'h', label: 'L' }];
      await bookContent.updateToc(id, newToc);

      expect((await bookContent.getBookStructure(id))?.toc).toEqual(newToc);
    });
  });

  describe('offload drops only the resource (P13d: no useless manifest lock)', () => {
    it('offloadBook removes the resource record; manifest/structure stay', async () => {
      await bookContent.ingest(makeIngestData('off-1'), 'add');
      await bookContent.offloadBook('off-1');

      expect(await bookContent.getBookFile('off-1')).toBeUndefined();
      expect((await bookContent.getManifestBundle('off-1'))?.hasResource).toBe(false);
      expect((await bookContent.getAvailableResourceIds()).has('off-1')).toBe(false);
      expect(await bookContent.getManifest('off-1')).toBeDefined();
    });
  });
});
