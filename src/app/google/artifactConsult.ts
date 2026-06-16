/**
 * ArtifactConsult — the read side of the shared embedding cache: before a device
 * spends Gemini quota to embed a book, it checks whether another of the user's
 * devices already embedded the same book and uploaded the result, and if so
 * downloads and reuses it for free.
 *
 * This adapter holds the store/manifest/backend edges that the pure embedding
 * codec and the cloud backend cannot reach (the codec is store-free, the backend
 * is injected). It exposes two operations the background backfill loop and the
 * foreground reader indexer call before embedding:
 *
 *  - {@link ArtifactConsult.probeArtifact}: resolve bookId → contentHash via the
 *    manifest, derive the content-addressed {@link contentKey}, and check
 *    (HEAD request) whether a blob exists for it in the user's cloud backend.
 *  - {@link ArtifactConsult.hydrateFromArtifact}: download the blob, parse its
 *    header, reconcile each section's text hash against the LIVE local corpus
 *    (drop sections whose text has since changed — they re-embed next pass),
 *    re-derive the content key from the blob's OWN stamp and assert it matches
 *    the requested key (a corruption/swap guard), then write the local rows in
 *    one atomic transaction via {@link ArtifactConsultDeps.putHydrated}.
 *
 * Consent (hard requirement): BOTH operations are gated by the SAME consent the
 * embed they replace would require — the adapter calls
 * {@link ArtifactConsultDeps.isConsented} first and short-circuits (probe →
 * false, hydrate → null) when it is not granted. Downloading another device's
 * embeddings while sharing is off and there is no per-book consent is FORBIDDEN.
 *
 * The holder ({@link setArtifactConsult}/{@link getArtifactConsult}) mirrors the
 * embedding-client holder: wireGoogle installs the singleton, and the boot loop
 * and reader controller inject the port. (design: plan/shared-ai-cache-design.md)
 */
import {
  contentKey,
  parseArtifactBlob,
  type ArtifactStamp,
} from '@domains/search';
import type { SyncBackend } from '@domains/sync';
import type { StaticManifestRow } from '@data/rows/static';
import type {
  CacheEmbeddingsRow,
  CacheEmbedJobsRow,
  CacheSearchTextRow,
} from '@data/rows/cache';
import { createLogger } from '@lib/logger';

const logger = createLogger('ArtifactConsult');

/**
 * Counts a specific inconsistency: a hydrate that finds the HEAD record present
 * but its blob object ABSENT. The blob is always written before its HEAD record,
 * so a HEAD hit should imply the bytes exist; a non-zero count therefore means a
 * stale HEAD record was observed (e.g. a crash between deleting the blob and
 * deleting its HEAD elsewhere, or a sweeper/blob race). Each occurrence
 * self-heals by deleting the stale HEAD record, so the drift is transient.
 * Observable via {@link getArtifactDriftCount} (tests/metrics).
 */
let driftCount = 0;

/** Read the in-module count of stale-HEAD-record observations (observability). */
export function getArtifactDriftCount(): number {
  return driftCount;
}

/** Whether the read path is consented to reuse a shared blob for a book. */
type ConsentGate = (bookId: string, opts: { interactive: boolean }) => boolean;

/**
 * Build the consent gate shared by the cache read path AND the upload path. It
 * ANDs the "Share AI caches across my devices" master switch into the per-book
 * consent predicate, so both reusing a peer's blob and uploading your own
 * require that switch to be ON:
 *
 *   gate(bookId, {interactive}) =
 *     isShareEnabled() && (interactive || isPreEmbedEnabled() || perBook === true)
 *
 * With sharing OFF every book is DENIED regardless of the interactive gesture,
 * library pre-embed, or per-book consent — reusing another device's embeddings
 * while sharing is off is forbidden even when the user just opened the book.
 * PURE/store-free: app/ injects the three store reads. Reused by both the read
 * adapter (wireGoogle) and the upload boot task so they share one gating rule.
 */
export function makeArtifactConsentGate(deps: {
  isShareEnabled(): boolean;
  isPreEmbedEnabled(): boolean;
  getPerBookConsent(bookId: string): boolean | undefined;
}): ConsentGate {
  return (bookId, { interactive }) =>
    deps.isShareEnabled() &&
    (interactive || deps.isPreEmbedEnabled() || deps.getPerBookConsent(bookId) === true);
}

export interface ArtifactConsultDeps {
  /**
   * The cloud-storage backend handle, or `null` when sync is off / not
   * connected. Read fresh per call so a connect/disconnect takes effect
   * immediately; a `null` handle is the cheap no-network short-circuit (probe →
   * false, hydrate → null).
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Resolve bookId → manifest (carries the optional `contentHash`). */
  getManifest(bookId: string): Promise<StaticManifestRow | undefined>;
  /** The live embedding-space stamp ({model, dims}, quant literal, extraction version). */
  getStamp(): ArtifactStamp;
  /** The live persisted local corpus, used to reconcile per-section text hashes. */
  getLiveCorpus(bookId: string): Promise<CacheSearchTextRow | undefined>;
  /** Write the hydrated embedding row + its job row in one atomic transaction. */
  putHydrated(row: CacheEmbeddingsRow, jobRow: CacheEmbedJobsRow): Promise<void>;
  /** Consent gate: the same consent the embed this would replace requires. */
  isConsented: ConsentGate;
}

export interface ArtifactConsult {
  /**
   * Cheap existence probe: `true` only when consent is granted, the manifest
   * carries a `contentHash`, a backend is connected, AND the HEAD doc for the
   * derived contentKey exists. Never spends quota; never throws on a clean
   * miss/degrade (absent contentHash, no backend → `false`).
   */
  probeArtifact(bookId: string, opts: { interactive: boolean }): Promise<boolean>;
  /**
   * Download the shared blob and write the local embedding row from it, or
   * `null` on any clean non-reuse (consent denied, no backend, definitive miss,
   * stamp mismatch, no reconcilable sections). A transient/permission error from
   * {@link SyncBackend.getArtifact} is RETHROWN — never mistake a temporary
   * offline blip for a miss and waste quota re-embedding.
   */
  hydrateFromArtifact(
    bookId: string,
    opts: { interactive: boolean },
  ): Promise<CacheEmbeddingsRow | null>;
}

export function makeArtifactConsult(deps: ArtifactConsultDeps): ArtifactConsult {
  /** Resolve the consent + contentKey + backend triple, or null to short-circuit. */
  async function resolve(
    bookId: string,
    opts: { interactive: boolean },
  ): Promise<{ backend: SyncBackend; workspaceId: string; key: string } | null> {
    // Consent gate FIRST — a denied request never touches the manifest or the
    // network.
    if (!deps.isConsented(bookId, opts)) return null;

    // No connected backend → cheap no-network short-circuit (the common
    // no-sync case adds zero latency).
    const handle = deps.getBackend();
    if (!handle) return null;

    // Older manifests may have no contentHash; without it there is no
    // content-addressed key to look up, so fall through to a per-device embed
    // (no benefit, no error, no quota spent).
    const manifest = await deps.getManifest(bookId);
    const contentHash = manifest?.contentHash;
    if (!contentHash) return null;

    const key = await contentKey({ contentHash, ...deps.getStamp() });
    return { backend: handle.backend, workspaceId: handle.workspaceId, key };
  }

  return {
    async probeArtifact(bookId, opts): Promise<boolean> {
      const resolved = await resolve(bookId, opts);
      if (!resolved) return false;
      const { backend, workspaceId, key } = resolved;
      // The HEAD record lives at `embedCache/{key}`. A null result is a miss.
      const head = await backend.headArtifact(workspaceId, `embedCache/${key}`);
      return head !== null;
    },

    async hydrateFromArtifact(bookId, opts): Promise<CacheEmbeddingsRow | null> {
      const resolved = await resolve(bookId, opts);
      if (!resolved) return null;
      const { backend, workspaceId, key } = resolved;

      // Check the HEAD record FIRST (at `embedCache/{key}`) so we can tell a
      // clean miss (no HEAD record → just re-embed) from the inconsistent case
      // (HEAD present but blob absent — see driftCount). A null HEAD is a clean
      // miss.
      const head = await backend.headArtifact(workspaceId, `embedCache/${key}`);
      if (head === null) return null;

      // Fetch the blob at `embeddings/{key}.bin`. A definitive miss returns
      // `null` (re-embed); a transient/permission error THROWS from the backend
      // and we let it propagate — never waste quota re-embedding on an offline
      // blip.
      const bytes = await backend.getArtifact(workspaceId, `embeddings/${key}.bin`);
      if (!bytes) {
        // HEAD record present but blob absent — the inconsistency tracked by
        // driftCount. Count + log it (stable search key), opportunistically
        // delete the stale HEAD record so a future probe re-embeds instead of
        // falsely hitting, and return null.
        driftCount += 1;
        logger.warn(
          `[artifact-head-object-drift] HEAD doc present but object absent for ${bookId} ` +
            `(key=${key}); self-healing the stale HEAD doc and re-embedding. ` +
            `drift count: ${driftCount}.`,
        );
        try {
          await backend.deleteArtifactHead(workspaceId, `embedCache/${key}`);
        } catch (err) {
          logger.warn(`Stale HEAD-doc self-heal delete failed for ${bookId}:`, err);
        }
        return null;
      }

      let parsed: ReturnType<typeof parseArtifactBlob>;
      try {
        parsed = parseArtifactBlob(bytes);
      } catch (err) {
        // A structurally corrupt blob is a definitive non-hit (not transient).
        logger.warn(`Artifact blob for ${bookId} is unparseable; treating as miss:`, err);
        return null;
      }
      const { header } = parsed;

      // Corruption guard: RE-DERIVE the content key from the blob's OWN stamp
      // (the header's {model, dims, quant, extractionVersion}) folded with this
      // book's contentHash, and assert it equals the requested `key`. A mismatch
      // means the object stored under this content-addressed key does not
      // describe this stamp/content (a swap or bit-rot) — reject it. Re-read the
      // contentHash (a cheap cached IDB read) so the re-derivation uses the same
      // content identity the request did.
      const manifest = await deps.getManifest(bookId);
      const contentHash = manifest?.contentHash;
      if (!contentHash) return null;
      const rederived = await contentKey({
        contentHash,
        model: header.model,
        dims: header.dims,
        quant: header.quant,
        extractionVersion: header.extractionVersion,
      });
      if (rederived !== key) {
        logger.warn(
          `Artifact stamp mismatch for ${bookId} (re-derived key !== requested); rejecting blob.`,
        );
        return null;
      }

      // Reconcile each blob section's text hash against the LIVE local corpus:
      // keep only sections whose hash still matches, since a section whose text
      // has since changed (or is now absent locally) would carry stale vectors.
      // Dropped sections are left for the indexer to re-embed on the next pass
      // (a partial reuse). The job row below marks ONLY the survivors complete,
      // so the dropped ones are not skipped on resume.
      const corpus = await deps.getLiveCorpus(bookId);
      const liveHashByHref = new Map<string, string | undefined>(
        (corpus?.sections ?? []).map((s) => [s.href, s.sectionTextHash]),
      );

      const sections: CacheEmbeddingsRow['sections'] = [];
      const jobSections: CacheEmbedJobsRow['sections'] = [];
      for (const hs of header.sections) {
        const liveHash = liveHashByHref.get(hs.href);
        // Drop a section the live corpus no longer has, or whose text diverged.
        if (liveHash === undefined || liveHash !== hs.sectionTextHash) continue;
        const bytesForSection = parsed.sectionBytes(hs.href);
        if (!bytesForSection) continue;
        sections.push({
          href: hs.href,
          sectionTextHash: hs.sectionTextHash,
          // The v1 blob header does not carry per-chunk CFI/char offsets; the
          // ranker re-segments from the local search-text corpus when chunks are
          // empty, so an empty list is a valid persisted state and the hydrated
          // row is still searchable.
          chunks: [],
          vectors: bytesForSection.vectors,
          scales: bytesForSection.scales,
        });
        jobSections.push({
          href: hs.href,
          // embeddedThroughChunk is the resume cursor; this section is fully
          // hydrated, so mark it complete. The exact chunk count is unknown from
          // the blob (chunks aren't carried), but any positive value paired with
          // the present vectors lets the indexer skip this section on resume.
          embeddedThroughChunk: 1,
          sectionTextHash: hs.sectionTextHash,
        });
      }

      // No reconcilable section → nothing to hydrate; fall through to embed.
      if (sections.length === 0) return null;

      const extractionVersion = corpus?.extractionVersion ?? header.extractionVersion;
      const row: CacheEmbeddingsRow = {
        bookId,
        model: header.model,
        dims: header.dims,
        quant: header.quant,
        extractionVersion,
        sections,
      };
      const jobRow: CacheEmbedJobsRow = {
        bookId,
        extractionVersion,
        sections: jobSections,
        updatedAt: Date.now(),
      };
      // ATOMIC write: both rows in one cross-store transaction, so a crash can
      // never leave a section marked complete in the job row but with no vectors.
      await deps.putHydrated(row, jobRow);
      return row;
    },
  };
}

// ── Holder (mirrors the embedding-client holder) ────────────────────────────

let instance: ArtifactConsult | null = null;

/** Install the singleton (wireGoogle, composition root). */
export function setArtifactConsult(consult: ArtifactConsult): void {
  instance = consult;
}

/**
 * The installed consult, or `null` when sync/Google was never wired. Callers
 * (the boot loop + reader controller) bind their own `interactive` posture onto
 * the returned adapter. Not memoized: a later wireGoogle still wins.
 */
export function getArtifactConsult(): ArtifactConsult | null {
  return instance;
}
