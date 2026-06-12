/**
 * Sync composition root (phase4-sync-strangler.md §D1/§D2; master plan §2
 * boundary rules 3 + 9): the ONE place that constructs the SyncOrchestrator
 * and decides which `SyncBackend` implementation the app runs on.
 *
 * - The orchestrator (src/domains/sync/core/SyncOrchestrator.ts) is
 *   store-free; every store/flag/yjs-provider touch it needs is injected
 *   HERE as a port adapter (the EngineContext pattern). `getSyncOrchestrator`
 *   replaces the legacy `FirestoreSyncManager.getInstance()`; construction is
 *   owned by the `syncInit` boot task.
 *
 * - Backend selection: production needs nothing — the orchestrator runs on
 *   `FirestoreBackend`. DEV/E2E with `window.__VERSICLE_MOCK_FIRESTORE__`
 *   (read through src/test-flags.ts, the single flag reader) swaps in
 *   `MockBackend` plus a synthesized auth session. The dynamic import below
 *   sits in a branch that is statically dead in production builds
 *   (`import.meta.env.DEV` / `VITE_E2E` are build-time constants), so Rollup
 *   drops the MockBackend/MockFireProvider chunk from prod output entirely —
 *   the chunk-content check in scripts/check-worker-chunk.mjs asserts the
 *   emitted artifact, not this import shape.
 *
 * - The single enablement gate (§D2): start() runs only when
 *   `(firebaseEnabled && isConfigured) || mockEnabled` — the legacy boot
 *   path ignored the `firebaseEnabled` flag (prep doc reality item 20).
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
import { isFirebaseConfigured } from '@lib/sync/firebase-config';
import {
  getYDoc,
  waitForYjsSync,
  handleObsoleteClient,
  CURRENT_SCHEMA_VERSION,
} from '@store/yjs-provider';
import { useSyncStore } from '@store/useSyncStore';
import { useBookStore } from '@store/useBookStore';
import {
  isMockFirestoreEnabled,
  getMockFirestoreUserId,
  getFirestoreDebounceOverrideMs,
} from '../../test-flags';

let instance: SyncOrchestrator | null = null;
let selection: SyncBackendSelection = {
  factory: (uid) => new FirestoreBackend(uid),
};

/**
 * The app-wide orchestrator accessor serving boot and the UI
 * (SyncSettingsTab, WorkspaceMigrationConfirmModal, useFirestoreSync,
 * wireSyncEvents). Constructs lazily on first use.
 */
export function getSyncOrchestrator(): SyncOrchestrator {
  if (!instance) {
    instance = createSyncOrchestrator({
      backendSelection: selection,
      events: getSyncEventBus(),
      doc: getYDoc,
      whenLocalSynced: () => waitForYjsSync(),
      onObsolete: handleObsoleteClient,
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      // merge-defaults hydration guarantees `books` is always present
      // (flip wave 4) — the old `|| {}` fallback canary is gone.
      isCleanClient: () => Object.keys(useBookStore.getState().books).length === 0,
      isEnabled: () =>
        Boolean(selection.mockSession) ||
        (useSyncStore.getState().firebaseEnabled && isFirebaseConfigured()),
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
        // §D7 inversion: the destructive apply severs sync through the
        // injected handle instead of importing the orchestrator.
        applyRemoteState: (blob) =>
          CheckpointService.applyRemoteState(blob, { pauseSync: stopSyncConnections }),
      },
      migrationState: {
        setAwaitingConfirmation: (targetWorkspaceId, backupCheckpointId) =>
          MigrationStateService.setAwaitingConfirmation(targetWorkspaceId, backupCheckpointId),
        setRestoringBackup: () => MigrationStateService.setRestoringBackup(),
        clear: () => MigrationStateService.clear(),
      },
    });
  }
  return instance;
}

/**
 * Sever live sync (provider + auth listener) without dropping the
 * orchestrator. The §D7 `pauseSync` handle for destructive restores
 * (CheckpointService.restoreCheckpoint / applyRemoteState callers).
 * No-op when sync never started.
 */
export function stopSyncConnections(): void {
  instance?.stop();
}

/**
 * Full teardown for wipeAllData (registered as a wipe hook in
 * registerBootTasks) and for test isolation: stop everything and drop the
 * instance so the next getSyncOrchestrator() composes fresh. Replaces the
 * legacy `FirestoreSyncManager.resetInstance()`.
 */
export function stopSyncForWipe(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

/**
 * Decide the backend (composition root only — boundary rule 9). Called by
 * the `syncInit` boot task BEFORE any start(); idempotent and re-runnable
 * (the orchestrator may be reset by tests/wipe; the mock uid flag is read
 * at composition time).
 */
export async function configureSyncBackendSelection(): Promise<void> {
  if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === 'true')) return;
  if (!isMockFirestoreEnabled()) return;

  const { MockBackend } = await import('@domains/sync/backend/MockBackend');
  const uid = getMockFirestoreUserId();
  selection = {
    factory: (forUid) => new MockBackend(forUid),
    mockSession: { uid, email: `${uid}@example.com` },
  };
  instance?.setBackendSelection(selection);
}
