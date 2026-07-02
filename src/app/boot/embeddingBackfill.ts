/**
 * `embeddingBackfillTask` — pre-embeds the library for semantic search in the
 * background, so books are searchable WITHOUT first being opened in the reader.
 * During idle time it trickles the full text of ALL books present on this
 * device through the EmbeddingIndexer on the low-priority background quota
 * lane. (The foreground indexer handles the currently open book; the
 * per-section resume-skip makes re-visiting an already-embedded book free, so
 * the two lanes never duplicate spend.)
 *
 * Privacy posture (the load-bearing gates — see GUARDRAILS):
 *  - it runs ONLY when the user turned the library-wide opt-in ON
 *    (useGenAIStore.preEmbedLibrary) AND the embedding client isConfigured();
 *  - every embed is `{ interactive: false, lane: 'bg' }` — NEVER interactive
 *    (an idle path must not take the interactive bypass); the library-wide
 *    opt-in is what grants the consent for this background egress;
 *  - it runs ONLY on a device whose heartbeat is recent (reusing
 *    ACTIVE_DEVICE_WINDOW_MS) so an idle/locked device never spends quota;
 *  - it runs on requestIdleCallback (setTimeout fallback) so it never competes
 *    with the boot path or interactive work;
 *  - before each embed it checks an app-layer cross-device daily-request budget
 *    and stops the trickle when this device's share of the shared daily quota is
 *    used up. (The kernel quota governor still enforces foreground-preempt and
 *    the background fraction on the lane itself; this is the extra
 *    cross-device admission check on top of that.)
 *
 * The core {@link runEmbeddingBackfill} is PURE/injectable: every store/IDB/
 * governor edge arrives as a dep, so the suite drives it with fakes. The boot
 * task wires the real seams. (design: plan/shared-ai-cache-design.md)
 */
import type { BootTask } from '../bootstrap';
import { ACTIVE_DEVICE_WINDOW_MS } from '@app/quota/embedSpendReconciler';
import { NetRateLimitedError } from '~types/errors';
import { EmbeddingIndexer } from '@domains/search';
import { getEmbeddingClient } from '@domains/google';
import { getArtifactConsult } from '@app/google/artifactConsult';
import { SearchEngine } from '@lib/search-engine';
import { searchTextRepo } from '@data/repos/searchText';
import { embeddingsRepo } from '@data/repos/embeddings';
import { useGenAIStore } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { useBookStore } from '@store/useBookStore';
import { bookContent } from '@data/repos/bookContent';
import { getDeviceId } from '@lib/device-id';
import type { DeviceInfo } from '~types/device';
import type { QuotaLimits } from '@kernel/quota';
import { createLogger } from '@lib/logger';

const logger = createLogger('EmbeddingBackfill');

/**
 * How long to wait before re-running a pass that stopped on an error
 * (backpressure or a per-book failure): 90 seconds — long enough for a
 * minute-window rate limit to clear, short enough that indexing resumes
 * without waiting for the next boot.
 */
export const ERROR_RETRY_DELAY_MS = 90_000;

/**
 * The outcome of one backfill pass: `'complete'` when there is nothing left
 * for this pass to do (all books processed, gates closed, or cancelled), and
 * `'retry'` when the pass hit an error (rate-limit backpressure or a per-book
 * failure) — the boot task re-runs it after {@link ERROR_RETRY_DELAY_MS}.
 */
export type BackfillOutcome = 'complete' | 'retry';

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
  /** True when the local binary is present (getOffloadedStatus === false). */
  hasLocalBinary(bookId: string): Promise<boolean>;
  /**
   * This device's effective background-lane quota limits — the base daily
   * request limit reduced by what other active devices have already spent today.
   */
  getBgLimits(): QuotaLimits;
  /** Requests already counted against today's background lane. */
  getBgUsedRpd(): number;
  /** Embed one book's corpus on the background lane (EmbeddingIndexer.enqueue port). */
  enqueue(bookId: string, opts: { interactive: false; lane: 'bg' }): Promise<void>;
  /**
   * Cheap existence check: does a reusable embedding blob for this book already
   * exist in the shared cloud cache? Checked BEFORE the cross-device quota gate
   * so that even a device that has exhausted its quota can still reuse a peer's
   * embeddings for free. Returns `false` (fall through to embed) when sync is
   * off / not connected / there is no contentHash / the cache adapter is unwired.
   */
  probeArtifact(bookId: string): Promise<boolean>;
  /**
   * Download the shared blob and write the local embedding row from it (no
   * quota spent). Returns `true` on a successful reuse; `false` falls through to
   * embed.
   */
  hydrateFromArtifact(bookId: string): Promise<boolean>;
  /** Cooperative cancel + live re-check (opt-in flipped off / shutdown). */
  shouldContinue(): boolean;
}

/** This device sent a heartbeat within the recent-activity window. */
function isSelfActive(deps: EmbeddingBackfillDeps): boolean {
  const self = deps.getDevices()[deps.selfId];
  if (!self) return false;
  return deps.now() - self.lastActive < ACTIVE_DEVICE_WINDOW_MS;
}

/**
 * Run one backfill pass (PURE — no store/IDB/governor edge; everything is a
 * dep). Bails unless opt-in ON + client configured + THIS device active; then
 * trickles EVERY book present on this device through the background-lane
 * indexer until this device's share of the daily request budget is exhausted
 * or shouldContinue() goes false. Returns `'retry'` when the pass stopped on
 * an error (NetRateLimitedError backpressure, or any book failing to embed)
 * so the caller re-runs it after {@link ERROR_RETRY_DELAY_MS}; `'complete'`
 * otherwise.
 */
export async function runEmbeddingBackfill(
  deps: EmbeddingBackfillDeps,
): Promise<BackfillOutcome> {
  if (!deps.isOptInEnabled()) return 'complete';
  if (!deps.isClientConfigured()) return 'complete';
  if (!isSelfActive(deps)) return 'complete';

  let hadError = false;

  for (const bookId of deps.listBooks()) {
    if (!deps.shouldContinue()) return 'complete';

    // Every book whose binary is present locally is a candidate — the
    // background lane covers the WHOLE on-device library (the foreground
    // indexer covers the currently open book, and the per-section resume-skip
    // makes an already-embedded book a cheap no-op here). The local-binary
    // check is an async IDB read, done lazily per candidate to avoid a burst
    // at boot, and BEFORE the quota gate so the shared-cache check below only
    // runs for books this lane would actually embed.
    if (!(await deps.hasLocalBinary(bookId))) continue;

    // Reuse a peer's embeddings before spending any quota — and do this BEFORE
    // the cross-device quota gate below. A book whose embeddings already exist in
    // the shared cloud cache is downloaded for free and skipped, so even a device
    // that has used up its quota share still reuses peer-embedded books at zero
    // cost (the whole point of the shared cache). Only a miss / partial / failed
    // download falls through to the quota gate and an actual embed.
    if (await deps.probeArtifact(bookId)) {
      if (await deps.hydrateFromArtifact(bookId)) continue;
    }

    // Cross-device daily-request budget: stop once this device's share of the
    // shared daily quota is used up (remaining = this device's effective daily
    // limit minus what its background lane has already spent today). Only books
    // that missed the shared cache above reach this check.
    const remaining = deps.getBgLimits().rpd - deps.getBgUsedRpd();
    if (remaining <= 0) {
      logger.info('Background embedding paused: cross-device bg RPD ceiling reached.');
      // Not an error: the daily budget resets at midnight PT; resume next boot.
      return 'complete';
    }

    try {
      // A background embed is ALWAYS interactive:false — never the user-gesture path.
      await deps.enqueue(bookId, { interactive: false, lane: 'bg' });
    } catch (err) {
      if (err instanceof NetRateLimitedError) {
        // Backpressured: stop the trickle; the caller retries after the delay.
        logger.info('Background embedding backpressured; retrying shortly.');
        return 'retry';
      }
      // Per-book failure (e.g. a transient extract error) — log, move on, and
      // signal a retry pass so the failed book gets another attempt after the
      // delay (the resume-skip keeps the retry from re-embedding the rest).
      logger.warn(`Background embedding failed for ${bookId}; will retry:`, err);
      hadError = true;
    }
  }
  return hadError ? 'retry' : 'complete';
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
 * The backfill boot task: registered in the `backgroundTasks` phase after the
 * reingest-wave task. It constructs its OWN long-lived EmbeddingIndexer (the
 * foreground indexer is created per reader session) and schedules the background
 * trickle on idle. The indexer's per-section resume-skip (keyed by href +
 * section text hash) keeps the background pass from re-embedding books the
 * foreground indexer already covered. A pass that stops on an error is re-run
 * after {@link ERROR_RETRY_DELAY_MS}.
 */
export const embeddingBackfillTask: BootTask = {
  name: 'search/embedding-backfill',
  run: (ctx) => {
    // A long-lived indexer for the background lane (mirrors the reader's
    // foreground wiring): the lazy embedding facade, the search-text/embeddings
    // repos, and the int8 quantize port. bookId/lane flow as arguments — the
    // domain layer holds no store edges.
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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const runPass = () => {
      if (cancelled) return;
      runEmbeddingBackfill({
        isOptInEnabled: () => useGenAIStore.getState().preEmbedLibrary,
        isClientConfigured: () => getEmbeddingClient().isConfigured(),
        getDevices: () => useDeviceStore.getState().devices,
        selfId: getDeviceId(),
        now: () => Date.now(),
        listBooks: () => Object.keys(useBookStore.getState().books),
        hasLocalBinary: async (bookId) => {
          const status = await bookContent.getOffloadedStatus([bookId]);
          return status.get(bookId) === false;
        },
        // This device's effective background daily limit + its live spend so far,
        // read through the in-memory seam wireGoogle installed (so this task
        // never imports the quota governor). When the seam is absent (boot ran
        // before wireGoogle) the limit reads as zero, which stops the trickle;
        // the next idle pass picks it up once the seam is present.
        getBgLimits: () =>
          useGenAIStore.getState().getBgQuotaLimits?.() ?? { rpm: 0, tpm: 0, rpd: 0 },
        getBgUsedRpd: () => useGenAIStore.getState().getBgUsedRpd?.() ?? 0,
        enqueue: (bookId, opts) => indexer.enqueue(bookId, undefined, opts),
        // Shared-cache check, run inside the loop before the quota gate.
        // interactive:false (a background path is never a user gesture) and the
        // adapter's own consent gate covers library-pre-embed-OR-per-book. When
        // the cache adapter is unwired (sync/Google not composed) the probe
        // returns false, so the lane simply embeds — the check never blocks it.
        probeArtifact: (bookId) =>
          getArtifactConsult()?.probeArtifact(bookId, { interactive: false }) ??
          Promise.resolve(false),
        hydrateFromArtifact: async (bookId) => {
          const row = await getArtifactConsult()?.hydrateFromArtifact(bookId, {
            interactive: false,
          });
          return row != null;
        },
        shouldContinue: () => !cancelled && useGenAIStore.getState().preEmbedLibrary,
      })
        .then((outcome) => {
          // An errored pass re-runs after the delay; the resume-skip makes the
          // retry cheap (only the failed/remaining books actually embed).
          if (outcome === 'retry' && !cancelled) {
            retryTimer = setTimeout(runPass, ERROR_RETRY_DELAY_MS);
          }
        })
        .catch((err) => {
          logger.warn('Embedding backfill failed; retrying after delay:', err);
          if (!cancelled) {
            retryTimer = setTimeout(runPass, ERROR_RETRY_DELAY_MS);
          }
        });
    };
    const cancelIdle = scheduleIdle(runPass);

    ctx.addCleanup(() => {
      cancelled = true;
      cancelIdle();
      if (retryTimer !== null) clearTimeout(retryTimer);
    });
  },
};
