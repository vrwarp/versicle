/**
 * TTS domain types: the canonical playback queue-item and audio-alignment
 * shapes, plus the persisted TTS session/position/content rows.
 *
 * This module is the canonical home of {@link TTSQueueItem} (formerly
 * defined in lib/tts/AudioPlayerService.ts) and {@link Timepoint} (formerly
 * defined in lib/tts/providers/types.ts). Those modules re-export them for
 * their existing consumers; defining them here breaks the types→lib/tts
 * dependency inversion (plan/overhaul/analysis/layering-deps.md LD-1).
 *
 * Extracted from types/db.ts in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1).
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */

/**
 * Represents a specific point in time within the synthesized audio.
 */
export interface Timepoint {
  /** Time in seconds from the start of the audio. */
  timeSeconds: number;
  /** Index of the character in the text corresponding to this time. */
  charIndex: number;
  /** The type of timepoint ('word', 'sentence', or 'mark'). */
  type?: string;
}

/**
 * Represents a single item in the TTS playback queue.
 */
export interface TTSQueueItem {
  /** The text content to be spoken. */
  text: string;
  /** The Canonical Fragment Identifier (CFI) for the location in the book. */
  cfi: string | null;
  /** Optional chapter title (displayed as the track title). */
  title?: string;
  /** Indicates if this item is a pre-roll announcement. */
  isPreroll?: boolean;
  /** Indicates if this item should be skipped during playback. */
  isSkipped?: boolean;
  /** The indices of the raw source sentences that make up this item. */
  sourceIndices?: number[];
}

/**
 * Persisted TTS state for session restoration.
 */
export interface TTSState {
  /** The book ID this state belongs to. */
  bookId: string;
  /** The current playback queue. */
  queue: TTSQueueItem[];
  /** Timestamp of last update. */
  updatedAt: number;
}

/**
 * Lightweight persisted TTS position for frequent updates.
 */
export interface TTSPosition {
  /** The book ID this position belongs to. */
  bookId: string;
  /** The current index in the queue. */
  currentIndex: number;
  /** The index of the current section in the playlist. */
  sectionIndex?: number;
  /** Timestamp of last update. */
  updatedAt: number;
}

/**
 * Pre-extracted text content for TTS, allowing playback without rendering.
 */
export interface TTSContent {
  /** Composite key: `${bookId}-${sectionId}` */
  id: string;

  /** Foreign key to Books store */
  bookId: string;

  /** The href/id of the spine item (e.g., "text/chapter01.xhtml") */
  sectionId: string;

  /** Ordered list of sentences for this section */
  sentences: {
    /** The raw or sanitized text to speak */
    text: string;

    /** * The CFI range for highlighting.
     * Generated during ingestion relative to the root of the spine item.
     */
    cfi: string;
  }[];
}
