/**
 * EmbeddingIndexer — the foreground document-embedding pass that turns a book's
 * text into the vectors semantic search runs over.
 *
 * Takes constructor-injected ports only — the embedding client, the persisted
 * corpus source, the embeddings repo, and the int8 quantizer (passed as a port
 * so this domain never deep-imports the search worker). bookId and the reading
 * position (CFI) flow in as arguments, never read from a store.
 *
 * `enqueue(bookId, currentCfi?, opts?)`:
 *  - loads the book's extracted search text via the injected textSource,
 *  - orders sections OUTWARD from the current reading position (so the page the
 *    reader is on becomes searchable first), derived from the position CFI;
 *    falls back to section 0 when the CFI is absent/unparseable,
 *  - per section: skips it when the resume journal already records this section
 *    (keyed by href + text hash) as fully embedded; otherwise chunks the text,
 *    embeds the chunks (threading consent + quota lane through the client to the
 *    gateway), quantizes each vector to int8, packs the int8 rows + float32
 *    scales, persists them, and updates the resume journal per section so an
 *    interrupted pass can pick up where it left off.
 *
 * Chunk CFIs are persisted as empty strings here: the chunker works on plain
 * text and cannot produce a CFI without the live reader view. The char offsets
 * ARE persisted, and the read path recovers CFIs from those at query time.
 */
import { parseCfiTokens, tryParseCfiPoint } from '@kernel/cfi';
import { AppError, retryAfterMsOf } from '~types/errors';
import { chunkSection } from './chunker';
import { effectiveSectionHash } from './sectionHash';
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
      /**
       * Gateway quota lane. The foreground indexer (book being read) uses
       * `'fgd'`; the bg backfill (other books) passes `'bg'`.
       */
      lane?: 'fg' | 'fgd' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<{ vectors: Float32Array[] }>;
  isConfigured(): boolean;
}

/**
 * The persisted row's embedding-space stamp ({model, dims, quant}), compared
 * against the live config to decide whether the whole book must be re-embedded
 * (a stamp change means the stored vectors live in an incompatible space). It is
 * widened with the prior row's `sections` so the indexer can read-modify-write
 * the embeddings row and carry forward the vectors of sections it resume-skips,
 * rather than overwriting the row with only this pass's sections. `sections` is
 * optional/lightweight — the buffers it carries are the already-materialized
 * vectors/scales (the production repo hands them back as typed-array views, which
 * we re-pack to ArrayBuffers on write).
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

/** The int8 quantizer port (the search worker's per-vector int8 quantizer). */
type QuantizePort = (vec: Float32Array) => { vectors: Int8Array; scale: number };

/**
 * Optional port for reusing embeddings the user already generated on another
 * device. Embeddings are expensive to regenerate (they cost API quota), so when
 * the user has the same book embedded elsewhere and synced to their cloud, the
 * indexer can download those vectors instead of re-embedding from scratch.
 * `probe` is a cheap availability check; `hydrate` downloads the blob and writes
 * the local embedding rows. It is optional so indexer constructions that pass no
 * port compile and behave exactly as before. The app layer owns the consent
 * gate and must make both calls short-circuit to `false` cheaply when no cloud
 * backend is connected, so the common no-sync case adds zero latency.
 */
interface EmbeddingConsultPort {
  /** Cheap availability check: are reusable embeddings present for this book? */
  probe(bookId: string): Promise<boolean>;
  /** Download + write the local rows; `true` when the local row was hydrated. */
  hydrate(bookId: string): Promise<boolean>;
}

/** One activity-log entry the indexer emits (the app stamps id + timestamp). */
interface EmbeddingIndexerLogEntry {
  type: 'response' | 'error' | 'debug';
  method: 'embedIndexRun';
  payload: Record<string, unknown>;
}

/**
 * Why an embedding pass stopped early. Rate-limit stops carry the wait the
 * quota needs on the thrown error (see {@link retryAfterMsOf}); the caller's
 * scheduler sleeps that long instead of polling a fixed timer.
 */
type EmbeddingPassStop =
  | 'daily-quota'
  | 'rate-limit-long-wait'
  | 'rate-limit-retries-exhausted'
  | 'error';

/**
 * Inline rate-limit backoff. A rate-limited section is retried in place while
 * the wait is short (a busy minute window): the delay is the larger of the
 * server/governor hint and an exponential floor (2 s, 4 s, 8 s, 16 s). A long
 * wait — a spent DAILY budget carries the time to the next Pacific-day reset —
 * or a fifth consecutive limit stops the pass and rethrows, so the scheduler
 * above sleeps for the real duration. The Jul–Sep 2026 export showed 16
 * requests in 6.5 minutes at 1–8 s spacing against a per-minute limit, and
 * five requests 91 s apart into a spent daily cap; neither could succeed.
 */
const RATE_LIMIT_MAX_RETRIES = 4;
const RATE_LIMIT_MAX_INLINE_WAIT_MS = 60_000;
const RATE_LIMIT_BASE_WAIT_MS = 2_000;
const RATE_LIMIT_DEFAULT_WAIT_MS = 30_000;

/** The wait a rate-limit error asks for, or undefined when it is not a rate limit. */
function rateLimitWaitMs(error: unknown): number | undefined {
  if (!(error instanceof AppError)) return undefined;
  const rateLimited = error.code === 'NET_RATE_LIMITED' || error.context?.status === 429;
  if (!rateLimited) return undefined;
  return retryAfterMsOf(error) ?? RATE_LIMIT_DEFAULT_WAIT_MS;
}

/** A spent daily budget: the governor's rpd refusal or the server's PerDay quota. */
function isDailyExhaustion(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return error.context?.dailyQuotaExhausted === true || error.context?.reason === 'rpd-exhausted';
}

interface PassStats {
  startedAt: number;
  sectionsTotal: number;
  resumed: number;
  embedded: number;
  chunks: number;
  rateLimits: number;
  waitedMs: number;
  stoppedReason?: EmbeddingPassStop;
}

interface EmbeddingIndexerDeps {
  embeddingClient: EmbeddingClientPort;
  textSource: SearchTextSource;
  embeddingsRepo: EmbeddingsRepoPort;
  quantize: QuantizePort;
  /** Embedding stamp config (read once per enqueue). */
  getConfig: () => { model: string; dims: number };
  /**
   * Optional activity-log sink for the per-pass summary (`embedIndexRun`):
   * sections embedded/resumed, chunks, rate-limit waits, duration and why the
   * pass stopped. Emitted only when the pass did work or stopped early, so a
   * reader-open over an already-embedded book leaves no entry.
   */
  log?: (entry: EmbeddingIndexerLogEntry) => void;
  /** Sleep seam for the inline rate-limit backoff (injected for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Wall clock (injected for tests). */
  now?: () => number;
  /**
   * Optional reuse of embeddings generated on another device. When present,
   * `enqueue` checks it BEFORE the embed loop; on a full hit it downloads those
   * vectors and RETURNS without calling {@link EmbeddingClientPort.embed},
   * spending no API quota.
   */
  consult?: EmbeddingConsultPort;
}

export class EmbeddingIndexer {
  constructor(private readonly deps: EmbeddingIndexerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep
      ? this.deps.sleep(ms)
      : new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Embed with the inline rate-limit backoff described at {@link RATE_LIMIT_MAX_RETRIES}. */
  private async embedWithBackoff(
    texts: string[],
    opts: Parameters<EmbeddingClientPort['embed']>[1],
    pass: PassStats,
  ): Promise<{ vectors: Float32Array[] }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.deps.embeddingClient.embed(texts, opts);
      } catch (error) {
        const wait = rateLimitWaitMs(error);
        if (wait === undefined) {
          pass.stoppedReason = 'error';
          throw error;
        }
        pass.rateLimits += 1;
        if (isDailyExhaustion(error)) {
          pass.stoppedReason = 'daily-quota';
          throw error;
        }
        if (wait > RATE_LIMIT_MAX_INLINE_WAIT_MS) {
          pass.stoppedReason = 'rate-limit-long-wait';
          throw error;
        }
        if (attempt >= RATE_LIMIT_MAX_RETRIES) {
          pass.stoppedReason = 'rate-limit-retries-exhausted';
          throw error;
        }
        const delay = Math.min(
          RATE_LIMIT_MAX_INLINE_WAIT_MS,
          Math.max(wait, RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt),
        );
        pass.waitedMs += delay;
        await this.sleep(delay);
      }
    }
  }

  private logPass(bookId: string, lane: string, pass: PassStats): void {
    if (!this.deps.log) return;
    if (pass.embedded === 0 && !pass.stoppedReason) return;
    this.deps.log({
      type: pass.stoppedReason ? 'error' : 'response',
      method: 'embedIndexRun',
      payload: {
        message: pass.stoppedReason ? `embedding pass stopped: ${pass.stoppedReason}` : 'embedding pass complete',
        bookId,
        lane,
        sectionsTotal: pass.sectionsTotal,
        sectionsResumed: pass.resumed,
        sectionsEmbedded: pass.embedded,
        chunks: pass.chunks,
        rateLimits: pass.rateLimits,
        waitedMs: pass.waitedMs,
        durationMs: this.now() - pass.startedAt,
        ...(pass.stoppedReason ? { stoppedReason: pass.stoppedReason } : {}),
      },
    });
  }

  /**
   * Embed `bookId`'s document corpus, outward from `currentCfi`. No-op when the
   * client is unconfigured or the book has no persisted corpus.
   *
   * `opts` selects the consent/quota-lane posture (default `{ interactive:
   * true, lane: 'fgd' }`, the foreground reader behavior — the book being read
   * embeds on the foreground DOCUMENT lane, which runs at foreground speed but
   * respects the `fgRpdHeadroom` reserved for interactive search, so it never
   * starves search the way the plain `'fg'` lane would). The background backfill
   * passes `{ interactive: false, lane: 'bg' }` so the embed uses the slow
   * background quota lane and never claims a user gesture from a background path.
   */
  async enqueue(
    bookId: string,
    currentCfi?: string,
    opts?: { interactive?: boolean; lane?: 'fg' | 'fgd' | 'bg' },
  ): Promise<void> {
    if (!this.deps.embeddingClient.isConfigured()) return;

    const corpus = await this.deps.textSource.get(bookId);
    if (!corpus || corpus.sections.length === 0) return;

    // Before embedding anything, try to reuse vectors the user already generated
    // for this book on another device. If the injected adapter reports they are
    // available and successfully downloads + writes them into the local rows, we
    // RETURN here without ever calling embed() — spending no API quota. The
    // adapter owns the consent gate and short-circuits cheaply when no cloud
    // backend is connected, so the common no-sync case adds no latency. A miss,
    // or a partial/failed download, falls through to the normal embed loop below.
    if (this.deps.consult && (await this.deps.consult.probe(bookId))) {
      if (await this.deps.consult.hydrate(bookId)) return;
    }

    const sections = corpus.sections;
    const order = orderOutward(sections.length, spineOrdinalFrom(currentCfi, sections.length));

    const config = this.deps.getConfig();

    // Stamp-mismatch guard: when the persisted row's {model, dims, quant} no
    // longer matches the live config, the stored vectors live in an
    // INCOMPATIBLE space and can never be converted. Discard the prior resume
    // journal so EVERY section re-embeds, rather than resume-skipping vectors
    // from the old space on the {href, sectionTextHash} key below.
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

    // The set of hrefs whose VECTORS actually live in the persisted embeddings
    // row. A section the resume journal marks complete but that is ABSENT here is
    // a corrupt-resume window (a crash between writing the journal and writing
    // the vectors, or a partial download) — it must be treated as a MISS and
    // re-embedded, NOT resume-skipped forever.
    const persistedHrefs = new Set(
      (!stampMismatch && persisted?.sections ? persisted.sections : []).map((s) => s.href),
    );

    const lane = opts?.lane ?? 'fgd';
    const pass: PassStats = {
      startedAt: this.now(),
      sectionsTotal: order.length,
      resumed: 0,
      embedded: 0,
      chunks: 0,
      rateLimits: 0,
      waitedMs: 0,
    };
    try {
      await this.embedSections(bookId, corpus, order, config, job, embeddedSections, jobSections, persistedHrefs, opts, pass);
    } finally {
      this.logPass(bookId, lane, pass);
    }
  }

  private async embedSections(
    bookId: string,
    corpus: NonNullable<Awaited<ReturnType<SearchTextSource['get']>>>,
    order: number[],
    config: { model: string; dims: number },
    job: CacheEmbedJobsRow | undefined,
    embeddedSections: CacheEmbeddingsRow['sections'],
    jobSections: CacheEmbedJobsRow['sections'],
    persistedHrefs: Set<string>,
    opts: { interactive?: boolean; lane?: 'fg' | 'fgd' | 'bg' } | undefined,
    pass: PassStats,
  ): Promise<void> {
    const sections = corpus.sections;
    for (const idx of order) {
      const section = sections[idx];
      // Prefer the extractor's stamped hash; derive it from the section text
      // when the corpus predates the field (version-3 corpora written before it
      // existed, which are never re-extracted). Without this, a hash-less corpus
      // falls to '' and NO section ever resume-skips — the whole book re-embeds
      // on every reader pass. The derived value matches what re-extraction would
      // stamp, so it is a stable, comparable key.
      const sectionTextHash = effectiveSectionHash(section.text, section.sectionTextHash);

      // Resume-skip: the journal already records this {href, sectionTextHash}
      // as fully embedded AND its vectors are present in the persisted row (the
      // guard above). A re-extracted section (text-hash mismatch), an older
      // journal row without a hash, OR a section the journal marks complete but
      // whose vectors are missing all fall through and re-embed.
      const prior = job?.sections.find((s) => s.href === section.href);
      if (
        prior &&
        sectionTextHash !== '' &&
        prior.sectionTextHash === sectionTextHash &&
        persistedHrefs.has(section.href)
      ) {
        pass.resumed += 1;
        continue;
      }

      const { chunks } = chunkSection({
        href: section.href,
        title: section.title,
        text: section.text,
      });
      if (chunks.length === 0) continue;

      const { vectors } = await this.embedWithBackoff(
        chunks.map((c) => c.text),
        {
          profile: 'document',
          bookId,
          interactive: opts?.interactive ?? true,
          lane: opts?.lane ?? 'fgd',
        },
        pass,
      );
      pass.embedded += 1;
      pass.chunks += chunks.length;

      // Quantize each returned float32 vector to int8 plus a per-vector scale,
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
        // CFIs are left empty: the chunker works on plain text and cannot
        // produce a CFI without the live reader view. The CHAR offsets ARE
        // persisted so the read path can recover the char offset/length without
        // re-segmenting. Older rows lack them and fall back to re-segmentation.
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
 * is absent/unparseable (the section-0-first fallback).
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
