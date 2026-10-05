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
import {
  configureSyncBackendSelection,
  getSyncOrchestratorAsync,
  isSyncEnabled,
} from '../sync/createSync';
import { wireSyncEvents } from '../sync/wireSyncEvents';
import { startSyncDiagnosticsRecorder } from '../sync/diagnostics/recorder';
import { getYDoc, getYjsPersistence } from '@store/yjs-provider';
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
    // Sync diagnostics (Settings → Diagnostics → export): record doc
    // updates by origin + lifecycle transitions from boot onward, so an
    // export taken after "it didn't sync" has the history leading up to it.
    ctx.addCleanup(
      startSyncDiagnosticsRecorder({
        doc: getYDoc(),
        isIdbOrigin: (origin) => origin !== null && origin === getYjsPersistence(),
      })
    );

    if (!ctx.syncAllowed) {
      logger.info('Sync init skipped: migration awaiting confirmation.');
      return;
    }
    // First-use gate (Phase 8 §A): the heavy sync composition (firebase
    // SDK) loads inside THIS run() body, and only when sync could actually
    // run — un-configured users never download the firebase chunk at all.
    // The orchestrator re-checks isEnabled internally; this outer check
    // only prevents the chunk fetch.
    if (!isSyncEnabled()) {
      logger.info('Sync init skipped: sync disabled or not configured.');
      return;
    }
    // Intentionally NOT awaited: start() may touch the network and boot
    // must never block on sync completion (pinned by App_Boot.test.tsx).
    void getSyncOrchestratorAsync().then((orchestrator) => orchestrator.start());
  },
};
