/**
 * Library composition root (Phase 7 §B/§C; master plan §2 rule 3): wires
 * the domain's ports to the zustand stores and constructs the ONE
 * KeyedMutex + ImportOrchestrator + LibraryService trio. Lazily constructed
 * on first use; everything store-shaped the domain needs is injected here.
 */
import {
  KeyedMutex,
  LibraryService,
  ImportOrchestrator,
  createLibraryPersistence,
} from '@domains/library';
import type { InventoryPort, ReadingListPort, LibraryProjectionPort } from '@domains/library';
import { useBookStore } from '@store/useBookStore';
import { useReadingListStore } from '@store/useReadingListStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { bookRepository } from '@app/repositories/BookRepository';
import { bookContent } from '@data/repos/bookContent';
import { contentKey, CURRENT_QUANT } from '@domains/search';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import { peekSyncOrchestrator } from '@app/sync/createSync';
import { createLogger } from '@lib/logger';

const logger = createLogger('createLibrary');

export interface LibraryComposition {
  mutex: KeyedMutex;
  orchestrator: ImportOrchestrator;
  service: LibraryService;
}

let instance: LibraryComposition | null = null;

export function buildInventoryPort(): InventoryPort {
  return {
    all: () => useBookStore.getState().books,
    get: (bookId) => useBookStore.getState().books[bookId],
    upsert: (item) => useBookStore.getState().addBook(item),
    upsertMany: (items) => useBookStore.getState().addBooks(items),
    update: (bookId, updates) => useBookStore.getState().updateBook(bookId, updates),
    remove: (bookId) => useBookStore.getState().removeBook(bookId),
    subscribe: (listener) =>
      useBookStore.subscribe((state, prev) => {
        if (state.books !== prev.books) listener(state.books);
      }),
  };
}

export function buildReadingListPort(): ReadingListPort {
  return {
    get: (filename) => useReadingListStore.getState().entries[filename],
    upsert: (entry) => useReadingListStore.getState().upsertEntry(entry),
    update: (filename, updates) => useReadingListStore.getState().updateEntry(filename, updates),
  };
}

export function buildProjectionPort(): LibraryProjectionPort {
  const s = () => useLibraryStore.getState();
  return {
    staticIds: () => new Set(Object.keys(s().staticMetadata)),
    setStatic: (bookId, meta) => s().setStaticMetadata(bookId, meta),
    removeStatic: (bookId) => s().removeStaticMetadata(bookId),
    offloaded: () => s().offloadedBookIds,
    addOffloaded: (bookId) => s().markOffloaded(bookId),
    removeOffloaded: (bookId) => s().unmarkOffloaded(bookId),
    setHydrating: (isHydrating) => s().setHydrating(isHydrating),
    setHasHydrated: (hasHydrated) => s().setHasHydrated(hasHydrated),
    setError: (message) => s().setError(message),
    importStarted: () => s().importStarted(),
    importProgress: (progress, message) => s().setImportProgress(progress, message),
    uploadProgress: (percent, status) => s().setUploadProgress(percent, status),
    importFinished: () => s().importFinished(),
    setBatchSummary: (summary) => s().setBatchImportSummary(summary),
  };
}

/**
 * When a book is removed, drop this device's pointer to its entry in the shared
 * embedding cache. Injected as LibraryService's `purgeBookArtifact` port because
 * it holds the store/backend/manifest edges the store-free LibraryService cannot
 * reach:
 *
 *  (a) read the connected cloud backend (null => no-op);
 *  (b) read the book's manifest for its contentHash (absent => no-op; the
 *      manifest is read BEFORE LibraryService deletes the book, so the row
 *      carrying the hash is still present);
 *  (c) derive the cache key from the LIVE embedding stamp ({model, dims} +
 *      quant literal + extraction version — the SAME stamp the read adapter uses,
 *      so the key matches what the publisher wrote);
 *  (d) best-effort delete of the HEAD record at `embedCache/{key}` ONLY; the
 *      shared blob is left for the cloud sweeper to reclaim once it ages out.
 *
 * The shareAiCaches switch is irrelevant here — removing your OWN pointer for a
 * book you deleted is always safe. A null backend / missing contentHash is a
 * clean no-op; a backend error is logged (LibraryService degrades too).
 */
async function purgeBookArtifact(bookId: string): Promise<void> {
  const handle = peekSyncOrchestrator()?.getConnectedArtifactBackend() ?? null;
  if (!handle) return;

  const manifest = await bookContent.getManifest(bookId);
  const contentHash = manifest?.contentHash;
  if (!contentHash) return;

  const s = useGenAIStore.getState();
  const key = await contentKey({
    contentHash,
    model: s.embeddingModel,
    dims: s.embeddingDims,
    quant: CURRENT_QUANT,
    extractionVersion: TTS_EXTRACTION_VERSION,
  });
  try {
    await handle.backend.deleteArtifactHead(handle.workspaceId, `embedCache/${key}`);
  } catch (err) {
    logger.warn(`Cloud HEAD-doc delete failed for ${bookId}; sweeper will reclaim it:`, err);
  }
}

export function getLibrary(): LibraryComposition {
  if (instance) return instance;

  const mutex = new KeyedMutex();
  const inventory = buildInventoryPort();
  const readingList = buildReadingListPort();
  const projection = buildProjectionPort();
  const persistence = createLibraryPersistence({
    getBookMetadata: (bookId) => bookRepository.getBookMetadata(bookId),
    getBookMetadataBulk: (bookIds) => bookRepository.getBookMetadataBulk(bookIds),
    getBookIdByFilename: (filename) => bookRepository.getBookIdByFilename(filename),
  });

  const orchestrator = new ImportOrchestrator({
    mutex,
    inventory,
    readingList,
    projection,
    persistence,
    // Captured PER JOB — severs the old useTTSSettingsStore.getState()
    // reach-ins inside lib/ (coupling #2).
    extractionOptions: () => ({
      sanitizationEnabled: useTTSSettingsStore.getState().sanitizationEnabled,
    }),
  });

  const service = new LibraryService({
    mutex,
    inventory,
    projection,
    persistence,
    orchestrator,
    // On book removal, drop THIS device's HEAD record in the shared embedding
    // cache (the shared blob is left for the sweeper). Edges live in this file.
    purgeBookArtifact,
  });

  instance = { mutex, orchestrator, service };
  return instance;
}
