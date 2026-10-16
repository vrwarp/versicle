/**
 * Book domain types: immutable per-book data derived from the EPUB file
 * (the "static" domain rows), the merged {@link BookMetadata} view the app
 * layer consumes, and section-level content metadata.
 *
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
  /**
   * Set when the entry's href does not land in the spine (missing file, or
   * a document epub.js cannot display). The TOC renders it greyed out.
   */
  unresolved?: boolean;
}

export interface PerceptualPalette {
  /** 16-bit packed integer (R4-G8-B4) for the standout color */
  standout: number;
  /** 16-bit packed integer (R4-G8-B4) for the background color */
  background: number;
  /** The CIELAB deltaE distance between the two colors */
  deltaE: number;
}

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
   * hashes of the first/last 4 KiB (NOT a cryptographic hash despite the
   * field name). Retained for restore acceptance of manifests that predate
   * {@link contentHash}; new identity checks prefer {@link contentHash}.
   */
  fileHash: string;
  /**
   * SHA-256 (hex) over the EPUB's content bytes only — filename-independent
   * book identity. Absent on manifests written before it existed; lazily
   * backfilled when a legacy fingerprint match succeeds during restore.
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
   * Lives on the manifest rather than with the heavy blobs in {@link StaticResource},
   * so the library view loads fast without fetching heavy resources.
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

// --- BOOK METADATA VIEW (composed into BookMetadata below) ---

/**
 * 1. Core Book Identity & Display Metadata.
 * Essential metadata for displaying the book in the library (including offloaded state).
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
   * The binary Blob of the cover image (sourced from
   * {@link StaticBookManifest.coverBlob}).
   *
   * perf: merged metadata OMITS this while the page is service-worker
   * controlled — the SW serves every cover straight from IndexedDB, so
   * materializing N thumbnails into the projection only pinned them for the
   * life of the tab. Use {@link hasCover} to decide whether a cover EXISTS.
   */
  coverBlob?: Blob;
  /**
   * Whether a cover image exists for this book, independent of whether
   * {@link coverBlob} was materialized. Additive and optional: readers that
   * predate it fall back to `coverBlob instanceof Blob`.
   */
  hasCover?: boolean;
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
 */
interface BookSource {
  /** The unique identifier of the book (FK). */
  bookId: string;
  /** The original filename of the EPUB file. */
  filename?: string;
  /** Legacy identity fingerprint ({@link StaticBookManifest.fileHash}), used for verification during restore. */
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
 * Composite type representing the full view of a book: display metadata,
 * source/ingestion info and mutable reading state in one object.
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
