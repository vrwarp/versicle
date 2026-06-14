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
