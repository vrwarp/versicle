/**
 * The typed E2E test API: `window.__versicleTest`.
 *
 * One module owns the page-side seams the Playwright suite needs, instead of
 * scattering untyped `window.__*` globals through production code. Installed
 * ONLY from main.tsx behind `import.meta.env.DEV || VITE_E2E` (the
 * verification Docker build sets VITE_E2E=true); production builds never
 * execute this module.
 *
 * Lives at the src/ root next to main.tsx (its only importer): this is
 * composition-root wiring, not a lib/ service — and lib/ may not depend on
 * store/ (.dependency-cruiser.cjs `lib-not-to-store`). Its final home is
 * `app/` (master plan §2 rule 9, §5 P1b).
 *
 * The legacy globals (`__DISCONNECT_YJS__` in yjs-provider.ts, `__CLOSE_DB__`
 * in db.ts, the `__VERSICLE_MOCK_*` flags in FirestoreSyncManager) remain as
 * deprecated aliases for now — consolidating them is Phase 1 work
 * (plan/overhaul/README.md §2 rule 9, §5 P1b).
 */
import type { IndexeddbPersistence } from 'y-idb';
import { getYjsPersistence } from './store/yjs-provider';
import { dbService } from './db/DBService';
import { wipeAllData } from './db/wipe';
import { createLogger } from './lib/logger';

const logger = createLogger('TestApi');

export interface VersicleTestApi {
  /**
   * Deterministically flush every debounced persistence queue:
   *  - DBService `cache_session_state` writes (500ms debounce — the TTS
   *    playback queue / lastPauseTime mirror), and
   *  - the y-idb Yjs update queue (`writeDebounceMs: 200` — reading
   *    progress, annotations, the whole CRDT).
   *
   * Resolves once both queues are quiescent (all bytes handed to committed
   * IndexedDB transactions), so a `page.reload()` immediately afterwards
   * cannot lose state. Replaces the E2E suite's hardcoded 1500ms
   * `waitForPersistedWrites` sleep.
   */
  flushPersistence(): Promise<void>;

  /**
   * Full local data reset (both IndexedDB databases, Versicle-owned
   * localStorage keys, app caches) WITHOUT the page reload — the caller
   * (Playwright) controls navigation. Delegates to `wipeAllData`, the single
   * owner of "what counts as all local data".
   */
  resetApp(): Promise<void>;
}

declare global {
  interface Window {
    __versicleTest?: VersicleTestApi;
  }
}

/** Upper bound for a flush; a hung IDB transaction must fail the test loudly. */
const FLUSH_DEADLINE_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drain the y-idb persistence queue. The fork's public surface (see
 * dist/src/y-idb.d.ts) exposes the queue internals; we force `_flush()`
 * instead of waiting out the 200ms write debounce, then await the in-flight
 * transaction. Updates that arrive mid-flush land back in `_pendingUpdates`,
 * so loop until quiescent. (P4 vendors the fork as a workspace and can
 * expose a first-class `flush()` — track it there.)
 */
async function flushYjsPersistence(): Promise<void> {
  const persistence: IndexeddbPersistence | null = getYjsPersistence();
  if (!persistence) return;

  const deadline = Date.now() + FLUSH_DEADLINE_MS;
  while (!persistence._destroyed) {
    if (persistence._flushPromise) {
      // A transaction is in flight — wait for it (errors re-queue the batch
      // and are surfaced via the persistence 'error' event; the loop retries).
      await Promise.resolve(persistence._flushPromise).catch(() => undefined);
    } else if (persistence._pendingUpdates.length > 0) {
      if (!persistence._writing) {
        persistence._flush();
      }
      if (!persistence._flushPromise) {
        // The IDB connection is still opening; the constructor schedules a
        // flush once it is ready.
        await sleep(10);
      }
    } else if (persistence._writing) {
      await sleep(10);
    } else {
      return; // queue empty, nothing in flight — durable.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `[test-api] flushPersistence: y-idb queue did not drain within ${FLUSH_DEADLINE_MS}ms ` +
          `(pending=${persistence._pendingUpdates.length}, writing=${persistence._writing})`,
      );
    }
  }
}

export async function flushPersistence(): Promise<void> {
  // Both writers funnel through the shared exclusive IDB write lock
  // (src/lib/idb-write-lock.ts), so flushing them sequentially is also the
  // ordering the app itself guarantees.
  await dbService.flushSessionWrites();
  await flushYjsPersistence();
}

export function installTestApi(): void {
  if (typeof window === 'undefined') return;
  const api: VersicleTestApi = {
    flushPersistence,
    resetApp: () => wipeAllData({ reload: false }),
  };
  window.__versicleTest = api;
  logger.info('window.__versicleTest installed (DEV/VITE_E2E build)');
}
