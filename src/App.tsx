import { RouterProvider } from 'react-router-dom';
import { router } from './app/routes';
import { useBootSequence } from './app/boot/useBootSequence';
import { useServiceWorkerGate } from './app/boot/useServiceWorkerGate';
import { MigrationError } from './app/migrations';
import { SafeModeView } from './components/SafeModeView';
import { ObsoleteLockView } from './components/ObsoleteLockView';
import { CriticalMigrationFailureView } from './components/sync/CriticalMigrationFailureView';
import { WorkspaceMigrationConfirmModal } from './components/sync/WorkspaceMigrationConfirmModal';
import { wipeAllData } from './data/wipe';
import { createLogger } from './lib/logger';

const logger = createLogger('App');

/**
 * Main Application component: renders the boot state produced by the
 * bootstrap sequencer (src/app/bootstrap.ts, tasks in src/app/boot/) plus
 * the route tree. All boot ORDERING lives in the sequencer, not here.
 * Renders "Safe Mode" if the boot sequence fails.
 */
function App() {
  const boot = useBootSequence();
  const { swInitialized, swError } = useServiceWorkerGate();

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      return;
    }
    try {
      // Single owner of the wipe: stops sync + Yjs persistence, deletes both
      // IndexedDB databases (EpubLibraryDB + versicle-yjs), clears Versicle
      // localStorage keys and app caches, then reloads.
      await wipeAllData();
    } catch (err) {
      logger.error('Failed to wipe data:', err);
      alert('Failed to reset database. You may need to clear browser data manually.');
    }
  };

  if (boot.status === 'error') {
    // A failed CRDT migration carries its pre-migration checkpoint id; the
    // failure view's restore button drives the existing RESTORING_BACKUP
    // checkpoint-restore boot flow (phase2-fork-surgery.md §5.2).
    if (boot.error instanceof MigrationError) {
      return <CriticalMigrationFailureView backupId={boot.error.checkpointId} />;
    }
    return <SafeModeView error={boot.error} onReset={handleReset} onRetry={() => window.location.reload()} />;
  }

  if (swError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">Critical Error</h1>
          <p className="mb-4">{swError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  // Combined loading screen; 'halted' keeps it visible while a backup
  // restore reloads the page (migration rollback, Flow C).
  if (boot.status === 'loading' || boot.status === 'halted' || !swInitialized) {
    const message = boot.status === 'ready' ? 'Starting...' : boot.message;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            {message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ObsoleteLockView />
      {boot.pendingMigration && (
        <WorkspaceMigrationConfirmModal
          targetWorkspaceId={boot.pendingMigration.targetWorkspaceId}
          backupCheckpointId={boot.pendingMigration.backupCheckpointId}
          onResolved={() => window.location.reload()}
        />
      )}
      <RouterProvider router={router} />
    </>
  );
}

export default App;
