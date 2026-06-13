/**
 * `migrations` boot phase: run the CRDT migration coordinator
 * (src/app/migrations.ts) exactly once, after the `whenHydrated` phase has
 * confirmed the Y.Doc is loaded from local persistence.
 *
 * A {@link MigrationError} thrown here rejects the boot promise; App.tsx
 * routes it to CriticalMigrationFailureView with the pre-migration
 * checkpoint id, whose restore button drives the existing
 * RESTORING_BACKUP → CheckpointService.restoreCheckpoint boot flow.
 */
import type { BootTask } from '../bootstrap';
import { runCrdtMigrations } from '../migrations';

export const crdtMigrationsTask: BootTask = {
  name: 'state/crdt-migrations',
  run: async (ctx) => {
    ctx.setStatusMessage('Checking data version...');
    await runCrdtMigrations();
  },
};
