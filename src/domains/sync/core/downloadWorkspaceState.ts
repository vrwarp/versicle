/**
 * `downloadWorkspaceState` — THE one temp-doc hydration utility
 * (phase4-sync-strangler.md §D2): hydrates a throwaway Y.Doc from the
 * workspace's replicated document and returns its full state. Shared by
 * clean-sync, the workspace switch and the sync diagnostics remote check.
 *
 * Semantics (pinned by downloadWorkspaceState.test.ts and the orchestrator
 * characterization suite):
 *  - resolves with the temp doc's full state once the initial sync
 *    handshake lands;
 *  - the TIMEOUT resolves with whatever synced so far (an unreachable or
 *    empty remote yields an empty update — callers treat that as "remote is
 *    empty") unless `onTimeout: 'reject'`;
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
   * empty) current state — the clean-sync behavior; 'reject' propagates —
   * the workspace-switch behavior. Default 'reject'.
   */
  onAttachError?: 'resolve' | 'reject';
  /**
   * Handshake-timeout policy: 'resolve' returns whatever synced so far (the
   * "unreachable means empty" behavior); 'reject' fails with a
   * timeout error instead — for callers that must not mistake an
   * unreachable remote for an empty one (the sync diagnostics remote
   * check). Default 'resolve'.
   */
  onTimeout?: 'resolve' | 'reject';
}

export async function downloadWorkspaceState(
  backend: SyncBackend,
  workspaceId: string,
  options: DownloadWorkspaceStateOptions
): Promise<Uint8Array> {
  const {
    maxWaitTimeMs,
    maxUpdatesThreshold,
    timeoutMs = 15000,
    onAttachError = 'reject',
    onTimeout = 'resolve',
  } = options;

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
          if (onTimeout === 'reject') {
            resolved = true;
            reject(new Error(`Workspace download timed out after ${timeoutMs}ms (no initial sync)`));
            return;
          }
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
