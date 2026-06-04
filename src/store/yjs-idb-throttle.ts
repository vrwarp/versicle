import type * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';
import { createLogger } from '../lib/logger';

const logger = createLogger('YjsIdbThrottle');

const UPDATES_STORE = 'updates';

export interface ThrottleController {
    /** Detach handlers and best-effort flush any buffered updates. Call before persistence.destroy(). */
    teardown: () => Promise<void>;
    /** Force-drain the buffer immediately (mainly for tests). */
    flushNow: () => Promise<void>;
    /** Number of updates currently buffered (not yet written). */
    pendingCount: () => number;
}

export interface ThrottleOptions {
    /** Debounce window before a buffered batch is flushed (ms). */
    flushMs?: number;
}

const noopController: ThrottleController = {
    teardown: async () => {},
    flushNow: async () => {},
    pendingCount: () => 0,
};

/**
 * Replaces y-indexeddb's per-update, fire-and-forget IndexedDB writer with a
 * coalescing, single-in-flight writer.
 *
 * Why: stock y-indexeddb (`_storeUpdate`) opens a NEW readwrite transaction on the
 * `updates` store for EVERY Y.Doc update and never awaits it. During TTS the app
 * emits many rapid Yjs updates (reading position, progress, TTS index), so dozens of
 * concurrent readwrite transactions pile onto a single store. On WebKit that backlog
 * stops settling — transactions hang, which wedges the app's other IndexedDB work and,
 * through it, the single-chain TTS task sequencer. (Proven with verification/_idb_probe.js:
 * the wedged tests show multiple outstanding `updates` transactions lasting many seconds.)
 *
 * This installs a drop-in replacement that:
 *   • buffers Y.Doc updates in memory,
 *   • flushes them on a short debounce inside ONE transaction (one add() per update),
 *   • keeps at most one transaction in flight (serialized) — the next batch starts only
 *     after the previous transaction completes.
 *
 * The bytes written are identical to stock y-indexeddb (individual update rows in the
 * autoIncrement `updates` store); only the transaction cadence changes from "one txn per
 * update, unbounded concurrency" to "one txn per batch, at most one in flight". Reads,
 * hydration, the `synced` event, and the custom store are untouched.
 */
export function installThrottledYjsPersistence(
    persistence: IndexeddbPersistence,
    doc: Y.Doc,
    opts: ThrottleOptions = {}
): ThrottleController {
    const flushMs = opts.flushMs ?? 200;

    // Detach y-indexeddb's built-in per-update writer. We reach into the bound
    // `_storeUpdate` arrow it registered in its constructor; if a future y-indexeddb
    // changes that internal, we bail out and leave stock behaviour in place.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builtinWriter = (persistence as any)._storeUpdate as
        | ((u: Uint8Array, o: unknown) => void)
        | undefined;
    if (typeof builtinWriter !== 'function') {
        logger.warn('y-indexeddb _storeUpdate not found; leaving stock writer (version drift?)');
        return noopController;
    }
    doc.off('update', builtinWriter);

    const pending: Uint8Array[] = [];
    let flushing = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let torn = false;

    const getDb = (): IDBDatabase | null =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((persistence as any).db as IDBDatabase | null) ?? null;

    const writeBatch = (db: IDBDatabase, batch: Uint8Array[]): Promise<void> =>
        new Promise((resolve, reject) => {
            let txn: IDBTransaction;
            try {
                txn = db.transaction([UPDATES_STORE], 'readwrite');
            } catch (e) {
                reject(e);
                return;
            }
            txn.oncomplete = () => resolve();
            txn.onerror = () => reject(txn.error);
            txn.onabort = () => reject(txn.error);
            const store = txn.objectStore(UPDATES_STORE);
            // `updates` is an autoIncrement store — add() with no key (== idb.addAutoKey).
            for (const u of batch) store.add(u);
        });

    const runFlush = async (): Promise<void> => {
        timer = null;
        if (torn || flushing) return;
        if (pending.length === 0) return;
        const db = getDb();
        if (!db) {
            // persistence.db not resolved yet (startup race) — retry shortly.
            schedule();
            return;
        }
        flushing = true;
        const batch = pending.splice(0, pending.length);
        try {
            await writeBatch(db, batch);
            // Keep y-indexeddb's size counter accurate so its trim threshold still fires.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (persistence as any)._dbsize += batch.length;
        } catch (e) {
            // Don't drop data: re-buffer the batch and retry on the next tick.
            pending.unshift(...batch);
            logger.warn('Throttled Yjs flush failed; will retry', e);
        } finally {
            flushing = false;
            if (!torn && pending.length > 0) schedule();
        }
    };

    const schedule = (): void => {
        if (torn || timer !== null) return;
        timer = setTimeout(() => {
            void runFlush();
        }, flushMs);
    };

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
        // Skip updates that y-indexeddb itself applied while hydrating from IDB
        // (origin === persistence) — re-persisting those would be redundant.
        if (origin === persistence) return;
        pending.push(update);
        schedule();
    };
    doc.on('update', onUpdate);

    // Best-effort flush when the page is being hidden/unloaded, to narrow the window
    // where a hard reload could drop the last debounced batch.
    const onPageHide = (): void => {
        if (torn || flushing || pending.length === 0) return;
        const db = getDb();
        if (!db) return;
        const batch = pending.splice(0, pending.length);
        // Fire-and-forget here by necessity (unload context); best-effort only.
        writeBatch(db, batch).catch(() => {});
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('beforeunload', onPageHide);
    }

    const flushNow = async (): Promise<void> => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        // Drain fully, even if updates arrive mid-flush.
        while (pending.length > 0 || flushing) {
            if (torn) break;
            if (flushing) {
                await new Promise((r) => setTimeout(r, 10));
                continue;
            }
            await runFlush();
        }
    };

    const teardown = async (): Promise<void> => {
        torn = true;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        doc.off('update', onUpdate);
        if (typeof window !== 'undefined') {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('beforeunload', onPageHide);
        }
        // Wait for any in-flight batch to settle, then flush the remainder once.
        while (flushing) {
            await new Promise((r) => setTimeout(r, 10));
        }
        const db = getDb();
        if (db && pending.length > 0) {
            const batch = pending.splice(0, pending.length);
            await writeBatch(db, batch).catch(() => {});
        }
    };

    return { teardown, flushNow, pendingCount: () => pending.length };
}
