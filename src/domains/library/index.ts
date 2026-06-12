/**
 * domains/library — public surface (Phase 7 §A–§E).
 *
 * Composition root: src/app/library/createLibrary.ts (wires the ports to
 * the zustand stores and constructs the singletons).
 */
export { KeyedMutex } from './mutex';
export { LibraryService } from './LibraryService';
export {
  ImportOrchestrator,
  type ImportJobKind,
  type ImportPolicy,
  type ImportJobResult,
  type ImportOrchestratorDeps,
} from './import/ImportOrchestrator';
export {
  extractBook,
  type BookExtraction,
  type BookMetadataExtraction,
  type FullBookExtraction,
  type ExtractDepth,
  type BookSearchText,
  type SearchTextSection,
} from './import/extract';
export { reprocessBookContent, type ReprocessResult } from './import/reprocess';
export { extractEpubsFromZip } from './import/zip';
export { createLibraryPersistence, retargetExtraction, type MergedReadDeps } from './import/persist';
export {
  computeContentHash,
  computeLegacyFingerprint,
  matchesLegacyFingerprint,
} from './import/identity';
export { validateZipSignature } from './import/validate';
export type {
  InventoryPort,
  ReadingListPort,
  LibraryProjectionPort,
  LibraryPersistence,
  ExtractionOptionsProvider,
  BatchImportSummary,
} from './ports';
