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
export type BookLocationsRow = z.infer<typeof bookLocationsRowSchema>;

export const timepointSchema = z.looseObject({
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
export const ttsQueueItemSchema = z.looseObject({
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

export const citationMarkerSchema = z.looseObject({
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

// ── Compile-time drift guards (see rows/static.ts for the pattern) ────────
type _MetricsSchemaMatches = z.infer<typeof cacheRenderMetricsRowSchema> extends CacheRenderMetricsRow ? true : never;
type _AudioSchemaMatches = z.infer<typeof cacheAudioBlobRowSchema> extends CacheAudioBlobRow ? true : never;
type _SessionSchemaMatches = z.infer<typeof cacheSessionStateRowSchema> extends CacheSessionStateRow ? true : never;
type _PrepSchemaMatches = z.infer<typeof cacheTtsPreparationRowSchema> extends CacheTtsPreparationRow ? true : never;
type _QueueSchemaMatches = z.infer<typeof ttsQueueItemSchema> extends TTSQueueItem ? true : never;
type _TimepointSchemaMatches = z.infer<typeof timepointSchema> extends Timepoint ? true : never;
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
  _AudioRound,
  _SessionRound,
  _PrepRound,
] = [true, true, true, true, true, true, true, true, true];
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
