/**
 * ImportOrchestrator — the ONE entry into the import pipeline (Phase 7 §B).
 *
 * All non-reader entry points (LibraryView input/drop, FileUploader,
 * settings, Drive, ContentMissing restore, ReprocessingInterstitial) enqueue
 * jobs here; the legacy `lib/ingestion.reprocessBook` delegate routes the
 * frozen reader-side call through the same queue. Stages per import job:
 *
 *   validate → identify (one metadata-depth extractBook: contentHash +
 *   legacy fingerprint + ghost-probe metadata from a single epubjs open) →
 *   policy (filename duplicate, then ghost matching — now ALSO on the batch
 *   path, closing the P0 gap) → extract (full, reusing the probe preamble)
 *   → persist (one gated tx via LibraryPersistence) → register (inventory +
 *   reading-list entry WITH the bookId FK + static-metadata projection +
 *   offloaded clear, under the book's mutex).
 *
 * Concurrency: jobs run on a FIFO queue with two priority classes — normal
 * (user-initiated) and idle (the §E re-ingest wave) — and every per-book
 * mutation runs inside the shared KeyedMutex, so reprocess overlap (D6) and
 * restore-vs-delete races are impossible by construction.
 */
import type { BookMetadata, StaticBookManifest } from '~types/book';
import type { UserInventoryItem } from '~types/user-data';
import type { StaticManifestRow } from '@data/rows/static';
import { AppError, StorageFullError } from '~types/errors';
import { createLogger } from '@lib/logger';
import { measureSince } from '@lib/perf';
import type { KeyedMutex } from '../mutex';
import type {
  InventoryPort,
  ReadingListPort,
  LibraryProjectionPort,
  LibraryPersistence,
  ExtractionOptionsProvider,
  BatchImportSummary,
} from '../ports';
import {
  extractBook as realExtractBook,
  type BookMetadataExtraction,
  type FullBookExtraction,
} from './extract';
import { extractEpubsFromZip as realExtractEpubsFromZip } from './zip';
import { retargetExtraction } from './persist';
import { computeContentHash, matchesLegacyFingerprint } from './identity';

const logger = createLogger('ImportOrchestrator');

export type ImportJobKind = 'import' | 'restore' | 'reprocess' | 'reingest';

export interface ImportPolicy {
  onDuplicate: 'ask' | 'replace' | 'skip';
  adoptGhosts: boolean;
}

export interface RestoreOptions {
  /**
   * Accept a file whose content hash does NOT match the offloaded book's
   * stored manifest — the "updated the EPUB on purpose" override behind the
   * mismatch warning. Skips the {@link verifyRestoreAcceptance} gate and
   * re-derives the book under its existing id (the same path a synced
   * download with no local manifest takes), so the derived content matches
   * the new binary while reading progress and notes are preserved.
   */
  allowContentMismatch?: boolean;
}

export type ImportJobResult =
  | { status: 'imported'; bookId: string; adoptedGhost?: boolean }
  | { status: 'replaced'; bookId: string }
  | { status: 'duplicate'; existingBookId: string }
  | { status: 'skipped'; filename: string }
  | { status: 'failed'; error: AppError };

export interface ImportOrchestratorDeps {
  mutex: KeyedMutex;
  inventory: InventoryPort;
  readingList: ReadingListPort;
  projection: LibraryProjectionPort;
  persistence: LibraryPersistence;
  extractionOptions: ExtractionOptionsProvider;
  /** Pure-function seams (default real; injected by tests). */
  extract?: typeof realExtractBook;
  expandZip?: typeof realExtractEpubsFromZip;
  now?: () => number;
}

interface QueueJob {
  kind: ImportJobKind;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class ImportOrchestrator {
  private readonly extract: typeof realExtractBook;
  private readonly expandZip: typeof realExtractEpubsFromZip;
  private readonly now: () => number;
  private normalQueue: QueueJob[] = [];
  private idleQueue: QueueJob[] = [];
  private pumping = false;

  constructor(private readonly deps: ImportOrchestratorDeps) {
    this.extract = deps.extract ?? realExtractBook;
    this.expandZip = deps.expandZip ?? realExtractEpubsFromZip;
    this.now = deps.now ?? Date.now;
  }

  // ── The queue ───────────────────────────────────────────────────────────

  private enqueue<T>(kind: ImportJobKind, run: () => Promise<T>, priority: 'normal' | 'idle' = 'normal'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: QueueJob = {
        kind,
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      (priority === 'idle' ? this.idleQueue : this.normalQueue).push(job);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      // Idle jobs (the re-ingest wave) only run while no user job waits.
      for (;;) {
        const job = this.normalQueue.shift() ?? this.idleQueue.shift();
        if (!job) break;
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Pending job count by priority (used by the re-ingest wave's pacing). */
  pendingCount(): { normal: number; idle: number } {
    return { normal: this.normalQueue.length, idle: this.idleQueue.length };
  }

  // ── Public jobs ─────────────────────────────────────────────────────────

  /** Single import. `'ask'` surfaces the Replace dialog via the 'duplicate' result. */
  importFile(file: File, policy?: Partial<ImportPolicy>): Promise<ImportJobResult> {
    const effective: ImportPolicy = { onDuplicate: 'ask', adoptGhosts: true, ...policy };
    return this.enqueue('import', async () => {
      this.deps.projection.importStarted();
      try {
        const result = await this.runImport(file, effective);
        return result;
      } finally {
        this.deps.projection.importFinished();
      }
    });
  }

  /**
   * Batch import: ZIPs expand, every input file is accounted for in the
   * summary, duplicates skip, and — closing the two P0 gaps deliberately —
   * each imported file gets ghost matching AND a reading-list entry.
   */
  importFiles(files: File[], policy?: Partial<ImportPolicy>): Promise<BatchImportSummary> {
    const effective: ImportPolicy = { onDuplicate: 'skip', adoptGhosts: true, ...policy };
    return this.enqueue('import', async () => {
      const projection = this.deps.projection;
      projection.importStarted();
      projection.setBatchSummary(null);
      try {
        const summary: BatchImportSummary = { imported: 0, skipped: [], failed: [] };
        const epubs = await this.expandToEpubs(files, summary);

        const seen = new Set<string>();
        for (let i = 0; i < epubs.length; i++) {
          const epub = epubs[i];
          projection.importProgress(
            Math.round((i / epubs.length) * 100),
            `Importing ${i + 1} of ${epubs.length}: ${epub.name}`,
          );

          if (seen.has(epub.name)) {
            summary.skipped.push(epub.name);
            continue;
          }

          const result = await this.runImport(epub, effective);
          switch (result.status) {
            case 'imported':
            case 'replaced':
              summary.imported += 1;
              seen.add(epub.name);
              break;
            case 'duplicate':
            case 'skipped':
              summary.skipped.push(epub.name);
              break;
            case 'failed':
              summary.failed.push({ filename: epub.name, reason: result.error.message });
              break;
          }
        }

        projection.setBatchSummary(summary);
        if (summary.skipped.length > 0 || summary.failed.length > 0) {
          logger.warn(
            `Batch import finished with ${summary.skipped.length} duplicate(s) skipped and ${summary.failed.length} failure(s).`,
            summary,
          );
        }
        return summary;
      } finally {
        projection.importFinished();
      }
    });
  }

  /**
   * Restore a book's binary (ContentMissing flow). Acceptance: contentHash
   * match OR the legacy fingerprint's filename-independent content tail
   * (renamed files restore — D7), with the lazy contentHash manifest
   * upgrade on legacy acceptance. Without a local manifest this is a
   * synced-book download: a full import under the EXISTING id.
   *
   * `opts.allowContentMismatch` (the mismatch-warning "Proceed Anyway"
   * override for a deliberately-updated EPUB) skips the acceptance gate and
   * routes through the same full re-derivation, rebuilding the book's
   * content from the new binary while its progress and notes are preserved.
   */
  restore(bookId: string, file: File, opts: RestoreOptions = {}): Promise<void> {
    return this.enqueue('restore', async () => {
      const { projection, persistence } = this.deps;
      projection.importStarted();
      try {
        const manifest = await persistence.getManifest(bookId);
        if (manifest && !opts.allowContentMismatch) {
          await this.verifyRestoreAcceptance(bookId, manifest, file);
          await persistence.restoreResource(bookId, file);
          await this.deps.mutex.run(bookId, async () => {
            // I-3: re-validate existence inside the mutexed register step.
            if (!this.deps.inventory.get(bookId)) return;
            projection.removeOffloaded(bookId);
            const fresh = await persistence.getBookMetadata(bookId);
            if (fresh && this.deps.inventory.get(bookId)) projection.setStatic(bookId, fresh);
          });
        } else {
          logger.info(
            manifest
              ? `Book ${bookId} restored from a content-mismatched file (user override). Re-deriving under the existing ID.`
              : `Book ${bookId} has no local manifest. Importing with existing ID for synced book.`,
          );
          const extraction = await this.extract(file, {
            depth: 'full',
            extraction: this.deps.extractionOptions(),
            onProgress: (p, m) => projection.importProgress(p, m),
          });
          await this.registerWithExistingId(bookId, extraction, 'restore', file.name);
        }
      } catch (error) {
        projection.setError(error instanceof Error ? error.message : 'Failed to restore book.');
        throw error;
      } finally {
        projection.importFinished();
      }
    });
  }

  /**
   * Re-derive a book's content from its stored binary. Same-book overlap is
   * impossible: the work runs under the book's mutex (kills D6's concurrent
   * ReprocessingInterstitial runs). The §E re-ingest wave passes
   * `verifyDerived` (graft R4: old rows retained when the self-check fails).
   */
  reprocess(
    bookId: string,
    priority: 'normal' | 'idle' = 'normal',
    opts: Pick<Parameters<LibraryPersistence['reprocess']>[1], 'verifyDerived'> = {},
  ): Promise<void> {
    return this.enqueue(
      priority === 'idle' ? 'reingest' : 'reprocess',
      () =>
        this.deps.mutex.run(bookId, async () => {
          const result = await this.deps.persistence.reprocess(bookId, {
            extraction: this.deps.extractionOptions(),
            verifyDerived: opts.verifyDerived,
          });
          if (result.coverPalette || result.perceptualPalette) {
            this.deps.inventory.update(bookId, {
              coverPalette: result.coverPalette,
              perceptualPalette: result.perceptualPalette,
            });
          }
          const fresh = await this.deps.persistence.getBookMetadata(bookId);
          if (fresh && this.deps.inventory.get(bookId)) {
            this.deps.projection.setStatic(bookId, fresh);
          }
        }),
      priority,
    );
  }

  // ── Import pipeline stages ──────────────────────────────────────────────

  private async runImport(file: File, policy: ImportPolicy): Promise<ImportJobResult> {
    try {
      // policy: filename duplicate (inventory first — synchronous, races
      // with recent adds excluded — then the DB index backstop).
      const existingId = this.findExistingBookIdByFilename(file.name);
      if (existingId) {
        if (policy.onDuplicate === 'ask') return { status: 'duplicate', existingBookId: existingId };
        if (policy.onDuplicate === 'skip') return { status: 'skipped', filename: file.name };
        return await this.replaceExisting(existingId, file);
      }

      // identify + ghost probe: ONE metadata-depth extraction.
      let probe: BookMetadataExtraction | undefined;
      if (policy.adoptGhosts) {
        try {
          this.deps.projection.importProgress(0, 'Checking for existing library entries...');
          probe = await this.extract(file, { depth: 'metadata' });
        } catch (e) {
          // Parity with the legacy smart-matching: a probe failure falls
          // through to the standard import (which re-validates the file).
          logger.warn('Smart matching check failed, proceeding with standard import', e);
        }

        const ghost = probe ? this.findGhost(probe) : undefined;
        if (ghost) {
          logger.info(
            `Found Ghost Book match by metadata for file "${file.name}": "${ghost.title}" (${ghost.bookId}). Linking binary file to existing record...`,
          );
          this.deps.projection.importProgress(0, `Linking to existing entry: ${ghost.title}...`);
          const extraction = await this.extract(file, {
            depth: 'full',
            extraction: this.deps.extractionOptions(),
            preamble: probe,
            onProgress: (p, m) => this.deps.projection.importProgress(p, m),
          });
          await this.registerWithExistingId(ghost.bookId, extraction, 'ghost', file.name);
          return { status: 'imported', bookId: ghost.bookId, adoptedGhost: true };
        }
      }

      // extract (full) → persist → register.
      const extraction = await this.extract(file, {
        depth: 'full',
        extraction: this.deps.extractionOptions(),
        preamble: probe,
        onProgress: (p, m) => this.deps.projection.importProgress(p, m),
      });
      const persistStart = performance.now();
      await this.deps.persistence.ingest(extraction, { mode: 'add' });
      measureSince('import:persist', persistStart);
      await this.registerNew(extraction, file.name);
      return { status: 'imported', bookId: extraction.bookId };
    } catch (error) {
      logger.error('Failed to import book:', error);
      const message =
        error instanceof StorageFullError
          ? 'Device storage full. Please delete some books.'
          : 'Failed to import book.';
      this.deps.projection.setError(message);
      return { status: 'failed', error: toAppError(error) };
    }
  }

  private async replaceExisting(bookId: string, file: File): Promise<ImportJobResult> {
    this.deps.projection.importProgress(0, 'Updating existing content...');
    logger.info(`Overwriting book ${bookId}. Preserving user progress.`);

    const extraction = await this.extract(file, {
      depth: 'full',
      extraction: this.deps.extractionOptions(),
      onProgress: (p, m) => this.deps.projection.importProgress(p, m),
    });
    await this.registerWithExistingId(bookId, extraction, 'replace', file.name);
    return { status: 'replaced', bookId };
  }

  /** persist + register for ghost/replace/restore-download flavors. */
  private async registerWithExistingId(
    bookId: string,
    extraction: FullBookExtraction,
    flavor: 'ghost' | 'replace' | 'restore',
    filename: string,
  ): Promise<void> {
    const retargeted = retargetExtraction(extraction, bookId);
    await this.deps.persistence.ingest(retargeted, { mode: 'overwrite' });

    await this.deps.mutex.run(bookId, () => {
      const { inventory, readingList, projection } = this.deps;
      const existing = inventory.get(bookId);

      // Zombie guard (I-2/I-3): a concurrently-removed book is never
      // resurrected by a slow import landing afterwards.
      if (!existing) {
        logger.warn(`Book ${bookId} was removed while importing; skipping registration.`);
        return;
      }

      if (flavor === 'replace') {
        inventory.upsert({
          ...existing,
          title: retargeted.manifest.title,
          author: retargeted.manifest.author,
          sourceFilename: filename,
          lastInteraction: this.now(),
          coverPalette: retargeted.manifest.coverPalette,
          perceptualPalette: retargeted.manifest.perceptualPalette,
          language: retargeted.manifest.language,
          // status, tags, rating, addedAt preserved from the existing item.
        });

        const entry = readingList.get(filename);
        if (entry) {
          readingList.update(filename, {
            title: retargeted.manifest.title,
            author: retargeted.manifest.author,
            lastUpdated: this.now(),
            bookId: entry.bookId ?? bookId,
          });
        } else {
          readingList.upsert({ ...retargeted.readingListEntry, bookId });
        }
      } else {
        // ghost / restore: inventory stays as the user knows it; only the
        // FK backfill (copy-if-absent) touches the reading list.
        const entry = readingList.get(existing.sourceFilename ?? filename);
        if (entry && entry.bookId === undefined) {
          readingList.update(entry.filename, { bookId });
        }
      }

      projection.setStatic(bookId, toBookMetadata(retargeted.manifest, bookId, existing.addedAt ?? this.now()));
      projection.removeOffloaded(bookId);
    });
  }

  private async registerNew(extraction: FullBookExtraction, filename: string): Promise<void> {
    await this.deps.mutex.run(extraction.bookId, () => {
      const { inventory, readingList, projection } = this.deps;

      // The ONE inventory producer is the extractor output (§A).
      inventory.upsert(extraction.inventory);

      // Reading-list registration WITH the bookId FK (§B register; §D).
      const entry = readingList.get(filename);
      if (entry) {
        readingList.update(filename, {
          title: extraction.title,
          author: extraction.author,
          lastUpdated: this.now(),
          bookId: entry.bookId ?? extraction.bookId,
        });
      } else {
        readingList.upsert({ ...extraction.readingListEntry, bookId: extraction.bookId });
      }

      projection.setStatic(
        extraction.bookId,
        toBookMetadata(extraction.manifest, extraction.bookId, this.now()),
      );
      projection.removeOffloaded(extraction.bookId);
    });
  }

  // ── Policy helpers ──────────────────────────────────────────────────────

  private findExistingBookIdByFilename(filename: string): string | undefined {
    const books = this.deps.inventory.all();
    for (const key in books) {
      if (!Object.prototype.hasOwnProperty.call(books, key)) continue;
      if (books[key] && books[key].sourceFilename === filename) {
        return books[key].bookId;
      }
    }
    return this.deps.persistence.getBookIdByFilename(filename);
  }

  /** Ghost = inventory entry with NO local static metadata, matched by trimmed title+author. */
  private findGhost(probe: BookMetadataExtraction): UserInventoryItem | undefined {
    const books = this.deps.inventory.all();
    const staticIds = this.deps.projection.staticIds();
    const title = probe.title.trim();
    const author = probe.author.trim();
    if (!title || !author) return undefined;

    for (const key in books) {
      if (!Object.prototype.hasOwnProperty.call(books, key)) continue;
      const b = books[key];
      if (!b || !b.bookId) continue;
      const isGhost = !staticIds.has(b.bookId);
      const isMatch = !!b.title && !!b.author && b.title.trim() === title && b.author.trim() === author;
      if (isGhost && isMatch) return b;
    }
    return undefined;
  }

  private async verifyRestoreAcceptance(
    bookId: string,
    manifest: StaticManifestRow,
    file: File,
  ): Promise<void> {
    if (manifest.contentHash) {
      if ((await computeContentHash(file)) === manifest.contentHash) return;
      throw new AppError('File verification failed: content hash mismatch.', {
        code: 'INGEST_FILE_MISMATCH',
        context: { bookId },
      });
    }

    // Pre-P7 manifest: accept via the filename-independent legacy tail
    // (renamed files restore — D7), then lazily upgrade the manifest.
    if (manifest.fileHash && !(await matchesLegacyFingerprint(manifest.fileHash, file))) {
      throw new AppError('File verification failed: fingerprint mismatch.', {
        code: 'INGEST_FILE_MISMATCH',
        context: { bookId },
      });
    }
    try {
      await this.deps.persistence.writeContentHash(bookId, await computeContentHash(file));
    } catch (e) {
      logger.warn('Lazy contentHash manifest upgrade failed (will retry next restore):', e);
    }
  }

  private async expandToEpubs(files: File[], summary: BatchImportSummary): Promise<File[]> {
    const projection = this.deps.projection;
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    let processedBytes = 0;
    const epubs: File[] = [];

    for (const file of files) {
      const startBytes = processedBytes;
      const name = file.name.toLowerCase();
      if (name.endsWith('.zip')) {
        try {
          const extracted = await this.expandZip(file, (percent) => {
            const done = startBytes + (percent / 100) * file.size;
            projection.uploadProgress(
              totalSize > 0 ? Math.min(100, Math.round((done / totalSize) * 100)) : 100,
              `Processing ${file.name}...`,
            );
          });
          epubs.push(...extracted);
        } catch (e) {
          logger.warn(`Failed to extract zip ${file.name}:`, e);
          summary.failed.push({
            filename: file.name,
            reason: e instanceof Error ? e.message : 'Failed to extract ZIP archive.',
          });
        }
      } else if (name.endsWith('.epub')) {
        epubs.push(file);
      } else {
        summary.failed.push({ filename: file.name, reason: 'Unsupported file type (expected .epub or .zip).' });
      }
      processedBytes += file.size;
    }

    projection.uploadProgress(100, 'All files processed. Starting import...');
    return epubs;
  }
}

function toBookMetadata(manifest: StaticBookManifest, bookId: string, addedAt: number): BookMetadata {
  return {
    ...manifest,
    id: bookId,
    version: manifest.schemaVersion,
    addedAt,
  } as BookMetadata;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(error instanceof Error ? error.message : String(error), {
    code: 'INGEST_UNKNOWN',
    cause: error,
  });
}
