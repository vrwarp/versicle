import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-idb';
import type { StateCreator, StoreMutatorIdentifier } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { isStorageSupported } from '@lib/sync/support';
import { runExclusiveIdbWrite } from '@data/write-gate';
import { getSyncEventBus } from '@domains/sync/events';
import { createLogger } from '@lib/logger';

const logger = createLogger('YjsProvider');

// ─── Schema Version ─────────────────────────────────────────────────────────
// Increment this when introducing breaking changes to Yjs-synced state.
// A bump REQUIRES a matching CrdtMigration step in src/app/migrations.ts
// (the coordinator throws on a version gap) and fixture-matrix coverage in
// src/store/__tests__/crdt-contract/migrations.test.ts.
// v6: popover residual key deleted, `meta` map dual-write (N+1 staged),
// preferences folded to one keyed map (copy-without-clear) — see
// plan/overhaul/prep/phase2-fork-surgery.md §5.3.
// v7: vocabulary simplified-key canonicalization (Phase 6 §7.5, CH-6) —
// traditional knownCharacters keys merge into their simplified form
// (min-timestamp).
// v8: reading-list bookId FK (Phase 7 §D) — the one-time linker joins
// existing entries to the inventory (exact filename, then fuzzy
// title+author); pre-v8 clients would drop the unknown field on their
// whole-entry rebuilds, so the bump quarantines them.
// v9 (Phase 9 — the program's LAST format change): preferences
// husk-clearing, library.__schemaVersion dual-write retirement (meta is
// the sole version authority; library stays FROZEN at 8 as the pre-meta
// poison-pill tripwire), activeContext Y.Map husk pruning. Fleet-safety
// reasoning documented on clearHusksAndRetireDualWrite in
// src/app/migrations.ts.
export const CURRENT_SCHEMA_VERSION = 9;

// Singleton Y.Doc - Source of Truth for User Data. Constructed lazily on
// first access instead of at module scope: importing this module (e.g. for
// CURRENT_SCHEMA_VERSION) must not create CRDT state. Synced stores reach
// it through `defineSyncedStore` (src/store/registry.ts) while wiring their
// middleware at module init.
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
 * Fires when any quarantine layer sees a document from a newer schema
 * version: the middleware poison pill (defense in depth, maps carrying
 * `__schemaVersion`) and the P4 §D5 doc-level layers (pre-attach metadata
 * probe, pre-apply scratch check, live `meta` observer).
 *
 * This function owns the UI-LOCK half and ANNOUNCES the quarantine on the
 * typed SyncEvent bus; severing is delegated to the subscribers
 * (src/app/sync/wireSyncEvents.ts destroys the live provider connection via
 * the sync manager and stops the device heartbeat — pre-P4 the heartbeat
 * kept writing from behind the lock screen and the provider was never
 * destroyed; the old dynamic-import status flip only changed a label).
 */
export function handleObsoleteClient(incomingVersion: number): void {
    logger.error(
        `Schema version mismatch! App supports v${CURRENT_SCHEMA_VERSION}, ` +
        `but cloud has v${incomingVersion}. Entering safe mode.`
    );

    // 1. Announce: the app-side subscriber severs the provider connection
    //    and stops the device heartbeat (zero outbound writes after lock).
    getSyncEventBus().emit({ type: 'obsolete', incomingVersion });

    // 2. Lock UI — requires useUIStore (imported lazily to avoid circular deps at module init)
    import('./useUIStore').then(({ useUIStore }) => {
        useUIStore.getState().setObsoleteLock(true);
    }).catch(err => logger.error('Failed to import useUIStore:', err));
}

// ─── The synced-store seam ───────────────────────────────────────────────────

/**
 * Declaration of one CRDT-synced store (phase2-fork-surgery.md §2.5). Each
 * synced store module declares and exports its own def; the store registry
 * (src/store/registry.ts) aggregates them into the three-tier table and the
 * boot roster.
 *
 * `K` is the union of top-level state keys that replicate; declaring a def
 * as `SyncedStoreDef<'books'>` and passing it to
 * `defineSyncedStore<BookState>` proves at compile time that every synced
 * key exists on the state type (the middleware additionally fails loudly at
 * store creation in dev mode on a mismatch).
 *
 * (This type and {@link defineSyncedStore} live HERE rather than in the
 * registry because the TTS worker's type-closure already reaches this
 * module — a store importing any NEW src/store module would regress the
 * `worker-no-state-typegraph` depcruise ratchet. The registry must stay out
 * of the worker closure, so stores must never import it.)
 */
export interface SyncedStoreDef<K extends string = string> {
    /**
     * Top-level Y.Map name. FROZEN: map names are user-data format surface —
     * renaming one is a schema migration, not a refactor.
     */
    readonly name: string;
    /**
     * The replication whitelist (fork option `syncedKeys`). Top level only;
     * nesting below a synced key replicates fully. `__schemaVersion` is
     * implicitly synced and need not be listed.
     */
    readonly syncedKeys: readonly K[];
    /**
     * Inbound semantics for top-level keys absent from the map.
     * 'merge-defaults' suppresses top-level deletes of declared defaults (the
     * D2 fix: new fields survive hydration from older docs); 'replace' is the
     * legacy wipe. Flipped per store in the phase2-fork-surgery.md §2.6 order.
     */
    readonly hydration: 'replace' | 'merge-defaults';
    /** Per-top-level-key diffing (the D13 write-amplification fix). */
    readonly scopedDiff: boolean;
    /** Bind to a nested Y.Map at `getMap(name).get(scope.key)` (preferences fold). */
    readonly scope?: { readonly key: string };
}

/**
 * The single seam wiring a synced store to the shared Y.Doc (replaces the
 * legacy `getYjsOptions()`): every synced store consistently gets the
 * schema-version poison pill, the obsolete-client handler, and plain-string
 * encoding (`disableYText` — the v4 format), plus its declared replication
 * options. This is the ONLY production `yjs()` call site (lint-enforced via
 * no-restricted-imports).
 *
 * Schema migrations do not hang off `onLoaded`: the migration coordinator
 * (src/app/migrations.ts) runs ONCE from the bootstrap 'migrations' phase
 * and transforms the Y.Doc directly.
 */
export function defineSyncedStore<
    S,
    Mps extends [StoreMutatorIdentifier, unknown][] = [],
    Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
    def: SyncedStoreDef<keyof S & string>,
    creator: StateCreator<S, Mps, Mcs>,
): StateCreator<S, Mps, Mcs> {
    return yjs(getYDoc(), def.name, creator, {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        onObsolete: handleObsoleteClient,
        disableYText: true,
        syncedKeys: def.syncedKeys,
        hydration: def.hydration,
        scopedDiff: def.scopedDiff,
        scope: def.scope,
    });
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
