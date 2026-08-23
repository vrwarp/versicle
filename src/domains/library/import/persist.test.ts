/**
 * `persist` — the extraction retarget and the real LibraryPersistence
 * adapter.
 *
 * `retargetExtraction` rewrites EVERY bookId-bearing row when an extraction
 * is adopted onto an existing id; a row it misses becomes an orphan in the
 * database, so each one is asserted individually. The adapter itself is
 * thin, and its interesting property is what it refuses to let fail: the
 * search corpus is rebuildable, so its write never sinks an ingest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BookMetadata } from '~types/book';
import type { FullBookExtraction } from './extract';
import { createLibraryPersistence, retargetExtraction } from './persist';

const calls: string[] = [];
const searchPuts: unknown[] = [];
let searchPutThrows: Error | null = null;
let manifest: Record<string, unknown> | undefined;
const putManifests: unknown[][] = [];
let reprocessResult: Record<string, unknown> = {
  searchText: { extractionVersion: 4, sections: [{ href: 'a' }] },
};

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    ingest: async (payload: { bookId: string }, mode: string) => {
      calls.push(`ingest:${payload.bookId}:${mode}`);
    },
    deleteBook: async (id: string) => calls.push(`deleteBook:${id}`),
    offloadBook: async (id: string) => calls.push(`offloadBook:${id}`),
    restoreResource: async (id: string, bytes: ArrayBuffer) =>
      calls.push(`restoreResource:${id}:${bytes.byteLength}`),
    getManifest: async () => manifest,
    putManifests: async (rows: unknown[]) => {
      putManifests.push(rows);
    },
    getOffloadedStatus: async (ids?: string[]) => {
      calls.push(`getOffloadedStatus:${(ids ?? []).join('|')}`);
      return new Map<string, boolean>();
    },
    getAvailableResourceIds: async () => {
      calls.push('getAvailableResourceIds');
      return new Set<string>();
    },
  },
}));

vi.mock('@data/repos/searchText', () => ({
  searchTextRepo: {
    put: async (row: unknown) => {
      if (searchPutThrows) throw searchPutThrows;
      searchPuts.push(row);
    },
  },
}));

vi.mock('./reprocess', () => ({
  reprocessBookContent: async (bookId: string) => {
    calls.push(`reprocessBookContent:${bookId}`);
    return reprocessResult;
  },
}));

const extraction = (bookId = 'orig'): FullBookExtraction =>
  ({
    depth: 'full',
    bookId,
    title: 'T',
    author: 'A',
    manifest: { bookId, title: 'T' },
    resource: { bookId, epubBlob: new Blob(['x']) },
    structure: {
      bookId,
      toc: [],
      spineItems: [
        { id: `${bookId}-s0`, characterCount: 10, index: 0 },
        { id: `${bookId}-s1`, characterCount: 20, index: 1 },
      ],
    },
    sections: [{ bookId, id: `${bookId}-sec0`, sectionId: `${bookId}-s0` }],
    inventory: { bookId, title: 'T' },
    progress: { bookId, percentage: 0 },
    overrides: { bookId, lexicon: [] },
    ttsContentBatches: [{ id: `${bookId}-tts0`, bookId, sentences: [] }],
    tableBatches: [{ id: `${bookId}-tbl0`, bookId, cfi: 'c' }],
    searchText: { extractionVersion: 3, sections: [{ href: 'a', title: 'A', text: 't' }] },
  }) as unknown as FullBookExtraction;

const merged = {
  getBookMetadata: async (id: string) => ({ id }) as BookMetadata,
  getBookIdByFilename: (filename: string) => (filename === 'known.epub' ? 'b1' : undefined),
};

beforeEach(() => {
  calls.length = 0;
  searchPuts.length = 0;
  putManifests.length = 0;
  searchPutThrows = null;
  manifest = undefined;
  reprocessResult = { searchText: { extractionVersion: 4, sections: [{ href: 'a' }] } };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retargetExtraction', () => {
  it('returns the SAME object when the id already matches', () => {
    const e = extraction('same');

    expect(retargetExtraction(e, 'same')).toBe(e);
  });

  it('rewrites the top-level id and never mutates the input', () => {
    const e = extraction('orig');

    const out = retargetExtraction(e, 'target');

    expect(out.bookId).toBe('target');
    expect(e.bookId).toBe('orig');
    expect(out).not.toBe(e);
  });

  it('rewrites EVERY bookId-bearing row', () => {
    const out = retargetExtraction(extraction('orig'), 'target');

    expect(out.manifest.bookId).toBe('target');
    expect(out.resource.bookId).toBe('target');
    expect(out.structure.bookId).toBe('target');
    expect(out.sections.every((s) => s.bookId === 'target')).toBe(true);
    expect(out.inventory.bookId).toBe('target');
    expect(out.progress.bookId).toBe('target');
    expect(out.overrides.bookId).toBe('target');
    expect(out.ttsContentBatches.every((b) => b.bookId === 'target')).toBe(true);
    expect(out.tableBatches.every((t) => t.bookId === 'target')).toBe(true);
  });

  it('rewrites the id PREFIX inside every derived row id', () => {
    const out = retargetExtraction(extraction('orig'), 'target');

    expect(out.structure.spineItems.map((s) => s.id)).toEqual(['target-s0', 'target-s1']);
    expect(out.sections.map((s) => s.id)).toEqual(['target-sec0']);
    expect(out.ttsContentBatches.map((b) => b.id)).toEqual(['target-tts0']);
    expect(out.tableBatches.map((t) => t.id)).toEqual(['target-tbl0']);
  });

  it('preserves the non-id fields of every rewritten row', () => {
    const out = retargetExtraction(extraction('orig'), 'target');

    expect(out.structure.spineItems[0]).toMatchObject({ characterCount: 10, index: 0 });
    expect(out.title).toBe('T');
    expect(out.searchText.extractionVersion).toBe(3);
  });

  it('leaves the ORIGINAL rows untouched', () => {
    const e = extraction('orig');

    retargetExtraction(e, 'target');

    expect(e.structure.spineItems[0].id).toBe('orig-s0');
    expect(e.ttsContentBatches[0].bookId).toBe('orig');
  });
});

describe('createLibraryPersistence.ingest', () => {
  it('hands the content rows to the repo with the requested mode', async () => {
    await createLibraryPersistence(merged).ingest(extraction('b1'), { mode: 'overwrite' });

    expect(calls).toContain('ingest:b1:overwrite');
  });

  it('writes the search corpus alongside', async () => {
    await createLibraryPersistence(merged).ingest(extraction('b1'), { mode: 'add' });

    expect(searchPuts).toEqual([
      { bookId: 'b1', extractionVersion: 3, sections: [{ href: 'a', title: 'A', text: 't' }] },
    ]);
  });

  it('never lets a corpus write failure sink the ingest', async () => {
    searchPutThrows = new Error('quota');

    await expect(
      createLibraryPersistence(merged).ingest(extraction('b1'), { mode: 'add' })
    ).resolves.toBeUndefined();

    expect(calls).toContain('ingest:b1:add');
  });
});

describe('createLibraryPersistence — pass-throughs', () => {
  it('delegates delete and offload', async () => {
    const p = createLibraryPersistence(merged);

    await p.deleteBook('b1');
    await p.offloadBook('b2');

    expect(calls).toEqual(['deleteBook:b1', 'offloadBook:b2']);
  });

  it('converts the restored file to bytes BEFORE handing it over', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'b.epub');

    await createLibraryPersistence(merged).restoreResource('b1', file);

    expect(calls).toEqual(['restoreResource:b1:4']);
  });

  it('routes the two yjs-merged reads to the injected deps', async () => {
    const p = createLibraryPersistence(merged);

    await expect(p.getBookMetadata('b1')).resolves.toEqual({ id: 'b1' });
    expect(p.getBookIdByFilename('known.epub')).toBe('b1');
    expect(p.getBookIdByFilename('unknown.epub')).toBeUndefined();
  });

  it('exposes the bulk read only when the composition root supplied one', async () => {
    expect(createLibraryPersistence(merged).getBookMetadataBulk).toBeUndefined();

    const withBulk = createLibraryPersistence({
      ...merged,
      getBookMetadataBulk: async (ids) => ids.map((id) => ({ id }) as BookMetadata),
    });
    await expect(withBulk.getBookMetadataBulk?.(['a', 'b'])).resolves.toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('forwards both offload probes to the repo', async () => {
    const p = createLibraryPersistence(merged);

    await p.getOffloadedStatus(['a', 'b']);
    await p.getAvailableResourceIds?.();

    expect(calls).toEqual(['getOffloadedStatus:a|b', 'getAvailableResourceIds']);
  });
});

describe('createLibraryPersistence.writeContentHash', () => {
  it('does nothing when there is no manifest to upgrade', async () => {
    manifest = undefined;

    await createLibraryPersistence(merged).writeContentHash('b1', 'hash');

    expect(putManifests).toEqual([]);
  });

  it('does nothing when the hash is already stamped', async () => {
    manifest = { bookId: 'b1', contentHash: 'hash' };

    await createLibraryPersistence(merged).writeContentHash('b1', 'hash');

    expect(putManifests).toEqual([]);
  });

  it('stamps the hash onto the EXISTING manifest, preserving its other fields', async () => {
    manifest = { bookId: 'b1', title: 'Keep me', contentHash: 'old' };

    await createLibraryPersistence(merged).writeContentHash('b1', 'new');

    expect(putManifests).toEqual([[{ bookId: 'b1', title: 'Keep me', contentHash: 'new' }]]);
  });

  it('stamps a manifest that carried no hash at all', async () => {
    manifest = { bookId: 'b1', title: 'Legacy' };

    await createLibraryPersistence(merged).writeContentHash('b1', 'fresh');

    expect(putManifests).toEqual([[{ bookId: 'b1', title: 'Legacy', contentHash: 'fresh' }]]);
  });
});

describe('createLibraryPersistence.reprocess', () => {
  it('re-derives the content and refreshes the corpus from the result', async () => {
    const result = await createLibraryPersistence(merged).reprocess('b1', {});

    expect(calls).toContain('reprocessBookContent:b1');
    expect(searchPuts).toEqual([{ bookId: 'b1', extractionVersion: 4, sections: [{ href: 'a' }] }]);
    expect(result).toBe(reprocessResult);
  });

  it('still returns the result when the corpus refresh fails', async () => {
    searchPutThrows = new Error('quota');

    await expect(createLibraryPersistence(merged).reprocess('b1', {})).resolves.toBe(
      reprocessResult
    );
  });
});
