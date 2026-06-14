/**
 * Library-domain test composition (Phase 7): the REAL KeyedMutex +
 * ImportOrchestrator + LibraryService over the REAL zustand stores, with the
 * persistence seam (and optionally the extractor) injected — the same
 * wiring as `src/app/library/createLibrary.ts` minus IDB.
 */
import {
  KeyedMutex,
  ImportOrchestrator,
  LibraryService,
  type LibraryPersistence,
} from '@domains/library';
import type { ImportOrchestratorDeps } from '@domains/library';
import type { FullBookExtraction } from '@domains/library';
import {
  buildInventoryPort,
  buildReadingListPort,
  buildProjectionPort,
} from '@app/library/createLibrary';
import type { ExtractionOptions } from '@lib/ingestion/sentence-extraction';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';

export interface TestLibrary {
  mutex: KeyedMutex;
  orchestrator: ImportOrchestrator;
  service: LibraryService;
}

export function makeTestLibrary(opts: {
  persistence: LibraryPersistence;
  extract?: ImportOrchestratorDeps['extract'];
  expandZip?: ImportOrchestratorDeps['expandZip'];
  extractionOptions?: () => ExtractionOptions;
  now?: () => number;
}): TestLibrary {
  const mutex = new KeyedMutex();
  const inventory = buildInventoryPort();
  const readingList = buildReadingListPort();
  const projection = buildProjectionPort();

  const orchestrator = new ImportOrchestrator({
    mutex,
    inventory,
    readingList,
    projection,
    persistence: opts.persistence,
    extractionOptions: opts.extractionOptions ?? (() => ({})),
    extract: opts.extract,
    expandZip: opts.expandZip,
    now: opts.now,
  });

  const service = new LibraryService({
    mutex,
    inventory,
    projection,
    persistence: opts.persistence,
    orchestrator,
  });

  return { mutex, orchestrator, service };
}

/** Complete, valid FullBookExtraction fixture (overrides typechecked). */
export function makeFullExtraction(
  overrides: Partial<FullBookExtraction> & Pick<FullBookExtraction, 'bookId'>,
): FullBookExtraction {
  const bookId = overrides.bookId;
  const title = overrides.title ?? `Title ${bookId}`;
  const author = overrides.author ?? 'Extracted Author';
  const filename = overrides.resource ? '' : `${bookId}.epub`;
  const now = 1_700_000_000_000;

  return {
    depth: 'full',
    title,
    author,
    description: '',
    language: 'en',
    contentHash: `sha-${bookId}`,
    legacyFingerprint: `${filename}-${title}-${author}-aa-bb`,
    toc: [],
    manifest: {
      bookId,
      title,
      author,
      description: '',
      fileHash: `${filename}-${title}-${author}-aa-bb`,
      contentHash: `sha-${bookId}`,
      fileSize: 10,
      totalChars: 100,
      schemaVersion: 3,
      coverPalette: [1, 2, 3],
    },
    resource: { bookId, epubBlob: new Blob(['epub']) as unknown as File },
    structure: { bookId, toc: [], spineItems: [{ id: 'ch1.xhtml', characterCount: 100, index: 0 }] },
    sections: [
      { id: `${bookId}-ch1.xhtml`, bookId, sectionId: 'ch1.xhtml', characterCount: 100, playOrder: 0, title: 'Ch 1' },
    ],
    inventory: {
      bookId,
      title,
      author,
      addedAt: now,
      lastInteraction: now,
      sourceFilename: filename,
      tags: [],
      status: 'unread',
      coverPalette: [1, 2, 3],
      language: 'en',
    },
    progress: { bookId, percentage: 0, lastRead: 0, completedRanges: [] },
    overrides: { bookId, lexicon: [] },
    readingListEntry: {
      filename,
      title,
      author,
      isbn: undefined,
      percentage: 0,
      lastUpdated: now,
      status: 'to-read',
      rating: undefined,
    },
    ttsContentBatches: [
      {
        id: `${bookId}-ch1.xhtml`,
        bookId,
        sectionId: 'ch1.xhtml',
        sentences: [{ text: 'A sentence.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
        extractionVersion: TTS_EXTRACTION_VERSION,
      },
    ],
    tableBatches: [],
    searchText: {
      extractionVersion: TTS_EXTRACTION_VERSION,
      sections: [{ href: 'ch1.xhtml', title: 'Ch 1', text: 'A sentence.' }],
    },
    ...overrides,
  };
}
