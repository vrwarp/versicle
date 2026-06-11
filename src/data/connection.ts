/**
 * The EpubLibraryDB connection owner (Phase 3, D2 in
 * plan/overhaul/prep/phase3-storage-gateway.md). Absorbs src/db/db.ts and
 * fixes its connection defects (▲18) — all format-free:
 *
 * - `blocked` / `blocking` / `terminated` are handled. `blocking` closes
 *   this connection so another tab's upgrade can proceed; `terminated`
 *   resets the cached promise so the next call reopens. The data layer
 *   never imports UI — app/boot wires the callbacks via
 *   {@link configureConnectionEvents}.
 * - A failed open no longer bricks DB access until reload: the open is
 *   retried (3 attempts, 250 ms backoff) and a rejected promise is evicted
 *   from the cache so a later call can try again (db.ts cached the
 *   rejection forever).
 * - `navigator.storage.persist()` is requested once after the first
 *   successful open (fire-and-forget, result logged) so the browser is far
 *   less likely to evict the library under storage pressure.
 *
 * The schema itself (store map + upgrade callback + version 24) lives in
 * ./schema.ts and is byte-identical to the src/db/db.ts original in this
 * PR — IDB v25 is exclusively P3-13.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { createLogger } from '@lib/logger';
import { DB_NAME, DB_VERSION, upgradeSchema, type EpubLibraryDB } from './schema';

const logger = createLogger('DB');

const OPEN_RETRY_ATTEMPTS = 3;
const OPEN_RETRY_BACKOFF_MS = 250;

/**
 * Connection lifecycle callbacks, wired by the app layer
 * (src/app/boot/openDatabase.ts) — the data layer stays UI-free.
 */
export interface ConnectionEvents {
  /** Our open is blocked by another tab still holding an older version. */
  onBlocked?(info: { oldVersion: number }): void;
  /**
   * We are blocking another tab's upgrade. The connection has already been
   * closed by the time this fires — the app should prompt a reload.
   */
  onBlocking?(): void;
  /** The browser killed the connection (e.g. storage eviction). */
  onTerminated?(): void;
}

let events: ConnectionEvents = {};

export function configureConnectionEvents(next: ConnectionEvents): void {
  events = next;
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>> | null = null;

let persistRequested = false;

/**
 * Ask the browser to mark this origin's storage as persistent so the
 * library cannot be silently evicted. Once per session, fire-and-forget
 * (D2; surfacing storage.estimate() in settings is P8).
 */
function requestPersistentStorageOnce(): void {
  if (persistRequested) return;
  persistRequested = true;
  const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
  if (typeof storage?.persist !== 'function') return;
  storage
    .persist()
    .then((granted) => {
      logger.info(`navigator.storage.persist(): ${granted ? 'granted' : 'denied'}`);
    })
    .catch((error) => {
      logger.warn('navigator.storage.persist() failed:', error);
    });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function openConnection(): Promise<IDBPDatabase<EpubLibraryDB>> {
  return openDB<EpubLibraryDB>(DB_NAME, DB_VERSION, {
    upgrade: upgradeSchema,
    blocked(currentVersion) {
      logger.warn(
        `Opening ${DB_NAME} v${DB_VERSION} is blocked by another connection still on v${currentVersion}.`,
      );
      events.onBlocked?.({ oldVersion: currentVersion });
    },
    blocking() {
      logger.warn(
        `This ${DB_NAME} connection is blocking a version upgrade in another tab — closing it.`,
      );
      // Release the connection so the other tab's upgrade can proceed; the
      // app-level callback decides how to prompt the user (reload).
      void closeConnection().then(() => events.onBlocking?.());
    },
    terminated() {
      logger.error(`The browser terminated the ${DB_NAME} connection unexpectedly.`);
      // Drop the dead connection so the next getConnection() reopens.
      dbPromise = null;
      events.onTerminated?.();
    },
  });
}

async function openWithRetry(): Promise<IDBPDatabase<EpubLibraryDB>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OPEN_RETRY_ATTEMPTS; attempt++) {
    try {
      return await openConnection();
    } catch (error) {
      lastError = error;
      logger.warn(`IndexedDB open attempt ${attempt}/${OPEN_RETRY_ATTEMPTS} failed:`, error);
      if (attempt < OPEN_RETRY_ATTEMPTS) await delay(OPEN_RETRY_BACKOFF_MS);
    }
  }
  throw lastError;
}

/**
 * The process-wide EpubLibraryDB connection (lazily opened, cached). On
 * open failure the rejection propagates to every concurrent caller, but the
 * cache is reset so a LATER call retries instead of being bricked until
 * reload.
 */
export function getConnection(): Promise<IDBPDatabase<EpubLibraryDB>> {
  if (!dbPromise) {
    const promise: Promise<IDBPDatabase<EpubLibraryDB>> = openWithRetry()
      .then((db) => {
        requestPersistentStorageOnce();
        return db;
      })
      .catch((error) => {
        // Reset-on-failure (▲18): only evict OUR promise — a blocking/
        // terminated handler or concurrent close may have replaced it.
        if (dbPromise === promise) dbPromise = null;
        throw error;
      });
    dbPromise = promise;
  }
  return dbPromise;
}

/** Close the connection (if open) and drop the cache. */
export async function closeConnection(): Promise<void> {
  if (!dbPromise) return;
  const promise = dbPromise;
  dbPromise = null;
  try {
    const db = await promise;
    db.close();
    logger.info('Database connection closed.');
  } catch {
    // The open itself failed — nothing to close.
  }
}
