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
 * `saved` is the save-success event — emitted by the mock and, since the
 * P9 y-cinder fork delta (§D6.1; packages/y-cinder/PROVENANCE.md surgery
 * 1), by the real provider. It drives `lastSyncTime`-from-flush.
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
   * Detach the provider, flushing pending writes where the transport
   * supports it. Returns the flush promise when the transport's teardown is
   * asynchronous (FirestoreBackend: y-cinder's destroy() commits the final
   * batch) so callers that NEED durability-before-proceeding can await it;
   * fire-and-forget call sites (detach on switch) are unchanged. Additive
   * C3 evolution, P9 — pinned by the emulator runner's round-trip cases.
   */
  destroy(): void | Promise<void>;
}

export interface ConnectOptions {
  /** Max debounce before flushing updates to the backend (ms). */
  maxWaitTimeMs: number;
  /** Max batched updates before a forced flush. */
  maxUpdatesThreshold: number;
}

// ─── Backend ─────────────────────────────────────────────────────────────────

/**
 * What an honest delete actually removed (P4-6). Purges are idempotent and
 * re-runnable — a husk left by a crash mid-purge reports smaller numbers on
 * the retry, never an error.
 */
export interface PurgeReport {
  /** Residual Firestore docs removed (updates/history/maintenance/metadata). */
  docsDeleted: number;
  /** Cloud Storage blobs removed (snapshots, large_updates). */
  blobsDeleted: number;
}

export interface SyncBackend {
  /** The authenticated user this backend is bound to (post-auth). */
  readonly uid: string;

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
   * Plant the tombstone (root `isDeleted` + metadata `deletedAt`): the
   * workspace is never resurrectable, and server-side rules deny any new
   * data write into it from this point. Idempotent — the rules explicitly
   * allow re-asserting the tombstone (a retried delete).
   *
   * Always called BEFORE {@link purgeWorkspace} (the §D1 order): the
   * tombstone first closes the workspace to writers, so a crash mid-purge
   * leaves a re-runnable tombstoned husk, never a half-deleted live
   * workspace.
   */
  tombstoneWorkspace(workspaceId: string): Promise<void>;
  /**
   * The honest delete (P4-6): remove every residual the tombstone leaves
   * behind — the updates/history/maintenance/metadata subcollection docs
   * and the Cloud Storage blobs under exactly
   * `users/{uid}/versicle/{workspaceId}/` (risk R8: sibling workspaces'
   * blobs must survive). Idempotent and re-runnable.
   */
  purgeWorkspace(workspaceId: string): Promise<PurgeReport>;
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
