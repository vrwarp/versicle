// type import removed
import type { Timepoint } from '../lib/tts/providers/types';

export interface NavigationItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavigationItem[];
  parent?: string;
}
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ContentType } from './content-analysis';

// --- NEW V18 ARCHITECTURE TYPES ---

// DOMAIN 1: STATIC (Immutable, Authoritative Source: File)

/**
 * Dublin Core metadata, file hashes, and immutable book properties.
 * Store: 'static_manifests' (Key: bookId)
 */
export interface StaticBookManifest {
  /** Unique identifier for the book (UUID). */
  bookId: string;
  /** The title of the book (from OPF). */
  title: string;
  /** The author(s) of the book (from OPF). */
  author: string;
  /** A short description or summary of the book. */
  description?: string;
  /** The ISBN of the book, if available. */
  isbn?: string;
  /** SHA-256 hash of the original EPUB file. */
  fileHash: string;
  /** The size of the file in bytes. */
  fileSize: number;
  /** Total number of characters in the book. */
  totalChars: number;
  /** The version of the ingestion pipeline used. */
  schemaVersion: number;
  /**
   * The binary Blob of the cover image (thumbnail).
   * Moved here to allow fast loading in library view without fetching heavy resources.
   */
  coverBlob?: Blob;
}

/**
 * Heavy binary blobs.
 * Store: 'static_resources' (Key: bookId)
 */
export interface StaticResource {
  /** The unique identifier of the book. */
  bookId: string;
  /** The original EPUB file. */
  epubBlob: Blob | ArrayBuffer;
}

/**
 * Structural information (Spine, TOC).
 * Store: 'static_structure' (Key: bookId)
 */
export interface StaticStructure {
  /** The unique identifier of the book. */
  bookId: string;
  /** Synthetic Table of Contents. */
  toc: NavigationItem[];
  /** Flattened spine items with metadata. */
  spineItems: {
    /** The href/id of the section. */
    id: string;
    /** Character count of the section. */
    characterCount: number;
    /** Play order index. */
    index: number;
  }[];
}

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
  type: 'highlight' | 'note';
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
 * Chronological reading logs.
 * Store: 'user_journey' (Key: id (Auto))
 */
export interface UserJourneyStep {
  /** Auto-incrementing ID or UUID. */
  id?: number | string;
  /** The book ID. */
  bookId: string;
  /** Start timestamp. */
  startTimestamp: number;
  /** End timestamp. */
  endTimestamp: number;
  /** Duration in seconds. */
  duration: number;
  /** The CFI range covered. */
  cfiRange: string;
  /** Type of session. */
  type: 'visual' | 'tts' | 'scroll' | 'page';
}

/**
 * AI summaries and analysis (Synced due to high compute cost).
 * Store: 'user_ai_inference' (Key: `${bookId}-${sectionId}`)
 */
export interface UserAiInference {
  /** Composite key. */
  id: string;
  bookId: string;
  sectionId: string;
  /** Detected content types. */
  semanticMap: {
    rootCfi: string;
    type: ContentType;
  }[];
  /** Accessibility layers (e.g. Table Adaptations). */
  accessibilityLayers: {
    type: 'table-adaptation' | 'image-description';
    rootCfi: string;
    content: string;
  }[];
  /** Section summary. */
  summary?: string;
  /** Extracted structure (footnotes, etc). */
  structure?: {
    title?: string;
    footnoteMatches: string[];
  };
  /** Generation timestamp. */
  generatedAt: number;
}

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
  /** Alignment data. */
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
  /** The index of the section this queue belongs to. */
  sectionIndex?: number;
  /** Last pause timestamp. */
  lastPauseTime?: number;
  /** Update timestamp. */
  updatedAt: number;
}

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

// --- LEGACY TYPES (For Migration & Backward Compatibility) ---

/**
 * 1. Core Book Identity & Display Metadata.
 * Essential metadata for displaying the book in the library (including offloaded state).
 * Stored in 'books'.
 */
export interface Book {
  /** Unique identifier for the book (UUID). */
  id: string;
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
   * Stored in IndexedDB (books store).
   */
  coverBlob?: Blob;
  /** Timestamp when the book was added to the library. */
  addedAt: number;
  /**
   * 5 integers representing the cover regions (TL, TR, BL, BR, Center).
   */
  coverPalette?: number[];
}

/**
 * 2. Source Metadata (Technical/File Info).
 * Metadata related to the original file and ingestion process.
 * Stored in 'book_sources'.
 */
export interface BookSource {
  /** The unique identifier of the book (FK). */
  bookId: string;
  /** The original filename of the EPUB file. */
  filename?: string;
  /** SHA-256 hash of the original EPUB file, used for verification during restore. */
  fileHash?: string;
  /** The size of the file in bytes. */
  fileSize?: number;
  /** Total number of characters in the book, used for duration estimation. */
  totalChars?: number;
  /** Synthetic Table of Contents generated during ingestion. */
  syntheticToc?: NavigationItem[];
  /**
   * The version of the ingestion pipeline used for this book.
   * Used to trigger reprocessing when the pipeline is updated.
   */
  version?: number;
}

/**
 * 3. User State (User Generated Content/Runtime).
 * Mutable user data like progress, current location, and status.
 * Stored in 'book_states'.
 */
export interface BookState {
  /** The unique identifier of the book (FK). */
  bookId: string;
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
  /** Whether the binary file content has been deleted to save space. */
  isOffloaded?: boolean;
  /** Status of AI analysis for the book. */
  aiAnalysisStatus?: 'none' | 'partial' | 'complete';
}

/**
 * Composite type representing the full view of a book.
 * Maintains backward compatibility with the application layer.
 */
export type BookMetadata = Book & Partial<BookSource> & Partial<BookState>;

export interface TableAdaptation {
  rootCfi: string; // The EPUB CFI key for the table block
  text: string;    // The generated spoken-word adaptation
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
  /** Detected content types for sections (CFI -> Type). */
  contentTypes?: {
    rootCfi: string;
    type: ContentType;
  }[];
  tableAdaptations?: TableAdaptation[];
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
  /** The index of the current section in the playlist. */
  sectionIndex?: number;
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
  /**
   * If true, this book-specific rule is applied BEFORE global rules.
   * If false or undefined, it is applied AFTER global rules.
   * Only applicable if bookId is set.
   */
  applyBeforeGlobal?: boolean;
  /** Explicit order of the rule. Lower numbers run first. */
  order?: number;
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
  /** Timestamp of the event. */
  timestamp: number;
  /** The source of the reading event. */
  type: ReadingEventType;
  /**
   * Contextual label for the event.
   * - TTS: The text of the sentence (e.g., "Call me Ishmael.")
   * - Page/Scroll: The chapter title or progress (e.g., "Chapter 1 - 15%")
   */
  label?: string;
  /** Duration of the session in seconds. */
  duration?: number;
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
  /** The snapshot data. */
  manifest: SyncManifest;
  /** What triggered this checkpoint (e.g., 'pre-sync', 'manual'). */
  trigger: string;
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
