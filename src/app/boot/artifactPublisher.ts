/**
 * `artifactPublisherTask` — the Artifact Lane Phase C WRITE side (the upload
 * boot task, shared-ai-cache-design.md §2.1/§2.3/§3). It mirrors a locally-
 * embedded book's whole-corpus int8 vectors into the user's OWN cloud
 * (Cloud Storage `embeddings/{key}.bin` + the companion Firestore HEAD doc)
 * so the user's OTHER devices hydrate them quota-free via the Phase-B consult,
 * instead of re-spending Gemini embedding quota per device.
 *
 * Privacy posture (the load-bearing gates — see GUARDRAILS):
 *  - it runs ONLY when the user turned the default-OFF "Share AI caches across
 *    my devices" opt-in ON (useGenAIStore.shareAiCaches) — surfaced as the
 *    {@link ArtifactPublisherDeps.isUploadConsented} gate built from the SAME
 *    makeArtifactConsentGate the consult uses (consult+upload share semantics);
 *  - it runs ONLY on the heartbeat-active device (§3.4 gate, reusing
 *    isSelfActive + ACTIVE_DEVICE_WINDOW_MS) so an idle/locked device never
 *    uploads;
 *  - it runs on requestIdleCallback (setTimeout fallback) so it never competes
 *    with the boot path or interactive work — best-effort, off the FG latency
 *    path;
 *  - it is a SILENT no-op when getBackend() is null (sync off / not connected /
 *    no active workspace) — the cheap no-network short-circuit;
 *  - putArtifact is ifAbsent (head-before-put no-op): idempotent and content-
 *    addressed, so racing devices write byte-identical content harmlessly.
 *
 * The contentKey is derived from the ROW's stamp ({model, dims, quant,
 * extractionVersion}), NOT live config, so the published object is content-
 * addressed by what was ACTUALLY embedded — the indexer's §8.2 stamp-mismatch
 * guard re-embeds a stale row before the publisher ever sees it, keeping the
 * writer/reader keys aligned (a peer re-derives the key from the blob header).
 *
 * The core {@link runArtifactPublish} is PURE/injectable (mirrors
 * runEmbeddingBackfill): every store/IDB/backend edge arrives as a dep, so the
 * suite drives it with fakes. The boot task wires the real seams.
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
   * The Phase-C upload gate (the makeArtifactConsentGate result, interactive:
   * false posture): shareAiCaches ON AND (preEmbed OR per-book consent). Built
   * from the SAME helper the consult uses, so consult+upload share semantics.
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
  /** Resolve bookId → contentHash via the manifest (absent on pre-P7 books). */
  getContentHash(bookId: string): Promise<string | undefined>;
  /**
   * The artifact-lane backend handle, or `null` when sync is off / not
   * connected / no active workspace. Read FRESH per call so a connect/disconnect
   * takes effect immediately; a `null` handle is the silent no-network no-op.
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Cooperative cancel + live re-check (opt-in flipped off / shutdown). */
  shouldContinue(): boolean;
}

/** This device is heartbeat-active within the §3.4 recency window. */
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

    // The Phase-C upload gate (shareAiCaches ON + preEmbed/per-book). interactive
    // is false: a background boot path is NEVER an interactive gesture, so the
    // shareAiCaches AND-term is the only thing that can grant the bg upload.
    if (!deps.isUploadConsented(bookId)) continue;

    try {
      // Only locally-embedded books have a row to publish; absent → skip.
      const row = await deps.getRow(bookId);
      if (!row) continue;

      // contentHash is OPTIONAL on pre-P7 manifests — its absence is a CLEAN
      // degrade (no content identity → no content-addressed key → skip).
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
 * The Phase-C boot task: registered in the `backgroundTasks` phase after
 * embeddingBackfillTask, so it runs as a sibling bg/idle task in the same phase.
 * Builds the upload gate from the SAME makeArtifactConsentGate the consult uses
 * (shareAiCaches + preEmbed + per-book), and uploads each locally-embedded
 * book's blob (ifAbsent) into the connected BYO backend on idle.
 */
export const artifactPublisherTask: BootTask = {
  name: 'search/artifact-publisher',
  run: (ctx) => {
    // The SAME gate the consult wires (design §3): shareAiCaches ANDed with the
    // §2.6 preEmbed/per-book predicate. interactive is always false here (a bg
    // boot path), so shareAiCaches OFF → every book denied → zero uploads.
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
