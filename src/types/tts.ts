/**
 * TTS domain types: the canonical playback queue-item and audio-alignment
 * shapes, plus the persisted TTS position row.
 *
 * This module is the canonical home of {@link TTSQueueItem} and
 * {@link Timepoint}; defining them here (not in lib/tts) keeps the types
 * layer from importing upward into lib/tts
 * (plan/overhaul/analysis/layering-deps.md LD-1). lib/tts/providers/types.ts
 * re-exports {@link Timepoint} for its consumers.
 *
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

