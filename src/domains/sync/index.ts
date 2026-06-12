/**
 * `domains/sync` published surface (master plan §2 geography; boundary
 * rule 3: other domains import only this index).
 *
 * P4 lands this domain incrementally: the C3 backend seam (P4-2) is here;
 * the orchestrator/workspace-service decomposition arrives with later P4
 * items, after which legacy `src/lib/sync/**` dies in place. MockBackend is
 * deliberately NOT re-exported — it is reachable only via the composition
 * root's dynamic import (boundary rule 9) so it can never ride a production
 * import graph.
 */
export type {
  ConnectOptions,
  LegacyDeleteBehavior,
  SaveRejectedEvent,
  SyncBackend,
  SyncBackendFactory,
  SyncConnection,
  SyncConnectionEvents,
} from './backend/SyncBackend';
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
