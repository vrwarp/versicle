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

  describe('regression: session mirror is bounded', () => {
    // The mirror (one record per book touched, each carrying that book's whole TTS queue)
    // was never pruned, in BOTH the worker and the main-thread instance. It is now an
    // insertion-ordered LRU; an evicted book re-seeds from disk on its next touch.
    //
    // Eviction is asserted through observable behaviour rather than a spy on the connection:
    // `idb` hands out a Proxy-wrapped database, so `vi.spyOn(db, 'get')` never takes effect.
    // Instead the row is rewritten on disk behind the repo's back — a MIRRORED book ignores
    // it (the mirror wins), an EVICTED book re-reads and the disk value shows through.
    const ids = ['lru-1', 'lru-2', 'lru-3', 'lru-4', 'lru-5', 'lru-6'];
    const queueOf = (id: string) => [{ text: id, cfi: `cfi-${id}` }];

    it('evicts the oldest non-dirty books; an evicted book re-seeds from disk', async () => {
      const db = await getConnection();
      // Flush between books so none of them stays dirty — only then may they be evicted.
      for (const id of ids) {
        playbackCache.saveQueue(id, queueOf(id));
        await playbackCache.flushPending();
      }
      for (const id of ids) {
        expect((await db.get('cache_session_state', id))?.playbackQueue, id).toEqual(queueOf(id));
      }

      // The OLDEST book left the mirror: its next touch re-reads the (diverged) disk row.
      await db.put('cache_session_state', {
        bookId: 'lru-1', playbackQueue: [{ text: 'from disk', cfi: 'cfi-disk' }], updatedAt: 2,
      });
      await playbackCache.savePauseTime('lru-1', 99);
      await playbackCache.flushPending();
      const evicted = await db.get('cache_session_state', 'lru-1');
      expect(evicted?.playbackQueue, 'evicted book must re-seed from disk').toEqual([
        { text: 'from disk', cfi: 'cfi-disk' },
      ]);
      expect(evicted?.lastPauseTime).toBe(99);

      // The NEWEST book is still mirrored: the same divergence is overwritten by the mirror.
      await db.put('cache_session_state', {
        bookId: 'lru-6', playbackQueue: [{ text: 'from disk', cfi: 'cfi-disk' }], updatedAt: 2,
      });
      await playbackCache.savePauseTime('lru-6', 77);
      await playbackCache.flushPending();
      const mirrored = await db.get('cache_session_state', 'lru-6');
      expect(mirrored?.playbackQueue, 'recent book must still be mirrored').toEqual(queueOf('lru-6'));
      expect(mirrored?.lastPauseTime).toBe(77);
    });

    it('never evicts a book with a pending debounced write — every queue still lands', async () => {
      const db = await getConnection();
      const dirty = ids.map((id) => `dirty-${id}`);
      // No flush in between: every book has an unflushed write when the next one evicts.
      for (const id of dirty) playbackCache.saveQueue(id, queueOf(id));
      await playbackCache.flushPending();

      for (const id of dirty) {
        expect((await db.get('cache_session_state', id))?.playbackQueue, id).toEqual(queueOf(id));
      }
    });
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
