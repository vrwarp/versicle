/**
 * `syncInit` boot phase: construct + start the sync orchestrator — unless
 * the migration interceptor forbade it (`ctx.syncAllowed === false` while a
 * workspace migration awaits user confirmation).
 *
 * `start()` is intentionally NOT awaited: it may touch the network and
 * boot must never block on sync completion (pinned by App_Boot.test.tsx).
 * Its enablement gate — `(firebaseEnabled && isConfigured) || mockEnabled`
 * (§D2) — lives inside the orchestrator deps wired by createSync.
 */
import type { BootTask } from '../bootstrap';
import { configureSyncBackendSelection, getSyncOrchestrator } from '../sync/createSync';
import { wireSyncEvents } from '../sync/wireSyncEvents';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export const syncInitTask: BootTask = {
  name: 'sync/initialize',
  run: async (ctx) => {
    // Backend selection + the single SyncEvent subscriber happen
    // UNCONDITIONALLY (even when initialization is deferred):
    // WorkspaceMigrationConfirmModal re-starts sync after the user
    // confirms a migration, and by then both the composition decision and
    // the presentation wiring must already be installed. Local work only —
    // never blocks on network.
    await configureSyncBackendSelection();
    ctx.addCleanup(wireSyncEvents());

    if (!ctx.syncAllowed) {
      logger.info('Sync init skipped: migration awaiting confirmation.');
      return;
    }
    void getSyncOrchestrator().start();
  },
};
