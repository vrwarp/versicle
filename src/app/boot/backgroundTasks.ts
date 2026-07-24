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
import { getDriveLibrarySync, getDriveMetadataService } from '@domains/google';
import { GoogleAuthRequiredError } from '@domains/google';
import { audioCache } from '@data/repos/audioCache';
import { embeddingsRepo } from '@data/repos/embeddings';
import { bookContent } from '@data/repos/bookContent';
import { contentKey, CURRENT_QUANT } from '@domains/search';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import { peekSyncOrchestrator } from '@app/sync/createSync';
import { useGenAIStore } from '@store/useGenAIStore';
import { useReadingStateStore, getMostRecentProgress } from '@store/useReadingStateStore';
import { useBookStore } from '@store/useBookStore';
import { runReingestWave, derivedContentSane } from '@domains/library/reingest';
import { getLibrary } from '../library/createLibrary';
import type { SyncBackend } from '@domains/sync';
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

/** The injected seams for the never-evict-unconfirmed-upload protected set. */
export interface ProtectedBookIdsDeps {
  /** The shareAiCaches master switch (useGenAIStore.shareAiCaches). */
  isShareEnabled(): boolean;
  /**
   * The connected artifact backend handle, or null (sync off / not connected).
   * A null handle means there is no cloud to confirm against → nothing to
   * protect (eviction proceeds as today).
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Candidate book ids (the eviction set — the recency map keys). */
  bookIds: string[];
  /** Resolve bookId → contentHash via the manifest (absent on pre-P7 books). */
  getContentHash(bookId: string): Promise<string | undefined>;
  /** The live embedding-space stamp ({model,dims} fresh from the GenAI store). */
  getStamp(): { model: string; dims: number };
}

/**
 * Build the never-evict-unconfirmed-upload protected set (Phase D, GUARDRAILS).
 * EMPTY when shareAiCaches is OFF (evict exactly as today) or no backend is
 * connected. When ON + connected, for each book it derives the contentKey and
 * HEAD-probes the backend; a HEAD MISS means the upload is NOT yet confirmed,
 * so the book is PROTECTED (eviction must never destroy the only copy of a
 * cache the user opted to share).
 *
 * FAIL-SAFE on a probe throw: PROTECT the book (an offline blip must not be
 * mistaken for a confirmed upload — never evict the only copy). This is the
 * OPPOSITE polarity to isWorkspaceAlive's alive-on-error: here the conservative
 * default is "keep", not "proceed".
 */
export async function computeProtectedBookIds(
  deps: ProtectedBookIdsDeps,
): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  if (!deps.isShareEnabled()) return protectedIds;

  const handle = deps.getBackend();
  if (!handle) return protectedIds;

  const stamp = deps.getStamp();
  for (const bookId of deps.bookIds) {
    try {
      const contentHash = await deps.getContentHash(bookId);
      // No content identity (pre-P7) → no content-addressed key → nothing the
      // publisher could have uploaded; not a candidate for protection.
      if (!contentHash) continue;
      const key = await contentKey({
        contentHash,
        model: stamp.model,
        dims: stamp.dims,
        quant: CURRENT_QUANT,
        extractionVersion: TTS_EXTRACTION_VERSION,
      });
      const head = await handle.backend.headArtifact(
        handle.workspaceId,
        `embedCache/${key}`,
      );
      // HEAD miss → upload unconfirmed → protect (never evict the only copy).
      if (head === null) protectedIds.add(bookId);
    } catch (err) {
      // Fail-safe: a probe throw (offline/permission) protects the book.
      logger.warn(`Eviction-protection probe failed for ${bookId}; protecting:`, err);
      protectedIds.add(bookId);
    }
  }
  return protectedIds;
}

export const embeddingCacheEvictionTask: BootTask = {
  name: 'data/embedding-cache-eviction',
  run: () => {
    // Fire-and-forget, mirroring audioCacheEvictionTask: the sweep streams a
    // readonly cursor and deletes through the write gate, so it can never
    // overlap an indexer write, and boot must not wait on it.
    //
    // The recency signal is INJECTED here (the repo stays store-free,
    // data-no-upward): build Map<bookId, lastReadMs> from the reading-state
    // store's per-book progress (getMostRecentProgress(...).lastRead) so
    // recently-read books evict LAST. Books with no valid progress are absent
    // from the map and rank oldest (0) inside runEviction.
    const { progress } = useReadingStateStore.getState();
    const bookIds = Object.keys(useBookStore.getState().books);
    const recency = new Map<string, number>();
    for (const bookId of bookIds) {
      const recent = getMostRecentProgress(progress[bookId]);
      if (recent) recency.set(bookId, recent.lastRead);
    }

    // Shape the never-evict-unconfirmed-upload protected set at the TASK level
    // (the repo stays pure). shareAiCaches OFF / no backend → empty set → zero
    // added cost (no HEAD probes) and eviction runs exactly as today.
    void computeProtectedBookIds({
      isShareEnabled: () => useGenAIStore.getState().shareAiCaches,
      getBackend: () => peekSyncOrchestrator()?.getConnectedArtifactBackend() ?? null,
      bookIds,
      getContentHash: async (bookId) => {
        const manifest = await bookContent.getManifest(bookId);
        return manifest?.contentHash;
      },
      getStamp: () => {
        const s = useGenAIStore.getState();
        return { model: s.embeddingModel, dims: s.embeddingDims };
      },
    })
      .then((protectedIds) => embeddingsRepo.runEviction(recency, undefined, protectedIds))
      .catch((err) => {
        logger.warn('Embedding cache eviction sweep failed at boot:', err);
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


// ── R7: passive trickle hydration of the Drive preview index ────────────────

/**
 * Best-effort "safe to trickle now" gate. Foreground-only (Capacitor webviews
 * have no reliable background execution), online, unmetered (saveData off), and
 * only when the user opted in AND a folder is linked. Pure for testability.
 */
export function shouldTrickleNow(env: {
  onLine: boolean;
  visible: boolean;
  saveData: boolean;
  enabled: boolean;
  linked: boolean;
}): boolean {
  return env.enabled && env.linked && env.onLine && env.visible && !env.saveData;
}

const TRICKLE_START_DELAY_MS = 15_000;
const TRICKLE_INTERVAL_MS = 5 * 60 * 1000;
const TRICKLE_BATCH_SIZE = 30;
/**
 * Coarse per-session spend cap (attempts ≈ books ≈ bytes): on metered-unknown
 * connections (web can't always detect) this bounds a session to ~60 previews
 * (~a few MB of ranged reads) — the byte-cap proxy the critique asked for.
 */
const TRICKLE_SESSION_ATTEMPT_CAP = 60;

/**
 * R7: an idle, batched consumer that builds the rich Drive preview index in
 * the background. Opt-in (useDriveStore.trickleEnabled, default off), batched
 * (~30 books every 5 min — radio-friendly vs. a per-10s tick), foreground-only,
 * unmetered, and session-capped. It rides DriveMetadataService.hydrateBatch,
 * which reads the PERSISTED index only (never a scan) and skips negative-cache
 * rows, so a broken file is never retried.
 */
export const driveTrickleTask: BootTask = {
  name: 'drive/trickle-hydration',
  run: (ctx) => {
    let attemptedThisSession = 0;
    let stopped = false;

    const readEnv = () => {
      const s = useDriveStore.getState();
      const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
      return {
        onLine: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        visible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
        saveData: nav.connection?.saveData === true,
        enabled: s.trickleEnabled,
        linked: !!s.linkedFolderId,
      };
    };

    const runBatch = async () => {
      if (stopped || attemptedThisSession >= TRICKLE_SESSION_ATTEMPT_CAP) return;
      if (!shouldTrickleNow(readEnv())) return;
      try {
        const remainingBudget = TRICKLE_SESSION_ATTEMPT_CAP - attemptedThisSession;
        const result = await getDriveMetadataService().hydrateBatch({
          batchSize: Math.min(TRICKLE_BATCH_SIZE, remainingBudget),
        });
        attemptedThisSession += result.attempted;
        if (result.remaining === 0 && result.attempted > 0) {
          logger.info('Drive trickle: preview index fully hydrated.');
        }
      } catch (err) {
        logger.warn('Drive trickle batch failed (will retry next interval):', err);
      }
    };

    // Arm only when opted-in + linked; the interval re-checks each fire so a
    // settings flip or unlink stops the spend without a reboot.
    const env = readEnv();
    if (!env.enabled || !env.linked) return;

    const startTimer = setTimeout(() => void runBatch(), TRICKLE_START_DELAY_MS);
    const interval = setInterval(() => void runBatch(), TRICKLE_INTERVAL_MS);
    ctx.addCleanup(() => {
      stopped = true;
      clearTimeout(startTimer);
      clearInterval(interval);
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
