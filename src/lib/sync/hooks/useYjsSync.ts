import { useEffect } from 'react';
import { YjsSyncService } from '../YjsSyncService';
import { GoogleDriveProvider } from '../drivers/GoogleDriveProvider';
import { MockDriveProvider } from '../drivers/MockDriveProvider';

// Singleton instance to prevent multiple sync services
let syncServiceInstance: YjsSyncService | null = null;

/**
 * Hook to initialize the Yjs-based sync service.
 * Uses Yjs snapshots for CRDT-based cloud sync.
 */
export const useYjsSync = () => {
    useEffect(() => {
        if (!syncServiceInstance) {
            // Determine provider based on config or environment
            let provider;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).__VERSICLE_MOCK_SYNC__) {
                console.log('[YjsSync] Using MockDriveProvider');
                provider = new MockDriveProvider();
            } else {
                provider = new GoogleDriveProvider();
            }

            syncServiceInstance = new YjsSyncService(provider);
            syncServiceInstance.initialize();
        }
    }, []);

    return syncServiceInstance;
};

/**
 * Get the sync service instance (for imperative access outside React)
 */
export const getYjsSyncService = () => syncServiceInstance;
