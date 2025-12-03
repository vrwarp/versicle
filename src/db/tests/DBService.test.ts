import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DBService } from '../DBService';
import { StorageFullError, DatabaseError } from '../../types/errors';
import * as dbModule from '../db';
import * as ingestionModule from '../../lib/ingestion';

// Mock dependencies
vi.mock('../db', () => ({
  getDB: vi.fn(),
}));

vi.mock('../../lib/ingestion', () => ({
  processEpub: vi.fn(),
}));

describe('DBService', () => {
  let dbService: DBService;
  let mockDB: any;

  beforeEach(() => {
    vi.useFakeTimers(); // Enable fake timers for debounce testing
    dbService = new DBService();
    mockDB = {
      getAll: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(),
      getAllFromIndex: vi.fn(),
      count: vi.fn(),
    };
    (dbModule.getDB as any).mockResolvedValue(mockDB);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('execute wrapper', () => {
    it('should throw StorageFullError on QuotaExceededError', async () => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      mockDB.getAll.mockRejectedValue(quotaError);

      await expect(dbService.getLibrary()).rejects.toThrow(StorageFullError);
    });

    it('should wrap unknown errors in DatabaseError', async () => {
      const unknownError = new Error('Something went wrong');
      mockDB.getAll.mockRejectedValue(unknownError);

      await expect(dbService.getLibrary()).rejects.toThrow(DatabaseError);
      await expect(dbService.getLibrary()).rejects.toThrow('Failed to fetch library.');
    });
  });

  describe('getLibrary', () => {
    it('should return all books', async () => {
      const books = [{ id: '1', title: 'Test Book' }];
      mockDB.getAll.mockResolvedValue(books);

      const result = await dbService.getLibrary();
      expect(result).toEqual(books);
      expect(mockDB.getAll).toHaveBeenCalledWith('books');
    });
  });

  describe('getBookMetadata', () => {
    it('should return book metadata', async () => {
      const book = { id: '1', title: 'Test Book' };
      mockDB.get.mockResolvedValue(book);

      const result = await dbService.getBookMetadata('1');
      expect(result).toEqual(book);
      expect(mockDB.get).toHaveBeenCalledWith('books', '1');
    });
  });

  describe('addBook', () => {
    it('should call processEpub and return id', async () => {
      const file = new File([''], 'test.epub');
      (ingestionModule.processEpub as any).mockResolvedValue('new-id');

      const result = await dbService.addBook(file);
      expect(result).toBe('new-id');
      expect(ingestionModule.processEpub).toHaveBeenCalledWith(file);
    });
  });

  describe('deleteBook', () => {
    it('should delete from all stores using a transaction', async () => {
      const tx = {
        objectStore: vi.fn().mockReturnValue({
            delete: vi.fn(),
            index: vi.fn().mockReturnValue({
                openCursor: vi.fn().mockResolvedValue(null) // No items to iterate
            })
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(tx);

      await dbService.deleteBook('1');

      expect(mockDB.transaction).toHaveBeenCalledWith(
        ['books', 'files', 'annotations', 'locations', 'lexicon'],
        'readwrite'
      );
      expect(tx.objectStore).toHaveBeenCalledWith('books');
      expect(tx.objectStore).toHaveBeenCalledWith('files');
    });
  });

  describe('saveProgress (Debounced)', () => {
    it('should debounce multiple calls and only write once', async () => {
        const tx = {
          objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ id: '1', progress: 0 }),
              put: vi.fn()
          }),
          done: Promise.resolve(),
        };
        mockDB.transaction.mockReturnValue(tx);

        // Call saveProgress multiple times rapidly
        dbService.saveProgress('1', 'cfi1', 0.1);
        dbService.saveProgress('1', 'cfi2', 0.2);
        dbService.saveProgress('1', 'cfi3', 0.3);

        // Should not have been called yet
        expect(mockDB.transaction).not.toHaveBeenCalled();

        // Fast-forward time
        vi.advanceTimersByTime(1000);

        // Wait for any pending promises to resolve (execute is async)
        await Promise.resolve();
        await Promise.resolve();

        // Should be called once with the last value
        expect(mockDB.transaction).toHaveBeenCalledTimes(1);
        expect(tx.objectStore('books').put).toHaveBeenCalledWith(expect.objectContaining({
            id: '1',
            currentCfi: 'cfi3',
            progress: 0.3
        }));
    });
  });

  describe('cleanupCache', () => {
    it('should remove oldest entries if count exceeds limit', async () => {
      mockDB.count.mockResolvedValue(110);

      let cursorCallCount = 0;
      const dynamicCursor = {
           delete: vi.fn(),
           continue: vi.fn().mockImplementation(async () => {
               cursorCallCount++;
               if (cursorCallCount < 15) return dynamicCursor;
               return null;
           })
      };

      const tx = {
        objectStore: vi.fn().mockReturnValue({
            index: vi.fn().mockReturnValue({
                openCursor: vi.fn().mockResolvedValue(dynamicCursor)
            })
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(tx);

      await dbService.cleanupCache(100);

      expect(mockDB.count).toHaveBeenCalledWith('tts_cache');
      expect(mockDB.transaction).toHaveBeenCalledWith('tts_cache', 'readwrite');
      expect(dynamicCursor.delete).toHaveBeenCalled();
    });

    it('should do nothing if count is within limit', async () => {
      mockDB.count.mockResolvedValue(50);
      await dbService.cleanupCache(100);
      expect(mockDB.transaction).not.toHaveBeenCalled();
    });
  });
});
