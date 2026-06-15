/**
 * embeddings repo contract (Increment B): packed-blob round-trip with correct
 * Int8Array/Float32Array re-wrapping, get/put/delete on both stores, the
 * delete-with-book guarantee (vectors AND resumable job state die inside
 * bookContent.deleteBook's gated transaction), and faithful stamp round-trip
 * (the {model,dims,quant,extractionVersion} invalidation policy lives in the
 * Phase-F consumer, so the repo only proves the stamp survives a round-trip).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  embeddingsRepo,
  EMBEDDING_CACHE_BUDGET_BYTES,
  type CacheEmbeddingsRow,
  type CacheEmbedJobsRow,
} from './embeddings';
import { bookContent } from './bookContent';
import { closeConnection } from '../connection';
import { DB_NAME } from '../schema';

function deleteAppDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const DIMS = 4;

/** A two-section embedding row with packed int8 vectors + float32 scales. */
const row = (bookId: string): CacheEmbeddingsRow => ({
  bookId,
  model: 'gemini-embedding-001',
  dims: DIMS,
  quant: 'int8-pervec',
  extractionVersion: 3,
  sections: [
    {
      href: 'ch1.xhtml',
      sectionTextHash: 'hash-ch1',
      chunks: [{ cfiStart: '', cfiEnd: '', tokenCount: 120 }],
      // One packed int8 row of DIMS.
      vectors: Int8Array.from([12, -34, 56, -78]).buffer,
      scales: Float32Array.from([0.0123]).buffer,
    },
    {
      href: 'ch2.xhtml',
      sectionTextHash: 'hash-ch2',
      chunks: [
        { cfiStart: '', cfiEnd: '', tokenCount: 200 },
        { cfiStart: '', cfiEnd: '', tokenCount: 64 },
      ],
      // Two packed int8 rows of DIMS.
      vectors: Int8Array.from([1, 2, 3, 4, -5, -6, -7, -8]).buffer,
      scales: Float32Array.from([0.5, 0.25]).buffer,
    },
  ],
});

const job = (bookId: string): CacheEmbedJobsRow => ({
  bookId,
  extractionVersion: 3,
  sections: [
    { href: 'ch1.xhtml', embeddedThroughChunk: 1 },
    { href: 'ch2.xhtml', embeddedThroughChunk: 0 },
  ],
  updatedAt: 1_700_000_000_000,
});

describe('embeddingsRepo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  it('round-trips packed vectors, re-wrapping ArrayBuffer→Int8Array/Float32Array on read', async () => {
    await expect(embeddingsRepo.get('bk-1')).resolves.toBeUndefined();

    await embeddingsRepo.put(row('bk-1'));
    const read = await embeddingsRepo.get('bk-1');
    expect(read).toBeDefined();

    // The stamp round-trips faithfully.
    expect(read).toMatchObject({
      bookId: 'bk-1',
      model: 'gemini-embedding-001',
      dims: DIMS,
      quant: 'int8-pervec',
      extractionVersion: 3,
    });

    // Section 0: read path re-wraps as the typed-array views, byte-identical.
    const s0 = read!.sections[0];
    expect(s0.vectors).toBeInstanceOf(Int8Array);
    expect(s0.scales).toBeInstanceOf(Float32Array);
    expect(Array.from(s0.vectors)).toEqual([12, -34, 56, -78]);
    expect(Array.from(s0.scales)).toEqual([0.0123 as number].map((n) => Math.fround(n)));
    expect(s0.sectionTextHash).toBe('hash-ch1');
    expect(s0.chunks).toEqual([{ cfiStart: '', cfiEnd: '', tokenCount: 120 }]);

    // Section 1: two packed rows survive intact.
    const s1 = read!.sections[1];
    expect(Array.from(s1.vectors)).toEqual([1, 2, 3, 4, -5, -6, -7, -8]);
    expect(Array.from(s1.scales)).toEqual([0.5, 0.25]);
  });

  it('upserts (one row per book) and round-trips the resumable job state', async () => {
    await embeddingsRepo.put(row('bk-1'));
    await embeddingsRepo.put({ ...row('bk-1'), extractionVersion: 4 });
    await expect(embeddingsRepo.get('bk-1')).resolves.toMatchObject({ extractionVersion: 4 });

    await expect(embeddingsRepo.getJob('bk-1')).resolves.toBeUndefined();
    await embeddingsRepo.putJob(job('bk-1'));
    await expect(embeddingsRepo.getJob('bk-1')).resolves.toEqual(job('bk-1'));
  });

  it('delete(bookId) removes both the vectors and the resumable job state', async () => {
    await embeddingsRepo.put(row('bk-1'));
    await embeddingsRepo.putJob(job('bk-1'));

    await embeddingsRepo.delete('bk-1');

    await expect(embeddingsRepo.get('bk-1')).resolves.toBeUndefined();
    await expect(embeddingsRepo.getJob('bk-1')).resolves.toBeUndefined();
  });

  it('regression: deleting a book removes its embeddings + job in the same path (delete-with-book)', async () => {
    await embeddingsRepo.put(row('bk-doomed'));
    await embeddingsRepo.putJob(job('bk-doomed'));
    await embeddingsRepo.put(row('bk-survivor'));
    await embeddingsRepo.putJob(job('bk-survivor'));

    await bookContent.deleteBook('bk-doomed');

    await expect(embeddingsRepo.get('bk-doomed')).resolves.toBeUndefined();
    await expect(embeddingsRepo.getJob('bk-doomed')).resolves.toBeUndefined();
    await expect(embeddingsRepo.get('bk-survivor')).resolves.toMatchObject({ bookId: 'bk-survivor' });
    await expect(embeddingsRepo.getJob('bk-survivor')).resolves.toEqual(job('bk-survivor'));
  });

  it('putHydrated writes BOTH stores in one atomic cross-store transaction (§2.8)', async () => {
    const hydrated = row('bk-hydrated');
    const jobRow = job('bk-hydrated');

    await embeddingsRepo.putHydrated(hydrated, jobRow);

    // Both the vectors AND the completed job row landed.
    const readRow = await embeddingsRepo.get('bk-hydrated');
    const readJob = await embeddingsRepo.getJob('bk-hydrated');
    expect(readRow).toMatchObject({ bookId: 'bk-hydrated', model: 'gemini-embedding-001' });
    expect(readJob).toEqual(jobRow);
    // The vectors re-wrap correctly (the hydrate row uses the same packed shape).
    expect(Array.from(readRow!.sections[0].vectors)).toEqual([12, -34, 56, -78]);
  });

  it('crash-window self-heal: putHydrated marks ONLY present sections complete (no skip-but-empty)', async () => {
    // A PARTIAL hydrate (reconciliation dropped a diverged section): the row
    // carries only ch1, and the jobRow must mark ONLY ch1 complete — so the
    // indexer re-embeds the dropped ch2 on the next pass instead of resume-
    // skipping a section whose vectors are absent. putHydrated is the primary
    // fix (one atomic tx); the B-3 indexer guard is the backstop.
    const partialRow: CacheEmbeddingsRow = {
      ...row('bk-partial'),
      // Only the first section survived reconciliation.
      sections: [row('bk-partial').sections[0]],
    };
    const partialJob: CacheEmbedJobsRow = {
      bookId: 'bk-partial',
      extractionVersion: 3,
      // The completed job lists ONLY the surviving section (ch1).
      sections: [{ href: 'ch1.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'hash-ch1' }],
      updatedAt: 1_700_000_000_000,
    };

    await embeddingsRepo.putHydrated(partialRow, partialJob);

    const readRow = await embeddingsRepo.get('bk-partial');
    const readJob = await embeddingsRepo.getJob('bk-partial');
    // The persisted row has ch1 but NOT ch2…
    expect(readRow!.sections.map((s) => s.href)).toEqual(['ch1.xhtml']);
    // …and the job marks ONLY ch1 complete (ch2 is absent from BOTH → re-embeds,
    // never silently un-searchable: there is no job entry to resume-skip on).
    expect(readJob!.sections.map((s) => s.href)).toEqual(['ch1.xhtml']);
  });

  it('faithfully round-trips the {model,dims,quant,extractionVersion} stamp (invalidation lives in Phase F)', async () => {
    // Two rows with different stamps for the same logical book id family —
    // the repo surfaces whatever stamp is stored; it never invalidates.
    await embeddingsRepo.put({
      ...row('bk-stamp'),
      model: 'old-model',
      dims: DIMS,
      extractionVersion: 1,
    });
    const before = await embeddingsRepo.get('bk-stamp');
    expect(before).toMatchObject({ model: 'old-model', extractionVersion: 1 });

    // A re-embed with a newer stamp overwrites and is surfaced verbatim.
    await embeddingsRepo.put({
      ...row('bk-stamp'),
      model: 'gemini-embedding-001',
      dims: DIMS,
      extractionVersion: 5,
    });
    const after = await embeddingsRepo.get('bk-stamp');
    expect(after).toMatchObject({ model: 'gemini-embedding-001', extractionVersion: 5 });
  });
});

describe('EmbeddingsRepo.runEviction (injected-recency LRU, Increment F §6/§8.3)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  // Byte size per row() fixture (vectors.byteLength + scales.byteLength):
  //   Section 0: 4 int8 (4 B) + 1 float32 (4 B) = 8 B.
  //   Section 1: 8 int8 (8 B) + 2 float32 (8 B) = 16 B.  →  24 B total.
  const ROW_BYTES = 24;

  it('deletes least-recently-read first and keeps a recently-read book under budget', async () => {
    await embeddingsRepo.put(row('bk-old'));
    await embeddingsRepo.put(row('bk-mid'));
    await embeddingsRepo.put(row('bk-new'));

    // Recency: bk-new read most recently, bk-old least. Budget admits ONE row,
    // so the two least-recently-read (bk-old, bk-mid) evict; bk-new survives.
    const recency = new Map<string, number>([
      ['bk-old', 1_000],
      ['bk-mid', 2_000],
      ['bk-new', 3_000],
    ]);
    const result = await embeddingsRepo.runEviction(recency, ROW_BYTES);

    expect(result.deleted).toBe(2);
    expect(result.freedBytes).toBe(2 * ROW_BYTES);
    await expect(embeddingsRepo.get('bk-old')).resolves.toBeUndefined();
    await expect(embeddingsRepo.get('bk-mid')).resolves.toBeUndefined();
    // The recently-read book survives.
    await expect(embeddingsRepo.get('bk-new')).resolves.toMatchObject({ bookId: 'bk-new' });
  });

  it('treats an unknown bookId (no recency entry) as oldest=0 and evicts it first', async () => {
    await embeddingsRepo.put(row('bk-tracked'));
    await embeddingsRepo.put(row('bk-untracked'));

    // Only bk-tracked has a recency entry; bk-untracked ranks oldest (0) and
    // evicts first. Budget admits one row.
    const recency = new Map<string, number>([['bk-tracked', 5_000]]);
    const result = await embeddingsRepo.runEviction(recency, ROW_BYTES);

    expect(result.deleted).toBe(1);
    await expect(embeddingsRepo.get('bk-untracked')).resolves.toBeUndefined();
    await expect(embeddingsRepo.get('bk-tracked')).resolves.toMatchObject({ bookId: 'bk-tracked' });
  });

  it('an evicted book is fully re-derivable: get() AND getJob() both resolve undefined', async () => {
    await embeddingsRepo.put(row('bk-doomed'));
    await embeddingsRepo.putJob(job('bk-doomed'));

    // Zero budget forces eviction of everything.
    const result = await embeddingsRepo.runEviction(new Map(), 0);

    expect(result.deleted).toBe(1);
    // Vectors gone AND the resumable job died with them (re-derivable = absent).
    await expect(embeddingsRepo.get('bk-doomed')).resolves.toBeUndefined();
    await expect(embeddingsRepo.getJob('bk-doomed')).resolves.toBeUndefined();
  });

  it('is a no-op when total bytes are already under budget', async () => {
    await embeddingsRepo.put(row('bk-1'));
    await embeddingsRepo.put(row('bk-2'));

    const result = await embeddingsRepo.runEviction(new Map(), EMBEDDING_CACHE_BUDGET_BYTES);

    expect(result).toEqual({ deleted: 0, freedBytes: 0 });
    await expect(embeddingsRepo.get('bk-1')).resolves.toMatchObject({ bookId: 'bk-1' });
    await expect(embeddingsRepo.get('bk-2')).resolves.toMatchObject({ bookId: 'bk-2' });
  });

  it('uses the default budget constant when none is supplied (no eviction under it)', async () => {
    await embeddingsRepo.put(row('bk-small'));
    // The default 256 MiB budget admits a 24-byte row trivially.
    const result = await embeddingsRepo.runEviction(new Map());
    expect(result.deleted).toBe(0);
    await expect(embeddingsRepo.get('bk-small')).resolves.toMatchObject({ bookId: 'bk-small' });
  });

  it('never evicts a protected book even when it is oldest and the cache is over budget', async () => {
    await embeddingsRepo.put(row('bk-protected'));
    await embeddingsRepo.put(row('bk-evictable'));

    // bk-protected is the OLDEST (recency 0 — unknown) AND the cache is over
    // budget (one row admitted), so by recency alone it would evict FIRST. The
    // protected set must keep it; bk-evictable goes instead.
    const recency = new Map<string, number>([['bk-evictable', 9_000]]);
    const result = await embeddingsRepo.runEviction(
      recency,
      ROW_BYTES,
      new Set(['bk-protected']),
    );

    expect(result.deleted).toBe(1);
    // The protected book survives despite being oldest/over-budget…
    await expect(embeddingsRepo.get('bk-protected')).resolves.toMatchObject({ bookId: 'bk-protected' });
    // …and the unprotected, more-recently-read book is the one evicted.
    await expect(embeddingsRepo.get('bk-evictable')).resolves.toBeUndefined();
  });

  it('an empty/omitted protectedBookIds set behaves exactly as today (regression)', async () => {
    await embeddingsRepo.put(row('bk-old'));
    await embeddingsRepo.put(row('bk-new'));

    const recency = new Map<string, number>([
      ['bk-old', 1_000],
      ['bk-new', 2_000],
    ]);
    // Passing an explicit empty set must match the no-arg behavior: oldest evicts.
    const result = await embeddingsRepo.runEviction(recency, ROW_BYTES, new Set());

    expect(result.deleted).toBe(1);
    await expect(embeddingsRepo.get('bk-old')).resolves.toBeUndefined();
    await expect(embeddingsRepo.get('bk-new')).resolves.toMatchObject({ bookId: 'bk-new' });
  });
});
