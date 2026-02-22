import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isStorageSupported } from '../lib/sync/support';
import { createLogger } from '../lib/logger';
import type { YjsOptions } from 'zustand-middleware-yjs';
import type { UserProgress } from '../types/db';

const logger = createLogger('YjsProvider');

// ─── Schema Version ─────────────────────────────────────────────────────────
// Increment this when introducing breaking changes to Yjs-synced state.
// See: Operational Runbook for Breaking Changes in the TDD.
export const CURRENT_SCHEMA_VERSION = 2;

// Singleton Y.Doc instance - Source of Truth for User Data
export const yDoc = new Y.Doc();

// Expose globally for Playwright end-to-end tests
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__YJS_DOC__ = yDoc;
}

let persistence: IndexeddbPersistence | null = null;

// Initialize persistence only if supported
if (isStorageSupported()) {
    try {
        persistence = new IndexeddbPersistence('versicle-yjs', yDoc);

        persistence.on('synced', () => {
            logger.info('Content loaded from IndexedDB (versicle-yjs)');
        });

        // Error handling for persistence layer
        // Note: IndexeddbPersistence doesn't emit 'error' in all versions, but good practice to have listeners if accessible
    } catch (error) {
        logger.error('Failed to initialize IndexedDB persistence:', error);
    }
} else {
    logger.warn('IndexedDB not supported. Falling back to in-memory mode.');
}

/**
 * Expose the persistence instance for lower-level access (e.g., clearing data)
 */
export const yjsPersistence = persistence;

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
    import('../lib/sync/hooks/useSyncStore').then(({ useSyncStore }) => {
        useSyncStore.getState().setFirestoreStatus('disconnected');
    });

    // 2. Lock UI — requires useUIStore (imported lazily to avoid circular deps at module init)
    import('./useUIStore').then(({ useUIStore }) => {
        useUIStore.getState().setObsoleteLock(true);
    });
}

// ─── Deterministic Migration Runner ─────────────────────────────────────────
/**
 * Executes strictly deterministic Zustand state transformations.
 * Runs sequentially through each version step. Because transforms are
 * identical across all clients, Yjs LWW merges concurrent upgrades safely.
 *
 * Called via `onLoaded` after the Y.Doc is hydrated from IndexedDB/cloud.
 */
function runMigrationsImpl(): void {
    // Lazy import to avoid circular dependency at module init time
    import('./useBookStore').then(({ useBookStore }) => {
        if (!useBookStore) return; // Guard for test environments

        const bookState = useBookStore.getState();
        let currentVersion: number =
            (bookState as unknown as Record<string, unknown>).__schemaVersion as number || 1;

        if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

        logger.info(`Running migrations from v${currentVersion} → v${CURRENT_SCHEMA_VERSION}`);

        // ── Migration v1 → v2: Prune legacy reading history ─────────────
        if (currentVersion === 1) {
            import('./useReadingStateStore').then(({ useReadingStateStore }) => {
                if (!useReadingStateStore) return; // Guard for test environments

                const rsState = useReadingStateStore.getState();
                const progress = rsState.progress;
                const nextProgress = { ...progress };
                let migrated = false;

                for (const bookId in nextProgress) {
                    const devices = nextProgress[bookId];
                    for (const deviceId in devices) {
                        const userProgress: UserProgress = devices[deviceId];
                        if (userProgress.readingSessions) {
                            const validSessions = userProgress.readingSessions.filter(
                                s => typeof s.startTime === 'number' && typeof s.endTime === 'number'
                            );

                            if (validSessions.length !== userProgress.readingSessions.length) {
                                migrated = true;
                                nextProgress[bookId] = {
                                    ...nextProgress[bookId],
                                    [deviceId]: {
                                        ...userProgress,
                                        readingSessions: validSessions
                                    }
                                };
                            }
                        }
                    }
                }

                if (migrated) {
                    useReadingStateStore.setState({ progress: nextProgress });
                }

                // Bump version on the primary store
                useBookStore.setState({ __schemaVersion: 2 } as unknown as Record<string, unknown>);
                logger.info('Migration v1 → v2 complete (legacy history pruned).');
            }).catch(() => {
                // Silently ignore if useReadingStateStore can't be imported (test env)
            });

            currentVersion = 2;
        }

        // Future migrations added here sequentially:
        // if (currentVersion === 2) { ... currentVersion = 3; }
    }).catch(() => {
        // Silently ignore if useBookStore can't be imported (test env)
    });
}

/**
 * Defers the execution of migrations to ensure zustand-middleware-yjs has fully processed
 * the inbound snapshot into the local state via its microtask queue. Otherwise, migration logic
 * reads and modifies stale state, which can lead to overwriting the incoming remote map.
 */
export function runMigrations(): void {
    setTimeout(runMigrationsImpl, 0);
}

// ─── Shared Middleware Options ───────────────────────────────────────────────
/**
 * Returns the standard YjsOptions to pass to every yjs() middleware call.
 * Centralises version guarding so every store consistently enforces it.
 */
export function getYjsOptions(extra?: Partial<YjsOptions>): YjsOptions {
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        onObsolete: handleObsoleteClient,
        onLoaded: runMigrations,
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
