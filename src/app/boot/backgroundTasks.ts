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
import { DriveScannerService } from '@lib/drive/DriveScannerService';
import { audioCache } from '@data/repos/audioCache';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export const deviceHeartbeatTask: BootTask = {
  name: 'device/heartbeat',
  run: (ctx) => {
    const intervalId = setInterval(() => {
      useDeviceStore.getState().touchDevice(getDeviceId());
    }, HEARTBEAT_INTERVAL_MS);
    ctx.addCleanup(() => clearInterval(intervalId));
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

    const shouldSync = await DriveScannerService.shouldAutoSync();
    if (!shouldSync) {
      logger.info('Background Drive Scan: Skipping sync based on heuristic or connection status.');
      return;
    }

    logger.info('Background Drive Scan: Heuristic triggered, refreshing index...');
    DriveScannerService.scanAndIndex().catch(err => {
      if (err instanceof Error && err.message.includes('is not connected')) {
        logger.info(`Background Drive Scan failed: ${err.message}`);
      } else {
        logger.warn('Background Drive Scan failed:', err);
      }
    });
  },
};
