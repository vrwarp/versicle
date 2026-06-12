/**
 * dictionary — the `versicle-dict` IndexedDB database owner
 * (Phase 6 §7.4, prep/phase6-reader-engine.md PR-11).
 *
 * Deliberately a SEPARATE database, not a new object store in
 * EpubLibraryDB: the dictionary is rebuildable static content (compiled
 * CC-CEDICT served from /dict/), not user data — so it needs no main-schema
 * version bump, no slot in the v25 migration registry, and no write-gate
 * coordination (no other tab/worker writes it). It IS enumerated by
 * `wipeAllData()` (../wipe.ts APP_DATABASES) so a full wipe leaves nothing
 * behind, and the wipe closes this connection first so the deletion cannot
 * be blocked by our own tab.
 *
 * Stores:
 *  - `entries`: key = headword (simplified OR traditional), value =
 *    [pinyin, definitions] — the compiled cedict.json tuple, verbatim.
 *  - `meta`:    key-value provenance/progress (importedAt, entryCount,
 *    source meta from cedict.meta.json when present).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createLogger } from '@lib/logger';

const logger = createLogger('DictDB');

export const DICT_DB_NAME = 'versicle-dict';
export const DICT_DB_VERSION = 1;

/** The compiled cedict.json tuple: [pinyin, definitions]. */
export type DictEntryTuple = [string, string];

interface DictDB extends DBSchema {
  entries: { key: string; value: DictEntryTuple };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<DictDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DictDB>> {
  if (!dbPromise) {
    const promise = openDB<DictDB>(DICT_DB_NAME, DICT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      },
      terminated() {
        logger.warn(`The browser terminated the ${DICT_DB_NAME} connection.`);
        dbPromise = null;
      },
    }).catch((error) => {
      // Reset-on-failure: a later call retries instead of caching the brick.
      if (dbPromise === promise) dbPromise = null;
      throw error;
    });
    dbPromise = promise;
  }
  return dbPromise;
}

export const dictionary = {
  /** One entry, or undefined. */
  async getEntry(word: string): Promise<DictEntryTuple | undefined> {
    const db = await getDb();
    return db.get('entries', word);
  },

  /** Batch lookup in ONE readonly transaction; misses are absent. */
  async getEntries(words: readonly string[]): Promise<Map<string, DictEntryTuple>> {
    const db = await getDb();
    const tx = db.transaction('entries', 'readonly');
    const result = new Map<string, DictEntryTuple>();
    await Promise.all(
      words.map(async (word) => {
        const entry = await tx.store.get(word);
        if (entry) result.set(word, entry);
      }),
    );
    await tx.done;
    return result;
  },

  /** One import chunk in ONE readwrite transaction. */
  async bulkPutEntries(chunk: ReadonlyArray<readonly [string, DictEntryTuple]>): Promise<void> {
    const db = await getDb();
    const tx = db.transaction('entries', 'readwrite');
    for (const [word, entry] of chunk) {
      void tx.store.put(entry, word);
    }
    await tx.done;
  },

  async countEntries(): Promise<number> {
    const db = await getDb();
    return db.count('entries');
  },

  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    const db = await getDb();
    return (await db.get('meta', key)) as T | undefined;
  },

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await getDb();
    await db.put('meta', value, key);
  },

  /** Drop everything (a failed import must not leave a half-built index). */
  async clearAll(): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(['entries', 'meta'], 'readwrite');
    void tx.objectStore('entries').clear();
    void tx.objectStore('meta').clear();
    await tx.done;
  },
};

/** Close the connection (wipe path: close before deleteDatabase). */
export async function closeDictionaryConnection(): Promise<void> {
  if (!dbPromise) return;
  const promise = dbPromise;
  dbPromise = null;
  try {
    (await promise).close();
  } catch {
    // The open itself failed — nothing to close.
  }
}
