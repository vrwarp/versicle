import { RouterProvider } from 'react-router-dom';
import { router } from './app/routes';
import { useBootSequence } from './app/boot/useBootSequence';
import { useServiceWorkerGate } from './app/boot/useServiceWorkerGate';
import { MigrationError } from './app/migrations';
import { SafeModeView } from './components/SafeModeView';
import { ObsoleteLockView } from './components/ObsoleteLockView';
import { CriticalMigrationFailureView } from './components/sync/CriticalMigrationFailureView';
import { WorkspaceMigrationConfirmModal } from './components/sync/WorkspaceMigrationConfirmModal';
import { ToastHost } from './components/ToastHost';
import { SWUpdatePrompt } from './components/SWUpdatePrompt';
import { ConfirmHost, confirmDialog } from './components/ui/ConfirmDialog';
import { useToastStore } from './store/useToastStore';
import { wipeAllData } from './data/wipe';
import { createLogger } from './lib/logger';

const logger = createLogger('App');

/**
 * Main Application component: renders the boot state produced by the
 * bootstrap sequencer (src/app/bootstrap.ts, tasks in src/app/boot/) plus
 * the route tree. All boot ORDERING lives in the sequencer, not here.
 * Renders "Safe Mode" if the boot sequence fails.
 *
 * ToastHost + ConfirmHost mount HERE, above the router gate (Phase 8 §D):
 * a toast fired during boot renders instead of being dropped, and the
 * SafeMode reset path gets the accessible confirm dialog (native
 * confirm/alert are banned at lint ERROR). SWUpdatePrompt mounts beside
 * them (Phase 8 §G) so even a boot-blocked client can accept an update —
 * the recovery channel for a bad deploy.
 */
function App() {
  const boot = useBootSequence();
  const { swInitialized } = useServiceWorkerGate();

  const handleReset = async () => {
    const confirmed = await confirmDialog({
      titleKey: 'app.resetAll.title',
      bodyKey: 'app.resetAll.body',
      confirmKey: 'app.resetAll.confirm',
      danger: true,
    });
    if (!confirmed) return;
    try {
      // Single owner of the wipe: stops sync + Yjs persistence, deletes both
      // IndexedDB databases (EpubLibraryDB + versicle-yjs), clears Versicle
      // localStorage keys and app caches, then reloads.
      await wipeAllData();
    } catch (err) {
      logger.error('Failed to wipe data:', err);
      useToastStore.getState().showToast('app.resetAll.failed', 'error', 8000);
    }
  };

  // Boot-state branch (the hosts above the gate render around ALL of them).
  const body = (() => {
    if (boot.status === 'error') {
      // A failed CRDT migration carries its pre-migration checkpoint id; the
      // failure view's restore button drives the existing RESTORING_BACKUP
      // checkpoint-restore boot flow (phase2-fork-surgery.md §5.2).
      if (boot.error instanceof MigrationError) {
        return <CriticalMigrationFailureView backupId={boot.error.checkpointId} />;
      }
      return <SafeModeView error={boot.error} onReset={handleReset} onRetry={() => window.location.reload()} />;
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
  })();

  return (
    <>
      <ToastHost />
      <SWUpdatePrompt />
      <ConfirmHost />
      {body}
    </>
  );
}

export default App;
