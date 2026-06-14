/**
 * `backgroundTasks` boot phase (moved from App.tsx):
 *  - the device heartbeat interval (now started AFTER device registration —
 *    pre-C11 it raced registration from a parallel effect),
 *  - the weekly background Drive scan policy,
 *  - the audio-cache LRU eviction sweep (Phase 3 D5.1), preceded by the
 *    one-time v25 `size` backfill (P3-13 D7 — "post-open idle": this phase
 *    runs after boot completes, off the critical path).
 */
import type { BootTask } from '../bootstrap';
import { getDeviceId } from '@lib/device-id';
import { useDeviceStore } from '@store/useDeviceStore';
import { useDriveStore } from '@store/useDriveStore';
import { getDriveLibrarySync } from '@domains/google';
import { GoogleAuthRequiredError } from '@domains/google';
import { audioCache } from '@data/repos/audioCache';
import { bookContent } from '@data/repos/bookContent';
import { runReingestWave, derivedContentSane } from '@domains/library/reingest';
import { getLibrary } from '../library/createLibrary';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

/** Idempotent; the boot task owns the start moment. */
export function startDeviceHeartbeat(): void {
  if (heartbeatIntervalId !== null) return;
  heartbeatIntervalId = setInterval(() => {
    useDeviceStore.getState().touchDevice(getDeviceId());
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat. Called by boot cleanup AND by wireSyncEvents on the
 * `obsolete` quarantine event (phase4-sync-strangler.md §D5 layer 3): an
 * obsolete client must stop announcing itself — pre-P4 it kept writing the
 * device doc from behind the lock screen.
 */
export function stopDeviceHeartbeat(): void {
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

/** Test seam: observable heartbeat state for the quarantine suites. */
export function isDeviceHeartbeatRunning(): boolean {
  return heartbeatIntervalId !== null;
}

export const deviceHeartbeatTask: BootTask = {
  name: 'device/heartbeat',
  run: (ctx) => {
    startDeviceHeartbeat();
    ctx.addCleanup(stopDeviceHeartbeat);
  },
};

export const audioCacheEvictionTask: BootTask = {
  name: 'data/audio-cache-eviction',
  run: () => {
    // Fire-and-forget: both jobs stream cursors and write through the gate,
    // so they can never overlap a playback write. Boot must not wait on
    // them. The backfill runs first (once; flag-guarded) so the sweep can
    // read sizes without touching blobs; on backfill failure the flag stays
    // unset and it retries next boot, while eviction still runs (it falls
    // back to audio.byteLength).
    void audioCache
      .backfillSizesOnce()
      .catch((err) => {
        logger.warn('v25 audio size backfill failed (will retry next boot):', err);
      })
      .then(() => audioCache.runEviction())
      .catch((err) => {
        logger.warn('Audio cache eviction sweep failed at boot:', err);
      });
  },
};

export const driveAutoScanTask: BootTask = {
  name: 'drive/auto-scan',
  run: async () => {
    const driveStore = useDriveStore.getState();
    if (!driveStore.linkedFolderId) return;

    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (driveStore.lastScanTime && now - driveStore.lastScanTime <= ONE_WEEK) return;

    const shouldSync = await getDriveLibrarySync().shouldAutoSync();
    if (!shouldSync) {
      logger.info('Background Drive Scan: Skipping sync based on heuristic or connection status.');
      return;
    }

    logger.info('Background Drive Scan: Heuristic triggered, refreshing index...');
    // Silent by default (boot policy): never pops auth UI from boot.
    getDriveLibrarySync().scanAndIndex().catch(err => {
      if (err instanceof GoogleAuthRequiredError) {
        // Silent path: no cached token. Never pops UI, never disconnects —
        // the user reconnects from settings (GG-2 reversal).
        logger.info(`Background Drive Scan skipped: ${err.message}`);
      } else {
        logger.warn('Background Drive Scan failed:', err);
      }
    });
  },
};


// ── Phase 7 §E: the NFKD/extraction re-ingest wave ─────────────────────────

/** localStorage flag: the settings "defer re-ingestion" toggle (device-local). */
const REINGEST_DEFER_KEY = 'versicle_reingest_defer';
/** Idle delay before the wave starts scanning (stays off the boot path). */
const REINGEST_START_DELAY_MS = 10_000;

function isReingestDeferred(): boolean {
  try {
    return localStorage.getItem(REINGEST_DEFER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget background re-ingestion (phase7-library-google.md §E):
 * stamp-based candidacy, restamp fast path, idle-priority reingest jobs
 * through the ImportOrchestrator queue (user imports always preempt),
 * resumable via the per-book stamps. Honors the defer toggle between books.
 */
export const reingestWaveTask: BootTask = {
  name: 'library/reingest-wave',
  run: (ctx) => {
    if (isReingestDeferred()) {
      logger.info('Re-ingest wave deferred by settings toggle.');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void runReingestWave({
        listVersions: () => bookContent.listTtsExtractionVersions(),
        listRows: (bookId) => bookContent.listTtsPrepForBook(bookId),
        restamp: (bookId, version) => bookContent.restampTtsPrep(bookId, version),
        hasLocalBinary: async (bookId) => {
          const status = await bookContent.getOffloadedStatus([bookId]);
          return status.get(bookId) === false;
        },
        reingest: (bookId) =>
          getLibrary().orchestrator.reprocess(bookId, 'idle', { verifyDerived: derivedContentSane }),
        shouldContinue: () => !cancelled && !isReingestDeferred(),
      }).catch((err) => {
        logger.warn('Re-ingest wave failed (will retry next boot):', err);
      });
    }, REINGEST_START_DELAY_MS);
    ctx.addCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  },
};
