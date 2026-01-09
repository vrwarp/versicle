import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import * as ingestion from '../lib/ingestion';
import type { Book, BookSource, BookState, StaticBookManifest, UserInventoryItem, UserProgress, StaticResource } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  processEpub: vi.fn(),
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

  describe('addBook', () => {
    it('should call processEpub', async () => {
      const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const processSpy = vi.mocked(ingestion.processEpub).mockResolvedValue('new-id');

      await dbService.addBook(file);
      expect(processSpy).toHaveBeenCalledWith(file, undefined, undefined);
    });

    it('should handle error', async () => {
      const file = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      vi.mocked(ingestion.processEpub).mockRejectedValue(new Error('Ingestion failed'));

      // Expect the generic error thrown by handleError
      await expect(dbService.addBook(file)).rejects.toThrow('An unexpected database error occurred');
    });
  });

  describe('getLibrary', () => {
    it('should return sorted books', async () => {
      const db = await getDB();

      // Seed using v18 stores
      await db.put('static_manifests', { bookId: '1', title: 'A', author: 'A', schemaVersion: 1, fileHash: 'h1', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: '1', addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
      await db.put('user_progress', { bookId: '1', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

      await db.put('static_manifests', { bookId: '2', title: 'B', author: 'B', schemaVersion: 1, fileHash: 'h2', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: '2', addedAt: 200, status: 'unread', tags: [], lastInteraction: 200 } as UserInventoryItem);
      await db.put('user_progress', { bookId: '2', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

      const library = await dbService.getLibrary();
      expect(library).toHaveLength(2);
      expect(library[0].id).toBe('2'); // Sorted by addedAt desc
      expect(library[1].id).toBe('1');
    });
  });

  describe('getBook', () => {
    it('should return book metadata and file', async () => {
      const db = await getDB();
      const id = '123';

      const fileData = new TextEncoder().encode('data').buffer;

      await db.put('static_manifests', { bookId: id, title: 'Test', author: 'A', schemaVersion: 1, fileHash: 'h1', fileSize: 100, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
      await db.put('static_resources', { bookId: id, epubBlob: fileData } as StaticResource);

      const result = await dbService.getBook(id);
      expect(result.metadata?.id).toBe(id);
      expect(result.metadata?.fileHash).toBe('h1');
      expect(result.file).toEqual(fileData);
    });

    it('should return undefined if book not found', async () => {
      const result = await dbService.getBook('non-existent');
      expect(result.metadata).toBeUndefined();
      expect(result.file).toBeUndefined();
    });
  });

  describe('deleteBook', () => {
    it('should delete book, file, and related data', async () => {
      const db = await getDB();
      const id = 'del-1';

      await db.put('static_manifests', { bookId: id, title: 'Del', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
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
        await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100, sourceFilename: 'f.epub' } as UserInventoryItem);
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

  describe('Annotation Operations', () => {
    it('should add and get annotations', async () => {
      const ann = { id: 'a1', bookId: 'b1', cfiRange: 'cfi1', text: 't1', color: 'red', created: 100, type: 'highlight' as const };
      await dbService.addAnnotation(ann);

      const res = await dbService.getAnnotations('b1');
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual(ann);
    });

    it('should delete annotation', async () => {
      const ann = { id: 'a1', bookId: 'b1', cfiRange: 'cfi1', text: 't1', color: 'red', created: 100, type: 'highlight' as const };
      await dbService.addAnnotation(ann);
      await dbService.deleteAnnotation('a1');
      const res = await dbService.getAnnotations('b1');
      expect(res).toHaveLength(0);
    });
  });

  describe('saveProgress', () => {
    it('should save progress debounced', async () => {
      // Use real timers for simplicity/reliability with async DB ops
      const db = await getDB();
      const id = 'prog-1';

      await db.put('static_manifests', { bookId: id, title: 'P', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

      dbService.saveProgress(id, 'cfi1', 0.1);
      dbService.saveProgress(id, 'cfi2', 0.2);

      // Wait > 1000ms
      await new Promise(resolve => setTimeout(resolve, 1100));

      const updated = await db.get('user_progress', id);
      expect(updated?.currentCfi).toBe('cfi2');
      expect(updated?.percentage).toBe(0.2);
    });
  });

  describe('cleanup', () => {
    it('should prevent saveProgress from writing if cleaned up', async () => {
      const db = await getDB();
      const id = 'clean-1';

      await db.put('static_manifests', { bookId: id, title: 'Clean', author: 'A', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100 } as UserInventoryItem);
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

      dbService.saveProgress(id, 'cfi-updated', 0.5);

      // Verify not yet written
      let updated = await db.get('user_progress', id);
      expect(updated?.percentage).toBe(0);

      // Cleanup
      dbService.cleanup();

      // Wait > 1000ms (real time)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify STILL not written
      updated = await db.get('user_progress', id);
      expect(updated?.percentage).toBe(0);
    });

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
});
