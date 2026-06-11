import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-idb';
import { isStorageSupported } from '@lib/sync/support';
import { runExclusiveIdbWrite } from '@lib/idb-write-lock';
import { createLogger } from '@lib/logger';
import type { YjsOptions } from 'zustand-middleware-yjs';

const logger = createLogger('YjsProvider');

// ─── Schema Version ─────────────────────────────────────────────────────────
// Increment this when introducing breaking changes to Yjs-synced state.
// A bump REQUIRES a matching CrdtMigration step in src/app/migrations.ts
// (the coordinator throws on a version gap) and fixture-matrix coverage in
// src/store/__tests__/crdt-contract/migrations.test.ts.
// v6: popover residual key deleted, `meta` map dual-write (N+1 staged),
// preferences folded to one keyed map (copy-without-clear) — see
// plan/overhaul/prep/phase2-fork-surgery.md §5.3.
export const CURRENT_SCHEMA_VERSION = 6;

// Singleton Y.Doc - Source of Truth for User Data. Constructed lazily on
// first access instead of at module scope: importing this module (e.g. for
// CURRENT_SCHEMA_VERSION) must not create CRDT state. Synced stores still
// call getYDoc() while wiring their middleware at module init — full
// construction-on-boot lands with the P2 store registry.
let doc: Y.Doc | null = null;

export function getYDoc(): Y.Doc {
    if (!doc) {
        doc = new Y.Doc();
    }
    return doc;
}

let persistence: IndexeddbPersistence | null = null;
let persistenceStarted = false;

/**
 * Start the y-idb persistence binding for the shared Y.Doc. Idempotent.
 *
 * Called EXCLUSIVELY by the bootstrap `startYjsPersistence` phase
 * (src/app/boot/yjsPersistence.ts) — persistence used to boot here at import
 * time as a module-scope side effect (any store import started IndexedDB
 * writes before React rendered); now boot owns the moment explicitly.
 */
export function startYjsPersistence(): void {
    if (persistenceStarted) return;
    persistenceStarted = true;

    if (!isStorageSupported()) {
        logger.warn('IndexedDB not supported. Falling back to in-memory mode.');
        return;
    }

    try {
        persistence = new IndexeddbPersistence('versicle-yjs', getYDoc(), {
            writeDebounceMs: 200,
            transactionRunner: runExclusiveIdbWrite,
        });

        persistence.on('synced', () => {
            logger.info('Content loaded from IndexedDB (versicle-yjs)');
        });

        // Error handling for persistence layer
        // Note: IndexeddbPersistence doesn't emit 'error' in all versions, but good practice to have listeners if accessible
    } catch (error) {
        logger.error('Failed to initialize IndexedDB persistence:', error);
    }
}

/**
 * Live accessor for the persistence instance — null until
 * `startYjsPersistence()` has run, and again after `disconnectYjs()`.
 * Always read it through this function; never cache the instance.
 */
export function getYjsPersistence(): IndexeddbPersistence | null {
    return persistence;
}

// ─── Client Quarantine ──────────────────────────────────────────────────────
/**
 * Fires when FirestoreSyncManager pulls a document with a newer schema version.
 * Severs the cloud connection and locks the UI to prevent data corruption.
 */
export function handleObsoleteClient(incomingVersion: number): void {
    logger.error(
        `Schema version mismatch! App supports v${CURRENT_SCHEMA_VERSION}, ` +
        `but cloud has v${incomingVersion}. Entering safe mode.`
    );

    // 1. Sever cloud connection (lazy import to avoid circular deps)
    import('./useSyncStore').then(({ useSyncStore }) => {
        useSyncStore.getState().setFirestoreStatus('disconnected');
    }).catch(err => logger.error('Failed to import useSyncStore:', err));

    // 2. Lock UI — requires useUIStore (imported lazily to avoid circular deps at module init)
    import('./useUIStore').then(({ useUIStore }) => {
        useUIStore.getState().setObsoleteLock(true);
    }).catch(err => logger.error('Failed to import useUIStore:', err));
}

// ─── Shared Middleware Options ───────────────────────────────────────────────
/**
 * Returns the standard YjsOptions to pass to every yjs() middleware call.
 * Centralises version guarding so every store consistently enforces it.
 *
 * Schema migrations no longer hang off `onLoaded` (the legacy runner fired
 * up to 9× per boot and raced its own version bumps): the migration
 * coordinator (src/app/migrations.ts) runs ONCE from the bootstrap
 * 'migrations' phase and transforms the Y.Doc directly.
 */
export function getYjsOptions(extra?: Partial<YjsOptions>): YjsOptions {
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        onObsolete: handleObsoleteClient,
        disableYText: true,
        ...extra
    };
}

/**
 * Returns a promise that resolves when Yjs has synced with IndexedDB.
 * Safe to call even if persistence is disabled (resolves immediately).
 * 
 * @param timeoutMs Max time to wait before resolving anyway
 */
export const waitForYjsSync = (timeoutMs = 5000): Promise<void> => {
    if (!persistence) return Promise.resolve();
    if (persistence.synced) return Promise.resolve();

    return new Promise((resolve) => {
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                logger.warn('Sync timeout reached. Proceeding with potentially stale data.');
                resolved = true;
                resolve();
            }
        }, timeoutMs);

        persistence!.once('synced', () => {
            if (!resolved) {
                clearTimeout(timer);
                resolved = true;
                resolve();
            }
        });
    });
};

export const disconnectYjs = async () => {
    if (persistence) {
        logger.info('Disconnecting persistence...');
        await persistence.destroy();
        persistence = null;
        logger.info('Persistence disconnected.');
    }
};
