/**
 * Legacy ingestion façade (Phase 7).
 *
 * The three extraction copies that lived here (`extractBookData`,
 * `extractBookMetadata`, `reprocessBook` — see the deletion table in
 * `domains/library/import/extract.ts`) are GONE: the unified pipeline lives
 * at `src/domains/library/import/` and runs through the ImportOrchestrator.
 *
 * What remains, and why: the sanitize-at-ingest helpers +
 * `validateZipSignature` re-exports — consumed by
 * FileUploader/MaintenanceService-era call sites that re-point at the
 * phase exit, when this module dies. The `reprocessBook` delegate is GONE:
 * the post-merge reader follow-up re-pointed `ContentAnalysisLegend` onto
 * `useImportController().reprocessBook` (the ImportOrchestrator queue,
 * mutex-guarded — D6 stays paid).
 */
export {
  sanitizeString,
  getSanitizedBookMetadata,
} from '@domains/library/import/metadata';

export { validateZipSignature } from '@domains/library/import/validate';

