/**
 * `uploadMissingState` — repair a replicated document whose cloud copy is
 * missing data this device holds.
 *
 * Why this exists: Yjs integrates a client's edits strictly in clock order.
 * If the cloud copy lacks one clock range of some client (a "gap" — e.g. a
 * batch an older y-cinder build dropped, or a base snapshot whose stored
 * stateVector claims more than its content holds), every LATER edit of that
 * client is parked in pendingStructs on every other device, forever and
 * silently. y-cinder's initial-sync push only re-sends what its server
 * metadata says is missing, so a gap the metadata hides is never refilled.
 *
 * The repair ignores the metadata: it downloads what the cloud ACTUALLY
 * integrates (a throwaway doc's real state vector — parked structs do not
 * count), diffs the live doc against it, and applies that diff to the
 * throwaway doc as a LOCAL edit, so the temp provider uploads it through
 * y-cinder's normal save path (proper update format, Storage offload for
 * oversized diffs). Yjs merges are idempotent: re-sending structs the
 * cloud already has is harmless, so the operation is safe to repeat.
 *
 * The live doc and live connection are never touched.
 */
import * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { SyncBackend, SyncConnection } from '../backend/SyncBackend';

const logger = createLogger('uploadMissingState');

/** Origin of the repair transaction on the throwaway doc. */
const REPAIR_ORIGIN = 'versicle:repair';

export interface UploadMissingStateOptions {
  maxWaitTimeMs: number;
  /** Budget for the initial download and, separately, for the upload ack. */
  timeoutMs?: number;
}

export type UploadMissingStateResult =
  | {
      ok: true;
      /** False when the cloud already held everything this device holds. */
      uploaded: boolean;
      /** Bytes of the repair update (0 when nothing was missing). */
      bytes: number;
      /** Per client: [cloud's integrated clock, this device's clock]. */
      clientsBehind: Array<{ client: number; cloud: number; local: number }>;
      /** Parked structs in the cloud copy before / after the repair. */
      cloudPendingBefore: Record<string, number> | null;
      cloudPendingAfter: Record<string, number> | null;
      ms: number;
    }
  | { ok: false; error: string; ms: number };

const pendingOf = (doc: Y.Doc): Record<string, number> | null => {
  const pending = (doc.store as unknown as { pendingStructs: { missing: Map<number, number> } | null })
    .pendingStructs;
  return pending ? Object.fromEntries(pending.missing) : null;
};

function waitFor(
  connection: SyncConnection,
  event: 'synced' | 'saved',
  timeoutMs: number,
  label: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const done = (): void => {
      cleanup();
      resolve();
    };
    const fail = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(`${label} failed: ${JSON.stringify(error)}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      connection.off(event, done);
      connection.off('save-rejected', fail);
      connection.off('sync-failure', fail);
    };
    connection.on(event, done);
    connection.on('save-rejected', fail);
    connection.on('sync-failure', fail);
  });
}

export async function uploadMissingState(
  backend: SyncBackend,
  workspaceId: string,
  liveDoc: Y.Doc,
  options: UploadMissingStateOptions
): Promise<UploadMissingStateResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  const tempDoc = new Y.Doc();
  let connection: SyncConnection | null = null;
  try {
    connection = backend.connect(tempDoc, workspaceId, {
      maxWaitTimeMs: options.maxWaitTimeMs,
      // Never let the temp provider force a threshold compaction.
      maxUpdatesThreshold: 1_000_000_000,
    });
    await waitFor(connection, 'synced', timeoutMs, 'Cloud download');

    const cloudSV = Y.decodeStateVector(Y.encodeStateVector(tempDoc));
    const localSV = Y.decodeStateVector(Y.encodeStateVector(liveDoc));
    const clientsBehind: Array<{ client: number; cloud: number; local: number }> = [];
    for (const [client, local] of localSV) {
      const cloud = cloudSV.get(client) ?? 0;
      if (local > cloud) clientsBehind.push({ client, cloud, local });
    }
    const cloudPendingBefore = pendingOf(tempDoc);

    if (clientsBehind.length === 0) {
      logger.info('Repair: the cloud already integrates everything this device holds.');
      return {
        ok: true,
        uploaded: false,
        bytes: 0,
        clientsBehind,
        cloudPendingBefore,
        cloudPendingAfter: cloudPendingBefore,
        ms: Date.now() - started,
      };
    }

    // Everything this device holds beyond what the cloud INTEGRATES (gaps
    // included), plus the full delete set.
    const missing = Y.encodeStateAsUpdate(liveDoc, Y.encodeStateVector(tempDoc));
    logger.warn(
      `Repair: cloud is behind this device for ${clientsBehind.length} client(s); ` +
        `uploading ${missing.byteLength} bytes.`
    );
    const saved = waitFor(connection, 'saved', timeoutMs, 'Repair upload');
    // A LOCAL edit on the temp doc: the temp provider buffers and saves it.
    Y.applyUpdate(tempDoc, missing, REPAIR_ORIGIN);
    await saved;

    return {
      ok: true,
      uploaded: true,
      bytes: missing.byteLength,
      clientsBehind: clientsBehind.slice(0, 200),
      cloudPendingBefore,
      cloudPendingAfter: pendingOf(tempDoc),
      ms: Date.now() - started,
    };
  } catch (error) {
    logger.error('Repair failed:', error);
    return { ok: false, error: String(error), ms: Date.now() - started };
  } finally {
    if (connection) {
      try {
        await (connection as SyncConnection).destroy();
      } catch (e) {
        logger.error('Error destroying repair provider', e);
      }
    }
    tempDoc.destroy();
  }
}
