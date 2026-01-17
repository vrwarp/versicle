import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import * as ingestion from '../lib/ingestion';
import type { StaticBookManifest, UserInventoryItem, UserProgress, StaticResource, ReadingListEntry, NavigationItem } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  processEpub: vi.fn(),
  extractBookData: vi.fn(),
  generateFileFingerprint: vi.fn().mockResolvedValue('hash'),
}));

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
    vi.clearAllMocks();
  });

  describe('addBook', () => {
    it('should call extractBookData and ingestBook', async () => {
      const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const mockData = {
        metadata: { id: 'new-id', title: 'Test' },
        cover: new Blob([]),
        originalFile: file,
        assets: { images: {}, css: {} },
        ttsContent: [],
        tableImages: []
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extractSpy = vi.mocked(ingestion.extractBookData).mockResolvedValue(mockData as any);

      // Spy on ingestBook (real method)
      const ingestSpy = vi.spyOn(dbService, 'ingestBook').mockResolvedValue();

      await dbService.addBook(file);

      expect(extractSpy).toHaveBeenCalledWith(file, undefined, undefined);
      expect(ingestSpy).toHaveBeenCalledWith(mockData);
    });

    it('should handle error', async () => {
      const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      vi.mocked(ingestion.extractBookData).mockRejectedValue(new Error('Ingestion failed'));

      // Expect the generic error thrown by handleError
      await expect(dbService.addBook(file)).rejects.toThrow('An unexpected database error occurred');
    });
  });



  describe('deleteBook', () => {
    it('should delete book, file, and related data', async () => {
      const db = await getDB();
      const id = 'del-1';

      await db.put('static_manifests', { bookId: id, title: 'Del', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, title: 'Del', author: 'A', addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
      await db.put('static_resources', { bookId: id, epubBlob: new ArrayBuffer(0) } as StaticResource);

      await db.put('cache_render_metrics', { bookId: id, locations: 'loc' });
      await db.put('cache_session_state', { bookId: id, playbackQueue: [], updatedAt: 0 });
      await db.put('user_annotations', { id: 'ann-1', bookId: id, cfiRange: 'cfi', text: 'note', color: 'red', created: 0, type: 'highlight' });

      await dbService.deleteBook(id);

      expect(await db.get('static_manifests', id)).toBeUndefined();
      expect(await db.get('user_inventory', id)).toBeUndefined();
      expect(await db.get('user_progress', id)).toBeUndefined();
      expect(await db.get('static_resources', id)).toBeUndefined();
      expect(await db.get('cache_render_metrics', id)).toBeUndefined();
      expect(await db.get('cache_session_state', id)).toBeUndefined();
      expect(await db.get('user_annotations', 'ann-1')).toBeUndefined();
    });
  });

  describe('offloadBook', () => {
    it('should remove file and mark as offloaded', async () => {
      const db = await getDB();
      const id = 'off-1';
      const fileContent = new Uint8Array([1, 2, 3]);

      await db.put('static_manifests', { bookId: id, title: 'Off', author: 'A', schemaVersion: 1, fileHash: 'existing-hash', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, title: 'Off', author: 'A', addedAt: 100, status: 'unread', tags: [], lastInteraction: 100, sourceFilename: 'f.epub' } as UserInventoryItem);
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
      await db.put('static_resources', { bookId: id, epubBlob: fileContent.buffer } as StaticResource);

      await dbService.offloadBook(id);

      const resource = await db.get('static_resources', id);

      // After fix: resource blob is undefined
      expect(resource?.epubBlob).toBeUndefined();

      // Metadata helper check
      const meta = await dbService.getBookMetadata(id);
      expect(meta?.isOffloaded).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should prevent saveTTSState from writing if cleaned up', async () => {
      const db = await getDB();
      const id = 'tts-clean-1';
      // Ensure no previous state
      await db.delete('cache_session_state', id);

      dbService.saveTTSState(id, [], 1);

      dbService.cleanup();

      await new Promise(resolve => setTimeout(resolve, 1100));

      const state = await db.get('cache_session_state', id);
      expect(state).toBeUndefined();
    });
  });

  describe('updateBookStructure', () => {
    it('should throw error if book structure not found', async () => {
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
});
