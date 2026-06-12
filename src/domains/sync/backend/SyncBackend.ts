/**
 * `SyncBackend` — the C3 sync-transport contract
 * (plan/overhaul/proposals/contract-first.md row C3;
 * plan/overhaul/prep/phase4-sync-strangler.md §D1).
 *
 * Grown from the P0 contract-suite skeleton
 * (src/lib/sync/syncBackendContract.ts): the operations
 * FirestoreSyncManager's inline `__VERSICLE_MOCK_FIRESTORE__` branches used
 * to implement twice. Implementations:
 *
 *  - {@link ../backend/FirestoreBackend} — the ONLY sync module importing
 *    `firebase/firestore` (and, when P4-6 lands the purge, `firebase/storage`).
 *  - {@link ../backend/MockBackend} — the localStorage directory +
 *    MockFireProvider transport; selected EXCLUSIVELY at the composition
 *    root (src/app/sync/createSync.ts) behind
 *    `import.meta.env.DEV || VITE_E2E` + `isMockFirestoreEnabled()`
 *    (boundary rule 9) so it never enters a production import graph — the
 *    chunk-content check in scripts/check-worker-chunk.mjs is the gate.
 *
 * Pinned by `describeSyncBackendContract` run against both implementations
 * (syncBackendContract.mock.test.ts / .emulator.test.ts).
 */
import type * as Y from 'yjs';
import { z } from 'zod';
import type { WorkspaceMetadata } from '~types/workspace';
import { createLogger } from '@lib/logger';

const logger = createLogger('SyncBackend');

// ─── Connection ──────────────────────────────────────────────────────────────

/** Payload of a rejected save (mirrors y-cinder's save-rejected event). */
export interface SaveRejectedEvent {
  code: 'permission-denied' | 'document-too-large' | 'max-retries-exceeded';
  sizeBytes?: number;
  error?: unknown;
}

/**
 * The normalized transport event surface. `synced` wraps the providers'
 * `sync(isSynced=true)` handshake event; the failure events pass the
 * provider payloads through untouched (isPermissionDeniedEvent walks them);
 * `saved` is the save-success event — emitted by the mock today and by the
 * real provider once the P4 y-cinder fork delta lands (§D6.1). It drives
 * `lastSyncTime`-from-flush.
 */
export interface SyncConnectionEvents {
  synced: () => void;
  saved: (at: number) => void;
  'connection-error': (event: unknown) => void;
  'sync-failure': (error: unknown) => void;
  'save-rejected': (event: SaveRejectedEvent) => void;
  'corrupted-document': (event: { docId: string }) => void;
}

export interface SyncConnection {
  on<E extends keyof SyncConnectionEvents>(event: E, cb: SyncConnectionEvents[E]): void;
  off<E extends keyof SyncConnectionEvents>(event: E, cb: SyncConnectionEvents[E]): void;
  /**
   * Detach the provider (flushing where the transport supports it); the
   * workspace doc must be durable afterwards.
   */
  destroy(): void;
}

export interface ConnectOptions {
  /** Max debounce before flushing updates to the backend (ms). */
  maxWaitTimeMs: number;
  /** Max batched updates before a forced flush. */
  maxUpdatesThreshold: number;
}

// ─── Backend ─────────────────────────────────────────────────────────────────

/**
 * NAMED LEGACY DIVERGENCE (deleted by P4-6 "honest delete + purge"): the
 * pre-extraction real and mock deleteWorkspace flows disagreed on connection
 * and sever semantics (FirestoreSyncManager.ts @ fb3dcd3f — real branch
 * called full destroy() and severed `activeWorkspaceId` unconditionally;
 * the mock branch kept the connection and severed only when the deleted
 * workspace was active). The extraction must not change either behavior
 * (P4-0 characterization pins the mock branch), so the divergence is data
 * on the backend instead of `isMockFirestoreEnabled()` branches in the
 * orchestrator. P4-6 unifies both on the mock semantics + remote purge.
 */
export interface LegacyDeleteBehavior {
  destroyConnectionFirst: boolean;
  severActiveUnconditionally: boolean;
}

export interface SyncBackend {
  /** The authenticated user this backend is bound to (post-auth). */
  readonly uid: string;
  /** See {@link LegacyDeleteBehavior}. */
  readonly legacyDeleteBehavior: LegacyDeleteBehavior;

  /** Write a new workspace's metadata document. */
  createWorkspace(meta: WorkspaceMetadata): Promise<void>;
  /** List workspace metadata; tombstoned entries filtered unless asked for. */
  listWorkspaces(opts?: { includeDeleted?: boolean }): Promise<WorkspaceMetadata[]>;
  /** Patch workspace metadata (P4-4: the post-migration schemaVersion stamp). */
  updateWorkspaceMetadata(
    workspaceId: string,
    patch: Partial<WorkspaceMetadata>
  ): Promise<void>;
  /**
   * Tombstone pre-flight: false only when the workspace is positively
   * tombstoned. Missing docs and read failures are ALIVE (fail-safe: an
   * offline client must still be able to queue writes).
   */
  isWorkspaceAlive(workspaceId: string): Promise<boolean>;
  /** Clean-sync probe: does the replicated doc hold any data? */
  probeHasData(workspaceId: string): Promise<boolean>;
  /**
   * Delete a workspace (tombstone pattern; never resurrectable). Current
   * semantics absorbed verbatim from the manager's branches; P4-6 splits
   * this into tombstoneWorkspace + purgeWorkspace(PurgeReport).
   */
  deleteWorkspace(workspaceId: string): Promise<void>;
  /**
   * Attach a Y.Doc to the workspace's replicated document. Synchronous —
   * providers connect in the background and announce themselves via the
   * `synced` event.
   */
  connect(doc: Y.Doc, workspaceId: string, opts: ConnectOptions): SyncConnection;
}

/** Constructed once per authenticated uid by the sync orchestrator. */
export type SyncBackendFactory = (uid: string) => SyncBackend;

// ─── WorkspaceMetadata validation (C3 row; OBSERVE mode) ────────────────────

/**
 * Inbound WorkspaceMetadata shape. `~types/workspace.ts` stays the type
 * source; this schema validates remote payloads at the backend read
 * boundary. Unknown extra fields are tolerated (forward compatibility with
 * newer clients writing richer metadata).
 */
export const workspaceMetadataSchema: z.ZodType<WorkspaceMetadata> = z.looseObject({
  workspaceId: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  schemaVersion: z.number(),
  deletedAt: z.number().optional(),
});

/**
 * OBSERVE-then-enforce (plan/overhaul/README.md §3 operating rules; §4 risk
 * register): inbound validation on a live sync path must not reject until a
 * telemetry/logging review confirms real-world doc variance. This helper
 * therefore only LOGS schema violations — every row is returned untouched.
 * The flip to enforcement is gated on reviewing these logs in the wild
 * (search key: 'workspace-metadata-observe').
 */
export function observeWorkspaceMetadata(
  rows: WorkspaceMetadata[],
  source: string
): WorkspaceMetadata[] {
  for (const row of rows) {
    const result = workspaceMetadataSchema.safeParse(row);
    if (!result.success) {
      logger.warn(
        `[workspace-metadata-observe] inbound WorkspaceMetadata failed schema (source=${source}, ` +
          `workspaceId=${String((row as Partial<WorkspaceMetadata>)?.workspaceId)}). ` +
          'OBSERVE mode: row passed through unmodified.',
        result.error.issues
      );
    }
  }
  return rows;
}
