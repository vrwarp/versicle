/**
 * Row schemas for the CACHE domain stores (`cache_render_metrics`,
 * `cache_audio_blobs`, `cache_session_state`, `cache_tts_preparation`,
 * `cache_table_images`) — Phase 3, D4 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * See rows/static.ts for the shared posture (loose envelope, strict
 * required keys, `z.custom` binaries, ingress-only validation) and for why
 * the `*Row` types are plain aliases rather than `z.infer`.
 */
import { z } from 'zod';
import type {
  CacheAudioBlob,
  CacheRenderMetrics,
  CacheSessionState,
  CacheTtsPreparation,
  CitationMarker,
} from '~types/cache';
import type { TTSQueueItem, Timepoint } from '~types/tts';
import { binaryValueSchema } from './static';

/** `cache_render_metrics` row (key: bookId). */
export const cacheRenderMetricsRowSchema = z.looseObject({
  bookId: z.string().min(1),
  locations: z.string(),
  pageCount: z.number().optional(),
});
export type CacheRenderMetricsRow = {
  bookId: string;
  locations: string;
  pageCount?: number;
};

/**
 * A `cache_render_metrics` row as restored from a backup file's `locations`
 * array (the untrusted restore ingress). Invalid rows are skipped with a
 * warning — never written (pre-rows/ behavior wrote
 * `{ bookId, locations: undefined }` garbage).
 */
export const bookLocationsRowSchema = z.looseObject({
  bookId: z.string().min(1),
  locations: z.string(),
});
const timepointSchema = z.looseObject({
  timeSeconds: z.number(),
  charIndex: z.number(),
  type: z.string().optional(),
});

/**
 * `cache_audio_blobs` row (key: SHA-256 cache key).
 *
 * `alignmentData` is the LEGACY field name for `alignment` written by older
 * builds — read-shim only (the audioCache repo normalizes it onto
 * `alignment` on read; new rows never write it). `size` is the additive
 * byte-length field new writes stamp for the LRU eviction job (P3-6);
 * absent on older rows, backfilled by v25.
 */
export const cacheAudioBlobRowSchema = z.looseObject({
  key: z.string().min(1),
  audio: z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer, {
    message: 'Expected ArrayBuffer',
  }),
  alignment: z.array(timepointSchema).optional(),
  alignmentData: z.array(timepointSchema).optional(),
  createdAt: z.number(),
  lastAccessed: z.number(),
  size: z.number().optional(),
});
export type CacheAudioBlobRow = {
  key: string;
  audio: ArrayBuffer;
  alignment?: Timepoint[];
  alignmentData?: Timepoint[];
  createdAt: number;
  lastAccessed: number;
  size?: number;
};

/** The persisted TTS playback queue item (embedded in `cache_session_state`). */
const ttsQueueItemSchema = z.looseObject({
  text: z.string(),
  cfi: z.string().nullable(),
  title: z.string().optional(),
  isPreroll: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  sourceIndices: z.array(z.number()).optional(),
});

/** `cache_session_state` row (key: bookId). */
export const cacheSessionStateRowSchema = z.looseObject({
  bookId: z.string().min(1),
  playbackQueue: z.array(ttsQueueItemSchema),
  lastPauseTime: z.number().optional(),
  updatedAt: z.number(),
});
export type CacheSessionStateRow = {
  bookId: string;
  playbackQueue: TTSQueueItem[];
  lastPauseTime?: number;
  updatedAt: number;
};

const citationMarkerSchema = z.looseObject({
  cfi: z.string(),
  markerText: z.string(),
  super: z.boolean(),
  numeric: z.boolean(),
  glued: z.boolean(),
  leading: z.boolean(),
  fontSizeRatio: z.number().optional(),
  targetHref: z.string().optional(),
});

/** `cache_tts_preparation` row (key: `${bookId}-${sectionId}`). */
export const cacheTtsPreparationRowSchema = z.looseObject({
  id: z.string().min(1),
  bookId: z.string().min(1),
  sectionId: z.string(),
  sentences: z.array(z.looseObject({ text: z.string(), cfi: z.string() })),
  citationMarkers: z.array(citationMarkerSchema).optional(),
  extractionVersion: z.number().optional(),
});
export type CacheTtsPreparationRow = {
  id: string;
  bookId: string;
  sectionId: string;
  sentences: { text: string; cfi: string }[];
  citationMarkers?: CitationMarker[];
  extractionVersion?: number;
};

/**
 * `cache_table_images` row (key: `${bookId}-${cfi}`). `imageBlob` is
 * canonically an ArrayBuffer on disk (WebKit normalization at ingest);
 * the `~types/cache` interface says `Blob` because reads re-wrap it.
 */
export const tableImageRowSchema = z.looseObject({
  id: z.string().min(1),
  bookId: z.string().min(1),
  sectionId: z.string(),
  cfi: z.string(),
  imageBlob: binaryValueSchema,
});
export type TableImageRow = {
  id: string;
  bookId: string;
  sectionId: string;
  cfi: string;
  imageBlob: ArrayBuffer | Blob;
};

/**
 * `cache_search_text` row (key: bookId) — the persisted per-book search
 * corpus (Phase 7 §F): plain text per spine section, written at import (a
 * free output of the unified extractor) and lazily on first search for
 * pre-existing books. `extractionVersion` is the invalidation stamp:
 * rows below the current extraction version are re-extracted.
 */
const searchTextSectionSchema = z.looseObject({
  href: z.string(),
  title: z.string(),
  text: z.string(),
  /**
   * Fast change-detection stamp: a cheap hash of this section's text,
   * computed at import. The embedding builder compares it against the hash it
   * recorded to skip re-embedding sections whose text is unchanged. Additive
   * on this row — rows written before this field existed simply lack it and
   * get re-extracted (no migration, no schema-version bump).
   */
  sectionTextHash: z.string().optional(),
});
/**
 * @public C1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_SearchTextSchemaMatches` below pins it to the type).
 */
export const cacheSearchTextRowSchema = z.looseObject({
  bookId: z.string().min(1),
  extractionVersion: z.number(),
  sections: z.array(searchTextSectionSchema),
});
export type CacheSearchTextRow = {
  bookId: string;
  extractionVersion: number;
  sections: { href: string; title: string; text: string; sectionTextHash?: string }[];
};

/** A persisted binary field: canonically ArrayBuffer (WebKit-safe structured
 *  clone), same guard as cacheAudioBlobRowSchema.audio. Read paths re-wrap the
 *  buffer as the typed-array view the compute layer expects. */
const embeddingBinarySchema = z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer, {
  message: 'Expected ArrayBuffer',
});

const embeddingChunkSchema = z.looseObject({
  /** CFI (EPUB position locator) of the chunk start — filled in by the
   *  embedding builder, which runs in the reader and can resolve text spans to
   *  CFIs; the background text-chunker cannot derive a CFI from raw text. */
  cfiStart: z.string(),
  cfiEnd: z.string(),
  tokenCount: z.number(),
  /** Inclusive/exclusive character offsets of the chunk within the section
   *  text, recorded when embeddings are built so search can highlight the
   *  matched span without re-splitting the section into chunks again. Additive:
   *  rows written before these fields existed lack them and fall back to
   *  re-splitting — no migration, no DB_VERSION bump. (Any change to the
   *  extraction version re-embeds the book, so these never silently go stale.) */
  charStart: z.number().optional(),
  charEnd: z.number().optional(),
});

const embeddingSectionSchema = z.looseObject({
  href: z.string(),
  /** Invalidation stamp: cheapHash of the section text, computed at import. */
  sectionTextHash: z.string(),
  chunks: z.array(embeddingChunkSchema),
  /** Packed int8 vectors (one row per chunk), persisted as the raw .buffer;
   *  re-wrapped to Int8Array on read. */
  vectors: embeddingBinarySchema,
  /** Per-vector float32 quantization scales, persisted as the raw .buffer;
   *  re-wrapped to Float32Array on read. */
  scales: embeddingBinarySchema,
});

/**
 * `cache_embeddings` row (key: bookId) — the precomputed embedding vectors
 * that power semantic ("meaning-based") in-book search. One row per book; each
 * spine section carries its packed int8 vectors plus the per-vector scales
 * needed to dequantize them. The {model, dims, quant, extractionVersion} stamp
 * lets search detect when the vectors were built with a now-outdated model or
 * settings and must be rebuilt. Cache-domain, device-local, never synced.
 *
 * @public B1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_EmbeddingsSchemaMatches` below pins it).
 */
export const cacheEmbeddingsRowSchema = z.looseObject({
  bookId: z.string().min(1),
  model: z.string(),
  dims: z.number(),
  /** Quantization scheme stamp (currently the int8 per-vector scheme). */
  quant: z.literal('int8-pervec'),
  extractionVersion: z.number(),
  sections: z.array(embeddingSectionSchema),
});
export type CacheEmbeddingsRow = {
  bookId: string;
  model: string;
  dims: number;
  quant: 'int8-pervec';
  extractionVersion: number;
  sections: {
    href: string;
    sectionTextHash: string;
    chunks: {
      cfiStart: string;
      cfiEnd: string;
      tokenCount: number;
      /** Additive char offsets (see embeddingChunkSchema): legacy rows omit them. */
      charStart?: number;
      charEnd?: number;
    }[];
    vectors: ArrayBuffer;
    scales: ArrayBuffer;
  }[];
};

/**
 * `cache_embed_jobs` row (key: bookId) — per-section progress for the
 * background job that builds a book's embeddings. Records how far each section
 * got so the job can resume mid-book after an interruption instead of
 * re-embedding sections already written to `cache_embeddings`. Deleted
 * together with the book and its vectors in the same gated delete transaction.
 *
 * @public B1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_EmbedJobsSchemaMatches` below pins it).
 */
export const cacheEmbedJobsRowSchema = z.looseObject({
  bookId: z.string().min(1),
  extractionVersion: z.number(),
  sections: z.array(
    z.looseObject({
      href: z.string(),
      embeddedThroughChunk: z.number(),
      /**
       * The text hash this section was embedded against, paired with `href` as
       * the resume key. On resume, the builder skips a section whose recorded
       * hash still matches the current text and re-embeds it on mismatch (the
       * section was re-extracted). Additive — rows written before this field
       * existed lack it and re-embed (no migration).
       */
      sectionTextHash: z.string().optional(),
    }),
  ),
  updatedAt: z.number(),
});
export type CacheEmbedJobsRow = {
  bookId: string;
  extractionVersion: number;
  sections: { href: string; embeddedThroughChunk: number; sectionTextHash?: string }[];
  updatedAt: number;
};

/**
 * @public B1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_QueryEmbeddingsSchemaMatches` below pins it).
 */
export const cacheQueryEmbeddingsRowSchema = z.looseObject({
  key: z.string().min(1),
  query: z.string(),
  model: z.string(),
  dims: z.number(),
  vector: embeddingBinarySchema,
  createdAt: z.number(),
});
export type CacheQueryEmbeddingsRow = {
  key: string;
  query: string;
  model: string;
  dims: number;
  vector: ArrayBuffer;
  createdAt: number;
};

/**
 * `cache_drive_previews` row (key: fileId) — a partial-fetch EPUB preview for
 * a Google Drive file: the metadata and cover extracted by ranged reads
 * WITHOUT a full download. Device-local, never synced (syncing it would grow a
 * shadow-library data model in the CRDT). The `md5Checksum` pairs with `fileId`
 * as the freshness key: a re-uploaded file keeps its id but changes md5, so a
 * row whose md5 no longer matches the index is stale and re-fetched.
 *
 * `status: 'unextractable'` IS the negative cache: a corrupt / non-standard /
 * ZIP64 EPUB that failed ranged extraction is recorded so the trickle crawler
 * does not retry the same broken file forever. `lastAccessedAt` drives LRU
 * eviction (the by_lastAccessed index). `cover` is canonically an ArrayBuffer
 * on disk (WebKit structured-clone normalization); reads re-wrap it as a Blob
 * using `coverType`.
 *
 * @public C1 row contract: parsed at the repo read boundary.
 */
export const cacheDrivePreviewRowSchema = z.looseObject({
  fileId: z.string().min(1),
  md5Checksum: z.string().optional(),
  fetchedAt: z.number(),
  lastAccessedAt: z.number(),
  status: z.union([z.literal('ok'), z.literal('unextractable')]),
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  identifiers: z.array(z.string()).optional(),
  cover: binaryValueSchema.optional(),
  coverType: z.string().optional(),
});
export type CacheDrivePreviewRow = {
  fileId: string;
  md5Checksum?: string;
  fetchedAt: number;
  lastAccessedAt: number;
  status: 'ok' | 'unextractable';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  cover?: ArrayBuffer | Blob;
  coverType?: string;
};

// ── Compile-time drift guards (see rows/static.ts for the pattern) ────────
type _MetricsSchemaMatches = z.infer<typeof cacheRenderMetricsRowSchema> extends CacheRenderMetricsRow ? true : never;
type _AudioSchemaMatches = z.infer<typeof cacheAudioBlobRowSchema> extends CacheAudioBlobRow ? true : never;
type _SessionSchemaMatches = z.infer<typeof cacheSessionStateRowSchema> extends CacheSessionStateRow ? true : never;
type _PrepSchemaMatches = z.infer<typeof cacheTtsPreparationRowSchema> extends CacheTtsPreparationRow ? true : never;
type _QueueSchemaMatches = z.infer<typeof ttsQueueItemSchema> extends TTSQueueItem ? true : never;
type _TimepointSchemaMatches = z.infer<typeof timepointSchema> extends Timepoint ? true : never;
type _SearchTextSchemaMatches = z.infer<typeof cacheSearchTextRowSchema> extends CacheSearchTextRow ? true : never;
type _EmbeddingsSchemaMatches = z.infer<typeof cacheEmbeddingsRowSchema> extends CacheEmbeddingsRow ? true : never;
type _EmbedJobsSchemaMatches = z.infer<typeof cacheEmbedJobsRowSchema> extends CacheEmbedJobsRow ? true : never;
type _QueryEmbeddingsSchemaMatches = z.infer<typeof cacheQueryEmbeddingsRowSchema> extends CacheQueryEmbeddingsRow ? true : never;
type _DrivePreviewSchemaMatches = z.infer<typeof cacheDrivePreviewRowSchema> extends CacheDrivePreviewRow ? true : never;
type _AudioRound = CacheAudioBlobRow extends CacheAudioBlob ? true : never;
type _SessionRound = CacheSessionStateRow extends CacheSessionState ? true : never;
type _PrepRound = CacheTtsPreparationRow extends CacheTtsPreparation ? true : never;
const _schemaChecks: [
  _MetricsSchemaMatches,
  _AudioSchemaMatches,
  _SessionSchemaMatches,
  _PrepSchemaMatches,
  _QueueSchemaMatches,
  _TimepointSchemaMatches,
  _SearchTextSchemaMatches,
  _EmbeddingsSchemaMatches,
  _EmbedJobsSchemaMatches,
  _QueryEmbeddingsSchemaMatches,
  _DrivePreviewSchemaMatches,
  _AudioRound,
  _SessionRound,
  _PrepRound,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void _schemaChecks;

function _rowTypeDriftGuard(
  metrics: CacheRenderMetrics,
  audio: CacheAudioBlob,
  session: CacheSessionState,
  prep: CacheTtsPreparation,
): void {
  const _metrics: CacheRenderMetricsRow = metrics;
  const _audio: CacheAudioBlobRow = audio;
  const _session: CacheSessionStateRow = session;
  const _prep: CacheTtsPreparationRow = prep;
  void _metrics; void _audio; void _session; void _prep;
}
void _rowTypeDriftGuard;
