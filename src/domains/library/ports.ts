/**
 * Injected ports for the library domain (Phase 7 §B/§C; master plan §2
 * rule 3: domains never import state/ — `src/app/library/createLibrary.ts`
 * is the composition root that wires these to the zustand stores, the
 * EngineContext pattern generalized).
 */
import type { UserInventoryItem, ReadingListEntry, BookMetadata } from '~types/db';
import type { StaticManifestRow } from '@data/rows/static';
import type { ExtractionOptions } from '@lib/ingestion/sentence-extraction';
import type { FullBookExtraction } from './import/extract';
import type { ReprocessOptions, ReprocessResult } from './import/reprocess';

/** The synced inventory (useBookStore behind the seam). */
export interface InventoryPort {
  all(): Record<string, UserInventoryItem>;
  get(bookId: string): UserInventoryItem | undefined;
  upsert(item: UserInventoryItem): void;
  upsertMany(items: UserInventoryItem[]): void;
  update(bookId: string, updates: Partial<UserInventoryItem>): void;
  remove(bookId: string): void;
  /** Fires on every inventory change (the D16 delta subscription). */
  subscribe(listener: (books: Record<string, UserInventoryItem>) => void): () => void;
}

/** The synced reading list (useReadingListStore behind the seam). */
export interface ReadingListPort {
  get(filename: string): ReadingListEntry | undefined;
  upsert(entry: ReadingListEntry): void;
  update(filename: string, updates: Partial<ReadingListEntry>): void;
}

/** Per-file outcome summary of a batch import (shape preserved from P0). */
export interface BatchImportSummary {
  imported: number;
  skipped: string[];
  failed: { filename: string; reason: string }[];
}

/**
 * The transient UI projection (the shrunk useLibraryStore behind the seam).
 * NOTE the I-5 discipline is structural here: the offloaded set only has
 * per-key add/remove — wholesale replacement is not expressible.
 */
export interface LibraryProjectionPort {
  staticIds(): ReadonlySet<string>;
  setStatic(bookId: string, meta: BookMetadata): void;
  removeStatic(bookId: string): void;
  offloaded(): ReadonlySet<string>;
  addOffloaded(bookId: string): void;
  removeOffloaded(bookId: string): void;
  setHydrating(isHydrating: boolean): void;
  setHasHydrated(hasHydrated: boolean): void;
  setError(message: string | null): void;
  importStarted(): void;
  importProgress(progress: number, message: string): void;
  uploadProgress(percent: number, status: string): void;
  importFinished(): void;
  setBatchSummary(summary: BatchImportSummary | null): void;
}

/**
 * The persistence seam (IDB via data/ repos + app/repositories). The real
 * implementation lives in `import/persist.ts`; tests inject an in-memory
 * fake (`@test/harness` makeLibraryPersistenceDouble).
 */
export interface LibraryPersistence {
  /** One-transaction ingest of a full extraction under the given id. */
  ingest(extraction: FullBookExtraction, opts: { mode: 'add' | 'overwrite' }): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
  offloadBook(bookId: string): Promise<void>;
  restoreResource(bookId: string, file: File): Promise<void>;
  /** Raw manifest row (identity fields) — undefined when no local static data. */
  getManifest(bookId: string): Promise<StaticManifestRow | undefined>;
  /** Lazy manifest upgrade: stamp the SHA-256 contentHash post-acceptance. */
  writeContentHash(bookId: string, contentHash: string): Promise<void>;
  /** Hydration reads (BookRepository-shaped: inventory-merged metadata). */
  getBookMetadata(bookId: string): Promise<BookMetadata | undefined>;
  getBookMetadataBulk?(bookIds: string[]): Promise<(BookMetadata | undefined)[]>;
  getOffloadedStatus(bookIds?: string[]): Promise<Map<string, boolean>>;
  getAvailableResourceIds?(): Promise<Set<string>>;
  /** Filename → bookId index lookup (duplicate-detection backstop). */
  getBookIdByFilename(filename: string): string | undefined;
  /** Re-derive content from the stored binary (reprocess/reingest jobs). */
  reprocess(bookId: string, opts: ReprocessOptions): Promise<ReprocessResult>;
}

/** Settings captured PER JOB (severs the useTTSSettingsStore reach-ins, coupling #2). */
export type ExtractionOptionsProvider = () => ExtractionOptions;
