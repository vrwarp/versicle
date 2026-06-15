/**
 * `artifactSweeperTask` — the Artifact Lane Phase D cloud TTL/quota GC (the
 * REQUIRED cloud-side sweeper, shared-ai-cache-design.md §2.7). It bounds the
 * user's OWN cloud bucket so the shared AI-cache neither leaks nor grows
 * unbounded: each past-TTL `embedCache/{key}` HEAD doc (and, when over budget,
 * oldest-first) is deleted ALONG WITH its sibling `embeddings/{key}.bin` blob.
 *
 * This is a SEPARATE boot task, deliberately NOT coupled to runEviction
 * (which is the device-local IDB eviction sweep): the cloud sweeper is the
 * companion to per-book delete's leave-the-blob policy — deleteArtifactHead
 * drops the HEAD doc and leaves the content-addressed blob for THIS sweeper to
 * reclaim once it ages past the TTL (a sibling device may re-upload an
 * identical blob in the meantime, harmlessly, since content is byte-identical).
 *
 * Posture:
 *  - SILENT no-op when getBackend() is null (sync off / not connected / no
 *    active workspace) — the cheap no-network short-circuit;
 *  - best-effort: a thrown sweepArtifacts is logged and swallowed (the next
 *    boot retries; the sweep is idempotent);
 *  - scheduled on requestIdleCallback (setTimeout fallback) so it never
 *    competes with the boot path or interactive work.
 *
 * The core {@link runArtifactSweep} is PURE/injectable (mirrors
 * runArtifactPublish): every backend/clock edge arrives as a dep, so the suite
 * drives it with fakes. The boot task wires the real seams.
 */
import type { BootTask } from '../bootstrap';
import { peekSyncOrchestrator } from '@app/sync/createSync';
import { EMBEDDING_CACHE_BUDGET_BYTES } from '@data/repos/embeddings';
import type { SyncBackend } from '@domains/sync';
import { createLogger } from '@lib/logger';

const logger = createLogger('ArtifactSweeper');

/**
 * The cloud-blob TTL (Phase D). A policy GUESS, deliberately conservative: too
 * short reclaims a blob a peer device still wants before it re-uploads
 * (transient cost — the peer re-embeds or re-uploads), too long lets the bucket
 * grow. The blob is content-addressed + re-derivable (re-embed), so an
 * over-aggressive sweep only costs a re-embed; tunable as real-world bucket
 * pressure data arrives. 30 days.
 */
export const ARTIFACT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The injected seams (the boot task binds the real backend/clock/budget). */
export interface ArtifactSweepDeps {
  /**
   * The artifact-lane backend handle, or `null` when sync is off / not
   * connected / no active workspace. Read FRESH per call so a connect/
   * disconnect takes effect immediately; a `null` handle is the silent no-op.
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Past-TTL cutoff: HEAD docs older than now - ttlMs are swept. */
  ttlMs: number;
  /** Wall clock (injected for testability). */
  now(): number;
  /** Soft cloud budget: when over, oldest-first by createdAt until under. */
  budgetBytes: number;
}

/**
 * Run one cloud-sweep pass (PURE — no store/backend edge; everything is a dep).
 * A `null` backend is a silent no-op (returns; the next idle/boot pass retries
 * once sync connects). A thrown sweepArtifacts is best-effort: logged + swallowed.
 */
export async function runArtifactSweep(deps: ArtifactSweepDeps): Promise<void> {
  const handle = deps.getBackend();
  if (!handle) return;

  try {
    const report = await handle.backend.sweepArtifacts(handle.workspaceId, {
      ttlMs: deps.ttlMs,
      now: deps.now(),
      budgetBytes: deps.budgetBytes,
    });
    if (report.headsDeleted > 0 || report.blobsDeleted > 0) {
      logger.info(
        `Cloud artifact sweep: ${report.headsDeleted} heads, ${report.blobsDeleted} blobs reclaimed.`,
      );
    }
  } catch (err) {
    logger.warn('Cloud artifact sweep failed (will retry next boot):', err);
  }
}

/**
 * Schedule `cb` on the next idle slot (requestIdleCallback), falling back to a
 * macrotask when the API is unavailable (Safari history, jsdom). Returns a
 * cancel fn the boot cleanup calls. (Mirrors artifactPublisher.scheduleIdle.)
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
 * The Phase-D cloud-GC boot task: registered in the `backgroundTasks` phase
 * after artifactPublisherTask. Holds uid/workspaceId/backend via
 * peekSyncOrchestrator().getConnectedArtifactBackend() (read fresh, null =>
 * silent no-op), fires the sweep on idle, and addCleanup-cancels.
 */
export const artifactSweeperTask: BootTask = {
  name: 'search/artifact-sweeper',
  run: (ctx) => {
    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      if (cancelled) return;
      void runArtifactSweep({
        // The connected backend handle, or null (sync off / not connected / no
        // active workspace). peekSyncOrchestrator never CREATES the orchestrator
        // (no-sync = null = silent no-op). Read fresh per call.
        getBackend: () => peekSyncOrchestrator()?.getConnectedArtifactBackend() ?? null,
        ttlMs: ARTIFACT_TTL_MS,
        now: () => Date.now(),
        budgetBytes: EMBEDDING_CACHE_BUDGET_BYTES,
      });
    });

    ctx.addCleanup(() => {
      cancelled = true;
      cancelIdle();
    });
  },
};
