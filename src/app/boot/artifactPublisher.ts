/**
 * `artifactPublisherTask` — uploads a locally-embedded book's vectors to the
 * user's OWN cloud so their OTHER devices can reuse them instead of paying to
 * re-embed. Embeddings are expensive to regenerate (per-device Gemini quota),
 * so once a book is embedded on one device its whole-corpus int8 vectors are
 * mirrored to a content-addressed blob (`embeddings/{key}.bin`) plus a small
 * companion HEAD record, and a sibling device downloads them for free.
 *
 * Privacy posture (the load-bearing gates — see GUARDRAILS):
 *  - it runs ONLY when the user turned the default-OFF "Share AI caches across
 *    my devices" opt-in ON (useGenAIStore.shareAiCaches) — surfaced as the
 *    {@link ArtifactPublisherDeps.isUploadConsented} gate, built from the same
 *    consent helper the download path uses so upload and download stay in sync;
 *  - it runs ONLY on a device whose heartbeat is recent (isSelfActive +
 *    ACTIVE_DEVICE_WINDOW_MS) so an idle/locked device never uploads;
 *  - it runs on requestIdleCallback (setTimeout fallback) so it never competes
 *    with the boot path or interactive work — best-effort, off the latency path;
 *  - it is a SILENT no-op when getBackend() is null (sync off / not connected /
 *    no active workspace) — the cheap no-network short-circuit;
 *  - putArtifact only writes if the key is absent (a head-before-put no-op), so
 *    it is idempotent and racing devices write byte-identical content harmlessly.
 *
 * The blob key is derived from the embedding ROW's stamp ({model, dims, quant,
 * extractionVersion}), NOT live config, so the object is addressed by what was
 * ACTUALLY embedded — the indexer re-embeds a stale row before the publisher
 * ever sees it, keeping the writer's and reader's keys aligned (a peer
 * re-derives the same key from the blob's own header).
 *
 * The core {@link runArtifactPublish} is PURE/injectable: every store/IDB/
 * backend edge arrives as a dep, so the suite drives it with fakes. The boot
 * task wires the real seams. (design: plan/shared-ai-cache-design.md)
 */
import type { BootTask } from '../bootstrap';
import { ACTIVE_DEVICE_WINDOW_MS } from '@app/quota/embedSpendReconciler';
import {
  contentKey,
  serializeArtifactBlob,
  type SerializableEmbeddingRow,
} from '@domains/search';
import { makeArtifactConsentGate } from '@app/google/artifactConsult';
import { peekSyncOrchestrator } from '@app/sync/createSync';
import { embeddingsRepo } from '@data/repos/embeddings';
import { bookContent } from '@data/repos/bookContent';
import { useGenAIStore } from '@store/useGenAIStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { useBookStore } from '@store/useBookStore';
import { getDeviceId } from '@lib/device-id';
import type { SyncBackend } from '@domains/sync';
import type { DeviceInfo } from '~types/device';
import { createLogger } from '@lib/logger';

const logger = createLogger('ArtifactPublisher');

/** The injected seams (the boot task binds the real stores/repos/backend). */
export interface ArtifactPublisherDeps {
  /**
   * Upload consent for a book: shareAiCaches ON AND (library pre-embed OR
   * per-book consent). Built from the same consent helper the download path
   * uses, so a book that may be downloaded by a peer is exactly one that may be
   * uploaded. (No interactive bypass here — a background upload is never a
   * user gesture.)
   */
  isUploadConsented(bookId: string): boolean;
  /** The embedding client currently holds a usable config (API key). */
  isClientConfigured(): boolean;
  /** The device mesh + this device id, for the heartbeat-active gate. */
  getDevices(): Record<string, DeviceInfo>;
  selfId: string;
  /** Wall clock (injected for the active-device window math; testability). */
  now(): number;
  /** Candidate book ids (useBookStore.books keys). */
  listBooks(): string[];
  /**
   * The embedding row for a book, or undefined when never embedded. Typed as the
   * structural {@link SerializableEmbeddingRow} (the serializer's input shape) so
   * the real seam `embeddingsRepo.get` — which hands back the repo READ VIEW
   * (section binaries re-wrapped as Int8Array/Float32Array, not raw ArrayBuffers)
   * — passes straight through; {@link serializeArtifactBlob} byte-reads either.
   */
  getRow(bookId: string): Promise<SerializableEmbeddingRow | undefined>;
  /** Resolve bookId → contentHash via the manifest (absent on older books). */
  getContentHash(bookId: string): Promise<string | undefined>;
  /**
   * The cloud-storage backend handle, or `null` when sync is off / not
   * connected / no active workspace. Read FRESH per call so a connect/disconnect
   * takes effect immediately; a `null` handle is the silent no-network no-op.
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Cooperative cancel + live re-check (opt-in flipped off / shutdown). */
  shouldContinue(): boolean;
}

/** This device sent a heartbeat within the recent-activity window. */
function isSelfActive(deps: ArtifactPublisherDeps): boolean {
  const self = deps.getDevices()[deps.selfId];
  if (!self) return false;
  return deps.now() - self.lastActive < ACTIVE_DEVICE_WINDOW_MS;
}

/**
 * Run one publish pass (PURE — no store/IDB/backend edge; everything is a dep).
 * Bails unless client configured + THIS device active; then, for each locally-
 * embedded + upload-consented book, derives the contentKey from the ROW's stamp,
 * serializes the blob, and putArtifact (ifAbsent) into the connected backend.
 * A `null` backend is a silent no-op (returns; the next idle pass retries once
 * sync connects). Per-book failures are best-effort: log and continue.
 */
export async function runArtifactPublish(deps: ArtifactPublisherDeps): Promise<void> {
  if (!deps.isClientConfigured()) return;
  if (!isSelfActive(deps)) return;

  for (const bookId of deps.listBooks()) {
    if (!deps.shouldContinue()) return;

    // Upload only books the user has consented to share (shareAiCaches ON plus
    // library pre-embed or per-book consent). A background pass is never a user
    // gesture, so the shareAiCaches switch is the only thing that can grant it.
    if (!deps.isUploadConsented(bookId)) continue;

    try {
      // Only locally-embedded books have a row to publish; absent → skip.
      const row = await deps.getRow(bookId);
      if (!row) continue;

      // Older manifests may lack a contentHash — without a content identity
      // there is no content-addressed key to publish under, so skip cleanly.
      const contentHash = await deps.getContentHash(bookId);
      if (!contentHash) continue;

      // Read the backend FRESH per book: a disconnect mid-pass turns this into
      // a silent no-op for the rest of the run (the next idle pass retries).
      const handle = deps.getBackend();
      if (!handle) return;

      // Derive the key from the ROW's stamp (NOT live config) so the published
      // object is content-addressed by what was actually embedded — the peer
      // re-derives the same key from the blob header.
      const key = await contentKey({
        contentHash,
        model: row.model,
        dims: row.dims,
        quant: row.quant,
        extractionVersion: row.extractionVersion,
      });
      const bytes = serializeArtifactBlob(row);
      // ifAbsent (head-before-put): a key already present is a backend no-op, so
      // racing devices writing byte-identical content is harmless.
      await handle.backend.putArtifact(handle.workspaceId, `embeddings/${key}.bin`, bytes, {
        stamp: `${row.model}|${row.dims}`,
        size: bytes.byteLength,
      });
    } catch (err) {
      // Per-book failure (transient backend error, serialize error) — log and
      // move on; the next idle/boot pass retries (ifAbsent keeps it idempotent).
      logger.warn(`Artifact publish failed for ${bookId}; skipping:`, err);
    }
  }
}

/**
 * Schedule `cb` on the next idle slot (requestIdleCallback), falling back to a
 * macrotask when the API is unavailable (Safari history, jsdom). Returns a
 * cancel fn the boot cleanup calls. (Mirrors embeddingBackfill.scheduleIdle.)
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
 * The publisher boot task: registered in the `backgroundTasks` phase after the
 * embedding-backfill task, so it runs as a sibling idle task. Builds the upload
 * consent gate from the same helper the download path uses (shareAiCaches +
 * library pre-embed + per-book consent) and, on idle, uploads each locally-
 * embedded book's blob (write-if-absent) into the connected cloud backend.
 */
export const artifactPublisherTask: BootTask = {
  name: 'search/artifact-publisher',
  run: (ctx) => {
    // The same consent gate the download path uses: the shareAiCaches master
    // switch ANDed with the per-book/library-pre-embed predicate. interactive is
    // always false here (a background path), so shareAiCaches OFF means every
    // book is denied and nothing is uploaded.
    const uploadGate = makeArtifactConsentGate({
      isShareEnabled: () => useGenAIStore.getState().shareAiCaches,
      isPreEmbedEnabled: () => useGenAIStore.getState().preEmbedLibrary,
      getPerBookConsent: (bookId) => usePreferencesStore.getState().aiConsent[bookId],
    });

    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      if (cancelled) return;
      void runArtifactPublish({
        isUploadConsented: (bookId) => uploadGate(bookId, { interactive: false }),
        // The embedding client config gates upload the same way it gates embed
        // (no key → nothing was embedded locally to publish anyway).
        isClientConfigured: () =>
          useGenAIStore.getState().apiKey.trim().length > 0,
        getDevices: () => useDeviceStore.getState().devices,
        selfId: getDeviceId(),
        now: () => Date.now(),
        listBooks: () => Object.keys(useBookStore.getState().books),
        getRow: (bookId) => embeddingsRepo.get(bookId),
        getContentHash: async (bookId) => {
          const manifest = await bookContent.getManifest(bookId);
          return manifest?.contentHash;
        },
        // The connected backend handle, or null (sync off / not connected / no
        // active workspace). peekSyncOrchestrator never CREATES the orchestrator
        // (no-sync = null = silent no-op). Read fresh per call.
        getBackend: () => peekSyncOrchestrator()?.getConnectedArtifactBackend() ?? null,
        shouldContinue: () => !cancelled && useGenAIStore.getState().shareAiCaches,
      }).catch((err) => {
        logger.warn('Artifact publish failed (will retry next boot):', err);
      });
    });

    ctx.addCleanup(() => {
      cancelled = true;
      cancelIdle();
    });
  },
};
