import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { StaticBookManifest, StaticResource, NavigationItem } from '../types/db';

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
});
