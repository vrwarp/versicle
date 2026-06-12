/**
 * Boot interceptor for the workspace-migration state machine
 * (moved verbatim from App.tsx; see MigrationStateService for the states).
 *
 * - STAGED → run the idempotent staged apply (Phase 4 §D4: wipe main +
 *   rewrite from the durable staging DB under the cross-tab swap lock,
 *   transition to AWAITING_CONFIRMATION, reload) and HALT the boot
 *   sequence. A crash anywhere in apply re-enters this arm on next boot —
 *   staging stays intact until the user finalizes. Apply failure routes to
 *   RESTORING_BACKUP (the protected pre-migration checkpoint always exists
 *   before anything destructive ran).
 * - RESTORING_BACKUP  → execute the rollback and HALT the boot sequence; the
 *   restore reloads the page when the snapshot is fully written.
 * - AWAITING_CONFIRMATION → record the pending migration for the
 *   confirmation modal and forbid sync init (`ctx.syncAllowed = false`);
 *   boot continues so the user can confirm/reject on a working shell.
 * - otherwise (standard boot) → prune zombie pre-migration backups.
 */
import type { BootTask } from '../bootstrap';
import { MigrationStateService } from '@domains/sync/workspaces/MigrationStateService';
import { applyStagedSwap } from '@domains/sync/workspaces/stagedSwap';
import { CheckpointService } from '@domains/sync/checkpoints/CheckpointService';
import { stopSyncConnections } from '../sync/createSync';
import { useSyncStore } from '@store/useSyncStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

/** Store-backed hook for the staged apply / rollback (injected — the
 * domain modules stay store-free). */
const setActiveWorkspaceId = (id: string): void => {
  useSyncStore.getState().setActiveWorkspaceId(id);
};

export const migrationInterceptorTask: BootTask = {
  name: 'sync/migration-interceptor',
  run: (ctx) => {
    const migrationState = MigrationStateService.getState();

    if (migrationState) {
      if (migrationState.status === 'STAGED') {
        // §D4 step 7: the crash-resumable apply. Idempotent — every entry
        // into this arm re-runs the whole wipe+rewrite from staging.
        logger.info('Boot interceptor: STAGED detected, applying staged workspace switch...');
        applyStagedSwap(migrationState, {
          pauseSync: stopSyncConnections,
          setActiveWorkspaceId,
        }).catch(err => {
          // Failure table row 4 ("apply throws"): fall back to the pinned
          // pre-migration checkpoint via the existing RESTORING_BACKUP
          // flow. Without a backup id there is nothing to restore — clear
          // and reload into the previous workspace (main IDB is only
          // touched after the staging read+validate succeeded).
          logger.error('Staged apply failed, routing to backup restore:', err);
          if (migrationState.backupCheckpointId != null) {
            MigrationStateService.setRestoringBackup();
          } else {
            MigrationStateService.clear();
          }
          window.location.reload();
        });
        ctx.setStatusMessage('Applying workspace switch...');
        ctx.halt('applying-staged-switch'); // applyStagedSwap will reload
        return;
      }

      if (migrationState.status === 'RESTORING_BACKUP') {
        // Flow C: Execute rollback immediately.
        // The migration state is kept until the restore SUCCEEDS —
        // restoreCheckpoint clears it once the snapshot is fully written,
        // just before reloading. Clearing it up-front would make a failed
        // or interrupted rollback silently boot into the target workspace.
        logger.info('Boot interceptor: RESTORING_BACKUP detected, rolling back...');
        if (migrationState.backupCheckpointId != null) {
          // pauseSync (§D7 inversion): sync never started on this boot path
          // (ctx.syncAllowed gates syncInit), so this is belt-and-braces —
          // it severs anything a future boot reordering might have started.
          // setActiveWorkspaceId: staged-swap states carry the pre-switch
          // workspace id; the restore reverts the local tie alongside the
          // data so a rollback cannot leave old data tied to the target
          // workspace (P4-5; legacy states without the field are untouched).
          CheckpointService.restoreCheckpoint(migrationState.backupCheckpointId, {
            pauseSync: stopSyncConnections,
            setActiveWorkspaceId,
          })
            .catch(err => {
              logger.error('Rollback failed:', err);
              // Clear state and reload as last resort (avoids a reload loop)
              MigrationStateService.clear();
              window.location.reload();
            });
        } else {
          logger.error('No backup checkpoint ID for rollback, reloading...');
          MigrationStateService.clear();
          window.location.reload();
        }
        ctx.setStatusMessage('Restoring backup...');
        ctx.halt('restoring-backup'); // restoreCheckpoint will reload
        return;
      }

      if (migrationState.status === 'AWAITING_CONFIRMATION') {
        // Flow B, Step 6: surface the confirmation modal, do NOT initialize
        // sync (enforced by the syncInit task reading ctx.syncAllowed).
        logger.info('Boot interceptor: AWAITING_CONFIRMATION detected, HALT sync init...');
        ctx.syncAllowed = false;
        ctx.pendingMigration = {
          targetWorkspaceId: migrationState.targetWorkspaceId || 'unknown',
          backupCheckpointId: migrationState.backupCheckpointId || 0,
        };
        return;
      }
    }

    // Zombie backup cleanup: prune extremely old pre-migration backups that
    // were abandoned (standard boot only — never while a migration is live).
    CheckpointService.listCheckpoints().then(checkpoints => {
      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      checkpoints.forEach(cp => {
        if (cp.trigger === 'pre-migration' && now - cp.timestamp > SEVEN_DAYS) {
          logger.info(`Cleaning up zombie pre-migration backup checkpoint #${cp.id}`);
          CheckpointService.deleteCheckpoint(cp.id).catch(err => {
            logger.warn('Failed to clean up zombie backup:', err);
          });
        }
      });
    }).catch(err => logger.warn('Failed to list zombie backups:', err));
  },
};
