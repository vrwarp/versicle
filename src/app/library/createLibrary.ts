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
import { bookRepository } from '@app/repositories/BookRepository';

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

  const service = new LibraryService({ mutex, inventory, projection, persistence, orchestrator });

  instance = { mutex, orchestrator, service };
  return instance;
}
