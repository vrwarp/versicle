/**
 * `downloadWorkspaceState` — THE one temp-doc hydration utility
 * (phase4-sync-strangler.md §D2): replaces the two copy-pasted
 * temp-provider dances in FirestoreSyncManager (`performCleanSync` and
 * `switchWorkspace`, with their `(tempDoc as any)._tempProvider` smuggling).
 * DataRecoveryView's third copy is retargeted in P4-7.
 *
 * Semantics preserved from both originals (pinned by the P4-0
 * characterization suite):
 *  - resolves with the temp doc's full state once the initial sync
 *    handshake lands;
 *  - the TIMEOUT resolves with whatever synced so far (an unreachable or
 *    empty remote yields an empty update — callers treat that as "remote is
 *    empty", the long-standing behavior);
 *  - a synchronous connect failure either resolves with the current state
 *    (clean-sync behavior) or rejects (switch behavior) per
 *    `onAttachError`;
 *  - the temp provider and temp doc are ALWAYS destroyed.
 */
import * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { SyncBackend, SyncConnection } from '../backend/SyncBackend';

const logger = createLogger('downloadWorkspaceState');

export interface DownloadWorkspaceStateOptions {
  /** Provider flush debounce (ms) — test override flows through here. */
  maxWaitTimeMs: number;
  maxUpdatesThreshold: number;
  /** Handshake budget; on expiry resolves with whatever synced. Default 15s. */
  timeoutMs?: number;
  /**
   * Synchronous connect-failure policy: 'resolve' returns the (likely
   * empty) current state — the legacy clean-sync behavior; 'reject'
   * propagates — the legacy switch behavior. Default 'reject'.
   */
  onAttachError?: 'resolve' | 'reject';
}

export async function downloadWorkspaceState(
  backend: SyncBackend,
  workspaceId: string,
  options: DownloadWorkspaceStateOptions
): Promise<Uint8Array> {
  const { maxWaitTimeMs, maxUpdatesThreshold, timeoutMs = 15000, onAttachError = 'reject' } =
    options;

  const tempDoc = new Y.Doc();
  let connection: SyncConnection | null = null;

  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      let resolved = false;

      const finish = (): void => {
        resolved = true;
        clearTimeout(timer);
        resolve(Y.encodeStateAsUpdate(tempDoc));
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          logger.warn(
            `Workspace download timeout reached for ${workspaceId}. ` +
              'Assuming empty or unreachable remote.'
          );
          finish();
        }
      }, timeoutMs);

      try {
        connection = backend.connect(tempDoc, workspaceId, {
          maxWaitTimeMs,
          maxUpdatesThreshold,
        });
        connection.on('synced', () => {
          if (!resolved) {
            logger.info('Received sync complete event from temp workspace provider.');
            finish();
          }
        });
      } catch (e) {
        if (!resolved) {
          logger.error('Failed to connect temp provider:', e);
          if (onAttachError === 'reject') {
            resolved = true;
            clearTimeout(timer);
            reject(e);
          } else {
            finish();
          }
        }
      }
    });
  } finally {
    if (connection) {
      try {
        (connection as SyncConnection).destroy();
      } catch (e) {
        logger.error('Error destroying temp provider', e);
      }
    }
    tempDoc.destroy();
  }
}
