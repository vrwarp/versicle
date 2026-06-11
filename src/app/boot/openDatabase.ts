/**
 * `openDB` boot phase: open the EpubLibraryDB IndexedDB connection and run
 * the one-time, non-fatal cover-blob repair (moved verbatim from App.tsx).
 */
import type { BootTask } from '../bootstrap';
import { getDB } from '../../db/db';
import { maintenanceService } from '../../lib/MaintenanceService';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Boot');

export const openDatabaseTask: BootTask = {
  name: 'db/open',
  run: async (ctx) => {
    ctx.setStatusMessage('Connecting to database...');
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
