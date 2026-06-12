/**
 * Typed `SyncEvent` bus (phase4-sync-strangler.md §D3): the transport layer
 * announces WHAT happened; presentation decides what the user sees.
 *
 * Producers: the sync manager/orchestrator and firebase-config — which must
 * never import `useToastStore` again (lint-enforced for src/lib/sync/** and
 * src/domains/sync/**).
 *
 * Consumer: exactly ONE — `src/app/sync/wireSyncEvents.ts`, registered by
 * the `syncInit` boot task. It owns every user-facing sync string and the
 * `useSyncStore` mirror writes (lastSyncTime is driven by `flushed`).
 *
 * Deltas from the prep-doc union (additive evolution, allowed by the
 * contract registry's operating rules):
 *  - `save-rejected`/`workspace-tombstoned` carry the context the legacy
 *    toast copy was keyed on (permissionDenied / connect-vs-switch);
 *  - `switch` gains 'failed-aborted' (the NON-destructive pre-apply failure
 *    path, distinct from 'failed-rolling-back');
 *  - `signed-in-via-redirect` (the legacy getRedirectResult toast; the
 *    whole flow is deleted in P4-7) and `local-persistence-unavailable`
 *    (firebase-config's one toast).
 */
import type { FirestoreSyncStatus, FirebaseAuthStatus } from '~types/sync';
import { createLogger } from '@lib/logger';

const logger = createLogger('SyncEvents');

export type SyncEvent =
  | { type: 'status'; status: FirestoreSyncStatus }
  | { type: 'auth'; status: FirebaseAuthStatus; email: string | null }
  | { type: 'signed-in-via-redirect'; email: string | null }
  /** A committed save (mock today; real Firestore once the y-cinder `saved` fork delta lands). */
  | { type: 'flushed'; at: number }
  | { type: 'clean-sync'; phase: 'started' | 'applied' | 'failed' }
  | {
      type: 'switch';
      phase:
        | 'downloading'
        | 'verifying'
        | 'staged'
        | 'applying'
        | 'failed-rolling-back'
        | 'failed-aborted';
    }
  | {
      type: 'save-rejected';
      code: 'permission-denied' | 'document-too-large' | 'max-retries-exceeded';
      sizeBytes?: number;
      permissionDenied: boolean;
    }
  | { type: 'connection-error'; permissionDenied: boolean }
  | { type: 'sync-failure'; permissionDenied: boolean }
  | { type: 'workspace-tombstoned'; workspaceId: string; context: 'connect' | 'switch' }
  | { type: 'workspace-purged'; report: { docsDeleted: number; blobsDeleted: number } }
  /** Doc-level quarantine fired (§D5): the client is obsolete vs the fleet. */
  | { type: 'obsolete'; incomingVersion: number }
  | { type: 'local-persistence-unavailable' };

export interface SyncEventBus {
  emit(event: SyncEvent): void;
  /** Subscribe; returns the unsubscribe handle. */
  on(listener: (event: SyncEvent) => void): () => void;
}

function createSyncEventBus(): SyncEventBus {
  const listeners = new Set<(event: SyncEvent) => void>();
  return {
    emit: (event) => {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (e) {
          // A presentation bug must never take down the transport.
          logger.error('Sync event listener threw:', e);
        }
      }
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let bus: SyncEventBus | null = null;

/** The process-wide bus (transport singleton, like the sync manager). */
export function getSyncEventBus(): SyncEventBus {
  if (!bus) bus = createSyncEventBus();
  return bus;
}
