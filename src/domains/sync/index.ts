/**
 * `domains/sync` published surface (master plan §2 geography; boundary
 * rule 3: other domains import only this index).
 *
 * P4 lands this domain incrementally: the C3 backend seam (P4-2), the
 * SyncEvent bus (P4-3a), and the orchestrator decomposition (P4-3 —
 * AuthSession/ProviderConnection/WorkspaceService/SyncOrchestrator over
 * injected ports; FirestoreSyncManager is deleted). The ONE production
 * orchestrator instance is composed by src/app/sync/createSync.ts, which
 * injects the store-backed ports (boundary: domains/ holds no store
 * imports — depcruise `domains-no-store`). MockBackend is deliberately NOT
 * re-exported — it is reachable only via the composition root's dynamic
 * import (boundary rule 9) so it can never ride a production import graph.
 */
export { createSyncOrchestrator, SyncOrchestrator } from './core/SyncOrchestrator';
export type {
  CheckpointsPort,
  MigrationStatePort,
  SyncBackendSelection,
  SyncOrchestratorConfig,
  SyncOrchestratorDeps,
  SyncStatePort,
} from './core/ports';
export { AuthSession } from './core/AuthSession';
export { ProviderConnection } from './core/ProviderConnection';
export { WorkspaceService } from './workspaces/WorkspaceService';
export { MigrationStateService } from './workspaces/MigrationStateService';
export { CheckpointService } from './checkpoints/CheckpointService';
export type { DestructiveRestoreOptions } from './checkpoints/CheckpointService';
export { CheckpointInspector } from './checkpoints/CheckpointInspector';
export type { DiffResult } from './checkpoints/CheckpointInspector';
export type {
  ConnectOptions,
  PurgeReport,
  SaveRejectedEvent,
  SyncBackend,
  SyncBackendFactory,
  SyncConnection,
  SyncConnectionEvents,
} from './backend/SyncBackend';
export { stageWorkspaceState, applyStagedSwap, clearStagedState } from './workspaces/stagedSwap';
export type { ApplyStagedSwapHooks } from './workspaces/stagedSwap';
export { observeWorkspaceMetadata, workspaceMetadataSchema } from './backend/SyncBackend';
export { FirestoreBackend } from './backend/FirestoreBackend';
export { downloadWorkspaceState } from './core/downloadWorkspaceState';
export type { DownloadWorkspaceStateOptions } from './core/downloadWorkspaceState';
export { getSyncEventBus } from './events';
export type { SyncEvent, SyncEventBus } from './events';
export {
  isPermissionDeniedEvent,
  RULES_OUT_OF_DATE_MESSAGE,
} from './backend/permissionDenied';
