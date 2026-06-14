/**
 * `embeddingBackfillTask` — the Increment E2 BACKGROUND embedding lane (design
 * §4.3, §3.4). It trickles the FULL TEXT of loaded-but-unread books through the
 * EmbeddingIndexer on the bg quota lane during idle time, so the library can be
 * pre-embedded for semantic search WITHOUT a foreground reader session.
 *
 * Privacy posture (the load-bearing gates — see GUARDRAILS):
 *  - it runs ONLY when the user turned the library-wide opt-in ON
 *    (useGenAIStore.preEmbedLibrary) AND the embedding client isConfigured();
 *  - every embed is `{ interactive: false, lane: 'bg' }` — NEVER interactive
 *    (the interactive:true bypass is forbidden from an idle path); the §8.4.1
 *    consent grant in aiConsent.ts is what lets the bg egress through;
 *  - it runs ONLY on the heartbeat-active device (net-new §3.4 gate, reusing
 *    ACTIVE_DEVICE_WINDOW_MS) so an idle/locked device never spends quota;
 *  - it runs on requestIdleCallback (setTimeout fallback) so it never competes
 *    with the boot path or interactive work;
 *  - an app-layer CROSS-DEVICE RPD pre-flight (makeBackgroundQuotaLimits vs the
 *    governor's bg.rpd snapshot) stops the trickle when the A6 cross-device
 *    ceiling is reached — the kernel governor enforces fg-preempt + bg-fraction
 *    on the bg lane, but the cross-device ceiling is an admission gate here.
 *
 * The core {@link runEmbeddingBackfill} is PURE/injectable (mirrors
 * runReingestWave): every store/IDB/governor edge arrives as a dep, so the
 * suite drives it with fakes. The boot task wires the real seams.
 */
import type { BootTask } from '../bootstrap';
import { ACTIVE_DEVICE_WINDOW_MS } from '@app/quota/embedSpendReconciler';
import { NetRateLimitedError } from '~types/errors';
import { EmbeddingIndexer } from '@domains/search';
import { getEmbeddingClient } from '@domains/google';
import { SearchEngine } from '@lib/search-engine';
import { searchTextRepo } from '@data/repos/searchText';
import { embeddingsRepo } from '@data/repos/embeddings';
import { useGenAIStore } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { useBookStore } from '@store/useBookStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { bookContent } from '@data/repos/bookContent';
import { getDeviceId } from '@lib/device-id';
import type { DeviceInfo } from '~types/device';
import type { QuotaLimits } from '@kernel/quota';
import { createLogger } from '@lib/logger';

const logger = createLogger('EmbeddingBackfill');

/**
 * "Unread enough to backfill": a book whose synced progress is below this
 * fraction is treated as loaded-but-unread. The §4.3 trickle targets the books
 * the reader has NOT opened (the FG indexer already covers the open book).
 */
const UNREAD_PROGRESS_CEILING = 0.05;

/** The injected seams (the boot task binds the real stores/repos/governor). */
export interface EmbeddingBackfillDeps {
  /** The library-wide opt-in (useGenAIStore.preEmbedLibrary). */
  isOptInEnabled(): boolean;
  /** The embedding client currently holds a usable config (API key). */
  isClientConfigured(): boolean;
  /** The device mesh + this device id, for the heartbeat-active gate. */
  getDevices(): Record<string, DeviceInfo>;
  selfId: string;
  /** Wall clock (injected for the active-device window math; testability). */
  now(): number;
  /** Candidate book ids (useBookStore.books keys). */
  listBooks(): string[];
  /** Synced reading progress fraction (0..1) for a book, or null. */
  getProgress(bookId: string): number | null;
  /** True when the local binary is present (getOffloadedStatus === false). */
  hasLocalBinary(bookId: string): Promise<boolean>;
  /** The BG-lane effective limits (makeBackgroundQuotaLimits — A6 ceiling). */
  getBgLimits(): QuotaLimits;
  /** Requests counted against today's bg lane (governor.snapshot().bg.rpd). */
  getBgUsedRpd(): number;
  /** Embed one book's corpus on the bg lane (EmbeddingIndexer.enqueue port). */
  enqueue(bookId: string, opts: { interactive: false; lane: 'bg' }): Promise<void>;
  /** Cooperative cancel + live re-check (opt-in flipped off / shutdown). */
  shouldContinue(): boolean;
}

/** This device is heartbeat-active within the §3.4 recency window. */
function isSelfActive(deps: EmbeddingBackfillDeps): boolean {
  const self = deps.getDevices()[deps.selfId];
  if (!self) return false;
  return deps.now() - self.lastActive < ACTIVE_DEVICE_WINDOW_MS;
}

/**
 * Run one backfill pass (PURE — no store/IDB/governor edge; everything is a
 * dep). Bails unless opt-in ON + client configured + THIS device active; then
 * trickles loaded-but-unread books through the bg-lane indexer until the
 * cross-device bg RPD headroom is exhausted, a book hits NetRateLimitedError
 * (stop and resume next idle/boot), or shouldContinue() goes false.
 */
export async function runEmbeddingBackfill(deps: EmbeddingBackfillDeps): Promise<void> {
  if (!deps.isOptInEnabled()) return;
  if (!deps.isClientConfigured()) return;
  if (!isSelfActive(deps)) return;

  for (const bookId of deps.listBooks()) {
    if (!deps.shouldContinue()) return;

    // Cross-device RPD pre-flight (A6): the governor uses ONE full-projectRPD
    // provider for both lanes, so the cross-device ceiling is enforced HERE as
    // an admission gate (remaining = bgLimits.rpd - bg.rpd already spent).
    const remaining = deps.getBgLimits().rpd - deps.getBgUsedRpd();
    if (remaining <= 0) {
      logger.info('Background embedding paused: cross-device bg RPD ceiling reached.');
      return;
    }

    // Loaded-but-unread: a local binary is present AND progress is below the
    // ceiling (the FG indexer targets the open/read books). getOffloadedStatus
    // is an async IDB read — done lazily per candidate to avoid a boot burst.
    const progress = deps.getProgress(bookId) ?? 0;
    if (progress >= UNREAD_PROGRESS_CEILING) continue;
    if (!(await deps.hasLocalBinary(bookId))) continue;

    try {
      // ALWAYS interactive:false (the §8.4.1 invariant) on the bg lane.
      await deps.enqueue(bookId, { interactive: false, lane: 'bg' });
    } catch (err) {
      if (err instanceof NetRateLimitedError) {
        // Backpressured: stop the trickle and resume on the next idle/boot.
        logger.info('Background embedding backpressured; will resume next idle.');
        return;
      }
      // Per-book failure (e.g. a transient extract error) — log and move on.
      logger.warn(`Background embedding failed for ${bookId}; skipping:`, err);
    }
  }
}

/**
 * Schedule `cb` on the next idle slot (requestIdleCallback), falling back to a
 * macrotask when the API is unavailable (Safari history, jsdom). Returns a
 * cancel fn the boot cleanup calls. Exported as a default seam; tests inject
 * their own deterministic scheduler.
 */
function scheduleIdle(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => cb());
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(cb, 0);
  return () => clearTimeout(timer);
}

/**
 * The Increment E2 boot task: registered in the `backgroundTasks` phase after
 * reingestWaveTask. It constructs its OWN long-lived EmbeddingIndexer in app/
 * (the FG indexer is per reader session) and schedules the bg trickle on idle.
 * The {href, sectionTextHash} resume-skip in the indexer + the loaded-but-unread
 * filter keep the bg pass from double-embedding the open book.
 */
export const embeddingBackfillTask: BootTask = {
  name: 'search/embedding-backfill',
  run: (ctx) => {
    // A long-lived indexer for the bg lane (mirrors useReaderController's FG
    // wiring): the lazy embedding facade + the searchText/embeddings repos + the
    // B3 quantize port. bookId/lane flow as arguments — no store edge in domains.
    const quantizer = new SearchEngine();
    const indexer = new EmbeddingIndexer({
      embeddingClient: getEmbeddingClient(),
      textSource: searchTextRepo,
      embeddingsRepo,
      quantize: (vec) => quantizer.quantizeInt8PerVector(vec),
      getConfig: () => {
        const s = useGenAIStore.getState();
        return { model: s.embeddingModel, dims: s.embeddingDims };
      },
    });

    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      if (cancelled) return;
      void runEmbeddingBackfill({
        isOptInEnabled: () => useGenAIStore.getState().preEmbedLibrary,
        isClientConfigured: () => getEmbeddingClient().isConfigured(),
        getDevices: () => useDeviceStore.getState().devices,
        selfId: getDeviceId(),
        now: () => Date.now(),
        listBooks: () => Object.keys(useBookStore.getState().books),
        getProgress: (bookId) =>
          useReadingStateStore.getState().getProgress(bookId)?.percentage ?? null,
        hasLocalBinary: async (bookId) => {
          const status = await bookContent.getOffloadedStatus([bookId]);
          return status.get(bookId) === false;
        },
        // The A6 cross-device bg ceiling + the governor's live bg.rpd, read
        // through the in-memory seam wireGoogle installed (no governor import).
        // A zero ceiling when unwired (boot ran before wireGoogle) stops the
        // trickle — the next idle pass picks it up once the seam is present.
        getBgLimits: () =>
          useGenAIStore.getState().getBgQuotaLimits?.() ?? { rpm: 0, tpm: 0, rpd: 0 },
        getBgUsedRpd: () => useGenAIStore.getState().getBgUsedRpd?.() ?? 0,
        enqueue: (bookId, opts) => indexer.enqueue(bookId, undefined, opts),
        shouldContinue: () => !cancelled && useGenAIStore.getState().preEmbedLibrary,
      }).catch((err) => {
        logger.warn('Embedding backfill failed (will retry next boot):', err);
      });
    });

    ctx.addCleanup(() => {
      cancelled = true;
      cancelIdle();
    });
  },
};
