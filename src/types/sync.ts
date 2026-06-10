/**
 * Sync domain types: the serialized manifest wire shape, local recovery
 * checkpoints, and the sync log row.
 *
 * Extracted from types/db.ts in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1; layering-deps.md LD-1).
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */
import type { BookMetadata, ContentAnalysis } from './book';
import type { Annotation, LexiconRule, ReadingHistoryEntry, ReadingListEntry } from './user-data';
import type { TTSPosition } from './tts';

/**
 * The "Moral Layer" of the Library.
 * A serialized, optimized projection designed for efficient merging.
 */
export interface SyncManifest {
  /** Schema version to handle forward/backward compatibility. */
  version: number;
  /** Global UTC timestamp (ms) representing the last authoritative write. */
  lastUpdated: number;
  /** Unique ID of the device that last modified the manifest. */
  deviceId: string;

  /**
   * The "Moral Layer" of the Library.
   */
  books: {
    [bookId: string]: {
      /** Synchronized via Last-Write-Wins (LWW). */
      metadata: Partial<BookMetadata>;
      /** Merged via CFI Range Union. */
      history: ReadingHistoryEntry;
      /** Merged as a unique set. */
      annotations: Annotation[];
      /** Synced AI analysis. */
      aiInference?: ContentAnalysis[];
    };
  };

  /** Global pronunciation rules and custom abbreviations. */
  lexicon: LexiconRule[];
  /** Current reading queue and priority states. */
  readingList: Record<string, ReadingListEntry>;

  /**
   * App settings (theme, fonts, etc).
   * Persisted via LWW.
   */
  settings?: {
    theme?: string;
    customTheme?: { bg: string; fg: string };
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    shouldForceFont?: boolean;
    readerViewMode?: string;
    libraryLayout?: string;
  };

  /** High-frequency "Handoff" state. */
  transientState: {
    ttsPositions: Record<string, TTSPosition>;
  };

  /** Registry used to display "Last Synced" status per device. */
  deviceRegistry: {
    [deviceId: string]: {
      name: string;
      lastSeen: number;
    };
  };
}

/**
 * A local snapshot of the SyncManifest for recovery.
 */
export interface SyncCheckpoint {
  /** Auto-incrementing ID. */
  id: number;
  /** Timestamp when the checkpoint was created. */
  timestamp: number;
  /** The snapshot data (Yjs binary state vector). */
  blob: Uint8Array;
  /** Size in KB (metadata for UI). */
  size: number;
  /** What triggered this checkpoint (e.g., 'pre-sync', 'manual'). */
  trigger: string;
  /**
   * When true, the rolling prune never deletes this checkpoint.
   * Used to pin the pre-migration backup of an in-flight workspace switch
   * so it cannot be rotated out before the migration state machine resolves.
   * Optional/additive: records persisted before this field exist without it
   * and are treated as unprotected. Only the latest protected checkpoint is
   * kept pinned (creating a new protected checkpoint unprotects older ones).
   */
  protected?: boolean;
}

/**
 * Log entry for synchronization events.
 */
export interface SyncLogEntry {
  /** Auto-incrementing ID. */
  id: number;
  /** Timestamp of the log entry. */
  timestamp: number;
  /** Severity level. */
  level: 'info' | 'warn' | 'error';
  /** Log message. */
  message: string;
  /** Optional details or error object. */
  details?: unknown;
}
