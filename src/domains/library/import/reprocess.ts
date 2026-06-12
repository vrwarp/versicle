/**
 * Reprocess a book's DERIVED content from its stored binary (Phase 7 PR-L1
 * — the third `extractBookData` copy from `lib/ingestion.ts`, now expressed
 * over the shared preamble + `mapChapters`).
 *
 * Pure of stores: returns the palette delta for the caller to apply to the
 * synced inventory (`lib/ingestion.reprocessBook` keeps that store write for
 * its frozen reader-side consumers; the ImportOrchestrator routes
 * `reprocess` jobs here under the book's mutex).
 *
 * The WebKit-safe write discipline (Blob → ArrayBuffer conversion before the
 * transaction; reads hoisted out; one synchronous gated transaction) lives
 * in `bookContent.replaceDerivedContent` — the repo absorbed the raw
 * 4-store transaction in Phase 3 (D5.3).
 */
import { bookContent } from '@data/repos/bookContent';
import { extractContentOffscreen } from '@lib/offscreen-renderer';
import { CURRENT_BOOK_VERSION } from '@lib/constants';
import type { ExtractionOptions } from '@lib/ingestion/sentence-extraction';
import type { PerceptualPalette } from '~types/db';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import { extractPreamble, mapChapters, type BookSearchText } from './extract';

export interface ReprocessResult {
  /** Set when the cover palette was re-extracted — apply to the synced inventory. */
  coverPalette?: number[];
  perceptualPalette?: PerceptualPalette;
  /** Fresh search corpus for the searchText repo (persisted from PR-S3 on). */
  searchText: BookSearchText;
}

export async function reprocessBookContent(
  bookId: string,
  opts: { extraction?: ExtractionOptions; signal?: AbortSignal } = {},
): Promise<ReprocessResult> {
  const file = await bookContent.getBookFile(bookId);

  if (!file) {
    throw new Error(`Book source file not found for ID: ${bookId}`);
  }

  const fileBlob = file instanceof Blob ? file : new Blob([file]);

  // Reprocess parity: the palette is extracted from the RAW cover (no
  // thumbnail compression), exactly as the legacy `reprocessBook` did.
  const preamble = await extractPreamble(fileBlob, { cover: 'raw', signal: opts.signal });

  const { chapters, baseFontSize, baseLineHeight } = await extractContentOffscreen(
    fileBlob,
    { ...opts.extraction, locale: preamble.language },
    undefined,
    opts.signal,
  );

  const mapping = mapChapters(bookId, chapters);

  const manifest = await bookContent.getManifest(bookId);
  if (manifest) {
    manifest.totalChars = mapping.totalChars;
    manifest.schemaVersion = CURRENT_BOOK_VERSION;
    manifest.baseFontSize = baseFontSize;
    manifest.baseLineHeight = baseLineHeight;
    if (preamble.coverPalette) manifest.coverPalette = preamble.coverPalette;
    if (preamble.perceptualPalette) manifest.perceptualPalette = preamble.perceptualPalette;
  }

  await bookContent.replaceDerivedContent(bookId, {
    manifest,
    structure: {
      bookId,
      toc: preamble.toc.length > 0 ? preamble.toc : mapping.syntheticToc,
      spineItems: mapping.sections.map((s) => ({
        id: s.sectionId,
        characterCount: s.characterCount,
        index: s.playOrder,
      })),
    },
    ttsPrep: mapping.ttsContentBatches,
    tableImages: mapping.tableBatches,
  });

  return {
    coverPalette: preamble.coverPalette,
    perceptualPalette: preamble.perceptualPalette,
    searchText: {
      extractionVersion: TTS_EXTRACTION_VERSION,
      sections: mapping.searchSections,
    },
  };
}
