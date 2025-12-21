import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import * as ingestion from '../lib/ingestion';
import type { BookMetadata } from '../types/db';

// Mock ingestion
vi.mock('../lib/ingestion', () => ({
  processEpub: vi.fn(),
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
      const book1 = { id: '1', title: 'A', addedAt: 100, isOffloaded: false, fileHash: 'h1', fileSize: 100, syntheticToc: [], totalChars: 0, author: 'A', description: '' };
      const book2 = { id: '2', title: 'B', addedAt: 200, isOffloaded: false, fileHash: 'h2', fileSize: 100, syntheticToc: [], totalChars: 0, author: 'B', description: '' };

      await db.put('books', book1);
      await db.put('books', book2);

      const library = await dbService.getLibrary();
      expect(library).toHaveLength(2);
      expect(library[0].id).toBe('2'); // Sorted by addedAt desc
      expect(library[1].id).toBe('1');
    });

    it('should filter invalid books', async () => {
      const db = await getDB();
      // missing required fields
      const invalidBook = { id: '3', addedAt: 300 } as unknown as BookMetadata;
      const validBook = { id: '1', title: 'A', addedAt: 100, isOffloaded: false, fileHash: 'h1', fileSize: 100, syntheticToc: [], totalChars: 0, author: 'A', description: '' };

      await db.put('books', invalidBook);
      await db.put('books', validBook);

      const library = await dbService.getLibrary();
      expect(library).toHaveLength(1);
      expect(library[0].id).toBe('1');
    });
  });

  describe('getBook', () => {
    it('should return book metadata and file', async () => {
      const db = await getDB();
      const id = '123';
      const book = { id, title: 'Test', addedAt: 100, isOffloaded: false, fileHash: 'h1', fileSize: 100, syntheticToc: [], totalChars: 0, author: 'A', description: '' };
      const fileData = new TextEncoder().encode('data').buffer;

      await db.put('books', book);
      await db.put('files', fileData, id);

      const result = await dbService.getBook(id);
      expect(result.metadata).toEqual(book);
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
      const book = { id, title: 'Del', addedAt: 100, isOffloaded: false, fileHash: 'h', fileSize: 10, syntheticToc: [], totalChars: 0, author: 'A', description: '' };
      await db.put('books', book);
      await db.put('files', new ArrayBuffer(0), id);
      await db.put('locations', { bookId: id, locations: 'loc' });
      await db.put('tts_queue', { bookId: id, queue: [], currentIndex: 0, updatedAt: 0 });
      await db.put('annotations', { id: 'ann-1', bookId: id, cfiRange: 'cfi', text: 'note', color: 'red', created: 0 });

      await dbService.deleteBook(id);

      expect(await db.get('books', id)).toBeUndefined();
      expect(await db.get('files', id)).toBeUndefined();
      expect(await db.get('locations', id)).toBeUndefined();
      expect(await db.get('tts_queue', id)).toBeUndefined();
      expect(await db.get('annotations', 'ann-1')).toBeUndefined();
    });
  });

  describe('offloadBook', () => {
    it('should remove file and mark as offloaded', async () => {
        const db = await getDB();
        const id = 'off-1';
        const fileContent = new Uint8Array([1, 2, 3]);

        // Provide fileHash to avoid async hashing issues in IDB transaction
        const book = { id, title: 'Off', addedAt: 100, isOffloaded: false, fileSize: 3, syntheticToc: [], totalChars: 0, author: 'A', description: '', fileHash: 'existing-hash' };
        await db.put('books', book);
        await db.put('files', fileContent.buffer, id);

        await dbService.offloadBook(id);

        const updatedBook = await db.get('books', id);
        expect(updatedBook?.isOffloaded).toBe(true);
        expect(updatedBook?.fileHash).toBe('existing-hash');
        expect(await db.get('files', id)).toBeUndefined();
    });
  });

  describe('Annotation Operations', () => {
    it('should add and get annotations', async () => {
      const ann = { id: 'a1', bookId: 'b1', cfiRange: 'cfi1', text: 't1', color: 'red', created: 100 };
      await dbService.addAnnotation(ann);

      const res = await dbService.getAnnotations('b1');
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual(ann);
    });

    it('should delete annotation', async () => {
      const ann = { id: 'a1', bookId: 'b1', cfiRange: 'cfi1', text: 't1', color: 'red', created: 100 };
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
      const book = { id, title: 'P', addedAt: 100, isOffloaded: false, fileHash: 'h', fileSize: 10, syntheticToc: [], totalChars: 0, author: 'A', description: '' };
      await db.put('books', book);

      dbService.saveProgress(id, 'cfi1', 0.1);
      dbService.saveProgress(id, 'cfi2', 0.2);

      // Wait > 1000ms
      await new Promise(resolve => setTimeout(resolve, 1100));

      const updated = await db.get('books', id);
      expect(updated?.currentCfi).toBe('cfi2');
      expect(updated?.progress).toBe(0.2);
    });
  });
});
