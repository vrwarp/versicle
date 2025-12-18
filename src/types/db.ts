import type { Timepoint } from '../lib/tts/providers/types';
import type { NavigationItem } from 'epubjs';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';

/**
 * Metadata for a book stored in the library.
 */
export interface BookMetadata {
  /** Unique identifier for the book (UUID). */
  id: string;
  /** The original filename of the EPUB file. */
  filename?: string;
  /** The title of the book. */
  title: string;
  /** The author(s) of the book. */
  author: string;
  /** A short description or summary of the book. */
  description?: string;
  /**
   * Ephemeral Blob URL for the cover image.
   * Created during runtime for display, revoked when not needed.
   */
  coverUrl?: string;
  /**
   * The binary Blob of the cover image.
   * Stored in IndexedDB.
   */
  coverBlob?: Blob;
  /** Timestamp when the book was added to the library. */
  addedAt: number;
  /** Timestamp when the book was last opened. */
  lastRead?: number;
  /** Reading progress as a percentage (0.0 to 1.0). */
  progress?: number;
  /** The Canonical Fragment Identifier (CFI) of the last read position. */
  currentCfi?: string;
  /** The CFI of the last spoken sentence during TTS playback. */
  lastPlayedCfi?: string;
  /** Timestamp when TTS playback was last paused, for smart resume. */
  lastPauseTime?: number;
  /** SHA-256 hash of the original EPUB file, used for verification during restore. */
  fileHash?: string;
  /** Whether the binary file content has been deleted to save space. */
  isOffloaded?: boolean;
  /** The size of the file in bytes. */
  fileSize?: number;
  /** Synthetic Table of Contents generated during ingestion. */
  syntheticToc?: NavigationItem[];
  /** Total number of characters in the book, used for duration estimation. */
  totalChars?: number;
  /** Status of AI analysis for the book. */
  aiAnalysisStatus?: 'none' | 'partial' | 'complete';
}

/**
 * Result of AI analysis for a section.
 */
export interface ContentAnalysis {
  /** Composite key (bookId-sectionId). */
  id: string;
  /** The ID of the book. */
  bookId: string;
  /** The section ID. */
  sectionId: string;
  /** Extracted structure information. */
  structure: {
    title?: string;
    footnoteMatches: string[];
  };
  /** Summary of the section. */
  summary?: string;
  /** Timestamp when the analysis was performed. */
  lastAnalyzed: number;
}

/**
 * Metadata for a section (chapter) of a book.
 */
export interface SectionMetadata {
  /** Composite key or unique ID (e.g., bookId + sectionId). */
  id: string;
  /** The ID of the book this section belongs to. */
  bookId: string;
  /** The href/id of the section as defined in the EPUB. */
  sectionId: string;
  /** The number of characters in this section. */
  characterCount: number;
  /** The order of the section in the book. */
  playOrder: number;
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
  type: 'highlight' | 'note';
  /** The color code (e.g., hex) for the highlight. */
  color: string;
  /** Optional user-written note associated with the highlight. */
  note?: string;
  /** Timestamp when the annotation was created. */
  created: number;
}

/**
 * Cached location data for a book to speed up loading.
 */
export interface BookLocations {
  /** The ID of the book. */
  bookId: string;
  /** JSON string representing the epub.js location mapping. */
  locations: string;
}

/**
 * A cached audio segment for TTS.
 */
export interface CachedSegment {
  /** SHA-256 hash key generated from text, voice, and settings. */
  key: string;
  /** The raw audio data. */
  audio: ArrayBuffer;
  /** Optional alignment data for synchronizing text highlighting. */
  alignment?: Timepoint[];
  /** Timestamp when the cache entry was created. */
  createdAt: number;
  /** Timestamp when the cache entry was last accessed (for LRU eviction). */
  lastAccessed: number;
}

/**
 * Persisted TTS state for session restoration.
 */
export interface TTSState {
  /** The book ID this state belongs to. */
  bookId: string;
  /** The current playback queue. */
  queue: TTSQueueItem[];
  /** The current index in the queue. */
  currentIndex: number;
  /** Timestamp of last update. */
  updatedAt: number;
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
  /** Optional ID of a specific book. If null/undefined, the rule is global. */
  bookId?: string;
  /** Explicit order of the rule. Lower numbers run first. */
  order?: number;
  /** Timestamp when the rule was created. */
  created: number;
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
  /** Timestamp when the history was last updated. */
  lastUpdated: number;
}

/**
 * Represents an entry in the reading list (lightweight, portable history).
 */
export interface ReadingListEntry {
  /** The filename of the book (Primary Key). */
  filename: string;
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
