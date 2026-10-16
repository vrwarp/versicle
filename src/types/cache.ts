/**
 * Cache domain types: transient, disposable rows (the V18 "cache" domain)
 * — render metrics, synthesized-audio blobs, session state, TTS sentence
 * preparation, table snapshots — plus the per-book locations view.
 *
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */
import type { Timepoint, TTSQueueItem } from './tts';

// DOMAIN 3: CACHE (Transient, Disposable)

/**
 * Epub.js locations and metrics.
 * Store: 'cache_render_metrics' (Key: bookId)
 */
export interface CacheRenderMetrics {
  /** The book ID. */
  bookId: string;
  /** Locations JSON string. */
  locations: string;
  /** Page count estimation. */
  pageCount?: number;
}

/**
 * Synthesized audio files.
 * Store: 'cache_audio_blobs' (Key: hash)
 */
export interface CacheAudioBlob {
  /** SHA-256 hash key. */
  key: string;
  /** Audio data. */
  audio: ArrayBuffer;
  /** Alignment/timepoint data (canonical field, matches the provider-side name). */
  alignment?: Timepoint[];
  /**
   * Legacy field name for alignment data written by older builds.
   * Read-shim only: `audioCache.getCachedSegment` (src/data/repos/audioCache.ts)
   * normalizes it onto `alignment`; new rows never write it.
   */
  alignmentData?: Timepoint[];
  /** Creation timestamp. */
  createdAt: number;
  /** Last access timestamp for LRU. */
  lastAccessed: number;
}

/**
 * Transient UI state (queue, active table snapshots).
 * Store: 'cache_session_state' (Key: bookId)
 */
export interface CacheSessionState {
  /** The book ID. */
  bookId: string;
  /** The active playback queue. */
  playbackQueue: TTSQueueItem[];
  /** Last pause timestamp. */
  lastPauseTime?: number;
  /** Update timestamp. */
  updatedAt: number;
}

// The canonical CitationMarker lives in ./tts-content (the extraction/engine
// consumption types live together); re-exported here so the cache-row surface
// keeps serving it.
export type { CitationMarker } from './tts-content';
import type { CitationMarker } from './tts-content';

/**
 * Extracted/sanitized sentences for TTS.
 * Store: 'cache_tts_preparation' (Key: `${bookId}-${sectionId}`)
 */
export interface CacheTtsPreparation {
  /** Composite key. */
  id: string;
  bookId: string;
  sectionId: string;
  /** Extracted sentences. */
  sentences: {
    text: string;
    cfi: string;
  }[];
  /** Citation markers detected during extraction (superscripts, symbol footnotes). */
  citationMarkers?: CitationMarker[];
  /**
   * Version of the sentence-extraction algorithm that produced this row
   * (`TTS_EXTRACTION_VERSION` in `lib/ingestion/sentence-extraction.ts`).
   * Absent on rows written before the NFKD/CFI offset fix (extraction v2) —
   * those rows may carry drifted CFIs for non-ASCII text and are candidates
   * for background re-extraction.
   */
  extractionVersion?: number;
}

/**
 * Represents a snapped image of a table.
 * Store: 'cache_table_images' (Key: `${bookId}-${cfi}`)
 */
export interface TableImage {
  /** Unique identifier: `${bookId}-${cfi}` */
  id: string;
  /** The ID of the book. */
  bookId: string;
  /** The section ID (href) where the table is located. */
  sectionId: string;
  /** The CFI of the table element. */
  cfi: string;
  /** The webp image blob. */
  imageBlob: Blob;
}

/**
 * Cached location data for a book to speed up loading (the `locations`
 * field of a `cache_render_metrics` row).
 */
export interface BookLocations {
  /** The ID of the book. */
  bookId: string;
  /** JSON string representing the epub.js location mapping. */
  locations: string;
}
