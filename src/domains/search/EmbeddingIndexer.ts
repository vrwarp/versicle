/**
 * EmbeddingIndexer (Increment C §4) — the FOREGROUND document-embedding pass.
 *
 * Constructor-injected ports ONLY (mirrors SearchSession's engineFactory /
 * textSource seam at SearchSession.ts:63): the embedding client, the persisted
 * corpus source, the embeddings repo, and the int8 quantizer (the B3
 * `SearchEngine.quantizeInt8PerVector`, passed as a port so this domain never
 * deep-imports the worker). bookId/CFI flow as ARGUMENTS — never read from a
 * store (domains-no-store guardrail).
 *
 * `enqueue(bookId, currentCfi?, opts?)`:
 *  - loads `cache_search_text` via the injected textSource,
 *  - orders sections OUTWARD from the current reading position (the CFI's
 *    spine ordinal, derived via @kernel/cfi parseCfiTokens; falls back to
 *    section 0 when absent/unparseable),
 *  - per section: skips when `cache_embed_jobs` already records the
 *    {href, sectionTextHash} fully embedded (resume), else chunks → embeds
 *    (FG, consent + lane threaded through the client → gateway) → quantizes
 *    each vector → packs int8 rows + float32 scales → persists via the repo,
 *    updating `cache_embed_jobs` per section for resumability.
 *
 * CFI population is deferred to Phase D (the chunker cannot emit CFI from text;
 * cache.ts:188), so chunk CFIs are persisted as empty strings here — char
 * offsets are recoverable from `cache_search_text`.
 */
import { parseCfiTokens, tryParseCfiPoint } from '@kernel/cfi';
import { chunkSection } from './chunker';
import { CURRENT_QUANT } from './embeddingPort';
import type { SearchTextSource } from './SearchSession';
import type { CacheEmbeddingsRow, CacheEmbedJobsRow } from '@data/rows/cache';

/** The slice of the EmbeddingClient the indexer consumes (injected port). */
interface EmbeddingClientPort {
  embed(
    texts: string[],
    opts: {
      profile: 'document' | 'query';
      bookId?: string;
      interactive?: boolean;
      /** Gateway quota lane (default `'fg'`); the bg backfill passes `'bg'`. */
      lane?: 'fg' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<{ vectors: Float32Array[] }>;
  isConfigured(): boolean;
}

/**
 * The persisted-row stamp the indexer compares against the live config to
 * decide a whole-book re-embed (design §8.2), WIDENED with the prior row's
 * `sections` so the indexer can read-modify-write `cache_embeddings` and carry
 * forward resume-skipped sections' vectors (rather than overwriting the row with
 * only this-pass sections). `sections` is optional/lightweight — the buffers it
 * carries are the already-materialized vectors/scales (the production repo hands
 * them back as typed-array views, which we re-pack to ArrayBuffers on write).
 */
type EmbeddedRowStamp = Pick<CacheEmbeddingsRow, 'model' | 'dims' | 'quant'> & {
  sections?: PriorEmbeddedSection[];
};

/**
 * A prior persisted section as seen via the read port. `vectors`/`scales` are
 * `ArrayBufferLike | ArrayBufferView` so this accepts BOTH the on-disk
 * ArrayBuffer shape AND the typed-array views the production repo re-wraps on
 * read; {@link toArrayBuffer} normalizes either back to the ArrayBuffer the
 * `put` row carries so a carried-forward section re-persists losslessly.
 */
interface PriorEmbeddedSection {
  href: string;
  sectionTextHash: string;
  chunks: CacheEmbeddingsRow['sections'][number]['chunks'];
  vectors: ArrayBufferLike | ArrayBufferView;
  scales: ArrayBufferLike | ArrayBufferView;
}

/** Normalize a persisted buffer or a re-wrapped typed-array view to ArrayBuffer. */
function toArrayBuffer(buf: ArrayBufferLike | ArrayBufferView): ArrayBuffer {
  if (ArrayBuffer.isView(buf)) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  return buf as ArrayBuffer;
}

/** The slice of the embeddings repo the indexer consumes (injected port). */
interface EmbeddingsRepoPort {
  get(bookId: string): Promise<EmbeddedRowStamp | undefined>;
  getJob(bookId: string): Promise<CacheEmbedJobsRow | undefined>;
  put(row: CacheEmbeddingsRow): Promise<void>;
  putJob(row: CacheEmbedJobsRow): Promise<void>;
}

/** The int8 quantizer port (B3 SearchEngine.quantizeInt8PerVector). */
type QuantizePort = (vec: Float32Array) => { vectors: Int8Array; scale: number };

interface EmbeddingIndexerDeps {
  embeddingClient: EmbeddingClientPort;
  textSource: SearchTextSource;
  embeddingsRepo: EmbeddingsRepoPort;
  quantize: QuantizePort;
  /** Embedding stamp config (read once per enqueue). */
  getConfig: () => { model: string; dims: number };
}

export class EmbeddingIndexer {
  constructor(private readonly deps: EmbeddingIndexerDeps) {}

  /**
   * Embed `bookId`'s document corpus, outward from `currentCfi`. No-op when the
   * client is unconfigured or the book has no persisted corpus.
   *
   * `opts` selects the consent/lane posture (default `{ interactive: true,
   * lane: 'fg' }`, preserving the committed FOREGROUND reader behavior). The
   * Increment E background backfill passes `{ interactive: false, lane: 'bg' }`
   * so the embed rides the bg lane and is gated by the §8.4.1 consent grant —
   * never `interactive: true` from a background path.
   */
  async enqueue(
    bookId: string,
    currentCfi?: string,
    opts?: { interactive?: boolean; lane?: 'fg' | 'bg' },
  ): Promise<void> {
    if (!this.deps.embeddingClient.isConfigured()) return;

    const corpus = await this.deps.textSource.get(bookId);
    if (!corpus || corpus.sections.length === 0) return;

    const sections = corpus.sections;
    const order = orderOutward(sections.length, spineOrdinalFrom(currentCfi, sections.length));

    const config = this.deps.getConfig();

    // Whole-row stamp-mismatch guard (design §8.2): when the persisted row's
    // {model, dims, quant} no longer matches the live config, the stored
    // vectors live in an INCOMPATIBLE space — they are NEVER converted. Discard
    // the prior job so EVERY section re-embeds (the whole-book re-embed
    // fallback), rather than resume-skipping stale-space vectors on the
    // {href, sectionTextHash} key below.
    const persisted = await this.deps.embeddingsRepo.get(bookId);
    const stampMismatch =
      persisted !== undefined &&
      (persisted.model !== config.model ||
        persisted.dims !== config.dims ||
        persisted.quant !== CURRENT_QUANT);

    const job = stampMismatch ? undefined : await this.deps.embeddingsRepo.getJob(bookId);

    // Read-modify-write the per-book embedding row: SEED the accumulator from the
    // prior persisted row's sections (carried forward losslessly) so a RESUMED
    // pass — which resume-skips already-embedded sections below — keeps their
    // persisted vectors instead of overwriting the row with only this-pass
    // sections. On a stamp mismatch the prior sections live in an incompatible
    // space, so we start empty (the whole-book re-embed). Each section is
    // pushed-or-REPLACED by href in the loop; this-pass sections merge over any
    // carried-forward entry for the same href.
    const embeddedSections: CacheEmbeddingsRow['sections'] =
      !stampMismatch && persisted?.sections
        ? persisted.sections.map((s) => ({
            href: s.href,
            sectionTextHash: s.sectionTextHash,
            chunks: s.chunks,
            vectors: toArrayBuffer(s.vectors),
            scales: toArrayBuffer(s.scales),
          }))
        : [];
    const jobSections: CacheEmbedJobsRow['sections'] = job ? [...job.sections] : [];

    for (const idx of order) {
      const section = sections[idx];
      const sectionTextHash = section.sectionTextHash ?? '';

      // Resume-skip: the job already records this {href, sectionTextHash} as
      // fully embedded (design §2.1). A re-extracted section (hash mismatch) or
      // a legacy job row without the stamp falls through and re-embeds.
      const prior = job?.sections.find((s) => s.href === section.href);
      if (prior && sectionTextHash !== '' && prior.sectionTextHash === sectionTextHash) {
        continue;
      }

      const { chunks } = chunkSection({
        href: section.href,
        title: section.title,
        text: section.text,
      });
      if (chunks.length === 0) continue;

      const { vectors } = await this.deps.embeddingClient.embed(
        chunks.map((c) => c.text),
        {
          profile: 'document',
          bookId,
          interactive: opts?.interactive ?? true,
          lane: opts?.lane ?? 'fg',
        },
      );

      // Quantize each returned float32 vector to int8 + a per-vector scale (B3),
      // then pack the int8 rows back-to-back and the float32 scales alongside.
      const dims = vectors[0]?.length ?? config.dims;
      const packed = new Int8Array(vectors.length * dims);
      const scales = new Float32Array(vectors.length);
      vectors.forEach((vec, i) => {
        const { vectors: q, scale } = this.deps.quantize(vec);
        packed.set(q, i * dims);
        scales[i] = scale;
      });

      const embeddedSection = {
        href: section.href,
        sectionTextHash,
        // CFI population is Phase D (the chunker cannot emit CFI from text);
        // the CHAR offsets ARE persisted (additive, no IDB bump) so the read
        // path (semanticRank) can recover charOffset/matchLength WITHOUT
        // re-segmenting. Legacy rows lack them and fall back to re-segmentation.
        chunks: chunks.map((c) => ({
          cfiStart: '',
          cfiEnd: '',
          tokenCount: c.tokenCount,
          charStart: c.charStart,
          charEnd: c.charEnd,
        })),
        vectors: packed.buffer,
        scales: scales.buffer,
      };
      // Push-or-REPLACE by href (mirrors the jobSections merge below) so a
      // re-embedded section updates its carried-forward entry instead of
      // duplicating it.
      const existingIdx = embeddedSections.findIndex((s) => s.href === section.href);
      if (existingIdx >= 0) embeddedSections[existingIdx] = embeddedSection;
      else embeddedSections.push(embeddedSection);

      // Mark this section fully embedded for resumability ({href, sectionTextHash}
      // via the embeddedThroughChunk count, stamped with the section hash so a
      // re-extracted section is re-embedded).
      const jobEntry = { href: section.href, embeddedThroughChunk: chunks.length, sectionTextHash };
      const existingJobIdx = jobSections.findIndex((s) => s.href === section.href);
      if (existingJobIdx >= 0) jobSections[existingJobIdx] = jobEntry;
      else jobSections.push(jobEntry);

      // Persist incrementally so a mid-pass abort leaves resumable progress.
      // Snapshot the arrays (don't share the mutable accumulators with the
      // repo) so each persisted row is an independent point-in-time value.
      await this.deps.embeddingsRepo.put({
        bookId,
        model: config.model,
        dims,
        quant: 'int8-pervec',
        extractionVersion: corpus.extractionVersion,
        sections: [...embeddedSections],
      });
      await this.deps.embeddingsRepo.putJob({
        bookId,
        extractionVersion: corpus.extractionVersion,
        sections: [...jobSections],
        updatedAt: Date.now(),
      });
    }
  }
}

/**
 * Derive the 0-based spine-section ordinal from a position CFI, clamped to
 * `[0, count)`. Uses the standard EPUB even-step spine encoding (`/6/14…` →
 * the spine step `/14` maps to ordinal `(14 - 2) / 2`). Returns 0 when the CFI
 * is absent/unparseable (the section-0-first fallback — design risk note).
 */
function spineOrdinalFrom(currentCfi: string | undefined, count: number): number {
  if (!currentCfi) return 0;
  // tryParseCfiPoint validates structural parseability (the epubjs oracle);
  // parseCfiTokens gives us the step sequence to read the spine ordinal from.
  if (!tryParseCfiPoint(currentCfi)) return 0;
  const tokens = parseCfiTokens(currentCfi);
  if (!tokens) return 0;

  // The spine step is the last `/N` step BEFORE the first `!` indirection.
  let spineStepIndex: number | null = null;
  for (const token of tokens) {
    if (token.kind === 'indirection') break;
    if (token.kind === 'step') spineStepIndex = token.index;
  }
  if (spineStepIndex === null) return 0;

  const ordinal = Math.floor((spineStepIndex - 2) / 2);
  if (!Number.isFinite(ordinal) || ordinal < 0) return 0;
  return Math.min(ordinal, count - 1);
}

/**
 * Emit an OUTWARD section order from `center`: center, center+1, center-1,
 * center+2, center-2, … fanning out and covering every index exactly once.
 */
export function orderOutward(count: number, center: number): number[] {
  const order: number[] = [];
  if (count <= 0) return order;
  const start = Math.max(0, Math.min(center, count - 1));
  order.push(start);
  for (let d = 1; order.length < count; d++) {
    const up = start + d;
    const down = start - d;
    if (up < count) order.push(up);
    if (down >= 0) order.push(down);
  }
  return order;
}
