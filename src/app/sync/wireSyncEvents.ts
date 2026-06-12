/**
 * THE single SyncEvent subscriber (phase4-sync-strangler.md §D3):
 * presentation and store mirroring for the sync domain live HERE, nowhere
 * else.
 *
 * Ownership rule (risk R6): app/ owns intervals + presentation (toast keys,
 * useSyncStore writes); domains/sync owns transport + events. Since Phase 8
 * §D the copy itself lives in the typed catalog (kernel/locale/messages.ts,
 * `sync.*` namespace) — this file maps events to keys+params, and editing
 * copy cannot touch the transport OR this mapping.
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
import { peekSyncOrchestrator } from './createSync';
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
        toast({ key: 'sync.signedInViaRedirect', params: { email: String(event.email) } }, 'success');
        break;

      case 'flushed':
        sync.setLastSyncTime(event.at);
        break;

      case 'clean-sync':
        if (event.phase === 'started') {
          toast('sync.cleanSync.started', 'info');
        } else if (event.phase === 'applied') {
          toast('sync.cleanSync.applied', 'success');
        } else {
          toast('sync.cleanSync.failed', 'error');
        }
        break;

      case 'switch':
        if (event.phase === 'downloading') {
          toast('sync.switch.downloading', 'info');
        } else if (event.phase === 'failed-rolling-back') {
          toast('sync.switch.failedRollingBack', 'error');
        } else if (event.phase === 'failed-aborted') {
          toast('sync.switch.failedAborted', 'error');
        }
        break;

      case 'workspace-tombstoned':
        if (event.context === 'connect') {
          toast('sync.tombstoned.connect', 'error', 8000);
        } else {
          toast('sync.tombstoned.switch', 'error');
        }
        break;

      case 'connection-error':
        if (event.permissionDenied) {
          toast('sync.rulesOutOfDate', 'error', 10000);
        }
        break;

      case 'sync-failure':
        if (event.permissionDenied) {
          toast('sync.rulesOutOfDate', 'error', 10000);
        } else {
          toast('sync.failure.maxAttempts', 'error', 5000);
        }
        break;

      case 'save-rejected':
        if (event.permissionDenied) {
          toast('sync.rulesOutOfDate', 'error', 10000);
        } else if (event.code === 'document-too-large') {
          toast({ key: 'sync.saveRejected.tooLarge', params: { sizeBytes: String(event.sizeBytes) } }, 'error', 8000);
        } else if (event.code === 'max-retries-exceeded') {
          toast('sync.saveRejected.maxRetries', 'error', 5000);
        }
        break;

      case 'local-persistence-unavailable':
        toast('sync.persistenceUnavailable', 'error');
        break;

      case 'workspace-purged':
        // The honest delete / purge maintenance action (P4-6): tell the
        // user what actually got removed remotely. Params arrive
        // pre-pluralized (the catalog carries no ICU plural support yet —
        // recorded ADR §2 limitation).
        toast(
          {
            key: 'sync.workspacePurged',
            params: {
              docs: `${event.report.docsDeleted} document${event.report.docsDeleted === 1 ? '' : 's'}`,
              blobs: `${event.report.blobsDeleted} blob${event.report.blobsDeleted === 1 ? '' : 's'}`,
            },
          },
          'info'
        );
        break;

      case 'obsolete':
        // Quarantine (§D5): sever the provider connection (a destroy, not a
        // status label) and stop the device heartbeat — zero outbound
        // writes after the lock. The UI lock itself is set by
        // handleObsoleteClient (store/yjs-provider), which emitted this.
        // peek (not get): if sync never composed there is no connection to
        // sever, and composing the firebase chunk just to sever would be
        // absurd (P8 first-use split).
        peekSyncOrchestrator()?.severObsoleteConnection();
        stopDeviceHeartbeat();
        break;

      default:
        break;
    }
  });
}
