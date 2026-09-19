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
import { closeConnection, getConnection } from '../connection';
import { idbWriteLockIdle } from '../write-gate';
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

    expect(result).toEqual({ deleted: 0, freedBytes: 0, scanned: 2 });
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

  /**
   * perf: the sweep streams a VALUE cursor, so every book's packed int8
   * vectors (budget 256 MiB) were deserialized on the main thread before the
   * `totalBytes <= budgetBytes` early-out could run — at boot, every boot. A
   * persisted running byte total (app_metadata['embedding-cache-total-bytes'])
   * now answers "are we under budget?" without touching a single row, exactly
   * as the audio cache's does.
   */
  describe('regression: eviction does not scan while under budget', () => {
    it('skips the cursor entirely once the tracked total is known (scanned === 0)', async () => {
      await embeddingsRepo.put(row('bk-1'));
      await embeddingsRepo.put(row('bk-2'));

      // First sweep establishes the total the expensive way.
      const first = await embeddingsRepo.runEviction(new Map(), 10 * ROW_BYTES);
      expect(first.scanned).toBe(2);

      const db = await getConnection();
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(2 * ROW_BYTES);

      // Second sweep: the tracked total answers it — no vectors deserialized.
      const txSpy = vi.spyOn(db, 'transaction');
      try {
        const second = await embeddingsRepo.runEviction(new Map(), 10 * ROW_BYTES);
        expect(second).toEqual({ deleted: 0, freedBytes: 0, scanned: 0 });
        const readonlyScans = txSpy.mock.calls.filter(
          ([stores, mode]) => mode === 'readonly' && String(stores).includes('cache_embeddings'),
        );
        expect(readonlyScans).toHaveLength(0);
      } finally {
        txSpy.mockRestore();
      }

      // …and nothing was evicted.
      await expect(embeddingsRepo.get('bk-1')).resolves.toMatchObject({ bookId: 'bk-1' });
      await expect(embeddingsRepo.get('bk-2')).resolves.toMatchObject({ bookId: 'bk-2' });
    });

    it('counts puts into the tracked total so growth still trips a sweep', async () => {
      // Seed the persisted total at 0 with an empty-store sweep…
      expect((await embeddingsRepo.runEviction(new Map(), ROW_BYTES)).scanned).toBe(0);
      const db = await getConnection();
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(0);

      // …then write enough bytes to exceed the budget: the next sweep scans.
      await embeddingsRepo.put(row('grown'));
      expect((await embeddingsRepo.runEviction(new Map(), ROW_BYTES - 1)).scanned).toBe(1);
    });

    it('keeps the hint in step with the delete batches (no extra sweep afterwards)', async () => {
      await embeddingsRepo.put(row('bk-a'));
      await embeddingsRepo.put(row('bk-b'));
      await embeddingsRepo.put(row('bk-c'));

      const recency = new Map<string, number>([
        ['bk-a', 1_000],
        ['bk-b', 2_000],
        ['bk-c', 3_000],
      ]);
      const result = await embeddingsRepo.runEviction(recency, ROW_BYTES);
      expect(result).toEqual({ deleted: 2, freedBytes: 2 * ROW_BYTES, scanned: 3 });

      // The surviving row's bytes were persisted INSIDE the delete transaction…
      const db = await getConnection();
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(ROW_BYTES);
      // …so the follow-up sweep is free.
      expect((await embeddingsRepo.runEviction(recency, ROW_BYTES)).scanned).toBe(0);
    });

    it('re-establishes the total when nothing was evictable (every book protected)', async () => {
      await embeddingsRepo.put(row('bk-p1'));
      await embeddingsRepo.put(row('bk-p2'));

      const result = await embeddingsRepo.runEviction(
        new Map(),
        ROW_BYTES,
        new Set(['bk-p1', 'bk-p2']),
      );
      expect(result).toEqual({ deleted: 0, freedBytes: 0, scanned: 2 });

      const db = await getConnection();
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(2 * ROW_BYTES);
      // Both survive: the hint never decides WHAT to delete.
      await expect(embeddingsRepo.get('bk-p1')).resolves.toMatchObject({ bookId: 'bk-p1' });
      await expect(embeddingsRepo.get('bk-p2')).resolves.toMatchObject({ bookId: 'bk-p2' });
    });
  });

  /**
   * The tracked total used to be accumulated ONLY in memory by put/putHydrated:
   * the persisted key was written exclusively from inside runEviction, which for
   * this cache runs ONLY as a boot task. At boot the in-memory remainder is
   * empty, so the sweep's fast path returned without writing anything: the
   * stored hint froze at whatever the first scan saw, every later session's
   * vectors died with the page, and the sweep went on skipping a cache that had
   * long outgrown its budget — where the pre-change code rescanned at every boot
   * and could not drift. Both write paths now fold their bytes into the stored
   * total inside their OWN gated transaction.
   */
  describe('regression: the persisted total advances without a sweep', () => {
    it('folds put AND putHydrated into the stored total, so a session that never sweeps is not lost', async () => {
      const db = await getConnection();
      // A boot sweep on an empty cache establishes the hint (and drains whatever
      // an earlier test left pending in this singleton's memory).
      expect((await embeddingsRepo.runEviction(new Map(), 10 * ROW_BYTES)).scanned).toBe(0);
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(0);

      // Nothing here triggers another sweep — this cache only sweeps at boot.
      await embeddingsRepo.put(row('sess-1'));
      await embeddingsRepo.putHydrated(row('sess-2'), job('sess-2'));

      // What the NEXT page load reads: the in-memory delta died with the page,
      // so the stored value alone has to carry the session.
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(2 * ROW_BYTES);
    });

    it('keeps the stored total honest across a "page close" (no in-memory state left)', async () => {
      const db = await getConnection();
      await embeddingsRepo.runEviction(new Map(), 10 * ROW_BYTES); // establish the hint at 0
      for (let i = 0; i < 5; i++) {
        await embeddingsRepo.put(row(`close-${i}`));
      }
      await idbWriteLockIdle();

      // Nothing is pending in memory any more (every write folded its own
      // bytes), so this repo instance is in exactly the state a fresh boot
      // starts from — and the stored hint alone knows what the cache holds…
      expect(await db.get('app_metadata', 'embedding-cache-total-bytes')).toBe(5 * ROW_BYTES);
      // …counted ONCE: a budget exactly at the stored total still skips the scan.
      expect((await embeddingsRepo.runEviction(new Map(), 5 * ROW_BYTES)).scanned).toBe(0);
      // …and a byte under it, the stored hint alone sends the sweep to the rows.
      expect((await embeddingsRepo.runEviction(new Map(), 5 * ROW_BYTES - 1)).scanned).toBe(5);
    });
  });

  /**
   * persistTotal and the delete-batch flush both RESET the in-memory remainder
   * and then wrote a total computed before that reset, so every write that
   * completed in between — normal, because the sweep is fire-and-forget while
   * the indexer keeps flushing batches — had its bytes erased from the
   * accounting entirely. Each write now settles exactly the snapshot it folded
   * in.
   */
  describe('regression: a sweep never erases bytes it did not account for', () => {
    it('keeps a write that lands mid-sweep in the tracked total', async () => {
      // EVICTION_DELETE_BATCH (module-private) is 50, so evicting this many
      // books flushes TWICE — and the racing write's transaction is queued on
      // the write gate BEFORE the first flush's, so its bytes are on the books
      // well before the second flush writes a total derived from the one scan.
      // That is exactly the window the old wholesale reset erased.
      const COUNT = 55;
      for (let i = 0; i < COUNT; i++) {
        await embeddingsRepo.put(row(`mid-${i}`));
      }

      const db = await getConnection();
      const txSpy = vi.spyOn(db, 'transaction'); // observe only — no behavior change
      const scanning = (): boolean =>
        txSpy.mock.calls.some(
          ([stores, mode]) => mode === 'readonly' && String(stores).includes('cache_embeddings'),
        );
      try {
        // Budget 0: every book is a candidate, so the sweep scans and then
        // deletes in two batches while the indexer keeps flushing.
        const sweep = embeddingsRepo.runEviction(new Map(), 0);
        // Land the racing write only once the sweep's cursor is OPEN: IDB then
        // serializes it behind that readonly scan, so the scan provably never
        // sees it — the case whose bytes the sweep's own total cannot carry.
        for (let i = 0; i < 100 && !scanning(); i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(scanning()).toBe(true);
        await embeddingsRepo.put(row('mid-raced'));
        const result = await sweep;
        await idbWriteLockIdle();

        expect(result.deleted).toBe(COUNT);
        // The racing book was never a candidate, so it is still there…
        await expect(embeddingsRepo.get('mid-raced')).resolves.toMatchObject({
          bookId: 'mid-raced',
        });

        const persisted = await db.get('app_metadata', 'embedding-cache-total-bytes');
        if (typeof persisted !== 'number') throw new Error('the sweep must persist a total');

        // …and its bytes must still be tracked — persisted by its own fold or
        // still pending in memory, but never erased by the sweep's write. A
        // budget half-way between "with them" and "without them" separates the
        // two: tracked high ⇒ the next sweep scans, tracked low ⇒ it never does.
        const after = await embeddingsRepo.runEviction(new Map(), persisted + ROW_BYTES / 2);
        expect(after.scanned).toBeGreaterThan(0);
      } finally {
        txSpy.mockRestore();
      }
    });
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
