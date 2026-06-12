/**
 * The composition manifest: registers every subsystem's boot task into the
 * bootstrap registry, in the C11 phase contract. This file (not
 * app/bootstrap.ts) is the one place that may import subsystem boot modules —
 * the sequencer stays subsystem-free (plan/overhaul/README.md §4 rule 9).
 *
 * Within a phase, tasks run sequentially in the order listed here.
 *
 * It also registers the data layer's WIPE HOOKS (Phase 3 D9): wipeAllData
 * must stop every writer before deleting storage, and the two writers —
 * the Firestore sync manager and the y-idb persistence — live ABOVE the
 * data layer, so src/data/wipe.ts exposes a registry instead of importing
 * them (that import was the last db→store layering violation). Registration
 * happens here, at manifest import/registration time, not boot success: if
 * the app crashed before this module ran, neither writer was ever started,
 * so the missing hook stops nothing that runs (SafeMode stays safe).
 */
import { registerBootTask } from '../bootstrap';
import { registerWipeHook } from '@data/wipe';
import { disconnectYjs } from '@store/yjs-provider';
import { migrationInterceptorTask } from './migrationInterceptor';
import { openDatabaseTask } from './openDatabase';
import { yjsPersistenceTask } from './yjsPersistence';
import { whenHydratedTask, hydrateStaticMetadataTask } from './whenHydrated';
import { crdtMigrationsTask } from './crdtMigrations';
import { syncInitTask } from './syncInit';
import { ttsInitializeTask, deviceRegistrationTask } from './deviceRegistration';
import { deviceHeartbeatTask, driveAutoScanTask, audioCacheEvictionTask } from './backgroundTasks';
import { socialLoginTask } from './socialLogin';

let registered = false;

export function registerAppBootTasks(): void {
  if (registered) return;
  registered = true;

  registerWipeHook({
    name: 'sync/stop',
    // Dynamic import: keeps the firebase dependency tree out of this
    // module's static graph (same posture the wipe itself had pre-D9).
    // stopSyncForWipe is a no-op when no orchestrator was ever constructed.
    stop: async () => {
      const { stopSyncForWipe } = await import('../sync/createSync');
      stopSyncForWipe();
    },
  });
  registerWipeHook({
    name: 'state/stop-yjs-persistence',
    // Flushes and closes the y-idb persistence so the `versicle-yjs`
    // connection is released (otherwise its deletion would be blocked by
    // our own tab) and no debounced CRDT write can land post-delete.
    stop: () => disconnectYjs(),
  });

  registerBootTask('interceptMigration', migrationInterceptorTask);
  registerBootTask('openDB', openDatabaseTask);
  registerBootTask('startYjsPersistence', yjsPersistenceTask);
  registerBootTask('whenHydrated', whenHydratedTask);
  registerBootTask('whenHydrated', hydrateStaticMetadataTask);
  registerBootTask('migrations', crdtMigrationsTask);
  registerBootTask('syncInit', syncInitTask);
  registerBootTask('deviceRegistration', ttsInitializeTask);
  registerBootTask('deviceRegistration', deviceRegistrationTask);
  registerBootTask('backgroundTasks', deviceHeartbeatTask);
  registerBootTask('backgroundTasks', driveAutoScanTask);
  registerBootTask('backgroundTasks', audioCacheEvictionTask);
  registerBootTask('backgroundTasks', socialLoginTask);
}
