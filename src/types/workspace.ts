/**
 * Workspace and Migration types for multi-stage sync context switching.
 */

/**
 * Firestore metadata for a workspace.
 * Path: users/{uid}/workspaces/{workspaceId} (the replicated doc itself
 * lives at users/{uid}/versicle/{workspaceId}).
 * Validated at the backend read boundary by `workspaceMetadataSchema`
 * (src/domains/sync/backend/SyncBackend.ts) — OBSERVE mode until the
 * telemetry review gate.
 */
export interface WorkspaceMetadata {
    workspaceId: string;    // Randomly generated (e.g., ws_abc123)
    name: string;           // User-defined label
    createdAt: number;      // Epoch timestamp
    schemaVersion: number;  // CURRENT_SCHEMA_VERSION at creation/last migration
    deletedAt?: number;     // Filters out deleted workspaces from UI lists
}

/**
 * Migration status state machine.
 * Stored in localStorage to survive page reloads.
 *
 * `STAGED` is the commit point of the crash-resumable staged workspace
 * switch: the verified remote blob is durably in `versicle-yjs-staging` and
 * the boot interceptor's STAGED arm applies main ← staging (idempotent — a
 * crash anywhere in apply re-enters the arm) before transitioning to
 * `AWAITING_CONFIRMATION`.
 */
type MigrationStatus =
    | 'STAGED'
    | 'AWAITING_CONFIRMATION'
    | 'RESTORING_BACKUP';

/**
 * State persisted across reloads during workspace switching.
 * Key: __VERSICLE_MIGRATION_STATE__
 */
export interface SyncMigrationState {
    status: MigrationStatus;
    targetWorkspaceId?: string;
    backupCheckpointId?: number;
    /**
     * The workspace that was active when the switch started: a rollback
     * (`RESTORING_BACKUP`) restores the pre-switch Yjs data, so the boot
     * interceptor also reverts `activeWorkspaceId` to this — without it the id
     * would keep pointing at the TARGET workspace while the data is the
     * previous workspace's (old data bleeding into the new workspace on the
     * next connect). Optional: when absent (states persisted by older
     * clients), the rollback leaves `activeWorkspaceId` untouched.
     */
    previousWorkspaceId?: string;
}
