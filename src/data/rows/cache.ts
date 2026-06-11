/**
 * Row schemas for the CACHE domain stores (`cache_render_metrics`,
 * `cache_audio_blobs`, `cache_session_state`, `cache_tts_preparation`,
 * `cache_table_images`) — Phase 3, D4 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * See rows/static.ts for the shared posture (loose envelope, strict
 * required keys, `z.custom` binaries, ingress-only validation).
 */
import { z } from 'zod';
import type {
  CacheAudioBlob,
  CacheRenderMetrics,
  CacheSessionState,
  CacheTtsPreparation,
} from '~types/cache';
import type { TTSQueueItem, Timepoint } from '~types/tts';
import { binaryValueSchema } from './static';

/** `cache_render_metrics` row (key: bookId). */
export const cacheRenderMetricsRowSchema = z.looseObject({
  bookId: z.string().min(1),
  locations: z.string(),
  pageCount: z.number().optional(),
});
export type CacheRenderMetricsRow = z.infer<typeof cacheRenderMetricsRowSchema>;

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
export type CacheAudioBlobRow = z.infer<typeof cacheAudioBlobRowSchema>;

/** The persisted TTS playback queue item (embedded in `cache_session_state`). */
export const ttsQueueItemSchema = z.looseObject({
  text: z.string(),
  cfi: z.string().nullable(),
  title: z.string().optional(),
  isPreroll: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  sourceIndices: z.array(z.number()).optional(),
});
export type TtsQueueItemRow = z.infer<typeof ttsQueueItemSchema>;

/** `cache_session_state` row (key: bookId). */
export const cacheSessionStateRowSchema = z.looseObject({
  bookId: z.string().min(1),
  playbackQueue: z.array(ttsQueueItemSchema),
  lastPauseTime: z.number().optional(),
  updatedAt: z.number(),
});
export type CacheSessionStateRow = z.infer<typeof cacheSessionStateRowSchema>;

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
export type CacheTtsPreparationRow = z.infer<typeof cacheTtsPreparationRowSchema>;

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
export type TableImageRow = z.infer<typeof tableImageRowSchema>;

// ── Compile-time drift guards against ~types/cache + ~types/tts ───────────
// See rows/static.ts for why spread assignments are used for the
// interface → row direction. The row → interface direction uses plain
// conditional types where it must hold (the repos hand rows straight to
// consumers typed against the ~types interfaces).
function _rowTypeDriftGuard(
  metrics: CacheRenderMetrics,
  audio: CacheAudioBlob,
  queueItem: TTSQueueItem,
  session: CacheSessionState,
  prep: CacheTtsPreparation,
  timepoint: Timepoint,
): void {
  const _metrics: CacheRenderMetricsRow = { ...metrics };
  const _audio: CacheAudioBlobRow = {
    ...audio,
    alignment: audio.alignment?.map((t) => ({ ...t })),
    alignmentData: audio.alignmentData?.map((t) => ({ ...t })),
  };
  const _queueItem: TtsQueueItemRow = { ...queueItem };
  const _session: CacheSessionStateRow = { ...session, playbackQueue: [...session.playbackQueue.map((q) => ({ ...q }))] };
  const _prep: CacheTtsPreparationRow = {
    ...prep,
    sentences: prep.sentences.map((s) => ({ ...s })),
    citationMarkers: prep.citationMarkers?.map((c) => ({ ...c })),
  };
  const _timepoint: z.infer<typeof timepointSchema> = { ...timepoint };
  void _metrics; void _audio; void _queueItem; void _session; void _prep; void _timepoint;
}
void _rowTypeDriftGuard;
type _AudioRound = CacheAudioBlobRow extends CacheAudioBlob ? true : never;
type _QueueRound = TtsQueueItemRow extends TTSQueueItem ? true : never;
type _SessionRound = CacheSessionStateRow extends CacheSessionState ? true : never;
const _roundChecks: [_AudioRound, _QueueRound, _SessionRound] = [true, true, true];
void _roundChecks;
