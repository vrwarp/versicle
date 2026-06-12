/**
 * The HEAVY half of the sync composition root (Phase 8 §A first-use
 * splitting): this module statically imports the firebase-backed pieces
 * (SyncOrchestrator → AuthSession → firebase/auth; FirestoreBackend →
 * firebase/firestore+storage) and is reachable ONLY through the dynamic
 * import in createSync.ts — un-configured users (sync off) never download
 * the firebase chunk at all; configured users load it inside the syncInit
 * boot task body. Check 4 of scripts/check-worker-chunk.mjs asserts the
 * emitted entry chunk stays firebase-free.
 *
 * Everything in here moved verbatim from the pre-P8 createSync.ts; the
 * port-adapter wiring commentary lives there.
 */
import {
  createSyncOrchestrator,
  type SyncOrchestrator,
} from '@domains/sync/core/SyncOrchestrator';
import type { SyncBackendSelection } from '@domains/sync/core/ports';
import { FirestoreBackend } from '@domains/sync/backend/FirestoreBackend';
import { getSyncEventBus } from '@domains/sync/events';
import { CheckpointService } from '@domains/sync/checkpoints/CheckpointService';
import { MigrationStateService } from '@domains/sync/workspaces/MigrationStateService';
import {
  getYDoc,
  waitForYjsSync,
  handleObsoleteClient,
  CURRENT_SCHEMA_VERSION,
} from '@store/yjs-provider';
import { useSyncStore } from '@store/useSyncStore';
import { useBookStore } from '@store/useBookStore';
import { getFirestoreDebounceOverrideMs } from '../../test-flags';

export interface ComposeSyncArgs {
  /** Pre-selected backend (the mock path) or null for the Firestore default. */
  selection: SyncBackendSelection | null;
  /** The single enablement gate (§D2) — owned by createSync (light state). */
  isEnabled: () => boolean;
}

export interface ComposedSync {
  orchestrator: SyncOrchestrator;
  selection: SyncBackendSelection;
}

export function composeSyncOrchestrator(args: ComposeSyncArgs): ComposedSync {
  const selection: SyncBackendSelection =
    args.selection ?? { factory: (uid) => new FirestoreBackend(uid) };

  const orchestrator = createSyncOrchestrator({
    backendSelection: selection,
    events: getSyncEventBus(),
    doc: getYDoc,
    whenLocalSynced: () => waitForYjsSync(),
    onObsolete: handleObsoleteClient,
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    // merge-defaults hydration guarantees `books` is always present
    // (flip wave 4) — the old `|| {}` fallback canary is gone.
    isCleanClient: () => Object.keys(useBookStore.getState().books).length === 0,
    isEnabled: args.isEnabled,
    debounceOverrideMs: () => getFirestoreDebounceOverrideMs() || 0,
    syncState: {
      getActiveWorkspaceId: () => useSyncStore.getState().activeWorkspaceId,
      setActiveWorkspaceId: (id) => useSyncStore.getState().setActiveWorkspaceId(id),
      setFirebaseEnabled: (enabled) => useSyncStore.getState().setFirebaseEnabled(enabled),
    },
    checkpoints: {
      createCheckpoint: (trigger, options) =>
        CheckpointService.createCheckpoint(trigger, options),
      createAutomaticCheckpoint: (trigger, intervalMs) =>
        CheckpointService.createAutomaticCheckpoint(trigger, intervalMs),
    },
    migrationState: {
      setStaged: (targetWorkspaceId, backupCheckpointId, previousWorkspaceId) =>
        MigrationStateService.setStaged(
          targetWorkspaceId,
          backupCheckpointId,
          previousWorkspaceId
        ),
      setAwaitingConfirmation: (targetWorkspaceId, backupCheckpointId) =>
        MigrationStateService.setAwaitingConfirmation(targetWorkspaceId, backupCheckpointId),
      setRestoringBackup: () => MigrationStateService.setRestoringBackup(),
      clear: () => MigrationStateService.clear(),
    },
  });

  return { orchestrator, selection };
}
