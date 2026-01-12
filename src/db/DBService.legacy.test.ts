import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { StaticBookManifest, UserInventoryItem, UserProgress, ReadingListEntry, StaticResource } from '../types/db';

// Mock ingestion (not used here but good to be consistent)
vi.mock('../lib/ingestion', () => ({
  processEpub: vi.fn(),
  generateFileFingerprint: vi.fn().mockResolvedValue('hash'),
}));

describe('DBService (Legacy Inventory & Progress)', () => {

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

    it('should use higher progress from reading list', async () => {
      const db = await getDB();
      const id = '1';

      await db.put('static_manifests', { bookId: id, title: 'A', author: 'A', schemaVersion: 1, fileHash: 'h1', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100, sourceFilename: 'book.epub' } as UserInventoryItem);
      // Local progress 10%
      await db.put('user_progress', { bookId: id, percentage: 0.1, lastRead: 0, completedRanges: [] } as UserProgress);
      // Reading list progress 50%
      await db.put('user_reading_list', { filename: 'book.epub', title: 'A', author: 'A', percentage: 0.5, lastUpdated: 0 } as ReadingListEntry);

      const library = await dbService.getLibrary();
      expect(library[0].progress).toBe(0.5);
    });
  });

  describe('getBook Metadata', () => {
     // Tests for metadata retrieval (no blob)
    it('should fallback to reading list progress if local is zero', async () => {
      const db = await getDB();
      const id = '1';
      const fileData = new TextEncoder().encode('data').buffer;

      await db.put('static_manifests', { bookId: id, title: 'A', author: 'A', schemaVersion: 1, fileHash: 'h1', fileSize: 0, totalChars: 0 } as StaticBookManifest);
      await db.put('user_inventory', { bookId: id, addedAt: 100, status: 'unread', tags: [], lastInteraction: 100, sourceFilename: 'book.epub' } as UserInventoryItem);
      // Local progress 0%
      await db.put('user_progress', { bookId: id, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
      // Reading list progress 50%
      await db.put('user_reading_list', { filename: 'book.epub', title: 'A', author: 'A', percentage: 0.5, lastUpdated: 0 } as ReadingListEntry);
      await db.put('static_resources', { bookId: id, epubBlob: fileData } as StaticResource);

      const result = await dbService.getBook(id);
      expect(result.metadata?.progress).toBe(0.5);
      expect(result.metadata?.currentCfi).toBeUndefined(); // Should still be undefined/local
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
});
