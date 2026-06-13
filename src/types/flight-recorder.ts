/**
 * Flight-recorder (diagnostics) types: the lightweight event shape recorded
 * on the playback hot path and the persisted ring-buffer snapshots.
 *
 * Extracted from types/db.ts in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1; layering-deps.md LD-1).
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */

/**
 * Valid event sources for the flight recorder subsystem.
 */
export type FlightEventSource = 'APS' | 'PSM' | 'CAP' | 'TSQ' | 'TTS' | 'PLT';

/**
 * A single atomic event recorded by the flight recorder.
 *
 * Events are designed to be extremely lightweight to minimize overhead
 * on the playback hot path.
 */
export interface FlightEvent {
  /** Sequential identifier to ensure ordering even with identical timestamps. */
  seq: number;
  /** Monotonic performance timestamp (ms) for high-precision relative timing. */
  ts: number;
  /** Wall-clock timestamp (Unix ms) for human-readable correlation. */
  wall: number;
  /** The subsystem that generated the event. */
  src: FlightEventSource;
  /** The specific event name (e.g., 'play', 'pause', 'handoff'). */
  ev: string;
  /**
   * Optional payload of primitive values.
   * Values are truncated if they exceed MAX_STRING_LEN in the recorder.
   */
  d?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * A persistent snapshot of the TTS flight recorder's ring buffer.
 *
 * Snapshots are immutable records of a specific window of playback events,
 * captured either manually by the user or automatically when an anomaly
 * (like a premature chapter advance) is detected. They are stored in
 * IndexedDB ('flight_snapshots') and survive app restarts to allow for
 * post-mortem debugging of intermittent issues.
 */
export interface FlightSnapshot {
  /** Unique identifier for this recording, used as the primary key in IndexedDB. */
  id: string;
  /**
   * Wall-clock timestamp (Unix ms) when the snapshot was frozen.
   * Used for sorting snapshots in the UI.
   */
  createdAt: number;
  /**
   * The specific condition that caused this recording.
   * - 'manual': Triggered by the user from the Diagnostics UI.
   * - 'anomaly:chapter_advance': Auto-triggered by PlaybackStateManager detection.
   */
  trigger: string;
  /**
   * Optional description of the circumstances.
   * For manual snapshots, this might contain user-provided feedback.
   */
  note: string;
  /**
   * A snapshot of the internal state of the AudioPlayerService at the moment
   * of capture. This provides high-level context for the lower-level events
   * stored in eventsJSON.
   */
  context: {
    /** The book currently being played. */
    bookId: string | null;
    /** The 0-indexed section within the playlist. */
    sectionIndex: number;
    /** The current utterance index within the active queue. */
    currentIndex: number;
    /** The total number of utterances in the loaded section. */
    queueLength: number;
    /** The high-level player status (playing, paused, loading, etc.). */
    status: string;
    /** Number of items in the queue with isSkipped=true. */
    skippedCount?: number;
    /** Whether the item immediately after currentIndex is skipped. */
    nextItemSkipped?: boolean | undefined;
  };
  /**
   * The number of FlightEvent objects contained in the snapshot.
   * Useful for showing the 'density' of the recording in the UI.
   */
  eventCount: number;
  /**
   * The absolute time window covered by the events in this snapshot.
   * - first: wall-clock time of the oldest event.
   * - last: wall-clock time of the newest event (typically close to createdAt).
   */
  timeRange: { first: number; last: number };
  /**
   * The full payload of captured events, serialized to JSON.
   * We store this as a string to simplify IndexedDB interaction and
   * because it is rarely read (only during export/share).
   */
  eventsJSON: string;
  /**
   * Approximate disk space occupied by this snapshot in bytes.
   * Used to help the user manage their diagnostic storage.
   */
  sizeBytes: number;
}
