import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import { StorageFullError } from '../types/errors';

describe('DBService QuotaExceededError', () => {
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

  it('should throw StorageFullError when IndexedDB quota is exceeded (DOMException code 22)', async () => {
    const db = await getDB();

    // Mock getDB to return a proxy that throws QuotaExceededError on transaction
    vi.spyOn(dbService as any, 'getDB').mockImplementation(async () => {
      const originalDb = await getDB();
      return {
        ...originalDb,
        transaction: () => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
      };
    });

    await expect(dbService.getBookMetadata('123')).rejects.toThrow(StorageFullError);
  });

  it('should throw StorageFullError when IndexedDB quota is exceeded (Error name QuotaExceededError)', async () => {
    const db = await getDB();

    // Mock getDB to return a proxy that throws QuotaExceededError on transaction
    vi.spyOn(dbService as any, 'getDB').mockImplementation(async () => {
      const originalDb = await getDB();
      return {
        ...originalDb,
        transaction: () => {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
      };
    });

    await expect(dbService.getBookMetadata('123')).rejects.toThrow(StorageFullError);
  });
});
