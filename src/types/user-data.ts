/**
 * User-data domain types: mutable, user-authored state (the V18 "user"
 * domain rows synced via Yjs), reading history/session shapes, lexicon
 * rules, and the legacy annotation/reading-list rows.
 *
 * Extracted from types/db.ts in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1; layering-deps.md LD-1).
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */
import type { PerceptualPalette } from './book';

// DOMAIN 2: USER (Mutable, Authoritative Source: User/Sync)

/**
 * Existence of book in library and user-customizable metadata.
 * Store: 'user_inventory' (Key: bookId)
 *
 * Note: In Phase 2+ (Yjs migration), this is synced via zustand-middleware-yjs.
 * The title and author fields are "Ghost Book" metadata snapshots that allow
 * displaying books on devices that have synced inventory but not the actual
 * EPUB file from static_resources.
 */
export interface UserInventoryItem {
  /** The unique identifier of the book. */
  bookId: string;

  /**
   * Ghost Book metadata: Title snapshot from static manifest.
   * Synced to Yjs to enable cross-device display without the EPUB file.
   */
  title: string;

  /**
   * Ghost Book metadata: Author snapshot from static manifest.
   * Synced to Yjs to enable cross-device display without the EPUB file.
   */
  author: string;

  /** Timestamp when the user added the book. */
  addedAt: number;
  /** Timestamp of last user interaction. */
  lastInteraction: number;
  /** Original filename (for reference/export). */
  sourceFilename?: string;
  /** User-defined tags. */
  tags: string[];
  /** Custom title override. */
  customTitle?: string;
  /** Custom author override. */
  customAuthor?: string;
  /** Reading status. */
  status: 'unread' | 'reading' | 'completed' | 'abandoned';
  /** User rating (1-5). */
  rating?: number;
  /**
   * Ghost Book metadata: Palette snapshot generated during ingestion.
   * Synced to Yjs to enable gradient cover display without the EPUB file.
   * Format: 5x 16-bit integers (R4-G8-B4).
   * Layout: [TL, TR, BL, BR, Center]
   */
  coverPalette?: number[];
  /** Perceptual palette extracted via CIELAB K-Means for UI blending. */
  perceptualPalette?: PerceptualPalette;
  /** ISO 639-1 language code (e.g., 'en', 'zh'). Defaults to 'en'. */
  language?: string;
  /** Whether to use synthetic (AI enhanced) Table of Contents. */
  useSyntheticToc?: boolean;
}

/**
 * The "Bookmark" and progress state.
 * Store: 'user_progress' (Key: bookId)
 */
export interface UserProgress {
  /** The unique identifier of the book. */
  bookId: string;
  /** Reading progress as a percentage (0.0 to 1.0). */
  percentage: number;
  /** The current visual CFI position. */
  currentCfi?: string;
  /** The last spoken CFI (for TTS resume). */
  lastPlayedCfi?: string;
  /** Index of the current item in the playback queue. */
  currentQueueIndex?: number;
  /** Index of the current section. */
  currentSectionIndex?: number;
  /** Timestamp when the book was last read. */
  lastRead: number;
  /** Set of completed/read CFI ranges. */
  completedRanges: string[];
  /** Chronological reading sessions with metadata (type, timestamp, label). */
  readingSessions?: ReadingSession[];
}

/**
 * Highlights and notes.
 * Store: 'user_annotations' (Key: id)
 */
export interface UserAnnotation {
  /** Unique identifier (UUID). */
  id: string;
  /** The book ID. */
  bookId: string;
  /** The CFI range of the annotation. */
  cfiRange: string;
  /** The selected text. */
  text: string;
  /** Type of annotation. */
  type: 'highlight' | 'note' | 'audio-bookmark';
  /** Color code. */
  color: string;
  /** User note. */
  note?: string;
  /** Creation timestamp. */
  created: number;
}

/**
 * Book-specific settings and rules.
 * Store: 'user_overrides' (Key: bookId | 'global')
 */
export interface UserOverrides {
  /** The book ID or 'global'. */
  bookId: string;
  /** Lexicon/Pronunciation rules. */
  lexicon: {
    id: string;
    original: string;
    replacement: string;
    isRegex?: boolean;
    matchType?: 'ignore_case' | 'match_case' | 'regex';
    applyBeforeGlobal?: boolean;
    created: number;
  }[];
  /** Lexicon configuration. */
  lexiconConfig?: {
    applyBefore: boolean;
  };
  /** Per-book settings (font, theme overrides, etc - future proofing). */
  settings?: Record<string, unknown>;
}

/**
 * Represents a user annotation (highlight or note) within a book.
 */
export interface Annotation {
  /** Unique identifier for the annotation. */
  id: string;
  /** The ID of the book this annotation belongs to. */
  bookId: string;
  /** The CFI range identifying the selected text. */
  cfiRange: string;
  /** The actual text content that was selected. */
  text: string;
  /** The type of annotation. */
  type: 'highlight' | 'note' | 'audio-bookmark';
  /** The color code (e.g., hex) for the highlight. */
  color: string;
  /** Optional user-written note associated with the highlight. */
  note?: string;
  /** Timestamp when the annotation was created. */
  created: number;
}

/**
 * A pronunciation rule for the TTS engine.
 */
export interface LexiconRule {
  /** Unique identifier for the rule. */
  id: string;
  /** The original text or regex pattern to match. */
  original: string;
  /** The replacement text (pronunciation). */
  replacement: string;
  /** If true, 'original' is treated as a regular expression. */
  isRegex?: boolean;
  /** The type of matching to perform. Replaces isRegex. */
  matchType?: 'ignore_case' | 'match_case' | 'regex';
  /** Optional ID of a specific book. If null/undefined, the rule is global. */
  bookId?: string;
  /**
   * If true, this book-specific rule is applied BEFORE global rules.
   * If false or undefined, it is applied AFTER global rules.
   * Only applicable if bookId is set.
   */
  applyBeforeGlobal?: boolean;
  /** Explicit order of the rule. Lower numbers run first. */
  order?: number;
  /** ISO 639-1 language code this rule applies to. If undefined, applies to all languages. */
  language?: string;
  /** Timestamp when the rule was created. */
  created: number;
}

export type ReadingEventType = 'tts' | 'scroll' | 'page';

/**
 * Represents the reading history of a book.
 */
export interface ReadingSession {
  /** The snapped CFI range associated with this event. */
  cfiRange: string;
  /** Array of structural CFI ranges (continuous or distinct) in this session. */
  cfiRanges?: string[];
  /** Start timestamp of the event. */
  startTime: number;
  /** End timestamp of the event. */
  endTime: number;
  /** The source of the reading event. */
  type: ReadingEventType;
  /**
   * Contextual label for the event.
   * - TTS: The text of the sentence (e.g., "Call me Ishmael.")
   * - Page/Scroll: The chapter title or progress (e.g., "Chapter 1 - 15%")
   */
  label?: string;
}

/**
 * Represents the reading history of a book.
 */
export interface ReadingHistoryEntry {
  /** The ID of the book. */
  bookId: string;
  /**
   * A list of combined CFI ranges representing read content.
   */
  readRanges: string[];
  /** A list of individual reading sessions (chronological). */
  sessions: ReadingSession[];
  /** Timestamp when the history was last updated. */
  lastUpdated: number;
}

/**
 * Represents an entry in the reading list (lightweight, portable history).
 */
export interface ReadingListEntry {
  /** The filename of the book (Primary Key). */
  filename: string;
  /**
   * FK to the library inventory (`UserInventoryItem.bookId`) — Phase 7 §D.
   * ADDITIVE + OPTIONAL: written at import/registration time for new
   * entries; existing entries are linked by the one-time linker
   * (`src/app/migrations.linkReadingList.ts`), which is authored but NOT
   * yet registered — the CRDT version bump that protects it from old
   * clients (whole-entry rebuilds drop unknown fields,
   * useReadingListStore.ts) lands post-merge as the next migration step.
   * INTERNAL: excluded from CSV export (filename stays the portable key).
   */
  bookId?: string;
  /** The title of the book. */
  title: string;
  /** The author(s) of the book. */
  author: string;
  /** The ISBN of the book, if available. */
  isbn?: string;
  /** Reading progress as a percentage (0.0 to 1.0). */
  percentage: number;
  /** Timestamp when the entry was last updated. */
  lastUpdated: number;
  /** Reading status derived from percentage or set by user. */
  status?: 'read' | 'currently-reading' | 'to-read';
  /** User rating (1-5). */
  rating?: number;
}
