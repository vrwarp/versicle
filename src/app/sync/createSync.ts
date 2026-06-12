/**
 * Sync composition root (phase4-sync-strangler.md §D1 prod-bundle
 * exclusion; master plan §2 boundary rule 9): the ONE place that decides
 * which `SyncBackend` implementation the app runs on.
 *
 * - Production: nothing to do — the sync manager defaults to
 *   `FirestoreBackend`.
 * - DEV/E2E with `window.__VERSICLE_MOCK_FIRESTORE__` (read through
 *   src/test-flags.ts, the single flag reader): swap in `MockBackend` and a
 *   synthesized auth session. The dynamic import below sits in a branch
 *   that is statically dead in production builds (`import.meta.env.DEV`
 *   and `VITE_E2E` are build-time constants), so Rollup drops the
 *   MockBackend/MockFireProvider chunk from prod output entirely — the
 *   chunk-content check in scripts/check-worker-chunk.mjs asserts the
 *   emitted artifact, not this import shape.
 *
 * Called by the `syncInit` boot task BEFORE any `initialize()`; idempotent
 * and re-runnable (the manager singleton may be reset by tests/wipe).
 */
import { getFirestoreSyncManager } from '@lib/sync/FirestoreSyncManager';
import { isMockFirestoreEnabled, getMockFirestoreUserId } from '../../test-flags';

export async function configureSyncBackendSelection(): Promise<void> {
  if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === 'true')) return;
  if (!isMockFirestoreEnabled()) return;

  const { MockBackend } = await import('@domains/sync/backend/MockBackend');
  const uid = getMockFirestoreUserId();
  getFirestoreSyncManager().setBackendSelection({
    factory: (forUid) => new MockBackend(forUid),
    mockSession: { uid, email: `${uid}@example.com` },
  });
}
