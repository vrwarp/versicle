/**
 * repoPorts contract suite — the production {@link SessionStore} the engine
 * composes (createZustandEngineContext + WorkerEngineContext both take it).
 *
 * It drives the REAL `@data/repos/playbackCache` against fake-indexeddb, like
 * every src/data suite: the engine directory's vi.mock allowlist sits at ZERO,
 * and the whole point of these assertions is the repo/port interaction.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRepoSessionStore } from './repoPorts';
import { playbackCache } from '@data/repos/playbackCache';
import { getConnection } from '@data/connection';
import type { CacheSessionStateRow } from '@data/rows/cache';

describe('lib/tts/engine/repoPorts — createRepoSessionStore', () => {
  beforeEach(async () => {
    const db = await getConnection();
    await db.clear('cache_session_state');
    playbackCache.dropPending();
  });

  /** Flush the port's fire-and-forget persist and read back what landed. */
  async function settled(bookId: string, text: string): Promise<CacheSessionStateRow> {
    const db = await getConnection();
    for (let attempt = 0; attempt < 50; attempt++) {
      await playbackCache.flushPending();
      const row = await db.get('cache_session_state', bookId);
      if (row?.playbackQueue[0]?.text === text) return row;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`persistQueue never reached disk for ${bookId}`);
  }

  /**
   * The port memoizes "this book has been seeded" forever, on the premise that
   * one getSession puts the row in the repo's mirror and it stays there. The
   * mirror became a 4-entry LRU, so the premise stopped holding: a book evicted
   * mid-session was still remembered as seeded, and the next persist wrote a
   * record built from scratch — dropping whatever else the stored row carried.
   * The repo is cold-safe now, so the memo is only an ordering optimization.
   */
  describe('regression: a persist after an LRU eviction keeps the stored row', () => {
    it('does not clobber the pause stamp of a book the mirror evicted', async () => {
      const db = await getConnection();
      await db.put('cache_session_state', {
        bookId: 'port-a',
        playbackQueue: [{ text: 'Restored', cfi: 'cfi-0' }],
        lastPauseTime: 4242,
        updatedAt: 1,
      });

      const store = createRepoSessionStore();
      // The restore read seeds both the repo mirror and the port's memo.
      const restored = await store.loadSession('port-a');
      expect(restored?.lastPauseTime).toBe(4242);

      // Four more books pass through the engine in the same session — enough
      // for the 4-entry mirror to evict book A.
      for (const id of ['port-b', 'port-c', 'port-d', 'port-e']) {
        store.persistQueue(id, [{ text: id, cfi: `cfi-${id}` }]);
        await settled(id, id);
      }

      // A later persist for A: the memo resolves instantly, so nothing re-reads
      // the row at the port level.
      store.persistQueue('port-a', [{ text: 'Later', cfi: 'cfi-1' }]);
      const row = await settled('port-a', 'Later');

      expect(row.playbackQueue).toEqual([{ text: 'Later', cfi: 'cfi-1' }]);
      expect(row.lastPauseTime, 'the persisted pause stamp must survive').toBe(4242);
    });
  });
});
