/**
 * `ImportOrchestrator` — the queue, the policy fork and the register
 * flavors, over in-memory ports.
 *
 * importFlows.characterization.test.ts drives whole flows through the real
 * stores. This file isolates the decisions those flows exercise only in
 * combination: the two-class FIFO, the duplicate policy's three answers,
 * ghost adoption and its probe-failure fallback, batch accounting
 * (dedupe-by-name, progress, per-file failure reasons), the ZIP expansion's
 * byte-weighted progress, restore acceptance's hash-then-fingerprint
 * ladder, and what each register flavor preserves versus overwrites.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BookMetadata } from '~types/book';
import type { UserInventoryItem, ReadingListEntry } from '~types/user-data';
import type { StaticManifestRow } from '@data/rows/static';
import { StorageFullError } from '~types/errors';
import { KeyedMutex } from '../mutex';
import { computeContentHash, computeLegacyFingerprint } from './identity';
import type { FullBookExtraction, BookMetadataExtraction } from './extract';
import {
  ImportOrchestrator,
  type ImportOrchestratorDeps,
} from './ImportOrchestrator';

// ── fixtures ───────────────────────────────────────────────────────────────

const epubFile = (name = 'book.epub', bytes = new Uint8Array([1, 2, 3])): File => {
  const file = new File([bytes], name, { type: 'application/epub+zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
};

const extraction = (over: Record<string, unknown> = {}): FullBookExtraction =>
  ({
    depth: 'full',
    bookId: 'new-book',
    title: 'A Title',
    author: 'An Author',
    description: '',
    language: 'en',
    contentHash: 'hash-c',
    legacyFingerprint: 'hash-l',
    toc: [],
    manifest: {
      bookId: 'new-book',
      title: 'A Title',
      author: 'An Author',
      schemaVersion: 6,
      coverPalette: [1, 2, 3],
      perceptualPalette: { vibrant: [4, 5, 6] },
      language: 'en',
    },
    resource: { bookId: 'new-book', epubBlob: epubFile() },
    structure: { bookId: 'new-book', toc: [], spineItems: [] },
    sections: [],
    inventory: {
      bookId: 'new-book',
      title: 'A Title',
      author: 'An Author',
      addedAt: 1,
      sourceFilename: 'book.epub',
      tags: [],
      status: 'unread',
      lastInteraction: 1,
    },
    progress: { bookId: 'new-book', percentage: 0, lastRead: 0, completedRanges: [] },
    overrides: { bookId: 'new-book', lexicon: [] },
    readingListEntry: {
      filename: 'book.epub',
      title: 'A Title',
      author: 'An Author',
      percentage: 0,
      lastUpdated: 1,
      status: 'to-read',
    },
    ttsContentBatches: [],
    tableBatches: [],
    searchText: { extractionVersion: 3, sections: [] },
    ...over,
  }) as unknown as FullBookExtraction;

interface Harness {
  orchestrator: ImportOrchestrator;
  inventory: Record<string, UserInventoryItem>;
  readingList: Record<string, ReadingListEntry>;
  statics: Map<string, BookMetadata>;
  offloaded: Set<string>;
  calls: string[];
  errors: Array<string | null>;
  progress: Array<[number, string]>;
  uploads: Array<[number, string]>;
  summaries: unknown[];
  logs: { warn: string[]; info: string[]; error: unknown[][] };
  extract: ReturnType<typeof vi.fn>;
  expandZip: ReturnType<typeof vi.fn>;
  manifests: Map<string, StaticManifestRow>;
  filenameIndex: Map<string, string>;
}

const build = (over: Partial<ImportOrchestratorDeps> = {}): Harness => {
  const inventory: Record<string, UserInventoryItem> = {};
  const readingList: Record<string, ReadingListEntry> = {};
  const statics = new Map<string, BookMetadata>();
  const offloaded = new Set<string>();
  const calls: string[] = [];
  const errors: Array<string | null> = [];
  const progress: Array<[number, string]> = [];
  const uploads: Array<[number, string]> = [];
  const summaries: unknown[] = [];
  const manifests = new Map<string, StaticManifestRow>();
  const filenameIndex = new Map<string, string>();
  const logs = { warn: [] as string[], info: [] as string[], error: [] as unknown[][] };

  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => logs.info.push(a.map(String).join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => logs.warn.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => logs.error.push(a));
  vi.spyOn(console, 'debug').mockImplementation(() => {});

  const extract = vi.fn(async () => extraction());
  const expandZip = vi.fn(async () => []);

  const orchestrator = new ImportOrchestrator({
    mutex: new KeyedMutex(),
    inventory: {
      all: () => inventory,
      get: (id) => Object.values(inventory).find((b) => b.bookId === id),
      upsert: (item) => {
        calls.push(`inventory.upsert:${item.bookId}`);
        inventory[item.bookId] = item;
      },
      upsertMany: () => undefined,
      update: (id, updates) => {
        calls.push(`inventory.update:${id}:${JSON.stringify(updates)}`);
      },
      remove: (id) => {
        delete inventory[id];
      },
      subscribe: () => () => undefined,
    },
    readingList: {
      get: (filename) => readingList[filename],
      upsert: (entry) => {
        calls.push(`readingList.upsert:${entry.filename}:${entry.bookId}`);
        readingList[entry.filename] = entry;
      },
      update: (filename, updates) => {
        calls.push(`readingList.update:${filename}:${JSON.stringify(updates)}`);
        readingList[filename] = { ...readingList[filename], ...updates } as ReadingListEntry;
      },
    },
    projection: {
      staticIds: () => new Set(statics.keys()),
      setStatic: (id, m) => {
        calls.push(`setStatic:${id}`);
        statics.set(id, m);
      },
      setStaticMany: () => undefined,
      removeStatic: (id) => statics.delete(id),
      offloaded: () => offloaded,
      addOffloaded: (id) => offloaded.add(id),
      addOffloadedMany: () => undefined,
      removeOffloaded: (id) => {
        calls.push(`removeOffloaded:${id}`);
        offloaded.delete(id);
      },
      setHydrating: () => undefined,
      setHasHydrated: () => undefined,
      setError: (m) => errors.push(m),
      importStarted: () => calls.push('importStarted'),
      importProgress: (p, m) => progress.push([p, m]),
      uploadProgress: (p, m) => uploads.push([p, m]),
      importFinished: () => calls.push('importFinished'),
      setBatchSummary: (s) => summaries.push(s),
    },
    persistence: {
      ingest: async (e, opts) => {
        calls.push(`ingest:${e.bookId}:${opts.mode}`);
      },
      deleteBook: async () => undefined,
      offloadBook: async () => undefined,
      restoreResource: async (id) => {
        calls.push(`restoreResource:${id}`);
      },
      getManifest: async (id) => manifests.get(id),
      writeContentHash: async (id, hash) => {
        calls.push(`writeContentHash:${id}:${hash}`);
      },
      getBookMetadata: async (id) => ({ id, title: 'Fresh' }) as BookMetadata,
      getOffloadedStatus: async () => new Map(),
      getBookIdByFilename: (filename) => filenameIndex.get(filename),
      reprocess: async () => ({}) as never,
    },
    extractionOptions: () => ({ minSentenceLength: 2 }) as never,
    extract: extract as unknown as ImportOrchestratorDeps['extract'],
    expandZip: expandZip as unknown as ImportOrchestratorDeps['expandZip'],
    now: () => 5000,
    ...over,
  });

  return {
    orchestrator,
    inventory,
    readingList,
    statics,
    offloaded,
    calls,
    errors,
    progress,
    uploads,
    summaries,
    logs,
    extract,
    expandZip,
    manifests,
    filenameIndex,
  };
};

const item = (over: Partial<UserInventoryItem> = {}): UserInventoryItem =>
  ({
    bookId: 'existing',
    title: 'A Title',
    author: 'An Author',
    addedAt: 100,
    sourceFilename: 'book.epub',
    tags: ['fiction'],
    status: 'reading',
    lastInteraction: 100,
    ...over,
  }) as UserInventoryItem;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImportOrchestrator — the two-class queue', () => {
  it('reports nothing pending when idle', () => {
    expect(build().orchestrator.pendingCount()).toEqual({ normal: 0, idle: 0 });
  });

  it('runs jobs one at a time, FIFO within a class', async () => {
    const order: string[] = [];
    const h = build();
    h.extract.mockImplementation(async (file: File) => {
      order.push(`start:${file.name}`);
      await new Promise((r) => setTimeout(r, 0));
      order.push(`end:${file.name}`);
      return extraction({ bookId: file.name });
    });

    await Promise.all([
      h.orchestrator.importFile(epubFile('a.epub'), { adoptGhosts: false }),
      h.orchestrator.importFile(epubFile('b.epub'), { adoptGhosts: false }),
    ]);

    expect(order).toEqual(['start:a.epub', 'end:a.epub', 'start:b.epub', 'end:b.epub']);
  });

  it('IDLE work waits behind every normal job', async () => {
    const order: string[] = [];
    const h = build({
      persistence: {
        ingest: async () => undefined,
        deleteBook: async () => undefined,
        offloadBook: async () => undefined,
        restoreResource: async () => undefined,
        getManifest: async () => undefined,
        writeContentHash: async () => undefined,
        getBookMetadata: async () => undefined,
        getOffloadedStatus: async () => new Map(),
        getBookIdByFilename: () => undefined,
        reprocess: async (bookId) => {
          order.push(bookId);
          return {} as never;
        },
      },
    });
    // Occupy the pump so all three queue up behind it.
    const blocker = h.orchestrator.reprocess('blocker');
    const idle = h.orchestrator.reprocess('idle-job', 'idle');
    const normal = h.orchestrator.reprocess('normal-job', 'normal');

    await Promise.all([blocker, idle, normal]);

    expect(order).toEqual(['blocker', 'normal-job', 'idle-job']);
  });

  it('a failing job rejects its own caller and never stalls the queue', async () => {
    const h = build();
    h.extract.mockRejectedValueOnce(new Error('bad file'));

    const first = await h.orchestrator.importFile(epubFile('a.epub'), { adoptGhosts: false });
    const second = await h.orchestrator.importFile(epubFile('b.epub'), { adoptGhosts: false });

    expect(first.status).toBe('failed');
    expect(second.status).toBe('imported');
  });

  it('brackets each import with started/finished, even on failure', async () => {
    const h = build();
    h.extract.mockRejectedValue(new Error('bad file'));

    await h.orchestrator.importFile(epubFile(), { adoptGhosts: false });

    expect(h.calls.filter((c) => c.startsWith('import'))).toEqual([
      'importStarted',
      'importFinished',
    ]);
  });
});

describe('ImportOrchestrator.importFile — the duplicate policy', () => {
  const withDuplicate = (): Harness => {
    const h = build();
    h.inventory['existing'] = item();
    return h;
  };

  it("surfaces the Replace dialog under 'ask' (the default)", async () => {
    const h = withDuplicate();

    await expect(h.orchestrator.importFile(epubFile('book.epub'))).resolves.toEqual({
      status: 'duplicate',
      existingBookId: 'existing',
    });
    expect(h.extract).not.toHaveBeenCalled();
  });

  it("skips under 'skip'", async () => {
    const h = withDuplicate();

    await expect(
      h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'skip' })
    ).resolves.toEqual({ status: 'skipped', filename: 'book.epub' });
    expect(h.extract).not.toHaveBeenCalled();
  });

  it("re-derives under the existing id under 'replace'", async () => {
    const h = withDuplicate();

    await expect(
      h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' })
    ).resolves.toEqual({ status: 'replaced', bookId: 'existing' });
  });

  it('falls back to the DB filename index when the inventory has no match', async () => {
    const h = build();
    h.filenameIndex.set('book.epub', 'from-index');
    h.inventory['from-index'] = item({ bookId: 'from-index', sourceFilename: 'other.epub' });

    await expect(h.orchestrator.importFile(epubFile('book.epub'))).resolves.toEqual({
      status: 'duplicate',
      existingBookId: 'from-index',
    });
  });
});

describe('ImportOrchestrator.importFile — ghost adoption', () => {
  const ghostHarness = (): Harness => {
    const h = build();
    h.inventory['ghost-1'] = item({
      bookId: 'ghost-1',
      title: '  A Title  ',
      author: 'An Author ',
      sourceFilename: 'synced.epub',
    });
    h.extract.mockImplementation(async (_file: File, opts: { depth: string }) =>
      opts.depth === 'metadata'
        ? ({ depth: 'metadata', title: 'A Title', author: 'An Author' } as BookMetadataExtraction)
        : extraction()
    );
    return h;
  };

  it('adopts an inventory entry with NO local content, matched on trimmed title+author', async () => {
    const h = ghostHarness();

    await expect(h.orchestrator.importFile(epubFile('new-name.epub'))).resolves.toEqual({
      status: 'imported',
      bookId: 'ghost-1',
      adoptedGhost: true,
    });
    expect(h.calls).toContain('ingest:ghost-1:overwrite');
  });

  it('does NOT adopt a book that already has local content', async () => {
    const h = ghostHarness();
    h.statics.set('ghost-1', { id: 'ghost-1' } as BookMetadata);

    const result = await h.orchestrator.importFile(epubFile('new-name.epub'));

    expect(result).toEqual({ status: 'imported', bookId: 'new-book' });
  });

  it('does not adopt on a title-only or author-only match', async () => {
    const h = ghostHarness();
    h.inventory['ghost-1'] = item({ bookId: 'ghost-1', title: 'A Title', author: 'Someone Else' });

    await expect(h.orchestrator.importFile(epubFile('new.epub'))).resolves.toMatchObject({
      bookId: 'new-book',
    });
  });

  it('refuses to match on blank metadata', async () => {
    const h = build();
    h.inventory['ghost-1'] = item({ bookId: 'ghost-1', title: '', author: '' });
    h.extract.mockImplementation(async (_f: File, opts: { depth: string }) =>
      opts.depth === 'metadata'
        ? ({ depth: 'metadata', title: '   ', author: '' } as BookMetadataExtraction)
        : extraction()
    );

    await expect(h.orchestrator.importFile(epubFile('new.epub'))).resolves.toMatchObject({
      bookId: 'new-book',
    });
  });

  it('skips the probe entirely when adoption is off', async () => {
    const h = ghostHarness();

    await h.orchestrator.importFile(epubFile('new.epub'), { adoptGhosts: false });

    expect(h.extract.mock.calls.every((c) => (c[1] as { depth: string }).depth === 'full')).toBe(
      true
    );
  });

  it('falls through to a standard import when the PROBE fails', async () => {
    const h = build();
    h.extract.mockImplementation(async (_f: File, opts: { depth: string }) => {
      if (opts.depth === 'metadata') throw new Error('probe blew up');
      return extraction();
    });

    await expect(h.orchestrator.importFile(epubFile('new.epub'))).resolves.toEqual({
      status: 'imported',
      bookId: 'new-book',
    });
    expect(h.logs.warn.some((l) => l.includes('Smart matching check failed'))).toBe(true);
  });

  it('REUSES the probe preamble for the full extraction', async () => {
    const h = build();
    const probe = { depth: 'metadata', title: 'T', author: 'A' } as BookMetadataExtraction;
    h.extract.mockImplementation(async (_f: File, opts: { depth: string }) =>
      opts.depth === 'metadata' ? probe : extraction()
    );

    await h.orchestrator.importFile(epubFile('new.epub'));

    const full = h.extract.mock.calls.find((c) => (c[1] as { depth: string }).depth === 'full');
    expect((full?.[1] as { preamble: unknown }).preamble).toBe(probe);
  });
});

describe('ImportOrchestrator.importFile — failure reporting', () => {
  it('names storage exhaustion specifically', async () => {
    const h = build();
    h.extract.mockRejectedValue(new StorageFullError('quota'));

    const result = await h.orchestrator.importFile(epubFile(), { adoptGhosts: false });

    expect(result.status).toBe('failed');
    expect(h.errors).toEqual(['Device storage full. Please delete some books.']);
  });

  it('reports any other failure generically but keeps the real message on the error', async () => {
    const h = build();
    h.extract.mockRejectedValue(new Error('corrupt zip'));

    const result = await h.orchestrator.importFile(epubFile(), { adoptGhosts: false });

    expect(h.errors).toEqual(['Failed to import book.']);
    expect(result.status === 'failed' && result.error.message).toBe('corrupt zip');
  });

  it('wraps a non-Error rejection', async () => {
    const h = build();
    h.extract.mockRejectedValue('just a string');

    const result = await h.orchestrator.importFile(epubFile(), { adoptGhosts: false });

    expect(result.status === 'failed' && result.error.message).toBe('just a string');
  });
});

describe('ImportOrchestrator.importFiles — batch accounting', () => {
  it('counts every input file exactly once and reports the summary', async () => {
    const h = build();
    let n = 0;
    h.extract.mockImplementation(async () => extraction({ bookId: `book-${n++}` }));

    const summary = await h.orchestrator.importFiles([epubFile('a.epub'), epubFile('b.epub')], {
      adoptGhosts: false,
    });

    expect(summary).toEqual({ imported: 2, skipped: [], failed: [] });
    expect(h.summaries).toEqual([null, summary]);
  });

  it('skips a repeated FILENAME within the same batch', async () => {
    const h = build();
    let n = 0;
    h.extract.mockImplementation(async () => extraction({ bookId: `book-${n++}` }));

    const summary = await h.orchestrator.importFiles([epubFile('a.epub'), epubFile('a.epub')], {
      adoptGhosts: false,
    });

    expect(summary).toEqual({ imported: 1, skipped: ['a.epub'], failed: [] });
  });

  it('records a per-file failure reason without aborting the batch', async () => {
    const h = build();
    let call = 0;
    h.extract.mockImplementation(async () => {
      if (call++ === 0) throw new Error('bad first file');
      return extraction({ bookId: 'book-2' });
    });

    const summary = await h.orchestrator.importFiles([epubFile('a.epub'), epubFile('b.epub')], {
      adoptGhosts: false,
    });

    expect(summary.imported).toBe(1);
    expect(summary.failed).toEqual([{ filename: 'a.epub', reason: 'bad first file' }]);
  });

  it("defaults duplicates to 'skip' rather than prompting mid-batch", async () => {
    const h = build();
    h.inventory['existing'] = item();

    const summary = await h.orchestrator.importFiles([epubFile('book.epub')]);

    expect(summary).toEqual({ imported: 0, skipped: ['book.epub'], failed: [] });
  });

  it('warns once when the batch ends with skips or failures', async () => {
    const h = build();
    h.inventory['existing'] = item();

    await h.orchestrator.importFiles([epubFile('book.epub')]);

    expect(h.logs.warn.some((l) => l.includes('Batch import finished with 1 duplicate'))).toBe(
      true
    );
  });

  it('says nothing when everything imported cleanly', async () => {
    const h = build();

    await h.orchestrator.importFiles([epubFile('a.epub')], { adoptGhosts: false });

    expect(h.logs.warn.some((l) => l.includes('Batch import finished'))).toBe(false);
  });

  it('reports per-file progress as a position in the batch', async () => {
    const h = build();
    let n = 0;
    h.extract.mockImplementation(async () => extraction({ bookId: `book-${n++}` }));

    await h.orchestrator.importFiles(
      [epubFile('a.epub'), epubFile('b.epub'), epubFile('c.epub'), epubFile('d.epub')],
      { adoptGhosts: false }
    );

    const batchLines = h.progress.filter(([, m]) => m.startsWith('Importing '));
    expect(batchLines.map(([p]) => p)).toEqual([0, 25, 50, 75]);
    expect(batchLines[0][1]).toBe('Importing 1 of 4: a.epub');
    expect(batchLines[3][1]).toBe('Importing 4 of 4: d.epub');
  });
});

describe('ImportOrchestrator — ZIP expansion', () => {
  const zipFile = (name = 'books.zip', size = 100): File => {
    const file = new File([new Uint8Array(size)], name, { type: 'application/zip' });
    return file;
  };

  it('expands a zip into its epubs', async () => {
    const h = build();
    h.expandZip.mockResolvedValue([epubFile('inner-a.epub'), epubFile('inner-b.epub')]);
    let n = 0;
    h.extract.mockImplementation(async () => extraction({ bookId: `book-${n++}` }));

    const summary = await h.orchestrator.importFiles([zipFile()], { adoptGhosts: false });

    expect(summary.imported).toBe(2);
  });

  it('records the zip itself as failed when expansion throws', async () => {
    const h = build();
    h.expandZip.mockRejectedValue(new Error('corrupt archive'));

    const summary = await h.orchestrator.importFiles([zipFile('bad.zip')], { adoptGhosts: false });

    expect(summary.failed).toEqual([{ filename: 'bad.zip', reason: 'corrupt archive' }]);
    expect(h.logs.warn.some((l) => l.includes('Failed to extract zip bad.zip'))).toBe(true);
  });

  it('names a non-Error zip failure generically', async () => {
    const h = build();
    h.expandZip.mockRejectedValue('nope');

    const summary = await h.orchestrator.importFiles([zipFile('bad.zip')], { adoptGhosts: false });

    expect(summary.failed[0].reason).toBe('Failed to extract ZIP archive.');
  });

  it('rejects an unsupported extension by name', async () => {
    const h = build();

    const summary = await h.orchestrator.importFiles([new File(['x'], 'notes.txt')], {
      adoptGhosts: false,
    });

    expect(summary.failed).toEqual([
      { filename: 'notes.txt', reason: 'Unsupported file type (expected .epub or .zip).' },
    ]);
  });

  it('matches extensions case-insensitively', async () => {
    const h = build();
    h.expandZip.mockResolvedValue([]);

    const summary = await h.orchestrator.importFiles(
      [new File(['x'], 'A.EPUB'), new File(['x'], 'B.ZIP')],
      { adoptGhosts: false }
    );

    expect(summary.failed).toEqual([]);
    expect(h.expandZip).toHaveBeenCalledTimes(1);
  });

  it('weights expansion progress by BYTES across the whole batch', async () => {
    const h = build();
    h.expandZip.mockImplementation(async (_f: File, onProgress: (p: number) => void) => {
      onProgress(50);
      onProgress(100);
      return [];
    });

    await h.orchestrator.importFiles([zipFile('a.zip', 100), zipFile('b.zip', 300)], {
      adoptGhosts: false,
    });

    // a.zip is a quarter of the 400 bytes: half of it is 12.5% → 13.
    expect(h.uploads.map(([p]) => p)).toEqual([13, 25, 63, 100, 100]);
  });

  it('always finishes the expansion phase at 100%', async () => {
    const h = build();

    await h.orchestrator.importFiles([epubFile('a.epub')], { adoptGhosts: false });

    expect(h.uploads.at(-1)).toEqual([100, 'All files processed. Starting import...']);
  });

  it('reports 100% rather than dividing by zero for empty inputs', async () => {
    const h = build();
    h.expandZip.mockResolvedValue([]);

    await h.orchestrator.importFiles([zipFile('empty.zip', 0)], { adoptGhosts: false });

    expect(h.uploads[0][0]).toBe(100);
  });
});

describe('ImportOrchestrator.restore — acceptance and registration', () => {
  const fileWith = (bytes: Uint8Array) =>
    epubFile('book.epub', bytes as Uint8Array<ArrayBuffer>);

  it('accepts a matching contentHash and restores the binary in place', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const file = fileWith(bytes);
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', { contentHash: await computeContentHash(file) } as StaticManifestRow);

    await h.orchestrator.restore('b1', file);

    expect(h.calls).toContain('restoreResource:b1');
    expect(h.calls).toContain('removeOffloaded:b1');
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('REFUSES a content-hash mismatch', async () => {
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', { contentHash: 'something-else' } as StaticManifestRow);

    await expect(h.orchestrator.restore('b1', epubFile())).rejects.toThrow(
      'content hash mismatch'
    );
    expect(h.errors).toEqual(['File verification failed: content hash mismatch.']);
  });

  it('accepts a RENAMED file against a pre-P7 fingerprint and upgrades the manifest', async () => {
    const file = fileWith(new Uint8Array([4, 5, 6]));
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', {
      fileHash: await computeLegacyFingerprint(file, {
        title: 'Old',
        author: 'Old',
        filename: 'old-name.epub',
      }),
    } as StaticManifestRow);

    await h.orchestrator.restore('b1', file);

    expect(h.calls).toContain('restoreResource:b1');
    expect(h.calls.some((c) => c.startsWith('writeContentHash:b1:'))).toBe(true);
  });

  it('refuses a fingerprint mismatch', async () => {
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', { fileHash: 'nope-nope' } as StaticManifestRow);

    await expect(h.orchestrator.restore('b1', epubFile())).rejects.toThrow(
      'fingerprint mismatch'
    );
  });

  it('a failed lazy upgrade never fails the restore', async () => {
    const file = fileWith(new Uint8Array([7, 7]));
    const h = build({
      persistence: {
        ingest: async () => undefined,
        deleteBook: async () => undefined,
        offloadBook: async () => undefined,
        restoreResource: async () => undefined,
        getManifest: async () =>
          ({
            fileHash: await computeLegacyFingerprint(file, {
              title: 'x',
              author: 'y',
              filename: 'z.epub',
            }),
          }) as StaticManifestRow,
        writeContentHash: async () => {
          throw new Error('idb closed');
        },
        getBookMetadata: async () => undefined,
        getOffloadedStatus: async () => new Map(),
        getBookIdByFilename: () => undefined,
        reprocess: async () => ({}) as never,
      },
    });
    h.inventory['b1'] = item({ bookId: 'b1' });

    await expect(h.orchestrator.restore('b1', file)).resolves.toBeUndefined();
    expect(h.logs.warn.some((l) => l.includes('Lazy contentHash manifest upgrade failed'))).toBe(
      true
    );
  });

  it('re-derives under the existing id when the user overrides a mismatch', async () => {
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', { contentHash: 'something-else' } as StaticManifestRow);

    await h.orchestrator.restore('b1', epubFile(), { allowContentMismatch: true });

    expect(h.calls).toContain('ingest:b1:overwrite');
    expect(h.logs.info.some((l) => l.includes('content-mismatched file (user override)'))).toBe(
      true
    );
  });

  it('re-derives for a synced book with NO local manifest', async () => {
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });

    await h.orchestrator.restore('b1', epubFile());

    expect(h.calls).toContain('ingest:b1:overwrite');
    expect(h.logs.info.some((l) => l.includes('has no local manifest'))).toBe(true);
  });

  it('does NOT resurrect a book removed while the restore was running', async () => {
    const bytes = new Uint8Array([3, 3, 3]);
    const file = fileWith(bytes);
    const h = build();
    h.inventory['b1'] = item({ bookId: 'b1' });
    h.manifests.set('b1', { contentHash: await computeContentHash(file) } as StaticManifestRow);
    h.offloaded.add('b1');

    const pending = h.orchestrator.restore('b1', file);
    delete h.inventory['b1'];
    await pending;

    expect(h.calls).not.toContain('removeOffloaded:b1');
    expect(h.statics.has('b1')).toBe(false);
  });
});

describe('ImportOrchestrator — the register flavors', () => {
  it('REPLACE overwrites title/author/filename but preserves status, tags and addedAt', async () => {
    const h = build();
    h.inventory['existing'] = item({ status: 'reading', tags: ['fiction'], addedAt: 100 });

    await h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' });

    expect(h.inventory['existing']).toMatchObject({
      title: 'A Title',
      author: 'An Author',
      sourceFilename: 'book.epub',
      lastInteraction: 5000,
      status: 'reading',
      tags: ['fiction'],
      addedAt: 100,
      coverPalette: [1, 2, 3],
    });
  });

  it('REPLACE refreshes an existing reading-list entry, keeping its FK', async () => {
    const h = build();
    h.inventory['existing'] = item();
    h.readingList['book.epub'] = {
      filename: 'book.epub',
      title: 'Old',
      bookId: 'existing',
    } as ReadingListEntry;

    await h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' });

    expect(h.readingList['book.epub']).toMatchObject({
      title: 'A Title',
      author: 'An Author',
      lastUpdated: 5000,
      bookId: 'existing',
    });
  });

  it('REPLACE backfills a missing FK on the existing entry', async () => {
    const h = build();
    h.inventory['existing'] = item();
    h.readingList['book.epub'] = { filename: 'book.epub', title: 'Old' } as ReadingListEntry;

    await h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' });

    expect(h.readingList['book.epub'].bookId).toBe('existing');
  });

  it('REPLACE creates a reading-list entry when none exists', async () => {
    const h = build();
    h.inventory['existing'] = item();

    await h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' });

    expect(h.readingList['book.epub']).toMatchObject({ bookId: 'existing' });
  });

  it('GHOST leaves the inventory item alone and only backfills the FK', async () => {
    const h = build();
    h.inventory['ghost-1'] = item({ bookId: 'ghost-1', sourceFilename: 'synced.epub' });
    h.readingList['synced.epub'] = { filename: 'synced.epub', title: 'Synced' } as ReadingListEntry;
    h.extract.mockImplementation(async (_f: File, opts: { depth: string }) =>
      opts.depth === 'metadata'
        ? ({ depth: 'metadata', title: 'A Title', author: 'An Author' } as BookMetadataExtraction)
        : extraction()
    );

    await h.orchestrator.importFile(epubFile('downloaded.epub'));

    expect(h.inventory['ghost-1'].title).toBe('A Title'); // untouched original
    expect(h.calls.some((c) => c.startsWith('inventory.upsert'))).toBe(false);
    expect(h.readingList['synced.epub'].bookId).toBe('ghost-1');
  });

  it('GHOST does not overwrite an FK the entry already carries', async () => {
    const h = build();
    h.inventory['ghost-1'] = item({ bookId: 'ghost-1', sourceFilename: 'synced.epub' });
    h.readingList['synced.epub'] = {
      filename: 'synced.epub',
      bookId: 'someone-else',
    } as ReadingListEntry;
    h.extract.mockImplementation(async (_f: File, opts: { depth: string }) =>
      opts.depth === 'metadata'
        ? ({ depth: 'metadata', title: 'A Title', author: 'An Author' } as BookMetadataExtraction)
        : extraction()
    );

    await h.orchestrator.importFile(epubFile('downloaded.epub'));

    expect(h.readingList['synced.epub'].bookId).toBe('someone-else');
  });

  it('does not register a book removed mid-import', async () => {
    const h = build();
    h.inventory['existing'] = item();
    h.extract.mockImplementation(async () => {
      delete h.inventory['existing'];
      return extraction();
    });

    await h.orchestrator.importFile(epubFile('book.epub'), { onDuplicate: 'replace' });

    expect(h.statics.has('existing')).toBe(false);
    expect(h.logs.warn.some((l) => l.includes('was removed while importing'))).toBe(true);
  });

  it('NEW registers the extractor inventory item and an FK-carrying list entry', async () => {
    const h = build();

    await h.orchestrator.importFile(epubFile('book.epub'), { adoptGhosts: false });

    expect(h.inventory['new-book']).toMatchObject({ bookId: 'new-book', status: 'unread' });
    expect(h.readingList['book.epub']).toMatchObject({ bookId: 'new-book' });
    expect(h.statics.get('new-book')).toMatchObject({ id: 'new-book', addedAt: 5000 });
    expect(h.calls).toContain('removeOffloaded:new-book');
  });

  it('NEW refreshes a pre-existing reading-list entry instead of duplicating it', async () => {
    const h = build();
    h.readingList['book.epub'] = { filename: 'book.epub', title: 'Stale' } as ReadingListEntry;

    await h.orchestrator.importFile(epubFile('book.epub'), { adoptGhosts: false });

    expect(h.readingList['book.epub']).toMatchObject({
      title: 'A Title',
      bookId: 'new-book',
      lastUpdated: 5000,
    });
  });
});

describe('ImportOrchestrator.reprocess', () => {
  const reprocessHarness = (result: Record<string, unknown>): Harness =>
    build({
      persistence: {
        ingest: async () => undefined,
        deleteBook: async () => undefined,
        offloadBook: async () => undefined,
        restoreResource: async () => undefined,
        getManifest: async () => undefined,
        writeContentHash: async () => undefined,
        getBookMetadata: async () => ({ id: 'b1', title: 'Fresh' }) as BookMetadata,
        getOffloadedStatus: async () => new Map(),
        getBookIdByFilename: () => undefined,
        reprocess: async () => result as never,
      },
    });

  it('refreshes the projection from the re-derived metadata', async () => {
    const h = reprocessHarness({});
    h.inventory['b1'] = item({ bookId: 'b1' });

    await h.orchestrator.reprocess('b1');

    expect(h.statics.get('b1')).toMatchObject({ id: 'b1', title: 'Fresh' });
  });

  it('writes back a re-derived palette', async () => {
    const h = reprocessHarness({ coverPalette: [7, 8], perceptualPalette: { vibrant: [1] } });
    h.inventory['b1'] = item({ bookId: 'b1' });

    await h.orchestrator.reprocess('b1');

    expect(h.calls).toContain(
      'inventory.update:b1:{"coverPalette":[7,8],"perceptualPalette":{"vibrant":[1]}}'
    );
  });

  it('leaves the inventory alone when no palette was derived', async () => {
    const h = reprocessHarness({});
    h.inventory['b1'] = item({ bookId: 'b1' });

    await h.orchestrator.reprocess('b1');

    expect(h.calls.some((c) => c.startsWith('inventory.update'))).toBe(false);
  });

  it('does not write the projection for a book that left the inventory', async () => {
    const h = reprocessHarness({});

    await h.orchestrator.reprocess('b1');

    expect(h.statics.has('b1')).toBe(false);
  });
});
