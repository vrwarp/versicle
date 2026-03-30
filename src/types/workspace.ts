/**
 * Workspace and Migration types for multi-stage sync context switching.
 */

/**
 * Firestore metadata for a workspace.
 * Path: users/{uid}/versicle_meta/workspaces/{workspaceId}
 */
export interface WorkspaceMetadata {
    workspaceId: string;    // Randomly generated (e.g., ws_abc123)
    name: string;           // User-defined label
    createdAt: number;      // Epoch timestamp
    schemaVersion: number;  // CURRENT_SCHEMA_VERSION at creation/last migration
}

/**
 * Migration status state machine.
 * Stored in localStorage to survive page reloads.
 */
export type MigrationStatus =
    | 'IDLE'
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
}
