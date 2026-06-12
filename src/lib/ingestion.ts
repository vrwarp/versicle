/**
 * Legacy ingestion façade (Phase 7).
 *
 * The three extraction copies that lived here (`extractBookData`,
 * `extractBookMetadata`, `reprocessBook` — see the deletion table in
 * `domains/library/import/extract.ts`) are GONE: the unified pipeline lives
 * at `src/domains/library/import/` and runs through the ImportOrchestrator.
 *
 * What remains, and why:
 *  - the sanitize-at-ingest helpers + `validateZipSignature` re-exports —
 *    consumed by FileUploader/MaintenanceService-era call sites that
 *    re-point at PR-L5/phase exit;
 *  - `reprocessBook` — the READER-side `ContentAnalysisLegend` (frozen for
 *    the P6 chain) imports it from here; it now routes through the
 *    orchestrator queue, so overlapping reprocess runs serialize on the
 *    book's mutex (D6 paid). Deletion deadline: the post-merge reader
 *    follow-up re-points the legend, then this module dies.
 */
export {
  validateBookMetadata,
  sanitizeString,
  getSanitizedBookMetadata,
  type SanitizationResult,
} from '@domains/library/import/metadata';

export { validateZipSignature } from '@domains/library/import/validate';

export { extractCoverPalette } from './cover-palette';

/**
 * Re-derives a book's content (TOC/sections/TTS prep/tables) from its
 * stored binary, through the orchestrator's job queue (mutex-guarded).
 * The dynamic import keeps the lib→app edge out of the static module graph.
 */
export async function reprocessBook(bookId: string): Promise<void> {
  const { libraryController } = await import('@app/library/useImportController');
  await libraryController.reprocessBook(bookId);
}
