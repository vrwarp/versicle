/**
 * playbackCache repo contract suite (Phase 3 D5.2 / Test plan R).
 *
 * Pins the WebKit-hang-safe session block that moved verbatim from
 * DBService, including the assertions absorbed from src/db/DBService.test.ts
 * when the façade was deleted (P3-12; test-absorption ledger):
 * the DELIBERATE teardown drop (dropPending cancels — never flushes — the
 * debounced write) and the mirror/coalescing round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { playbackCache } from './playbackCache';
import { getConnection } from '../connection';
import { idbWriteLockIdle } from '../write-gate';

describe('data/repos/playbackCache', () => {
  beforeEach(async () => {
    const db = await getConnection();
    await db.clear('cache_session_state');
    await idbWriteLockIdle();
  });

  it('saveQueue + flushPending persists the mirrored record (single put, through the gate)', async () => {
    const queue = [{ text: 'Sentence 1', cfi: 'cfi1' }];
    playbackCache.saveQueue('book-rt', queue);
    await playbackCache.flushPending();

    const db = await getConnection();
    const row = await db.get('cache_session_state', 'book-rt');
    expect(row?.playbackQueue).toEqual(queue);
    expect(row?.updatedAt).toBeGreaterThan(0);
  });

  it('savePauseTime seeds the mirror from disk so it never clobbers a persisted queue', async () => {
    const db = await getConnection();
    await db.put('cache_session_state', {
      bookId: 'book-seed',
      playbackQueue: [{ text: 'Persisted', cfi: 'cfi-p' }],
      updatedAt: 1,
    });

    await playbackCache.savePauseTime('book-seed', 1234);
    await playbackCache.flushPending();

    const row = await db.get('cache_session_state', 'book-seed');
    expect(row?.lastPauseTime).toBe(1234);
    expect(row?.playbackQueue).toEqual([{ text: 'Persisted', cfi: 'cfi-p' }]); // preserved
  });

  it('savePauseTime(null) clears the persisted pause stamp', async () => {
    await playbackCache.savePauseTime('book-null', 555);
    await playbackCache.flushPending();
    await playbackCache.savePauseTime('book-null', null);
    await playbackCache.flushPending();

    const db = await getConnection();
    const row = await db.get('cache_session_state', 'book-null');
    expect(row?.lastPauseTime).toBeUndefined();
  });

  it('getSession seeds the in-memory mirror (later writes never need an intra-transaction read)', async () => {
    const db = await getConnection();
    await db.put('cache_session_state', {
      bookId: 'book-get',
      playbackQueue: [{ text: 'On disk', cfi: 'c' }],
      lastPauseTime: 42,
      updatedAt: 1,
    });

    const session = await playbackCache.getSession('book-get');
    expect(session?.playbackQueue).toEqual([{ text: 'On disk', cfi: 'c' }]);

    // The mirror was seeded: a queue update preserves the disk lastPauseTime.
    playbackCache.saveQueue('book-get', [{ text: 'New', cfi: 'c2' }]);
    await playbackCache.flushPending();
    const row = await db.get('cache_session_state', 'book-get');
    expect(row?.lastPauseTime).toBe(42);
    expect(row?.playbackQueue).toEqual([{ text: 'New', cfi: 'c2' }]);
  });

  describe('regression: teardown drops (never flushes) the pending write (absorbed from db/DBService.test.ts)', () => {
    it('dropPending prevents a scheduled saveQueue from ever reaching disk', async () => {
      const db = await getConnection();
      const id = 'tts-clean-1';
      await db.delete('cache_session_state', id);

      playbackCache.saveQueue(id, []);
      playbackCache.dropPending();

      // Wait out the 500ms debounce window (plus slack) — nothing may land.
      await new Promise(resolve => setTimeout(resolve, 1100));
      await idbWriteLockIdle();

      const state = await db.get('cache_session_state', id);
      expect(state).toBeUndefined();
    });
  });
});
