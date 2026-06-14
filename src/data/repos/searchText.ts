/**
 * Repo for `cache_search_text` — the persisted per-book search corpus
 * (Phase 7 §F; store created by the v26 migration step).
 *
 * Written at import (the unified extractor emits `searchText` for free) and
 * lazily on first search for pre-existing books; DELETED with the book
 * (bookContent.deleteBook removes the row in the same gated transaction).
 * Cache-domain: rebuildable, absence simply triggers re-extraction.
 *
 * Worker-safe like every repo: no store/UI imports; writes go through the
 * navigator.locks write-gate.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheSearchTextRow } from '../rows/cache';

class SearchTextRepo {
  /** The persisted corpus for a book, or undefined when never extracted. */
  async get(bookId: string): Promise<CacheSearchTextRow | undefined> {
    try {
      const db = await getConnection();
      return await db.get('cache_search_text', bookId);
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Upsert the corpus row (one row per book; keyPath bookId). */
  async put(row: CacheSearchTextRow): Promise<void> {
    try {
      await write(['cache_search_text'], (tx) => {
        tx.objectStore('cache_search_text').put(row);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Remove the corpus row (the book-deletion path also clears it in its own tx). */
  async delete(bookId: string): Promise<void> {
    try {
      await write(['cache_search_text'], (tx) => {
        tx.objectStore('cache_search_text').delete(bookId);
      });
    } catch (error) {
      handleDbError(error);
    }
  }
}

export const searchTextRepo = new SearchTextRepo();
export type { CacheSearchTextRow };
