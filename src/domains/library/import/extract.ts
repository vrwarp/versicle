/**
 * `extractBook` — the ONE extraction pipeline (Phase 7 PR-L1,
 * phase7-library-google.md §A).
 *
 * Replaces the three copies that lived in `src/lib/ingestion.ts`:
 *
 *  | deleted copy          | what it duplicated                                   |
 *  |-----------------------|------------------------------------------------------|
 *  | `extractBookData`     | the canonical full pipeline                          |
 *  | `extractBookMetadata` | ~80 lines of the open/cover/compress/palette/        |
 *  |                       | fingerprint preamble, verbatim                       |
 *  | `reprocessBook`       | the chapter→toc/sections/tts/tables mapping loop     |
 *  |                       | (now `mapChapters`, shared with import/reprocess.ts) |
 *
 * Pure module: no store imports — `ExtractionOptions` is passed in by the
 * caller (the orchestrator captures it per job), severing the
 * `useTTSStore.getState()` reach-ins (ingestion-library.md coupling #2).
 * `depth: 'metadata'` short-circuits after one epubjs open (the ghost probe
 * no longer pays cover compression/palette extraction twice per import —
 * pass the probe result back via `preamble`). `signal` aborts between
 * chapters in the offscreen render loop (the cancellable-task-runner
 * pattern); abort surfaces as `CancellationError`.
 */
// Phase 8 §A (first-use splitting): epubjs and the offscreen renderer load
// lazily at the extraction call sites — this module rides the eager
// LibraryView graph (via the ImportOrchestrator), and a static import here
// would put epubjs back into the entry chunk (check 4 of
// scripts/check-worker-chunk.mjs asserts the emitted artifact).
import { v4 as uuidv4 } from 'uuid';
import imageCompression from 'browser-image-compression';
import type { NavigationItem, SectionMetadata, StaticBookManifest, StaticResource, PerceptualPalette } from '~types/book';
import type { UserInventoryItem, UserProgress, UserOverrides, ReadingListEntry } from '~types/user-data';
import type { CacheTtsPreparation, TableImage } from '~types/cache';
import { TTS_EXTRACTION_VERSION, type ExtractionOptions } from '@lib/ingestion/sentence-extraction';
import type { ProcessedChapter } from '@domains/reader/engine/offscreen/offscreen-renderer';
import { CancellationError } from '@lib/cancellable-task-runner';
import { CURRENT_BOOK_VERSION } from '@lib/constants';
import { extractCoverPalette } from '@lib/cover-palette';
import { createLogger } from '@lib/logger';
import { normalizeLanguageCode } from '@lib/language-utils';
import { localFetch } from '@kernel/net';
import { computeContentHash, computeLegacyFingerprint } from './identity';
import { getSanitizedBookMetadata } from './metadata';
import { validateZipSignature } from './validate';

const logger = createLogger('Ingestion');

export type ExtractDepth = 'metadata' | 'full';

/** One spine item's plain text — the persisted search corpus (§F searchText). */
export interface SearchTextSection {
  href: string;
  title: string;
  text: string;
}

/** The extractor's search output; persisted per book by the searchText repo. */
export interface BookSearchText {
  /** Invalidation stamp: re-extract when below the current extraction version. */
  extractionVersion: number;
  sections: SearchTextSection[];
}

/** Shared (both depths) extraction output. */
export interface BookMetadataExtraction {
  depth: 'metadata';
  title: string;
  author: string;
  description: string;
  /** Normalized ISO 639-1 (defaults to 'en'). */
  language: string;
  /** Compressed thumbnail when compression succeeded, else the original cover. */
  coverBlob?: Blob;
  coverPalette?: number[];
  perceptualPalette?: PerceptualPalette;
  /** SHA-256 over content bytes (see identity.ts). */
  contentHash: string;
  /** Legacy filename-embedding fingerprint, still written for pre-P7 acceptance. */
  legacyFingerprint: string;
  /** The publisher TOC (may be empty; full depth falls back to a synthetic TOC). */
  toc: NavigationItem[];
}

/** Full-depth extraction output — everything the register stage persists. */
export interface FullBookExtraction extends Omit<BookMetadataExtraction, 'depth'> {
  depth: 'full';
  bookId: string;
  manifest: StaticBookManifest;
  resource: StaticResource;
  structure: {
    bookId: string;
    toc: NavigationItem[];
    spineItems: { id: string; characterCount: number; index: number }[];
  };
  sections: SectionMetadata[];
  /** The ONE inventory producer — registration consumes this (restores perceptualPalette + language, D4). */
  inventory: UserInventoryItem;
  progress: UserProgress;
  overrides: UserOverrides;
  readingListEntry: ReadingListEntry;
  ttsContentBatches: CacheTtsPreparation[];
  tableBatches: TableImage[];
  searchText: BookSearchText;
}

export type BookExtraction = BookMetadataExtraction | FullBookExtraction;

export interface ExtractBookOptions {
  depth: ExtractDepth;
  /** Segmentation/sanitization options, captured per job by the orchestrator. */
  extraction?: ExtractionOptions;
  /** Aborts between chapters in the offscreen render loop (CancellationError). */
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
  /**
   * A previously-extracted metadata-depth result for the SAME file (the
   * ghost-probe output): the full pass reuses it and skips the
   * open/cover/palette/hash preamble entirely.
   */
  preamble?: BookMetadataExtraction;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancellationError('Extraction cancelled');
}

// ── The preamble: one epubjs open for metadata/cover/palette/TOC ──────────

interface PreambleOptions {
  /** 'thumbnail' compresses the cover before palette extraction (import); 'raw' uses the original (reprocess parity). */
  cover: 'thumbnail' | 'raw';
  signal?: AbortSignal;
}

export interface BookPreamble {
  /** Raw (unsanitized) OPF metadata — the legacy fingerprint hashes these. */
  rawTitle: string;
  rawAuthor: string;
  rawDescription: string;
  language: string;
  coverBlob?: Blob;
  coverPalette?: number[];
  perceptualPalette?: PerceptualPalette;
  toc: NavigationItem[];
}

/** Open the EPUB once and pull metadata, cover (+palette) and the publisher TOC. */
export async function extractPreamble(file: Blob, options: PreambleOptions): Promise<BookPreamble> {
  throwIfAborted(options.signal);

  const { default: ePub } = await import('epubjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file, { replacements: 'none' });
  try {
    await book.ready;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = await (book.loaded as any).metadata;
    const language = normalizeLanguageCode(metadata.language || metadata.lang);
    const coverUrl = await book.coverUrl();

    let coverBlob: Blob | undefined;
    let thumbnailBlob: Blob | undefined;
    let coverPalette: number[] | undefined;
    let perceptualPalette: PerceptualPalette | undefined;

    if (coverUrl) {
      try {
        const response = await localFetch(coverUrl);
        coverBlob = await response.blob();
        if (coverBlob && options.cover === 'thumbnail') {
          try {
            thumbnailBlob = await imageCompression(coverBlob as File, {
              maxSizeMB: 0.1,
              maxWidthOrHeight: 600,
              useWebWorker: true,
              fileType: 'image/webp',
            });
          } catch (error) {
            logger.warn('Failed to compress cover image, using original:', error);
            thumbnailBlob = coverBlob;
          }
        }
      } catch (error) {
        logger.warn('Failed to retrieve cover blob:', error);
      }
    }

    // Generate palette if we have any cover image. A palette failure never
    // aborts extraction (legacy reprocess semantics; the import path only
    // loses the optional palette).
    if (thumbnailBlob || coverBlob) {
      try {
        const result = await extractCoverPalette((thumbnailBlob || coverBlob)!);
        coverPalette = result.palette;
        perceptualPalette = result.perceptualPalette;
        if (coverPalette.length === 0) coverPalette = undefined;
      } catch (error) {
        logger.warn('Failed to extract cover palette:', error);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navigation = await (book.loaded as any).navigation;
    const toc: NavigationItem[] = navigation ? navigation.toc : [];

    return {
      rawTitle: metadata.title || 'Untitled',
      rawAuthor: metadata.creator || 'Unknown Author',
      rawDescription: metadata.description || '',
      language,
      coverBlob: thumbnailBlob || coverBlob,
      coverPalette,
      perceptualPalette,
      toc,
    };
  } finally {
    await book.opened.catch(() => {});
    book.destroy();
  }
}

// ── The chapter mapping loop (was duplicated in extractBookData/reprocessBook) ──

export interface ChapterMapping {
  syntheticToc: NavigationItem[];
  sections: SectionMetadata[];
  ttsContentBatches: CacheTtsPreparation[];
  tableBatches: TableImage[];
  searchSections: SearchTextSection[];
  totalChars: number;
}

function toCacheTtsPrep(bookId: string, chapter: ProcessedChapter): CacheTtsPreparation {
  return {
    id: `${bookId}-${chapter.href}`,
    bookId,
    sectionId: chapter.href,
    sentences: chapter.sentences,
    citationMarkers: chapter.citationMarkers?.length > 0 ? chapter.citationMarkers : undefined,
    extractionVersion: TTS_EXTRACTION_VERSION,
  };
}

/** Map rendered chapters to TOC/sections/TTS-prep/table/search rows. */
export function mapChapters(bookId: string, chapters: ProcessedChapter[]): ChapterMapping {
  const syntheticToc: NavigationItem[] = [];
  const sections: SectionMetadata[] = [];
  const ttsContentBatches: CacheTtsPreparation[] = [];
  const tableBatches: TableImage[] = [];
  const searchSections: SearchTextSection[] = [];
  let totalChars = 0;

  chapters.forEach((chapter, i) => {
    const title = chapter.title || `Chapter ${i + 1}`;

    syntheticToc.push({
      id: `syn-toc-${i}`,
      href: chapter.href,
      label: title,
    });

    sections.push({
      id: `${bookId}-${chapter.href}`,
      bookId,
      sectionId: chapter.href,
      characterCount: chapter.textContent.length,
      playOrder: i,
      title,
    });
    totalChars += chapter.textContent.length;

    if (chapter.sentences.length > 0) {
      ttsContentBatches.push(toCacheTtsPrep(bookId, chapter));
    }

    if (chapter.tables && chapter.tables.length > 0) {
      chapter.tables.forEach((table) => {
        tableBatches.push({
          id: `${bookId}-${table.cfi}`,
          bookId,
          sectionId: chapter.href,
          cfi: table.cfi,
          imageBlob: table.imageBlob,
        });
      });
    }

    searchSections.push({ href: chapter.href, title, text: chapter.textContent });
  });

  return { syntheticToc, sections, ttsContentBatches, tableBatches, searchSections, totalChars };
}

// ── extractBook ────────────────────────────────────────────────────────────

export async function extractBook(
  file: File,
  opts: ExtractBookOptions & { depth: 'metadata' },
): Promise<BookMetadataExtraction>;
export async function extractBook(
  file: File,
  opts: ExtractBookOptions & { depth: 'full' },
): Promise<FullBookExtraction>;
export async function extractBook(file: File, opts: ExtractBookOptions): Promise<BookExtraction>;
export async function extractBook(file: File, opts: ExtractBookOptions): Promise<BookExtraction> {
  const { depth, extraction, signal, onProgress, preamble: reused } = opts;

  let shared: BookMetadataExtraction;
  if (reused) {
    shared = reused;
  } else {
    const isValid = await validateZipSignature(file);
    if (!isValid) {
      throw new Error('Invalid file format. File must be a valid EPUB (ZIP archive).');
    }

    const preamble = await extractPreamble(file, { cover: 'thumbnail', signal });

    // Identity. The legacy fingerprint hashes the UNSANITIZED metadata —
    // pre-P7 manifests were written that way and restore acceptance must
    // keep matching them.
    const legacyFingerprint = await computeLegacyFingerprint(file, {
      title: preamble.rawTitle,
      author: preamble.rawAuthor,
      filename: file.name,
    });
    const contentHash = await computeContentHash(file);

    // Sanitize the metadata candidate (sanitize-at-ingest boundary).
    const candidateMetadata = {
      id: 'pending-book-id',
      title: preamble.rawTitle,
      author: preamble.rawAuthor,
      description: preamble.rawDescription,
      addedAt: Date.now(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check = getSanitizedBookMetadata(candidateMetadata as any);
    if (check) {
      candidateMetadata.title = check.sanitized.title;
      candidateMetadata.author = check.sanitized.author;
      candidateMetadata.description = check.sanitized.description ?? '';
      if (check.wasModified) {
        logger.warn(`Metadata sanitized for "${candidateMetadata.title}":`, check.modifications);
      }
    }

    shared = {
      depth: 'metadata',
      title: candidateMetadata.title,
      author: candidateMetadata.author,
      description: candidateMetadata.description,
      language: preamble.language,
      coverBlob: preamble.coverBlob,
      coverPalette: preamble.coverPalette,
      perceptualPalette: preamble.perceptualPalette,
      contentHash,
      legacyFingerprint,
      toc: preamble.toc,
    };
  }

  if (depth === 'metadata') {
    return shared;
  }

  throwIfAborted(signal);

  const optionsWithLocale: ExtractionOptions = { ...extraction, locale: shared.language };
  const { extractContentOffscreen } = await import(
    '@domains/reader/engine/offscreen/offscreen-renderer'
  );
  const { chapters, baseFontSize, baseLineHeight } = await extractContentOffscreen(
    file,
    optionsWithLocale,
    onProgress,
    signal,
  );

  const bookId = uuidv4();
  const mapping = mapChapters(bookId, chapters);

  const manifest: StaticBookManifest = {
    bookId,
    title: shared.title,
    author: shared.author,
    description: shared.description,
    fileHash: shared.legacyFingerprint,
    contentHash: shared.contentHash,
    fileSize: file.size,
    totalChars: mapping.totalChars,
    schemaVersion: CURRENT_BOOK_VERSION,
    isbn: undefined,
    coverBlob: shared.coverBlob,
    coverPalette: shared.coverPalette,
    perceptualPalette: shared.perceptualPalette,
    language: shared.language,
    baseFontSize,
    baseLineHeight,
  };

  const now = Date.now();

  return {
    ...shared,
    depth: 'full',
    bookId,
    manifest,
    resource: { bookId, epubBlob: file },
    structure: {
      bookId,
      toc: shared.toc.length > 0 ? shared.toc : mapping.syntheticToc,
      spineItems: mapping.sections.map((s) => ({
        id: s.sectionId,
        characterCount: s.characterCount,
        index: s.playOrder,
      })),
    },
    sections: mapping.sections,
    inventory: {
      bookId,
      title: shared.title,
      author: shared.author,
      addedAt: now,
      sourceFilename: file.name,
      tags: [],
      status: 'unread',
      lastInteraction: now,
      coverPalette: shared.coverPalette,
      perceptualPalette: shared.perceptualPalette,
      language: shared.language,
    },
    progress: { bookId, percentage: 0, lastRead: 0, completedRanges: [] },
    overrides: { bookId, lexicon: [] },
    readingListEntry: {
      filename: file.name,
      title: shared.title,
      author: shared.author,
      isbn: undefined,
      percentage: 0,
      lastUpdated: now,
      status: 'to-read',
      rating: undefined,
    },
    ttsContentBatches: mapping.ttsContentBatches,
    tableBatches: mapping.tableBatches,
    searchText: {
      extractionVersion: TTS_EXTRACTION_VERSION,
      sections: mapping.searchSections,
    },
  };
}
