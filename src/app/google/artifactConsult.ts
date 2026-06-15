/**
 * ArtifactConsult — the app-layer READ-side adapter for the shared AI-cache
 * "Artifact Lane" (shared-ai-cache-design.md §2.4/§2.6/§2.7, Phase B).
 *
 * It holds the store/manifest/backend edges the pure domains/search codec and
 * the C3 SyncBackend cannot reach (domains-no-store; the codec is store-free,
 * the backend is injected), and exposes two operations the bg backfill loop and
 * the FG indexer consult BEFORE spending Gemini quota:
 *
 *  - {@link ArtifactConsult.probeArtifact}: resolve bookId → contentHash via the
 *    manifest, derive the {@link contentKey}, and HEAD-probe the BYO backend.
 *  - {@link ArtifactConsult.hydrateFromArtifact}: download the blob, parse its
 *    header, reconcile each section's `sectionTextHash` against the LIVE corpus
 *    (drop diverged sections — they re-embed next pass), re-derive the
 *    contentKey from the blob's OWN stamp and assert it matches the requested
 *    key (bit-rot guard), then write the local rows via the atomic
 *    {@link ArtifactConsultDeps.putHydrated} (§2.8) and return the row.
 *
 * Consent (§2.6, hard requirement): BOTH operations are gated by the SAME
 * predicate `makeAiConsentResolver` applies to the embed they replace — the
 * adapter calls {@link ArtifactConsultDeps.isConsented} first and short-circuits
 * (probe → false, hydrate → null) when it is not granted. A hydrate while the
 * opt-in is OFF and there is no per-book bit is FORBIDDEN.
 *
 * The holder ({@link setArtifactConsult}/{@link getArtifactConsult}) mirrors the
 * embedding-client holder so wireGoogle installs the singleton and the boot loop
 * + reader controller inject the consult port — one knip consumer chain.
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

/** Whether the read-path consult is consented for a book (§2.6). */
type ConsentGate = (bookId: string, opts: { interactive: boolean }) => boolean;

export interface ArtifactConsultDeps {
  /**
   * The artifact-lane backend handle, or `null` when sync is off / not
   * connected (SyncOrchestrator.getConnectedArtifactBackend). Read fresh per
   * call so a connect/disconnect takes effect immediately; a `null` handle is
   * the cheap no-network short-circuit (probe → false, hydrate → null).
   */
  getBackend(): { backend: SyncBackend; workspaceId: string } | null;
  /** Resolve bookId → manifest (carries the optional `contentHash`). */
  getManifest(bookId: string): Promise<StaticManifestRow | undefined>;
  /** The live embedding-space stamp (useGenAIStore + CURRENT_QUANT + extractionVersion). */
  getStamp(): ArtifactStamp;
  /** The live persisted corpus, for section-hash reconciliation (§2.4). */
  getLiveCorpus(bookId: string): Promise<CacheSearchTextRow | undefined>;
  /** The atomic cross-store hydrate write (§2.8). */
  putHydrated(row: CacheEmbeddingsRow, jobRow: CacheEmbedJobsRow): Promise<void>;
  /** The §2.6 read-path consent gate (mirrors makeAiConsentResolver). */
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
   * Download + materialize the local row from the artifact, or `null` on any
   * clean non-hydrate (consent denied, no backend, definitive miss, stamp
   * mismatch, no reconcilable sections). A transient/permission error from
   * {@link SyncBackend.getArtifact} is RETHROWN (§2.7: never mistake an offline
   * blip for a miss and burn quota).
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
    // §2.6 consent gate FIRST — a denied consult never touches the manifest or
    // the network.
    if (!deps.isConsented(bookId, opts)) return null;

    // No connected backend → cheap no-network short-circuit (the common
    // no-sync case adds zero latency).
    const handle = deps.getBackend();
    if (!handle) return null;

    // contentHash is OPTIONAL on pre-P7 manifests (static.ts:67); its absence
    // is a CLEAN degrade (no benefit, no throw, no quota) — fall through to a
    // per-device embed.
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
      // HEAD doc tail is `embedCache/{key}` (§2.1). A null HEAD is a miss.
      const head = await backend.headArtifact(workspaceId, `embedCache/${key}`);
      return head !== null;
    },

    async hydrateFromArtifact(bookId, opts): Promise<CacheEmbeddingsRow | null> {
      const resolved = await resolve(bookId, opts);
      if (!resolved) return null;
      const { backend, workspaceId, key } = resolved;

      // Blob tail is `embeddings/{key}.bin` (§2.1). §2.7 taxonomy: a definitive
      // miss is `null` (re-embed); a transient/permission error THROWS from the
      // backend and we let it propagate (never burn quota on an offline blip).
      const bytes = await backend.getArtifact(workspaceId, `embeddings/${key}.bin`);
      if (!bytes) return null;

      let parsed: ReturnType<typeof parseArtifactBlob>;
      try {
        parsed = parseArtifactBlob(bytes);
      } catch (err) {
        // A structurally corrupt blob is a definitive non-hit (not transient).
        logger.warn(`Artifact blob for ${bookId} is unparseable; treating as miss:`, err);
        return null;
      }
      const { header } = parsed;

      // Corruption guard (§2.4): RE-DERIVE the contentKey from the blob's OWN
      // stamp (the header's {model,dims,quant,extractionVersion}) folded with
      // this book's contentHash, and assert it equals the requested `key`. A
      // mismatch means the object stored under this content-addressed key does
      // not describe this stamp/content (a swap or bit-rot) — reject. The
      // contentHash came from `resolve` (the manifest); re-read it (cheap cached
      // IDB) so the re-key uses the SAME content identity the request did.
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

      // Reconcile each header section's sectionTextHash against the LIVE corpus
      // (§2.4): keep only sections whose hash still matches the local corpus —
      // a diverged/absent section is DROPPED so the indexer re-embeds just those
      // on the next pass (partial hydrate). The jobRow below marks ONLY the
      // survivors complete (so the dropped ones are NOT resume-skipped).
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
          // CFI/char offsets are not carried in the v1 blob header (Phase D
          // populates CFI; char offsets re-segment from cache_search_text). An
          // empty chunks list is a valid persisted state (semanticRank falls
          // back to re-segmentation), so the hydrated row is searchable.
          chunks: [],
          vectors: bytesForSection.vectors,
          scales: bytesForSection.scales,
        });
        jobSections.push({
          href: hs.href,
          // embeddedThroughChunk is the resume cursor; the section is fully
          // hydrated, so mark it complete. The exact count is unknown from the
          // blob (chunks aren't carried), but any positive value paired with the
          // present vectors + the B-3 guard makes this section resume-skippable.
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
      // §2.8 ATOMIC write: both stores in one gated cross-store tx, so a crash
      // can never leave a job-complete section with absent vectors.
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
