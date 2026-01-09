import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import * as ingestion from '../lib/ingestion';
import type { Book, BookSource, BookState } from '../types/db';

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

      const b1: Book = { id: '1', title: 'A', author: 'A', description: '', addedAt: 100 };
      const s1: BookSource = { bookId: '1', filename: 'A.epub' };
      const st1: BookState = { bookId: '1', isOffloaded: false };

      const b2: Book = { id: '2', title: 'B', author: 'B', description: '', addedAt: 200 };
      const s2: BookSource = { bookId: '2', filename: 'B.epub' };
      const st2: BookState = { bookId: '2', isOffloaded: false };

      await db.put('static_books', b1);
      await db.put('static_book_sources', s1);
      await db.put('user_book_states', st1);

      await db.put('static_books', b2);
      await db.put('static_book_sources', s2);
      await db.put('user_book_states', st2);

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
      const b: Book = { id, title: 'Test', author: 'A', description: '', addedAt: 100 };
      const s: BookSource = { bookId: id, fileHash: 'h1', fileSize: 100 };
      const st: BookState = { bookId: id, isOffloaded: false };

      const fileData = new TextEncoder().encode('data').buffer;

      await db.put('static_books', b);
      await db.put('static_book_sources', s);
      await db.put('user_book_states', st);
      await db.put('static_files', fileData, id);

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

      await db.put('static_books', { id, title: 'Del', author: 'A', description: '', addedAt: 100 });
      await db.put('static_book_sources', { bookId: id });
      await db.put('user_book_states', { bookId: id });
      await db.put('static_files', new ArrayBuffer(0), id);
      await db.put('cache_locations', { bookId: id, locations: 'loc' });
      await db.put('cache_tts_queue', { bookId: id, queue: [], currentIndex: 0, updatedAt: 0 });
      await db.put('user_annotations', { id: 'ann-1', bookId: id, cfiRange: 'cfi', text: 'note', color: 'red', created: 0, type: 'highlight' as const });

      await dbService.deleteBook(id);

      expect(await db.get('static_books', id)).toBeUndefined();
      expect(await db.get('static_book_sources', id)).toBeUndefined();
      expect(await db.get('user_book_states', id)).toBeUndefined();
      expect(await db.get('static_files', id)).toBeUndefined();
      expect(await db.get('cache_locations', id)).toBeUndefined();
      expect(await db.get('cache_tts_queue', id)).toBeUndefined();
      expect(await db.get('user_annotations', 'ann-1')).toBeUndefined();
    });
  });

  describe('offloadBook', () => {
    it('should remove file and mark as offloaded', async () => {
        const db = await getDB();
        const id = 'off-1';
        const fileContent = new Uint8Array([1, 2, 3]);

        await db.put('static_books', { id, title: 'Off', author: 'A', description: '', addedAt: 100 });
        await db.put('static_book_sources', { bookId: id, fileHash: 'existing-hash', filename: 'f.epub' });
        await db.put('user_book_states', { bookId: id, isOffloaded: false });
        await db.put('static_files', fileContent.buffer, id);

        await dbService.offloadBook(id);

        const updatedState = await db.get('user_book_states', id);
        expect(updatedState?.isOffloaded).toBe(true);
        expect(await db.get('static_files', id)).toBeUndefined();
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

      await db.put('static_books', { id, title: 'P', author: 'A', description: '', addedAt: 100 });
      await db.put('user_book_states', { bookId: id, progress: 0 });

      dbService.saveProgress(id, 'cfi1', 0.1);
      dbService.saveProgress(id, 'cfi2', 0.2);

      // Wait > 1000ms
      await new Promise(resolve => setTimeout(resolve, 1100));

      const updated = await db.get('user_book_states', id);
      expect(updated?.currentCfi).toBe('cfi2');
      expect(updated?.progress).toBe(0.2);
    });
  });

  describe('cleanup', () => {
    it('should prevent saveProgress from writing if cleaned up', async () => {
      const db = await getDB();
      const id = 'clean-1';

      await db.put('static_books', { id, title: 'Clean', author: 'A', description: '', addedAt: 100 });
      await db.put('user_book_states', { bookId: id, progress: 0 });

      dbService.saveProgress(id, 'cfi-updated', 0.5);

      // Verify not yet written
      let updated = await db.get('user_book_states', id);
      expect(updated?.progress).toBe(0);

      // Cleanup
      dbService.cleanup();

      // Wait > 1000ms (real time)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify STILL not written
      updated = await db.get('user_book_states', id);
      expect(updated?.progress).toBe(0);
    });

    it('should prevent saveTTSState from writing if cleaned up', async () => {
       const db = await getDB();
       const id = 'tts-clean-1';
       // Ensure no previous state
       await db.delete('cache_tts_queue', id);

       dbService.saveTTSState(id, [], 1);

       dbService.cleanup();

       await new Promise(resolve => setTimeout(resolve, 1100));

       const state = await db.get('cache_tts_queue', id);
       expect(state).toBeUndefined();
    });
  });
});
