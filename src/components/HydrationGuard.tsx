import React, { useEffect, useState } from 'react';
import { CRDTService } from '../lib/crdt/CRDTService';
import { LegacyStorageBridge } from '../lib/crdt/LegacyStorageBridge';
import { dbService } from '../db/DBService';

// Singleton instance for the app
// We export this so other parts of the app can use the same instance
export const crdtService = new CRDTService();

interface HydrationGuardProps {
  children: React.ReactNode;
}

/**
 * HydrationGuard ensures that the CRDT "Moral Layer" is fully loaded from IndexedDB
 * before rendering the application. This prevents "Ghost Library" issues where the UI
 * loads empty because the Y.Doc hasn't merged the persisted state yet.
 *
 * It also handles the one-time migration of legacy localStorage settings.
 */
export const HydrationGuard: React.FC<HydrationGuardProps> = ({ children }) => {
  const [isSynced, setIsSynced] = useState(crdtService.isReady);

  useEffect(() => {
    // Inject the CRDT service into DBService for the shunt
    dbService.setCRDTService(crdtService);
    // Set mode to 'shadow' for Phase 2A (Double Write)
    // In future phases, this will be controlled by app_metadata or feature flags
    dbService.setMode('shadow');

    const checkSync = async () => {
      if (crdtService.isReady) {
          setIsSynced(true);
          return;
      }

      await crdtService.waitForReady();

      // Once synced, run the legacy bridge
      // This is safe because Y.Doc is now hydrated from IDB.
      // If IDB was empty, we migrate from localStorage.
      // If IDB had data, we still check localStorage but might not overwrite if keys exist (handled by bridge).
      const bridge = new LegacyStorageBridge(crdtService.doc);
      bridge.migrateLocalStorageToState();

      // Note: We do NOT call clearLegacyStorage() yet.
      // That is reserved for when we are fully confident in CRDT persistence (Phase 2B/C).

      setIsSynced(true);
    };

    checkSync();

    return () => {
        // Cleanup if necessary
    };
  }, []);

  if (!isSynced) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            Loading Library...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
