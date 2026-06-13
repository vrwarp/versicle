/**
 * Staged workspace swap — the crash-resumable apply-from-staging design
 * (phase4-sync-strangler.md §D4). IndexedDB has no atomic database rename,
 * so "atomic swap" is implemented as durable local staging plus an
 * IDEMPOTENT apply gated by the localStorage state machine:
 *
 *   switch path (WorkspaceService.switch):
 *     download → verify on scratch → {@link stageWorkspaceState} →
 *     MigrationStateService.setStaged (THE commit point) → reload
 *   boot path (migrationInterceptor STAGED arm):
 *     {@link applyStagedSwap}: under the cross-tab swap lock, read staging →
 *     validate → wipe main → rewrite main → AWAITING_CONFIRMATION → reload
 *   finalize (WorkspaceMigrationConfirmModal):
 *     {@link clearStagedState} — staging stays intact UNTIL finalize, so a
 *     crash anywhere in apply re-enters the STAGED arm and re-runs it.
 *
 * Failure table (each row pinned by stagedSwap.test.ts and the
 * kill-mid-switch journey):
 *
 *   crash during download/verify/stage → no state machine, old
 *     `activeWorkspaceId` → old workspace boots untouched (staging junk is
 *     cleared by the next stage write);
 *   crash after STAGED, before/during apply → STAGED → apply re-runs from
 *     staging; switch completes;
 *   crash after apply, before user confirms → AWAITING_CONFIRMATION →
 *     existing confirm modal (P0 semantics untouched);
 *   user rolls back / apply throws → RESTORING_BACKUP → existing
 *     pinned-checkpoint restore (P0 semantics untouched).
 *
 * Layering: store access arrives via {@link ApplyStagedSwapHooks} (the boot
 * interceptor injects the `useSyncStore` write) — this module stays
 * store-free like the rest of domains/sync.
 */
import {
  readSnapshot,
  applySnapshot,
  deleteYjsDatabase,
  validateSnapshot,
  YJS_STAGING_DB_NAME,
} from '@data/snapshot/YjsSnapshotService';
import { createLogger } from '@lib/logger';
import type { SyncMigrationState } from '~types/workspace';
import { getSwapPausePoint, type SwapPausePoint } from '../../../test-flags';
import { MigrationStateService } from './MigrationStateService';

const logger = createLogger('StagedSwap');

/**
 * Cross-tab exclusive lock for the apply (§D4 step 7). Web Locks span tabs
 * AND release automatically when the holding context dies — exactly the
 * crash semantics the staged apply needs. Distinct from the data layer's
 * 'versicle-idb-write' gate (which the inner applySnapshot/deleteYjsDatabase
 * calls acquire per operation — same-name nesting would deadlock).
 */
const SWAP_LOCK_NAME = 'versicle-yjs-swap';

/** Fallback chain for environments without navigator.locks (jsdom). */
let fallbackTail: Promise<unknown> = Promise.resolve();

export function withSwapLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: Pick<LockManager, 'request'> } })
    .navigator?.locks;
  if (locks) {
    return locks.request(SWAP_LOCK_NAME, { mode: 'exclusive' }, work) as Promise<T>;
  }
  const run = fallbackTail.then(work, work) as Promise<T>;
  fallbackTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Kill-mid-switch determinism (§D8): when the Playwright suite armed this
 * point via `window.__VERSICLE_SWAP_PAUSE__`, park forever — the test then
 * `page.close()`es, modelling process death at exactly this boundary. Inert
 * in production (the flag is never set; see src/test-flags.ts).
 */
export async function pauseIfArmed(point: SwapPausePoint): Promise<void> {
  if (getSwapPausePoint() === point) {
    logger.warn(`Swap pause armed at '${point}' — parking for the kill-mid-switch harness.`);
    await new Promise<never>(() => {
      /* parked until the page is killed */
    });
  }
}

/**
 * Stage the verified workspace blob durably (§D4 step 5): clear any junk a
 * previously-abandoned switch left behind, then write the blob through the
 * fork's commit-awaited snapshot write. Resolves only once the staging
 * database would survive an immediate process kill.
 */
export async function stageWorkspaceState(blob: Uint8Array): Promise<void> {
  validateSnapshot(blob);
  await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
  await applySnapshot(blob, { dbName: YJS_STAGING_DB_NAME });
  logger.info(`Staged workspace state durably (${blob.byteLength} bytes).`);
}

/**
 * Drop the staging database. Called by the finalize path (confirm modal) —
 * and harmless any other time: the stage write clears junk first.
 */
export async function clearStagedState(): Promise<void> {
  await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
}

/** Store writes the boot interceptor injects (domains/sync stays store-free). */
export interface ApplyStagedSwapHooks {
  /**
   * Reconcile the persisted active-workspace tie to the switch target. Part
   * of the idempotent apply: a kill between `setStaged` and the switch
   * path's own id flip must not strand `activeWorkspaceId` on the previous
   * workspace while main IDB holds the target's data.
   */
  setActiveWorkspaceId: (id: string) => void;
  /** Sever cloud sync before the wipe; belt-and-braces at boot (§D7). */
  pauseSync?: () => void | Promise<void>;
}

/**
 * The boot-time apply (§D4 step 7): wipe main persistence and rewrite it
 * from the staging database, then hand over to the P0 state machine
 * (AWAITING_CONFIRMATION → the existing confirm modal) and reload.
 *
 * IDEMPOTENT: every step is re-runnable and staging is never touched, so a
 * crash anywhere re-enters the STAGED arm on next boot and completes. Runs
 * under the cross-tab swap lock so two tabs cannot interleave applies.
 *
 * PRECONDITION: boot-interceptor time — no live y-idb binding exists yet
 * (the interceptor phase precedes `startYjsPersistence`), which is what
 * makes the wipe a plain database deletion.
 *
 * @throws when the staging database is missing/empty or the blob fails
 *   validation — the caller routes that to RESTORING_BACKUP (the protected
 *   pre-migration checkpoint always exists before any destructive step).
 */
export async function applyStagedSwap(
  state: SyncMigrationState,
  hooks: ApplyStagedSwapHooks
): Promise<void> {
  if (state.status !== 'STAGED') {
    throw new Error(`applyStagedSwap called with status '${state.status}' (expected STAGED)`);
  }
  const target = state.targetWorkspaceId;
  const backupId = state.backupCheckpointId;
  if (!target || backupId == null) {
    throw new Error('STAGED state is missing targetWorkspaceId/backupCheckpointId');
  }

  await withSwapLock(async () => {
    if (hooks.pauseSync) {
      try {
        await hooks.pauseSync();
      } catch (e) {
        logger.warn('pauseSync failed during staged apply (continuing):', e);
      }
    }

    await pauseIfArmed('swap:before-apply');

    const blob = await readSnapshot({ dbName: YJS_STAGING_DB_NAME });
    if (!blob) {
      throw new Error(
        'Staged workspace state is missing — cannot apply. Routing to backup restore.'
      );
    }
    // Prove the blob applies cleanly BEFORE the destructive wipe
    // (validate-before-destroy, same discipline as restoreCheckpoint).
    validateSnapshot(blob);

    logger.info(`Applying staged workspace switch → ${target} (backup #${backupId})...`);

    // Destructive window opens: wipe main…
    await deleteYjsDatabase();

    await pauseIfArmed('swap:mid-apply');

    // …and rewrite it from staging, commit-awaited.
    await applySnapshot(blob);

    // Reconcile the persisted tie, then engage the P0 state machine. The
    // ordering keeps every crash row resolvable: a kill before this line
    // re-runs the whole apply; a kill after either line lands in
    // AWAITING_CONFIRMATION with the id already reconciled.
    hooks.setActiveWorkspaceId(target);
    MigrationStateService.setAwaitingConfirmation(target, backupId);

    logger.info('Staged apply complete. Reloading into the confirmation flow...');
  });

  window.location.reload();
}
