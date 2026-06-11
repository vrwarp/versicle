/**
 * The composition manifest: registers every subsystem's boot task into the
 * bootstrap registry, in the C11 phase contract. This file (not
 * app/bootstrap.ts) is the one place that may import subsystem boot modules —
 * the sequencer stays subsystem-free (plan/overhaul/README.md §4 rule 9).
 *
 * Within a phase, tasks run sequentially in the order listed here.
 */
import { registerBootTask } from '../bootstrap';
import { migrationInterceptorTask } from './migrationInterceptor';
import { openDatabaseTask } from './openDatabase';
import { yjsPersistenceTask } from './yjsPersistence';
import { whenHydratedTask, hydrateStaticMetadataTask } from './whenHydrated';
import { crdtMigrationsTask } from './crdtMigrations';
import { syncInitTask } from './syncInit';
import { ttsInitializeTask, deviceRegistrationTask } from './deviceRegistration';
import { deviceHeartbeatTask, driveAutoScanTask } from './backgroundTasks';
import { socialLoginTask } from './socialLogin';

let registered = false;

export function registerAppBootTasks(): void {
  if (registered) return;
  registered = true;

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
  registerBootTask('backgroundTasks', socialLoginTask);
}
