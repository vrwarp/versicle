/**
 * Full local data wipe — the single owner of "Clear All Data" / SafeMode
 * "Reset Database".
 *
 * User data lives across four browser storage surfaces:
 *  1. The `EpubLibraryDB` IndexedDB database (static book content, caches,
 *     checkpoints, sync log, flight snapshots).
 *  2. The `versicle-yjs` IndexedDB database (the Yjs CRDT holding the entire
 *     library inventory, progress, annotations, lexicon and reading lists,
 *     persisted via y-idb).
 *  3. Versicle-owned localStorage keys (device id, persisted zustand stores,
 *     migration/repair flags).
 *  4. App-created CacheStorage caches (downloaded Piper voice models).
 *
 * Historically each reset entry point cleared a hand-enumerated subset and
 * silently left the rest behind — most critically the entire `versicle-yjs`
 * database, so a "full wipe" resurrected all user data on reload. Entry
 * points must call `wipeAllData()` and must never enumerate stores themselves.
 *
 * Ordering matters: every writer is stopped/flushed BEFORE storage is
 * deleted, so nothing re-persists in the window before the page reloads.
 */
import { createLogger } from '../lib/logger';
import { closeDB } from './db';
import { dbService } from './DBService';

const logger = createLogger('Wipe');

/** Both IndexedDB databases owned by the app. */
export const APP_DATABASES: readonly string[] = ['versicle-yjs', 'EpubLibraryDB'];

/** Exact localStorage keys owned by the app (persisted zustand stores). */
export const APP_LOCAL_STORAGE_KEYS: readonly string[] = [
  'tts-storage',
  'sync-storage',
  'genai-storage',
  'local-history-storage',
  'google-services-storage',
  'drive-config-storage',
];

/**
 * localStorage key prefixes owned by the app:
 * - `versicle`     → versicle-device-id, versicle_cover_blob_repair_v1,
 *                    versicle_mock_firestore_snapshot
 * - `__VERSICLE_`  → __VERSICLE_MIGRATION_STATE__, __VERSICLE_WORKSPACES__
 * - `mockGenAI`    → mockGenAIResponse / mockGenAIError (E2E injection keys)
 *
 * Only these are removed — never the whole origin's localStorage.
 */
export const APP_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  'versicle',
  '__VERSICLE_',
  'mockGenAI',
];

/**
 * CacheStorage caches created by app code (Piper voice model downloads).
 * The service-worker precache is intentionally left alone: it holds no user
 * data and is managed by the SW lifecycle.
 */
export const APP_CACHE_PREFIXES: readonly string[] = ['piper-voices'];

/** Upper bound for any single flush/close/delete step so a wipe never hangs. */
const STEP_TIMEOUT_MS = 5000;

export interface WipeOptions {
  /** Reload the page after a successful wipe. Defaults to true. */
  reload?: boolean;
}

/** Awaits `promise`, but gives up (with a warning) after STEP_TIMEOUT_MS. */
const withTimeout = async (promise: Promise<unknown>, label: string): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), STEP_TIMEOUT_MS);
  });
  const result = await Promise.race([promise.then(() => 'done' as const), timeout]);
  clearTimeout(timer);
  if (result === 'timeout') {
    logger.warn(`${label} did not settle within ${STEP_TIMEOUT_MS}ms; continuing with wipe.`);
  }
};

/**
 * Stops the Firestore sync manager (if one was ever constructed) so no remote
 * update can trigger checkpoint/sync writes mid-wipe. Imported dynamically to
 * keep this module's static graph free of the firebase dependency tree.
 */
const stopSync = async (): Promise<void> => {
  try {
    const { FirestoreSyncManager } = await import('../lib/sync/FirestoreSyncManager');
    FirestoreSyncManager.resetInstance();
  } catch (error) {
    logger.warn('Failed to stop cloud sync before wipe (continuing):', error);
  }
};

/**
 * Flushes and closes the y-idb persistence so the `versicle-yjs` connection
 * is released (otherwise its deletion below would be blocked by our own tab)
 * and no debounced CRDT write can land after the database is deleted.
 */
const stopYjsPersistence = async (): Promise<void> => {
  try {
    const { disconnectYjs } = await import('../store/yjs-provider');
    await withTimeout(disconnectYjs(), 'Yjs persistence flush/close');
  } catch (error) {
    logger.warn('Failed to flush/close Yjs persistence before wipe (continuing):', error);
  }
};

type DeleteOutcome = 'deleted' | 'blocked';

/**
 * Deletes one IndexedDB database. Resolves 'blocked' when another tab still
 * holds a connection: the browser keeps the deletion queued until that tab
 * closes, but the data is still on disk right now, so the caller must surface
 * it instead of pretending the wipe succeeded.
 */
const deleteDatabase = (name: string): Promise<DeleteOutcome> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const timer = setTimeout(() => settle(() => {
      logger.warn(`deleteDatabase('${name}') did not settle within ${STEP_TIMEOUT_MS}ms; treating as blocked.`);
      resolve('blocked');
    }), STEP_TIMEOUT_MS);
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => settle(() => resolve('deleted'));
    request.onblocked = () => settle(() => resolve('blocked'));
    request.onerror = () => settle(() => reject(request.error ?? new Error(`Failed to delete database '${name}'`)));
  });

const isAppLocalStorageKey = (key: string): boolean =>
  APP_LOCAL_STORAGE_KEYS.includes(key) ||
  APP_LOCAL_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix));

/** Removes every Versicle-owned localStorage key; leaves other keys alone. */
const clearAppLocalStorage = (): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) keys.push(key);
    }
    for (const key of keys) {
      if (isAppLocalStorageKey(key)) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    logger.warn('Failed to clear localStorage during wipe (continuing):', error);
  }
};

/** Deletes the CacheStorage caches created by app code. */
const clearAppCaches = async (): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => APP_CACHE_PREFIXES.some(prefix => name.startsWith(prefix)))
        .map(name => caches.delete(name))
    );
  } catch (error) {
    logger.warn('Failed to clear CacheStorage during wipe (continuing):', error);
  }
};

/**
 * Wipes ALL local Versicle data, then reloads the page.
 *
 * Throws (after clearing everything it can) when a database deletion was
 * blocked by another tab, so the UI can tell the user the wipe is incomplete.
 */
export async function wipeAllData(options: WipeOptions = {}): Promise<void> {
  logger.info('Wiping all local data...');

  // 1. Stop every writer BEFORE deleting storage, so nothing can re-persist
  //    in the window before the reload.
  await stopSync();
  dbService.cleanup(); // drop the pending (debounced) session write
  await stopYjsPersistence();
  try {
    await closeDB();
  } catch (error) {
    // In SafeMode the EpubLibraryDB open itself may have failed; the wipe
    // must still proceed.
    logger.warn('Failed to close EpubLibraryDB cleanly before wipe (continuing):', error);
  }

  // 2. Delete both databases outright — no store enumeration to go stale.
  const blocked: string[] = [];
  if (typeof indexedDB !== 'undefined') {
    for (const name of APP_DATABASES) {
      if (await deleteDatabase(name) === 'blocked') {
        blocked.push(name);
      }
    }
  }

  // 3. Clear the remaining origin storage the app owns. This runs even when a
  //    database deletion was blocked: clear everything we can.
  clearAppLocalStorage();
  await clearAppCaches();

  if (blocked.length > 0) {
    throw new Error(
      `Could not delete: ${blocked.join(', ')}. Another Versicle tab is holding ` +
      'the database open — close all other Versicle tabs and try again.'
    );
  }

  logger.info('All local data wiped. Reloading...');
  if (options.reload !== false) {
    window.location.reload();
  }
}
