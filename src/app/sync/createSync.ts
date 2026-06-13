/**
 * Sync composition root (phase4-sync-strangler.md §D1/§D2; master plan §2
 * boundary rules 3 + 9): the ONE place that decides which `SyncBackend`
 * implementation the app runs on and holds the orchestrator singleton.
 *
 * Phase 8 §A split this module in two: THIS file is the LIGHT half (state,
 * gates, public accessors — zero firebase in its static graph) and
 * composeSync.ts is the HEAVY half (orchestrator + FirestoreBackend +
 * firebase SDK), reachable only through the dynamic import inside
 * {@link getSyncOrchestratorAsync}. Un-configured users (sync off) never
 * download the firebase chunk; configured users load it inside the
 * `syncInit` boot task body. Check 4 of scripts/check-worker-chunk.mjs
 * pins the emitted entry chunk firebase-free.
 *
 * - The orchestrator (src/domains/sync/core/SyncOrchestrator.ts) is
 *   store-free; every store/flag/yjs-provider touch it needs is injected
 *   in composeSync.ts as a port adapter (the EngineContext pattern).
 *   `getSyncOrchestratorAsync` replaces the legacy
 *   `FirestoreSyncManager.getInstance()`; construction is owned by the
 *   `syncInit` boot task.
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
 *   `(firebaseEnabled && isConfigured) || mockEnabled` — see
 *   {@link isSyncEnabled}, which reads config PRESENCE through the SDK-free
 *   firebase-config-presence module.
 */
import type { SyncOrchestrator } from '@domains/sync/core/SyncOrchestrator';
import type { SyncBackendSelection } from '@domains/sync/core/ports';
import { isFirebaseConfigured } from '@lib/sync/firebase-config-presence';
import { useSyncStore } from '@store/useSyncStore';
import {
  isMockFirestoreEnabled,
  getMockFirestoreUserId,
} from '../../test-flags';

let instance: SyncOrchestrator | null = null;
let instancePromise: Promise<SyncOrchestrator> | null = null;
let selection: SyncBackendSelection | null = null;

/**
 * The single enablement gate (§D2): callers that would START sync check
 * this BEFORE composing, so the firebase chunk is never even fetched while
 * sync is off/un-configured. The orchestrator re-checks it internally
 * (injected as the isEnabled dep), so calling start() remains safe either
 * way.
 */
export function isSyncEnabled(): boolean {
  return (
    Boolean(selection?.mockSession) ||
    (useSyncStore.getState().firebaseEnabled && isFirebaseConfigured())
  );
}

/**
 * The app-wide orchestrator accessor serving boot and the UI
 * (SyncSettingsTab, WorkspaceMigrationConfirmModal, useFirestoreSync,
 * wireSyncEvents). Composes lazily on first use — the await covers the
 * one-time dynamic import of the heavy half (local chunk load, no
 * network round-trips beyond the asset fetch).
 */
export async function getSyncOrchestratorAsync(): Promise<SyncOrchestrator> {
  if (instance) return instance;
  if (!instancePromise) {
    const p: Promise<SyncOrchestrator> = import('./composeSync').then(
      ({ composeSyncOrchestrator }) => {
        // A wipe/reset may have superseded this composition while the
        // chunk loaded — only install if we are still the current attempt.
        const composed = composeSyncOrchestrator({ selection, isEnabled: isSyncEnabled });
        if (instancePromise === p) {
          selection = composed.selection;
          instance = composed.orchestrator;
        }
        return instance ?? composed.orchestrator;
      },
    );
    instancePromise = p;
  }
  return instancePromise;
}

/**
 * Synchronous view of the singleton for callers that must never CREATE it
 * (e.g. wireSyncEvents' obsolete-quarantine sever: if sync never composed,
 * there is no connection to sever).
 */
export function peekSyncOrchestrator(): SyncOrchestrator | null {
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
 * instance so the next getSyncOrchestratorAsync() composes fresh. Replaces
 * the legacy `FirestoreSyncManager.resetInstance()`.
 */
export function stopSyncForWipe(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
  instancePromise = null;
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
