/**
 * MockFireProvider
 * 
 * A mock implementation of y-fire's FireProvider for testing.
 * Follows the same pattern as MockDriveProvider.ts.
 * 
 * Features:
 * - Stores Yjs updates in localStorage for cross-context persistence
 * - Simulates auth states and sync events
 * - Compatible with FirestoreSyncManager via window.__VERSICLE_MOCK_FIRESTORE__
 */
import * as Y from 'yjs';
import { ObservableV2 } from 'lib0/observable';
import * as awarenessProtocol from 'y-protocols/awareness';
import { createLogger } from '../../logger';
import { getMockSyncDelayMs } from '../../../test-flags';

const logger = createLogger('MockFireProvider');

// Mock state stored in localStorage
const MOCK_STORAGE_KEY = 'versicle_mock_firestore_snapshot';

// Re-defining config interface to match usage (FireProviderConfig from y-cinder might differ but we need to match what's passed)
// The original file used a local interface MockFireProviderConfig.
interface MockFireProviderConfig {
    firebaseApp: unknown;
    ydoc: Y.Doc;
    path: string;
    maxUpdatesThreshold?: number;
    maxWaitTime?: number;
}

interface MockStorageData {
    snapshotBase64?: string;
    lastModified: number;
    path: string;
}

/**
 * Event-surface parity with the real y-cinder FireProvider
 * (phase4-sync-strangler.md §D6.2): the real provider emits
 * `connection-error | sync-failure | save-rejected | corrupted-document`
 * (node_modules/y-cinder/dist/provider.js). The mock mirrors that surface so
 * the C3 contract suite can pin event drift as a red CI, plus `saved` — the
 * save-success event the P4 y-cinder fork delta adds (it powers
 * `lastSyncTime`-from-flush). The mock emits `saved` after every successful
 * snapshot write to localStorage, which is its equivalent of a committed
 * Firestore save.
 */
export interface MockSaveRejectedEvent {
    code: 'permission-denied' | 'document-too-large' | 'max-retries-exceeded';
    sizeBytes?: number;
    error?: Error;
}

export interface MockFireProviderEvents {
    sync: (isSynced: boolean) => void;
    synced: () => void;
    'connection-error': (error: Error) => void;
    'sync-failure': (error: Error) => void;
    'save-rejected': (event: MockSaveRejectedEvent) => void;
    'corrupted-document': (event: { docId: string }) => void;
    saved: (at: number) => void;
}

/**
 * Mock implementation of FireProvider for testing
 */
export class MockFireProvider extends ObservableV2<MockFireProviderEvents> {
    readonly doc: Y.Doc;
    readonly awareness: awarenessProtocol.Awareness;
    readonly documentPath: string;
    readonly firebaseApp: unknown;

    // Simulated state
    private _ready = false;
    private destroyed = false;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    readonly maxWaitFirestoreTime: number;

    // Test control flags
    private static shouldFailSync = false;
    private static syncDelay = 100; // ms

    /** Live (constructed, not yet destroyed) providers — see simulateEvent. */
    private static liveInstances = new Set<MockFireProvider>();

    constructor(config: MockFireProviderConfig) {
        super();
        this.doc = config.ydoc;
        this.documentPath = config.path;
        this.firebaseApp = config.firebaseApp;
        this.maxWaitFirestoreTime = config.maxWaitTime || 2000;
        this.awareness = new awarenessProtocol.Awareness(this.doc);
        MockFireProvider.liveInstances.add(this);

        logger.debug(`Initialized for path: ${config.path}`);

        // Simulate async initialization
        this.initializeAsync();
    }

    private async initializeAsync(): Promise<void> {
        // Check for globally configured delay (testing hook)
        const delayOverride = getMockSyncDelayMs();
        if (delayOverride) {
            MockFireProvider.syncDelay = delayOverride;
        }

        // Simulate network delay
        await this.delay(MockFireProvider.syncDelay);

        if (this.destroyed) return;

        if (MockFireProvider.shouldFailSync) {
            this.emit('connection-error', [new Error('Mock sync failure')]);
            return;
        }

        // Load any existing snapshot from storage
        const stored = this.loadFromStorage();
        if (stored?.snapshotBase64) {
            try {
                const binary = atob(stored.snapshotBase64);
                const snapshot = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    snapshot[i] = binary.charCodeAt(i);
                }

                Y.applyUpdate(this.doc, snapshot);
                logger.debug('Applied stored snapshot');
            } catch (e) {
                logger.error('Failed to apply snapshot:', e);
            }
        }

        // Set up update handler
        this.doc.on('update', this.handleUpdate);

        this._ready = true;
        this.emit('sync', [true]);
        this.emit('synced', []);
        logger.debug('Ready');
    }

    private handleUpdate = (_update: Uint8Array, origin: unknown): void => {
        if (origin === this) return; // Ignore updates from ourselves
        if (this.destroyed) return;

        // Debounced save to storage
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }

        this.syncTimeout = setTimeout(() => {
            this.saveToStorage();
        }, this.maxWaitFirestoreTime);
    };

    private loadFromStorage(): MockStorageData | null {
        try {
            const stored = localStorage.getItem(MOCK_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored) as Record<string, MockStorageData>;
                return data[this.documentPath] || null;
            }
        } catch (e) {
            logger.error('Failed to load from storage:', e);
        }
        return null;
    }

    private saveToStorage(): void {
        try {
            const snapshot = Y.encodeStateAsUpdate(this.doc);
            let snapshotBase64 = '';
            for (let i = 0; i < snapshot.byteLength; i++) {
                snapshotBase64 += String.fromCharCode(snapshot[i]);
            }
            snapshotBase64 = btoa(snapshotBase64);

            // Load existing data for other paths
            let allData: Record<string, MockStorageData> = {};
            const existing = localStorage.getItem(MOCK_STORAGE_KEY);
            if (existing) {
                allData = JSON.parse(existing);
            }

            const at = Date.now();
            allData[this.documentPath] = {
                snapshotBase64,
                lastModified: at,
                path: this.documentPath
            };

            localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(allData));
            // Parity with the P4 y-cinder `saved` fork delta: a committed
            // save announces itself (drives lastSyncTime-from-flush).
            this.emit('saved', [at]);
            // logger.debug(`Saved snapshot (${snapshot.byteLength} bytes)`);
        } catch (e) {
            logger.error('Failed to save to storage:', e);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // --- Public API (matching FireProvider) ---

    get ready(): boolean {
        return this._ready;
    }

    destroy(): void {
        if (this.destroyed) return;

        logger.debug('Destroying');
        this.destroyed = true;
        MockFireProvider.liveInstances.delete(this);

        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }

        this.doc.off('update', this.handleUpdate);
        this.awareness.destroy();

        // Final save before destroy
        this.saveToStorage();
    }

    // --- Test Helpers (Static) ---

    /**
     * Set whether sync operations should fail
     */
    static setMockFailure(shouldFail: boolean): void {
        MockFireProvider.shouldFailSync = shouldFail;
    }

    /**
     * Set simulated sync delay in milliseconds
     */
    static setSyncDelay(ms: number): void {
        MockFireProvider.syncDelay = ms;
    }

    /**
     * Clear all mock storage
     */
    static clearMockStorage(): void {
        localStorage.removeItem(MOCK_STORAGE_KEY);
        logger.debug('Storage cleared');
    }

    /**
     * Get raw mock storage data (for testing/debugging)
     */
    static getMockStorageData(): Record<string, MockStorageData> | null {
        try {
            const stored = localStorage.getItem(MOCK_STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    /**
     * Test hook: fire a transport event on live providers, as if the real
     * FireProvider's Firestore listener had surfaced it. Used by the C3
     * contract event cases and failure-path tests; optionally scoped to
     * providers whose document path contains `pathIncludes`.
     *
     * Returns the number of providers the event was emitted on, so tests can
     * assert they actually hit a live connection.
     */
    static simulateEvent<E extends keyof MockFireProviderEvents>(
        event: E,
        payload: Parameters<MockFireProviderEvents[E]>,
        opts?: { pathIncludes?: string }
    ): number {
        let hit = 0;
        for (const provider of MockFireProvider.liveInstances) {
            if (opts?.pathIncludes && !provider.documentPath.includes(opts.pathIncludes)) {
                continue;
            }
            provider.emit(event, payload);
            hit++;
        }
        return hit;
    }

    /**
     * Inject snapshot data (for cross-device simulation)
     */
    static injectSnapshot(path: string, snapshotBase64: string): void {
        let allData: Record<string, MockStorageData> = {};
        const existing = localStorage.getItem(MOCK_STORAGE_KEY);
        if (existing) {
            allData = JSON.parse(existing);
        }

        allData[path] = {
            snapshotBase64,
            lastModified: Date.now(),
            path
        };

        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(allData));
        logger.debug(`Injected snapshot for path: ${path}`);
    }
}

// The window augmentation for the __VERSICLE_MOCK_* flags lives in
// src/test-flags.ts, the single typed reader for E2E input flags.
