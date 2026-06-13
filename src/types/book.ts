/**
 * Book domain types: immutable per-book data derived from the EPUB file
 * (the V18 "static" domain rows), the legacy v17 book rows kept for
 * migration/backward compatibility, and section-level content metadata.
 *
 * Extracted from types/db.ts in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1; layering-deps.md LD-1).
 * Layering rule: src/types/** imports nothing internal except other
 * src/types modules, and that graph stays acyclic.
 */
import type { AnalysisStatus } from './content-analysis';

export interface NavigationItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavigationItem[];
  parent?: string;
}

export interface PerceptualPalette {
  /** 16-bit packed integer (R4-G8-B4) for the standout color */
  standout: number;
  /** 16-bit packed integer (R4-G8-B4) for the background color */
  background: number;
  /** The CIELAB deltaE distance between the two colors */
  deltaE: number;
}

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
  /**
   * Legacy identity fingerprint: `${filename}-${title}-${author}` plus djb2
   * hashes of the first/last 4 KiB (NOT a cryptographic hash — the field
   * name predates Phase 7). Retained for restore acceptance of pre-P7
   * manifests; new identity checks prefer {@link contentHash}.
   */
  fileHash: string;
  /**
   * SHA-256 (hex) over the EPUB's content bytes only — filename-independent
   * book identity (Phase 7, phase7-library-google.md §B "identify"). Absent
   * on manifests written before P7; lazily backfilled when a legacy
   * fingerprint match succeeds during restore.
   */
  contentHash?: string;
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
  /**
   * Ghost Book metadata: Palette snapshot generated during ingestion.
   */
  coverPalette?: number[];
  /** Perceptual palette extracted via CIELAB K-Means for UI blending. */
  perceptualPalette?: PerceptualPalette;
  /** Raw dc:language from EPUB OPF metadata. Used as default for UserInventoryItem.language. */
  language?: string;
  /** The calculated base font size of the book in pixels. */
  baseFontSize?: number;
  /** The calculated base line height of the book in pixels. */
  baseLineHeight?: number;
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

// --- LEGACY TYPES (For Migration & Backward Compatibility) ---

/**
 * 1. Core Book Identity & Display Metadata.
 * Essential metadata for displaying the book in the library (including offloaded state).
 * Stored in 'books'.
 */
interface Book {
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
  /** Perceptual palette extracted via CIELAB K-Means for UI blending. */
  perceptualPalette?: PerceptualPalette;
  /** ISO 639-1 language code (e.g., 'en', 'zh'). */
  language?: string;
}

/**
 * 2. Source Metadata (Technical/File Info).
 * Metadata related to the original file and ingestion process.
 * Stored in 'book_sources'.
 */
interface BookSource {
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
  /** The calculated base font size of the book in pixels. */
  baseFontSize?: number;
  /** The calculated base line height of the book in pixels. */
  baseLineHeight?: number;
}

/**
 * 3. User State (User Generated Content/Runtime).
 * Mutable user data like progress, current location, and status.
 * Stored in 'book_states'.
 */
interface BookState {
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
  /** ISO 639-1 language code (e.g., 'en', 'zh'). */
  language?: string;
  /** Whether to use synthetic (AI enhanced) Table of Contents. */
  useSyntheticToc?: boolean;
}

/**
 * Composite type representing the full view of a book.
 * Maintains backward compatibility with the application layer.
 */
export type BookMetadata = Book & Partial<BookSource> & Partial<BookState>;

interface TableAdaptation {
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
  /** The rootCfi marking the beginning of the references section, if any. */
  referenceStartCfi?: string;
  tableAdaptations?: TableAdaptation[];
  /** Summary of the section. */
  summary?: string;
  /** Timestamp when the analysis was performed. */
  lastAnalyzed: number;
  /** Current analysis status. */
  status?: AnalysisStatus;
  /** Last error message if status is 'error'. */
  lastError?: string;
  /** Timestamp of the last attempt. */
  lastAttempt?: number;
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
  /** The title of the section (chapter name). */
  title?: string;
}
