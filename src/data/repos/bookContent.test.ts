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
