/**
 * Full local data wipe — the single owner of "Clear All Data" / SafeMode
 * "Reset Database". (Phase 3 D9: moved from src/db/wipe.ts; the dynamic
 * imports of the two writers it must stop — sync + Yjs persistence — are
 * INVERTED into the {@link registerWipeHook} registry so the data layer
 * never reaches upward into stores/sync. Registration lives in the app
 * composition manifest, src/app/boot/registerBootTasks.ts, where importing
 * store + sync is legal. SafeMode safety argument: registration happens at
 * manifest import time, not boot success — and if the app crashed before
 * the manifest loaded, neither writer was ever started, so the missing hook
 * stops nothing that runs.)
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
import { createLogger } from '@lib/logger';
import { closeConnection } from './connection';
import { closeDictionaryConnection } from './repos/dictionary';
import { playbackCache } from './repos/playbackCache';

const logger = createLogger('Wipe');

/**
 * Every IndexedDB database owned by the app. `versicle-yjs-staging` is the
 * Phase 4 staged-workspace-switch buffer (YJS_STAGING_DB_NAME) — transient,
 * but a wipe must not leave a stale staged workspace behind. `versicle-dict`
 * is the Phase 6 dictionary index (rebuildable static content, but a wipe
 * must still leave nothing behind).
 */
export const APP_DATABASES: readonly string[] = [
  'versicle-yjs',
  'versicle-yjs-staging',
  'EpubLibraryDB',
  'versicle-dict',
];

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
 * - `mockGenAI`    → mockGenAIResponse / mockGenAIError — LEGACY E2E keys.
 *                    The production seams that read them died in Phase 7
 *                    (mocks install via window.__versicleTest.genai.setMock);
 *                    the prefix stays so a wipe still scrubs stale keys from
 *                    old sessions.
 *
 * Only these are removed — never the whole origin's localStorage.
 */
export const APP_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  'versicle',
  '__VERSICLE_',
  'mockGenAI',
];

/**
 * CacheStorage caches created by app code: Piper voice model downloads
 * (PiperRuntime's `piper-voices-v1`) and the SW runtime caches from
 * src/sw.ts (Phase 8 §G) — /dict/* (`versicle-dict-assets`), /fonts/*
 * (`versicle-fonts-v1`), /piper/* runtime pieces
 * (`versicle-piper-runtime-v1`). Prefix-matched so `-vN` rotations stay
 * covered. The service-worker precache is intentionally left alone: it
 * holds no user data and is managed by the SW lifecycle.
 */
export const APP_CACHE_PREFIXES: readonly string[] = [
  'piper-voices',
  'versicle-dict-assets',
  'versicle-fonts',
  'versicle-piper-runtime',
];

/** Upper bound for any single flush/close/delete step so a wipe never hangs. */
const STEP_TIMEOUT_MS = 5000;

export interface WipeOptions {
  /** Reload the page after a successful wipe. Defaults to true. */
  reload?: boolean;
}

/**
 * A writer that must be stopped before storage is deleted (e.g. the
 * Firestore sync manager, the y-idb persistence binding).
 */
export interface WipeHook {
  /** Stable name; re-registering the same name replaces the hook (idempotent). */
  name: string;
  stop(): Promise<void> | void;
}

const wipeHooks = new Map<string, WipeHook>();

/**
 * Register a writer-stopping hook. Idempotent by name so a re-imported
 * composition manifest (HMR, repeated installs in tests) cannot double-stop.
 */
export function registerWipeHook(hook: WipeHook): void {
  wipeHooks.set(hook.name, hook);
}

/** Test-only: reset the registry between cases. */
export function clearWipeHooksForTests(): void {
  wipeHooks.clear();
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

/** Run every registered writer-stopping hook (each bounded by the step timeout). */
const runWipeHooks = async (): Promise<void> => {
  for (const hook of wipeHooks.values()) {
    try {
      await withTimeout(Promise.resolve(hook.stop()), `wipe hook '${hook.name}'`);
    } catch (error) {
      logger.warn(`Wipe hook '${hook.name}' failed (continuing):`, error);
    }
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
  //    in the window before the reload: first the registered hooks (sync
  //    manager, y-idb persistence — registered by the app's composition
  //    manifest), then the data layer's own writers.
  await runWipeHooks();
  playbackCache.dropPending(); // drop (never flush) the pending debounced session write
  try {
    await closeConnection();
  } catch (error) {
    // In SafeMode the EpubLibraryDB open itself may have failed; the wipe
    // must still proceed.
    logger.warn('Failed to close EpubLibraryDB cleanly before wipe (continuing):', error);
  }
  try {
    await closeDictionaryConnection();
  } catch (error) {
    logger.warn('Failed to close versicle-dict cleanly before wipe (continuing):', error);
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
