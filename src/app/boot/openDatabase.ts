/**
 * `openDB` boot phase: open the EpubLibraryDB IndexedDB connection and run
 * the one-time, non-fatal cover-blob repair (moved verbatim from App.tsx).
 *
 * This is also where the data layer's connection-lifecycle callbacks get
 * their UI wiring (P3-4, design D2): src/data/connection.ts handles
 * blocked/blocking/terminated itself (closing/reopening as needed) but
 * never imports UI — the app layer decides how to tell the user.
 */
import type { BootTask } from '../bootstrap';
import { getDB } from '@db/db';
import { configureConnectionEvents } from '@data/connection';
import { maintenanceService } from '@lib/MaintenanceService';
import { useToastStore } from '@store/useToastStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export const openDatabaseTask: BootTask = {
  name: 'db/open',
  run: async (ctx) => {
    ctx.setStatusMessage('Connecting to database...');

    configureConnectionEvents({
      onBlocked: ({ oldVersion }) => {
        // Another tab still holds an older schema version open.
        useToastStore
          .getState()
          .showToast(
            'Waiting for another Versicle tab to close before the database can update…',
            'info',
            8000,
          );
        logger.warn(`DB open blocked by another tab on v${oldVersion}`);
      },
      onBlocking: () => {
        // Our (already-closed) connection was blocking another tab's
        // upgrade; this tab must reload to reopen at the new version.
        useToastStore
          .getState()
          .showToast(
            'Versicle was updated in another tab. Please reload this tab.',
            'error',
            0,
          );
      },
      onTerminated: () => {
        // The browser killed the connection; connection.ts already dropped
        // the cached promise so the next access reopens.
        useToastStore
          .getState()
          .showToast(
            'The browser closed the database connection. If problems persist, reload.',
            'error',
            8000,
          );
      },
    });

    await getDB();

    // One-time repair: strip corrupt (non-binary) coverBlobs left behind by
    // pre-v3 backup restores so covers can regenerate (see BackupService v3).
    try {
      await maintenanceService.repairCorruptCoverBlobsOnce();
    } catch (repairErr) {
      logger.warn('Cover blob repair failed:', repairErr);
    }
  },
};
