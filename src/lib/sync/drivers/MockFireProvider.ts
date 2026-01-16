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

// Mock state stored in localStorage
const MOCK_STORAGE_KEY = 'versicle_mock_firestore_snapshot';

interface MockFireProviderConfig {
    firebaseApp: unknown;
    ydoc: Y.Doc;
    path: string;
    maxUpdatesThreshold?: number;
    maxWaitTime?: number;
    maxWaitFirestoreTime?: number;
}

interface MockStorageData {
    snapshotBase64?: string;
    lastModified: number;
    path: string;
}

/**
 * Mock implementation of FireProvider for testing
 */
export class MockFireProvider extends ObservableV2<{
    sync: (isSynced: boolean) => void;
    synced: () => void;
    'connection-error': (error: Error) => void;
}> {
    readonly doc: Y.Doc;
    readonly awareness: awarenessProtocol.Awareness;
    readonly documentPath: string;
    readonly firebaseApp: unknown;

    // Simulated state
    private _ready = false;
    private destroyed = false;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;

    // Test control flags
    private static shouldFailSync = false;
    private static syncDelay = 100; // ms

    constructor(config: MockFireProviderConfig) {
        super();
        this.doc = config.ydoc;
        this.documentPath = config.path;
        this.firebaseApp = config.firebaseApp;
        this.awareness = new awarenessProtocol.Awareness(this.doc);

        console.log(`[MockFireProvider] Initialized for path: ${config.path}`);

        // Simulate async initialization
        this.initializeAsync();
    }

    private async initializeAsync(): Promise<void> {
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
                console.log('[MockFireProvider] Applied stored snapshot');
            } catch (e) {
                console.error('[MockFireProvider] Failed to apply snapshot:', e);
            }
        }

        // Set up update handler
        this.doc.on('update', this.handleUpdate);

        this._ready = true;
        this.emit('sync', [true]);
        this.emit('synced', []);
        console.log('[MockFireProvider] Ready');
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
        }, 100);
    };

    private loadFromStorage(): MockStorageData | null {
        try {
            const stored = localStorage.getItem(MOCK_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored) as Record<string, MockStorageData>;
                return data[this.documentPath] || null;
            }
        } catch (e) {
            console.error('[MockFireProvider] Failed to load from storage:', e);
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

            allData[this.documentPath] = {
                snapshotBase64,
                lastModified: Date.now(),
                path: this.documentPath
            };

            localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(allData));
            console.log(`[MockFireProvider] Saved snapshot (${snapshot.byteLength} bytes)`);
        } catch (e) {
            console.error('[MockFireProvider] Failed to save to storage:', e);
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

        console.log('[MockFireProvider] Destroying');
        this.destroyed = true;

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
        console.log('[MockFireProvider] Storage cleared');
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
        console.log(`[MockFireProvider] Injected snapshot for path: ${path}`);
    }
}

// Export type for global window augmentation
declare global {
    interface Window {
        __VERSICLE_MOCK_FIRESTORE__?: boolean;
    }
}
