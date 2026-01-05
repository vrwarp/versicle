import { useEffect } from 'react';
import { SyncOrchestrator } from '../SyncOrchestrator';
import { GoogleDriveProvider } from '../drivers/GoogleDriveProvider';

// Singleton instance to prevent multiple orchestrators
let orchestratorInstance: SyncOrchestrator | null = null;

export const useSyncOrchestrator = () => {
    useEffect(() => {
        if (!orchestratorInstance) {
            // Determine provider based on config or environment
            // For now, we default to GoogleDriveProvider, but we could switch to Mock
            // if we are in dev/test mode or via a setting.
            // Since the user might not have set credentials yet, the orchestrator handles that check.

            // To support testing without credentials, we might want to check a flag?
            // For now, let's use the real one.
            const provider = new GoogleDriveProvider();

            orchestratorInstance = new SyncOrchestrator(provider);
            orchestratorInstance.initialize();
        }
    }, []);
};
