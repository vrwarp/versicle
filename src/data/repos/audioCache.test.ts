/**
 * audioCache repo contract suite (Phase 3 D5.1 / Test plan R).
 *
 * Pins the behavior carved out of DBService (getCachedSegment/cacheSegment —
 * the round-trip + alignmentData read-shim assertions mirror the DBService
 * characterization suite, which keeps passing through the deprecated façade
 * until P3-12), plus the NEW design surface: the debounced lastAccessed
 * bump and the streaming-cursor LRU eviction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { audioCache, AUDIO_CACHE_BUDGET_BYTES, EVICTION_PUT_INTERVAL } from './audioCache';
import { getConnection } from '../connection';
import { idbWriteLockIdle } from '../write-gate';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function seedRow(key: string, opts: { size?: number; lastAccessed?: number; alignmentData?: { timeSeconds: number; charIndex: number }[]; stampSize?: boolean } = {}): Promise<void> {
  const db = await getConnection();
  const byteLength = opts.size ?? 8;
  const row: Record<string, unknown> = {
    key,
    audio: new ArrayBuffer(byteLength),
    createdAt: opts.lastAccessed ?? Date.now(),
    lastAccessed: opts.lastAccessed ?? Date.now(),
  };
  if (opts.alignmentData) row.alignmentData = opts.alignmentData;
  if (opts.stampSize !== false) row.size = byteLength;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.put('cache_audio_blobs', row as any);
}

describe('data/repos/audioCache', () => {
  beforeEach(async () => {
    const db = await getConnection();
    await db.clear('cache_audio_blobs');
  });

  afterEach(async () => {
    await idbWriteLockIdle();
    vi.useRealTimers();
  });

  describe('round-trip (carved from DBService — characterization preserved)', () => {
    it('putSegment→getSegment returns the alignment written', async () => {
      const timepoints = [{ timeSeconds: 0.5, charIndex: 3, type: 'word' }];
      await audioCache.putSegment('k1', new ArrayBuffer(4), timepoints);
      const row = await audioCache.getSegment('k1');
      expect(row?.alignment).toEqual(timepoints);
    });

    it('normalizes legacy rows written under the old alignmentData field (read-shim, prep ▲2)', async () => {
      const timepoints = [{ timeSeconds: 1.0, charIndex: 7 }];
      await seedRow('k-legacy', { alignmentData: timepoints, lastAccessed: 1, stampSize: false });
      const row = await audioCache.getSegment('k-legacy');
      expect(row?.alignment).toEqual(timepoints);
    });

    it('never writes the legacy alignmentData field for new rows, and stamps size', async () => {
      const timepoints = [{ timeSeconds: 0.25, charIndex: 1, type: 'word' }];
      await audioCache.putSegment('k-new', new ArrayBuffer(4), timepoints);
      const db = await getConnection();
      const raw = await db.get('cache_audio_blobs', 'k-new');
      expect(raw?.alignment).toEqual(timepoints);
      expect(raw?.alignmentData).toBeUndefined();
      expect(raw?.size).toBe(4); // additive field, not a format change
    });

    it('returns undefined for a miss', async () => {
      expect(await audioCache.getSegment('nope')).toBeUndefined();
    });
  });

  describe('debounced lastAccessed bump (replaces the per-hit gate-bypassing put)', () => {
    it('bumps lastAccessed when the stored stamp is over an hour old', async () => {
      const old = Date.now() - 2 * HOUR;
      await seedRow('k-old', { lastAccessed: old });
      await audioCache.getSegment('k-old');
      await idbWriteLockIdle(); // the bump is fire-and-forget through the gate
      const db = await getConnection();
      const raw = await db.get('cache_audio_blobs', 'k-old');
      expect(raw!.lastAccessed).toBeGreaterThan(old);
    });

    it('skips the write entirely while the stored stamp is fresh (< 1h)', async () => {
      const fresh = Date.now() - 5 * 60 * 1000;
      await seedRow('k-fresh', { lastAccessed: fresh });
      await audioCache.getSegment('k-fresh');
      await idbWriteLockIdle();
      const db = await getConnection();
      const raw = await db.get('cache_audio_blobs', 'k-fresh');
      expect(raw!.lastAccessed).toBe(fresh); // untouched — no readwrite txn spent
    });
  });

  describe('LRU eviction (streaming cursor, format-free — no new index)', () => {
    it('no-ops when the cache is under budget', async () => {
      await seedRow('a', { size: 100, lastAccessed: Date.now() - 2 * DAY });
      const result = await audioCache.runEviction(1000);
      expect(result).toEqual({ deleted: 0, freedBytes: 0 });
    });

    it('deletes oldest-first until under budget', async () => {
      const now = Date.now();
      // 5 rows × 1000 bytes, oldest first.
      for (let i = 0; i < 5; i++) {
        await seedRow(`row-${i}`, { size: 1000, lastAccessed: now - (10 - i) * DAY });
      }
      const result = await audioCache.runEviction(2500);
      // 5000 bytes total → delete 3 oldest to reach 2000 ≤ 2500.
      expect(result.deleted).toBe(3);
      expect(result.freedBytes).toBe(3000);
      const db = await getConnection();
      expect(await db.get('cache_audio_blobs', 'row-0')).toBeUndefined();
      expect(await db.get('cache_audio_blobs', 'row-1')).toBeUndefined();
      expect(await db.get('cache_audio_blobs', 'row-2')).toBeUndefined();
      expect(await db.get('cache_audio_blobs', 'row-3')).toBeDefined();
      expect(await db.get('cache_audio_blobs', 'row-4')).toBeDefined();
    });

    it('never evicts rows touched in the last 24h, even over budget (mid-playback safety)', async () => {
      const now = Date.now();
      await seedRow('recent-1', { size: 1000, lastAccessed: now - HOUR });
      await seedRow('recent-2', { size: 1000, lastAccessed: now - 2 * HOUR });
      const result = await audioCache.runEviction(500);
      expect(result.deleted).toBe(0);
      const db = await getConnection();
      expect(await db.get('cache_audio_blobs', 'recent-1')).toBeDefined();
      expect(await db.get('cache_audio_blobs', 'recent-2')).toBeDefined();
    });

    it('falls back to audio.byteLength for legacy rows without the size field', async () => {
      const now = Date.now();
      await seedRow('legacy-big', { size: 2000, lastAccessed: now - 5 * DAY, stampSize: false });
      await seedRow('new-small', { size: 100, lastAccessed: now - 2 * DAY });
      const result = await audioCache.runEviction(1000);
      expect(result.deleted).toBe(1);
      expect(result.freedBytes).toBe(2000); // measured from byteLength
      const db = await getConnection();
      expect(await db.get('cache_audio_blobs', 'legacy-big')).toBeUndefined();
      expect(await db.get('cache_audio_blobs', 'new-small')).toBeDefined();
    });

    it('uses the default 512 MiB budget constant', () => {
      expect(AUDIO_CACHE_BUDGET_BYTES).toBe(512 * 1024 * 1024);
    });

    it('runs a sweep after every N puts', async () => {
      const sweepSpy = vi.spyOn(audioCache, 'runEviction').mockResolvedValue({ deleted: 0, freedBytes: 0 });
      try {
        for (let i = 0; i < EVICTION_PUT_INTERVAL; i++) {
          await audioCache.putSegment(`burst-${i}`, new ArrayBuffer(1));
        }
        expect(sweepSpy).toHaveBeenCalledTimes(1);
      } finally {
        sweepSpy.mockRestore();
      }
    });
  });
});
