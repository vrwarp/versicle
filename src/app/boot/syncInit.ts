/**
 * `syncInit` boot phase: start the Firestore sync manager — unless the
 * migration interceptor forbade it (`ctx.syncAllowed === false` while a
 * workspace migration awaits user confirmation).
 *
 * `initialize()` is intentionally NOT awaited: it may touch the network and
 * boot must never block on sync completion (pinned by App_Boot.test.tsx).
 */
import type { BootTask } from '../bootstrap';
import { getFirestoreSyncManager } from '@lib/sync/FirestoreSyncManager';
import { configureSyncBackendSelection } from '../sync/createSync';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export const syncInitTask: BootTask = {
  name: 'sync/initialize',
  run: async (ctx) => {
    // Backend selection happens UNCONDITIONALLY (even when initialization
    // is deferred): WorkspaceMigrationConfirmModal re-initializes sync after
    // the user confirms a migration, and by then the composition decision
    // must already be installed. Local work only — never blocks on network.
    await configureSyncBackendSelection();

    if (!ctx.syncAllowed) {
      logger.info('Sync init skipped: migration awaiting confirmation.');
      return;
    }
    void getFirestoreSyncManager().initialize();
  },
};
