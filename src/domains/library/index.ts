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
  type ImportJobResult,
  type ImportOrchestratorDeps,
} from './import/ImportOrchestrator';
export {
  extractBook,
  type BookMetadataExtraction,
  type FullBookExtraction,
} from './import/extract';
export { extractEpubsFromZip } from './import/zip';
export { createLibraryPersistence, retargetExtraction } from './import/persist';
export { computeContentHash, computeLegacyFingerprint } from './import/identity';
export type {
  InventoryPort,
  ReadingListPort,
  LibraryProjectionPort,
  LibraryPersistence,
  BatchImportSummary,
} from './ports';
