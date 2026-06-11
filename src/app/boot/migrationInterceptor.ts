/**
 * Boot interceptor for the workspace-migration state machine
 * (moved verbatim from App.tsx; see MigrationStateService for the states).
 *
 * - RESTORING_BACKUP  → execute the rollback and HALT the boot sequence; the
 *   restore reloads the page when the snapshot is fully written.
 * - AWAITING_CONFIRMATION → record the pending migration for the
 *   confirmation modal and forbid sync init (`ctx.syncAllowed = false`);
 *   boot continues so the user can confirm/reject on a working shell.
 * - otherwise (standard boot) → prune zombie pre-migration backups.
 */
import type { BootTask } from '../bootstrap';
import { MigrationStateService } from '../../lib/sync/MigrationStateService';
import { CheckpointService } from '../../lib/sync/CheckpointService';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Boot');

export const migrationInterceptorTask: BootTask = {
  name: 'sync/migration-interceptor',
  run: (ctx) => {
    const migrationState = MigrationStateService.getState();

    if (migrationState) {
      if (migrationState.status === 'RESTORING_BACKUP') {
        // Flow C: Execute rollback immediately.
        // The migration state is kept until the restore SUCCEEDS —
        // restoreCheckpoint clears it once the snapshot is fully written,
        // just before reloading. Clearing it up-front would make a failed
        // or interrupted rollback silently boot into the target workspace.
        logger.info('Boot interceptor: RESTORING_BACKUP detected, rolling back...');
        if (migrationState.backupCheckpointId != null) {
          CheckpointService.restoreCheckpoint(migrationState.backupCheckpointId)
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
