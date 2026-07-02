/**
 * genaiLogs — the `versicle-genai-logs` IndexedDB database owner.
 *
 * Persists the GenAI activity-log ring buffer across app restarts (the
 * in-memory-only buffer kept losing the logs on every reload). Entries
 * arrive PRE-REDACTED from the GenAI clients (inlineData base64 bytes →
 * {byteCount, hash} — domains/google/genai/logging.ts), so nothing heavier
 * than the user's own prompt text is ever written; persisting that matches
 * the existing posture (`cache_search_text` already holds full book text).
 *
 * Deliberately a SEPARATE database, not a new object store in EpubLibraryDB
 * (the `versicle-dict` precedent): logs are ephemeral, device-local
 * diagnostics — so this needs no main-schema version bump, no slot in the
 * versioned migration registry, and no write-gate coordination (only the
 * app-layer mirror writes it, from one context). It IS enumerated by
 * `wipeAllData()` (../wipe.ts APP_DATABASES) so a full wipe leaves nothing
 * behind, and the wipe closes this connection first so the deletion cannot
 * be blocked by our own tab.
 *
 * All writes are serialized on one internal promise chain (append/prune/
 * clear run in submission order, so a clear can never lose a race against an
 * in-flight append) and are fail-soft: a persistence failure must never
 * break logging itself — the in-memory buffer keeps working regardless.
 * The wiring that mirrors the store's buffer into this repo lives in
 * src/app/google/genaiLogPersistence.ts.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createLogger } from '@lib/logger';

const logger = createLogger('GenAILogsDB');

export const GENAI_LOGS_DB_NAME = 'versicle-genai-logs';
const GENAI_LOGS_DB_VERSION = 1;
const STORE = 'logs';

/**
 * The persisted row — structurally identical to the domain's GenAILogEntry
 * (restated here because repos are the persisted-shape owners and the data
 * layer imports no domain modules). `payload` is the pre-redacted request/
 * response body; the optional fields are display context.
 */
export interface GenAILogRow {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'error';
  method: string;
  payload: unknown;
  bookTitle?: string;
  sectionTitle?: string;
  correlationId?: string;
}

interface GenAILogsDB extends DBSchema {
  logs: {
    key: string;
    value: GenAILogRow;
    indexes: { by_timestamp: number };
  };
}

let dbPromise: Promise<IDBPDatabase<GenAILogsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<GenAILogsDB>> {
  if (!dbPromise) {
    const promise = openDB<GenAILogsDB>(GENAI_LOGS_DB_NAME, GENAI_LOGS_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by_timestamp', 'timestamp');
        }
      },
      terminated() {
        logger.warn(`The browser terminated the ${GENAI_LOGS_DB_NAME} connection.`);
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

/**
 * One serialized write chain: ops run in submission order and swallow their
 * own failures (logged) — the chain must never wedge, and a failed persist
 * must never surface into the logging path.
 */
let opChain: Promise<void> = Promise.resolve();
function enqueueOp(op: (db: IDBPDatabase<GenAILogsDB>) => Promise<void>): void {
  opChain = opChain.then(async () => {
    try {
      await op(await getDb());
    } catch (err) {
      logger.warn('GenAI log persistence op failed:', err);
    }
  });
}

export const genaiLogsRepo = {
  /**
   * Persist one appended entry, then prune the oldest rows beyond `maxLogs`
   * (by timestamp). Fire-and-forget; serialized with every other write.
   */
  append(entry: GenAILogRow, maxLogs: number): void {
    enqueueOp(async (db) => {
      await db.put(STORE, entry);
      const count = await db.count(STORE);
      let excess = count - Math.max(1, maxLogs);
      if (excess <= 0) return;
      const tx = db.transaction(STORE, 'readwrite');
      let cursor = await tx.store.index('by_timestamp').openCursor();
      while (cursor && excess > 0) {
        await cursor.delete();
        excess -= 1;
        cursor = await cursor.continue();
      }
      await tx.done;
    });
  },

  /** Drop every persisted entry (mirrors the user's Clear Logs). */
  clear(): void {
    enqueueOp((db) => db.clear(STORE));
  },

  /** Load the persisted entries, oldest→newest, capped at `limit` newest. */
  async loadRecent(limit: number): Promise<GenAILogRow[]> {
    try {
      const db = await getDb();
      const all = await db.getAllFromIndex(STORE, 'by_timestamp');
      return all.slice(Math.max(0, all.length - limit));
    } catch (err) {
      logger.warn('Failed to load persisted GenAI logs:', err);
      return [];
    }
  },

  /** Await every write enqueued so far (tests; the wipe close below). */
  flush(): Promise<void> {
    return opChain;
  },
};

/**
 * Flush pending writes and close the connection so `wipeAllData()` (or a
 * test) can delete the database without our own tab blocking it. The next
 * repo call reopens lazily.
 */
export async function closeGenaiLogsConnection(): Promise<void> {
  await opChain.catch(() => {});
  const promise = dbPromise;
  dbPromise = null;
  opChain = Promise.resolve();
  if (promise) {
    const db = await promise.catch(() => null);
    db?.close();
  }
}
