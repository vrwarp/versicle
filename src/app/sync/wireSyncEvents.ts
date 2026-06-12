/**
 * THE single SyncEvent subscriber (phase4-sync-strangler.md §D3):
 * presentation and store mirroring for the sync domain live HERE, nowhere
 * else.
 *
 * Ownership rule (risk R6): app/ owns intervals + presentation (toast copy,
 * useSyncStore writes); domains/sync owns transport + events. The toast
 * strings below moved verbatim from FirestoreSyncManager/firebase-config —
 * editing copy is now a one-file change that cannot touch the transport.
 *
 * `lastSyncTime` semantics: driven by `flushed` (a committed save). Until
 * the y-cinder `saved` fork delta lands, real-Firestore sessions only emit
 * `flushed` from the mock transport, so the legacy connected-transition
 * stamp is kept as the transitional floor — without it the pulse tooltip
 * would read "never synced" on real Firestore. The transition stamp goes
 * away with the fork delta (then `flushed` is the only writer).
 *
 * Registered by the `syncInit` boot task with ctx.addCleanup.
 */
import { getSyncEventBus } from '@domains/sync/events';
import { RULES_OUT_OF_DATE_MESSAGE } from '@domains/sync/backend/permissionDenied';
import { getSyncOrchestrator } from './createSync';
import { stopDeviceHeartbeat } from '@app/boot/backgroundTasks';
import { useSyncStore } from '@store/useSyncStore';
import { useToastStore } from '@store/useToastStore';
import type { FirestoreSyncStatus } from '~types/sync';

export function wireSyncEvents(): () => void {
  let lastStatus: FirestoreSyncStatus | null = null;

  return getSyncEventBus().on((event) => {
    const toast = useToastStore.getState().showToast;
    const sync = useSyncStore.getState();

    switch (event.type) {
      case 'status': {
        sync.setFirestoreStatus(event.status);
        // Transitional (see module docs): connected-transition floor for
        // lastSyncTime until real flush events exist on Firestore.
        if (event.status === 'connected' && lastStatus !== 'connected') {
          sync.setLastSyncTime(Date.now());
        }
        lastStatus = event.status;
        break;
      }

      case 'auth':
        sync.setFirebaseAuthStatus(event.status);
        sync.setFirebaseUserEmail(event.email);
        break;

      case 'signed-in-via-redirect':
        toast(`Signed in as ${event.email}`, 'success');
        break;

      case 'flushed':
        sync.setLastSyncTime(event.at);
        break;

      case 'clean-sync':
        if (event.phase === 'started') {
          toast('Syncing library from cloud...', 'info');
        } else if (event.phase === 'applied') {
          toast('Sync complete!', 'success');
        } else {
          toast('Failed to sync. Please try again.', 'error');
        }
        break;

      case 'switch':
        if (event.phase === 'downloading') {
          toast('Downloading workspace data...', 'info');
        } else if (event.phase === 'failed-rolling-back') {
          toast('Workspace switch failed. Restoring your previous data...', 'error');
        } else if (event.phase === 'failed-aborted') {
          toast('Workspace switch failed. Please try again.', 'error');
        }
        break;

      case 'workspace-tombstoned':
        if (event.context === 'connect') {
          toast(
            'Sync disconnected: Remote workspace was deleted. Operating offline.',
            'error',
            8000
          );
        } else {
          toast('Cannot switch: This workspace has been deleted.', 'error');
        }
        break;

      case 'connection-error':
        if (event.permissionDenied) {
          toast(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
        }
        break;

      case 'sync-failure':
        if (event.permissionDenied) {
          toast(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
        } else {
          toast('Sync failed after multiple attempts. Please check your connection.', 'error', 5000);
        }
        break;

      case 'save-rejected':
        if (event.permissionDenied) {
          toast(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
        } else if (event.code === 'document-too-large') {
          toast(
            `Sync disabled: Document too large (${event.sizeBytes} bytes). Please export and clear data.`,
            'error',
            8000
          );
        } else if (event.code === 'max-retries-exceeded') {
          toast('Sync save failed: Max retries exceeded. Check connection.', 'error', 5000);
        }
        break;

      case 'local-persistence-unavailable':
        toast('Offline sync unavailable (persistence failed)', 'error');
        break;

      case 'workspace-purged':
        // The honest delete / purge maintenance action (P4-6): tell the
        // user what actually got removed remotely.
        toast(
          `Remote workspace data purged (${event.report.docsDeleted} document` +
            `${event.report.docsDeleted === 1 ? '' : 's'}, ${event.report.blobsDeleted} blob` +
            `${event.report.blobsDeleted === 1 ? '' : 's'}).`,
          'info'
        );
        break;

      case 'obsolete':
        // Quarantine (§D5): sever the provider connection (a destroy, not a
        // status label) and stop the device heartbeat — zero outbound
        // writes after the lock. The UI lock itself is set by
        // handleObsoleteClient (store/yjs-provider), which emitted this.
        getSyncOrchestrator().severObsoleteConnection();
        stopDeviceHeartbeat();
        break;

      default:
        break;
    }
  });
}
