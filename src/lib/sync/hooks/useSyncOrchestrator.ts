import { useEffect } from 'react';
import { SyncOrchestrator } from '../SyncOrchestrator';
import { GoogleDriveProvider } from '../drivers/GoogleDriveProvider';
import { MockDriveProvider } from '../drivers/MockDriveProvider';

// Singleton instance to prevent multiple orchestrators
let orchestratorInstance: SyncOrchestrator | null = null;

export const useSyncOrchestrator = () => {
    useEffect(() => {
        if (!orchestratorInstance) {
            // Determine provider based on config or environment
            let provider;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).__VERSICLE_MOCK_SYNC__) {
                console.log('Using MockDriveProvider for Sync');
                provider = new MockDriveProvider();
            } else {
                provider = new GoogleDriveProvider();
            }

            orchestratorInstance = new SyncOrchestrator(provider);
            orchestratorInstance.initialize();
        }
    }, []);
};
