/**
 * Ingestion façade: re-exports the sanitize-at-ingest helpers and
 * `validateZipSignature` from the unified import pipeline at
 * `src/domains/library/import/` (ImportOrchestrator, `extractBook`, reprocess).
 */
export {
  sanitizeString,
  getSanitizedBookMetadata,
} from '@domains/library/import/metadata';

export { validateZipSignature } from '@domains/library/import/validate';

