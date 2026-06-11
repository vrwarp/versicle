import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { StaticBookManifest, StaticResource, NavigationItem } from '~types/db';
import type { BookExtractionData } from '@lib/ingestion';

describe('DBService', () => {

  beforeEach(async () => {
    // Clear DB before each test
    const db = await getDB();
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length > 0) {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const store of storeNames) {
        await tx.objectStore(store).clear();
      }
      await tx.done;
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('deleteBook', () => {
    it('should delete static/cache data for a book', async () => {
      const db = await getDB();
      const id = 'del-1';

      // Set up static and cache stores
      await db.put('static_manifests', { bookId: id, title: 'Del', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('static_resources', { bookId: id, epubBlob: new ArrayBuffer(0) } as StaticResource);
      await db.put('cache_render_metrics', { bookId: id, locations: 'loc' });
      await db.put('cache_session_state', { bookId: id, playbackQueue: [], updatedAt: 0 });

      await dbService.deleteBook(id);

      // Verify static/cache stores are cleared
      expect(await db.get('static_manifests', id)).toBeUndefined();
      expect(await db.get('static_resources', id)).toBeUndefined();
      expect(await db.get('cache_render_metrics', id)).toBeUndefined();
      expect(await db.get('cache_session_state', id)).toBeUndefined();
    });
  });

  describe('offloadBook', () => {
    it('should remove file blob from static_resources', async () => {
      const db = await getDB();
      const id = 'off-1';
      const fileContent = new Uint8Array([1, 2, 3]);

      await db.put('static_manifests', { bookId: id, title: 'Off', author: 'A', schemaVersion: 1, fileHash: 'existing-hash', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('static_resources', { bookId: id, epubBlob: fileContent.buffer } as StaticResource);

      await dbService.offloadBook(id);

      const resource = await db.get('static_resources', id);
      // After offload: resource blob is set to undefined
      expect(resource?.epubBlob).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should prevent saveTTSState from writing if cleaned up', async () => {
      const db = await getDB();
      const id = 'tts-clean-1';
      // Ensure no previous state
      await db.delete('cache_session_state', id);

      dbService.saveTTSState(id, []);

      dbService.cleanup();

      await new Promise(resolve => setTimeout(resolve, 1100));

      const state = await db.get('cache_session_state', id);
      expect(state).toBeUndefined();
    });
  });

  describe('regression: TTS cache alignment round-trip (alignmentData vs alignment drift)', () => {
    it('should return alignment written via cacheSegment', async () => {
      const key = 'align-rt-1';
      const timepoints = [{ timeSeconds: 0.5, charIndex: 3, type: 'word' }];

      await dbService.cacheSegment(key, new ArrayBuffer(4), timepoints);
      const row = await dbService.getCachedSegment(key);

      expect(row).toBeDefined();
      expect(row?.alignment).toEqual(timepoints);
    });

    it('should normalize legacy rows written under the old alignmentData field', async () => {
      const db = await getDB();
      const key = 'align-legacy-1';
      const timepoints = [{ timeSeconds: 1.0, charIndex: 7, type: 'word' }];

      // Simulate a row persisted by a pre-unification build.
      await db.put('cache_audio_blobs', {
        key,
        audio: new ArrayBuffer(2),
        alignmentData: timepoints,
        createdAt: 1,
        lastAccessed: 1,
      });

      const row = await dbService.getCachedSegment(key);
      expect(row?.alignment).toEqual(timepoints);
    });

    it('should not write the legacy alignmentData field for new rows', async () => {
      const db = await getDB();
      const key = 'align-new-1';
      const timepoints = [{ timeSeconds: 0.25, charIndex: 1, type: 'word' }];

      await dbService.cacheSegment(key, new ArrayBuffer(4), timepoints);
      const raw = await db.get('cache_audio_blobs', key);

      expect(raw?.alignment).toEqual(timepoints);
      expect(raw?.alignmentData).toBeUndefined();
    });
  });

  describe('updateBookStructure', () => {
    it('should throw error if book structure not found', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const id = 'non-existent-book';
      await expect(dbService.updateBookStructure(id, [])).rejects.toThrow(`Book structure not found for ${id}`);
    });

    it('should update toc if book structure exists', async () => {
      const db = await getDB();
      const id = 'struct-1';
      // Seed structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.put('static_structure', { bookId: id, toc: [], spineItems: [] } as any);

      const newToc: NavigationItem[] = [{ id: '1', href: 'h', label: 'L' }];
      await dbService.updateBookStructure(id, newToc);

      const updated = await db.get('static_structure', id);
      expect(updated?.toc).toEqual(newToc);
    });
  });

  // P3-1 entry gate (plan/overhaul/prep/phase3-storage-gateway.md §Test plan
  // "R"): characterization of the ingest→read round-trip, including the
  // Blob→ArrayBuffer normalization policy (WebKit's IDB structured clone does
  // not support Blob; ingest converts BEFORE the transaction, reads convert
  // back where the consumer wants a Blob). The bookContent repo carved in
  // P3-8 must keep every assertion here green unchanged.
  describe('characterization: ingest→read round-trip (P3-1 entry gate)', () => {
    const COVER_BYTES = [1, 2, 3, 250, 255];
    const EPUB_BYTES = [80, 75, 3, 4, 0, 200];
    const TABLE_IMG_BYTES = [82, 73, 70, 70, 9, 9];

    function makeExtractionData(bookId: string, title = 'Ingested Book'): BookExtractionData {
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
        inventory: {
          bookId,
          title,
          author: 'Char Author',
          addedAt: 1,
          lastInteraction: 1,
          tags: [],
          status: 'unread',
        },
        progress: { bookId, percentage: 0, lastRead: 0, completedRanges: [] },
        overrides: { bookId, lexicon: [] },
        readingListEntry: {
          filename: `${bookId}.epub`,
          title,
          author: 'Char Author',
          percentage: 0,
          lastUpdated: 1,
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
      await dbService.ingestBook(makeExtractionData(id), 'add');

      // Manifest bundle: manifest row + structure + resource presence.
      const bundle = await dbService.getManifestBundle(id);
      expect(bundle).toBeDefined();
      expect(bundle!.manifest.title).toBe('Ingested Book');
      expect(bundle!.hasResource).toBe(true);
      expect(bundle!.structure?.toc).toEqual([{ id: 'toc-1', href: 'ch1.html', label: 'Chapter 1' }]);
      expect(bundle!.structure?.spineItems).toHaveLength(2);

      // Bulk read preserves input-index mapping (missing ids stay undefined).
      const bulk = await dbService.getManifestBundleBulk(['missing-id', id]);
      expect(bulk[0]).toBeUndefined();
      expect(bulk[1]?.manifest.bookId).toBe(id);

      // TTS preparation row readable via the composite key.
      const tts = await dbService.getTTSContent(id, 'ch1.html');
      expect(tts?.sentences).toEqual([{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }]);

      // Sections are derived from spineItems sorted by play order.
      const sections = await dbService.getSections(id);
      expect(sections.map(s => s.sectionId)).toEqual(['ch1.html', 'ch2.html']);
      expect(sections.map(s => s.playOrder)).toEqual([0, 1]);
    });

    it('normalizes every Blob to ArrayBuffer at write time and back to Blob where reads want one', async () => {
      const id = 'ingest-rt-norm';
      await dbService.ingestBook(makeExtractionData(id), 'add');
      const db = await getDB();

      // Raw rows: covers, EPUB binaries, and table images are stored as
      // ArrayBuffer (never Blob), byte-identical to the source.
      const rawManifest = await db.get('static_manifests', id);
      expect(rawManifest?.coverBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(rawManifest!.coverBlob as unknown as ArrayBuffer))).toEqual(COVER_BYTES);

      const rawResource = await db.get('static_resources', id);
      expect(rawResource?.epubBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(rawResource!.epubBlob as ArrayBuffer))).toEqual(EPUB_BYTES);

      const rawTable = await db.get('cache_table_images', `${id}-table-cfi`);
      expect(rawTable?.imageBlob).toBeInstanceOf(ArrayBuffer);

      // getBookFile returns the stored ArrayBuffer as-is.
      const file = await dbService.getBookFile(id);
      expect(file).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(file as ArrayBuffer))).toEqual(EPUB_BYTES);

      // getTableImages re-wraps the stored ArrayBuffer as a Blob for the UI.
      const tables = await dbService.getTableImages(id);
      expect(tables).toHaveLength(1);
      expect(tables[0].imageBlob).toBeInstanceOf(Blob);
      const tableBytes = new Uint8Array(await tables[0].imageBlob.arrayBuffer());
      expect(Array.from(tableBytes)).toEqual(TABLE_IMG_BYTES);
    });

    it("mode 'overwrite' replaces a previously ingested book in place", async () => {
      // NOTE deliberately NOT characterized: a duplicate mode-'add' ingest
      // rejects with DatabaseError (ConstraintError on the first add), but
      // the aborted transaction's idb `done` promise then rejects with
      // nothing awaiting it — an unhandled rejection inherent to the current
      // DBService shape. The P3-8 bookContent repo routes writes through
      // write() (which always awaits tx.done inside the gate) and should pin
      // the duplicate-add rejection there.
      const id = 'ingest-rt-dup';
      await dbService.ingestBook(makeExtractionData(id), 'add');
      expect((await dbService.getManifestBundle(id))?.manifest.title).toBe('Ingested Book');

      await dbService.ingestBook(makeExtractionData(id, 'Overwritten'), 'overwrite');
      expect((await dbService.getManifestBundle(id))?.manifest.title).toBe('Overwritten');
    });

    it('offload deletes the binary resource; restore writes the new bytes back', async () => {
      const id = 'ingest-rt-off';
      await dbService.ingestBook(makeExtractionData(id), 'add');

      await dbService.offloadBook(id);
      expect((await dbService.getManifestBundle(id))?.hasResource).toBe(false);
      expect((await dbService.getAvailableResourceIds()).has(id)).toBe(false);
      expect(await dbService.getBookFile(id)).toBeUndefined();

      const restoredBytes = new Uint8Array([7, 7, 7, 7]).buffer;
      await dbService.restoreBookResource(id, restoredBytes);
      expect((await dbService.getManifestBundle(id))?.hasResource).toBe(true);
      const file = await dbService.getBookFile(id);
      expect(Array.from(new Uint8Array(file as ArrayBuffer))).toEqual([7, 7, 7, 7]);
    });

    it('saveLocations/getLocations round-trips (last write wins)', async () => {
      const id = 'ingest-rt-loc';
      await dbService.saveLocations(id, 'first');
      await dbService.saveLocations(id, 'second');
      expect((await dbService.getLocations(id))?.locations).toBe('second');
    });
  });
});
