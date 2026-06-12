/**
 * searchText repo contract (Phase 7 §F / PR-S3): round-trip, absence
 * semantics, and the delete-with-book guarantee (the row dies inside
 * bookContent.deleteBook's gated transaction).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchTextRepo, type CacheSearchTextRow } from './searchText';
import { bookContent } from './bookContent';
import { closeConnection } from '../connection';
import { DB_NAME } from '../schema';

function deleteAppDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const row = (bookId: string): CacheSearchTextRow => ({
  bookId,
  extractionVersion: 3,
  sections: [
    { href: 'ch1.xhtml', title: 'Chapter 1', text: 'Call me Ishmael.' },
    { href: 'ch2.xhtml', title: 'Chapter 2', text: 'The white whale swam.' },
  ],
});

describe('searchTextRepo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  it('round-trips a corpus row and reports absence as undefined', async () => {
    await expect(searchTextRepo.get('bk-1')).resolves.toBeUndefined();

    await searchTextRepo.put(row('bk-1'));
    await expect(searchTextRepo.get('bk-1')).resolves.toEqual(row('bk-1'));

    // Upsert replaces (one row per book).
    await searchTextRepo.put({ ...row('bk-1'), extractionVersion: 4 });
    await expect(searchTextRepo.get('bk-1')).resolves.toMatchObject({ extractionVersion: 4 });

    await searchTextRepo.delete('bk-1');
    await expect(searchTextRepo.get('bk-1')).resolves.toBeUndefined();
  });

  it('regression: deleting a book removes its search corpus in the same path (delete-with-book)', async () => {
    await searchTextRepo.put(row('bk-doomed'));
    await searchTextRepo.put(row('bk-survivor'));

    await bookContent.deleteBook('bk-doomed');

    await expect(searchTextRepo.get('bk-doomed')).resolves.toBeUndefined();
    await expect(searchTextRepo.get('bk-survivor')).resolves.toEqual(row('bk-survivor'));
  });
});
