/**
 * drivePreviews repo contract: round-trip (cover Blob ↔ ArrayBuffer), the
 * negative-cache row, and eviction (orphan drop + LRU-by-bytes).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drivePreviews } from './drivePreviews';
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

describe('drivePreviews repo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  it('round-trips a preview with a cover Blob', async () => {
    const cover = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await drivePreviews.put({
      fileId: 'f1',
      md5Checksum: 'abc',
      status: 'ok',
      title: 'Book One',
      author: 'Author',
      identifiers: ['urn:isbn:1'],
      cover,
    });
    const got = await drivePreviews.get('f1');
    expect(got?.status).toBe('ok');
    expect(got?.title).toBe('Book One');
    expect(got?.md5Checksum).toBe('abc');
    expect(got?.cover).toBeInstanceOf(Blob);
    expect(got?.cover?.type).toBe('image/png');
    expect(await got!.cover!.arrayBuffer()).toEqual(await cover.arrayBuffer());
  });

  it('stores a negative-cache row with no cover', async () => {
    await drivePreviews.put({ fileId: 'bad', md5Checksum: 'z', status: 'unextractable' });
    const got = await drivePreviews.get('bad');
    expect(got?.status).toBe('unextractable');
    expect(got?.cover).toBeUndefined();
  });

  it('returns undefined for an unknown file', async () => {
    expect(await drivePreviews.get('nope')).toBeUndefined();
  });

  it('deletes a row', async () => {
    await drivePreviews.put({ fileId: 'f1', status: 'unextractable' });
    await drivePreviews.delete('f1');
    expect(await drivePreviews.get('f1')).toBeUndefined();
  });

  it('lists cached fileIds', async () => {
    await drivePreviews.put({ fileId: 'a', status: 'unextractable' });
    await drivePreviews.put({ fileId: 'b', status: 'unextractable' });
    expect((await drivePreviews.listFileIds()).sort()).toEqual(['a', 'b']);
  });

  it('evicts orphan rows whose fileId left the index', async () => {
    await drivePreviews.put({ fileId: 'keep', status: 'unextractable' });
    await drivePreviews.put({ fileId: 'orphan', status: 'unextractable' });
    const result = await drivePreviews.runEviction(new Set(['keep']));
    expect(result.deleted).toBe(1);
    expect(await drivePreviews.get('orphan')).toBeUndefined();
    expect(await drivePreviews.get('keep')).toBeDefined();
  });

  it('evicts by LRU when over the byte budget', async () => {
    // Two ~2KB cover rows; a 3KB budget forces one eviction (the older).
    const big = () => new Blob([new Uint8Array(2048)], { type: 'image/png' });
    await drivePreviews.put({ fileId: 'old', status: 'ok', cover: big(), lastAccessedAt: 1000 });
    await drivePreviews.put({ fileId: 'new', status: 'ok', cover: big(), lastAccessedAt: 2000 });
    const result = await drivePreviews.runEviction(undefined, 3 * 1024);
    expect(result.deleted).toBe(1);
    expect(await drivePreviews.get('old')).toBeUndefined();
    expect(await drivePreviews.get('new')).toBeDefined();
  });
});
