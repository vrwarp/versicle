import { useEffect } from 'react';
import { SyncOrchestrator } from '../SyncOrchestrator';
import { GoogleDriveProvider } from '../drivers/GoogleDriveProvider';
import { MockDriveProvider } from '../drivers/MockDriveProvider';
import type { RemoteStorageProvider } from '../types';

// Singleton instance to prevent multiple orchestrators
let orchestratorInstance: SyncOrchestrator | null = null;

export const useSyncOrchestrator = () => {
    useEffect(() => {
        if (!orchestratorInstance) {
            let provider: RemoteStorageProvider;

            // Check for test environment flag to switch to Mock Provider
            if (typeof window !== 'undefined' && window.__VERSICLE_MOCK_SYNC__) {
                console.warn("Using MockDriveProvider for Sync (Test Mode)");
                provider = new MockDriveProvider();
            } else {
                provider = new GoogleDriveProvider();
            }

            orchestratorInstance = new SyncOrchestrator(provider);
            orchestratorInstance.initialize();
        }
    }, []);
};
