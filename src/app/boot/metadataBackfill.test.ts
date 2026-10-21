/**
 * Metadata backfill — the one-time retry of the copyright-page title/author
 * fallback for books imported before it existed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StaticManifestRow } from '@data/rows/static';
import { bookContent } from '@data/repos/bookContent';
import {
  MAX_ATTEMPTS,
  METADATA_BACKFILL_ATTEMPTS,
  METADATA_BACKFILL_FLAG,
  isPlaceholderAuthor,
  metadataBackfillTask,
  runMetadataBackfill,
  type MetadataBackfillDeps,
  type RecoveredMetadata,
} from './metadataBackfill';

const row = (bookId: string, title: string, author: string): StaticManifestRow =>
  ({ bookId, title, author, fileHash: 'h', fileSize: 1, totalChars: 1, schemaVersion: 1 }) as StaticManifestRow;

const RECOVERED = { title: 'Reasonable Faith: Christian Truth and Apologetics', author: 'William Lane Craig' };

function deps(over: Partial<MetadataBackfillDeps> = {}): MetadataBackfillDeps & {
  saved: Array<[string, RecoveredMetadata]>;
  extracted: string[];
} {
  const saved: Array<[string, RecoveredMetadata]> = [];
  const extracted: string[] = [];
  return {
    saved,
    extracted,
    listManifests: async () => [
      row('fine', 'A Real Title', 'A Real Author'),
      row('no-author', 'Reasonable Faith', 'Unknown Author'),
      row('junk-title', 'Reasonable Faith.501159.int', 'William Lane Craig'),
      row('both', 'Reasonable Faith.501159.int', 'Unknown Author'),
      row('still-unknown', 'Untitled', 'Unknown Author'),
      row('offloaded', 'X', 'Unknown Author'),
      row('broken', 'X', 'Unknown Author'),
    ],
    getBookFile: async (id) => (id === 'offloaded' ? undefined : new Blob([id])),
    extractMetadata: async (file) => {
      const id = await file.text();
      extracted.push(id);
      if (id === 'broken') throw new Error('corrupt epub');
      return id === 'still-unknown' ? { title: 'Untitled', author: 'Unknown Author' } : RECOVERED;
    },
    saveMetadata: async (r, recovered) => {
      saved.push([r.bookId, recovered]);
    },
    shouldContinue: () => true,
    ...over,
  };
}

describe('runMetadataBackfill', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('re-extracts only local placeholder books and writes back only the placeholder fields', async () => {
    const d = deps();
    const result = await runMetadataBackfill(d);
    expect(d.extracted).toEqual(['no-author', 'junk-title', 'both', 'still-unknown', 'broken']);
    expect(d.saved).toEqual([
      ['no-author', { author: 'William Lane Craig' }],
      ['junk-title', { title: RECOVERED.title }],
      ['both', RECOVERED],
    ]);
    expect(result).toEqual({ scanned: 5, fixed: 3, failed: 1 });
  });

  it('sanitizes recovered values like import does', async () => {
    const d = deps({
      listManifests: async () => [row('b', 'T', 'Unknown Author')],
      extractMetadata: async () => ({ title: 'T', author: '<b>Jane</b> Doe' }),
    });
    await runMetadataBackfill(d);
    expect(d.saved).toEqual([['b', { author: 'Jane Doe' }]]);
  });

  it('counts a book whose file cannot be read as scanned and failed, and keeps going', async () => {
    const d = deps({
      listManifests: async () => [row('unreadable', 'T', 'Unknown Author'), row('both', 'X.123456.int', 'Unknown Author')],
      getBookFile: async (id) => {
        if (id === 'unreadable') throw new Error('read failed');
        return new Blob([id]);
      },
    });
    expect(await runMetadataBackfill(d)).toEqual({ scanned: 2, fixed: 1, failed: 1 });
    expect(d.saved.map(([id]) => id)).toEqual(['both']);
  });

  it('stops when told to', async () => {
    const d = deps({ shouldContinue: () => false });
    expect(await runMetadataBackfill(d)).toEqual({ scanned: 0, fixed: 0, failed: 0 });
    expect(d.saved).toEqual([]);
  });

  it('treats a blank author as a placeholder', () => {
    expect(isPlaceholderAuthor('  ')).toBe(true);
    expect(isPlaceholderAuthor('Unknown Author')).toBe(true);
    expect(isPlaceholderAuthor('Jane Doe')).toBe(false);
  });
});

describe('metadataBackfillTask', () => {
  const ctx = () => {
    const cleanups: Array<() => void> = [];
    return {
      cleanups,
      ctx: {
        setStatusMessage: () => {},
        syncAllowed: true,
        pendingMigration: null,
        halt: () => {},
        addCleanup: (fn: () => void) => cleanups.push(fn),
      },
    };
  };

  beforeEach(() => {
    localStorage.removeItem(METADATA_BACKFILL_FLAG);
    localStorage.removeItem(METADATA_BACKFILL_ATTEMPTS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.removeItem(METADATA_BACKFILL_FLAG);
    localStorage.removeItem(METADATA_BACKFILL_ATTEMPTS);
  });

  /** One boot whose only book always fails to extract. */
  const failingBoot = async () => {
    const before = localStorage.getItem(METADATA_BACKFILL_ATTEMPTS);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(bookContent, 'listManifests').mockResolvedValue([row('b', 'T', 'Unknown Author')]);
    vi.spyOn(bookContent, 'getBookFile').mockRejectedValue(new Error('read failed'));
    const { ctx: c } = ctx();
    metadataBackfillTask.run(c as never);
    // Settled: the pass either set the flag or advanced the attempt count.
    await vi.waitFor(() => {
      const settled =
        localStorage.getItem(METADATA_BACKFILL_FLAG) === '1' ||
        localStorage.getItem(METADATA_BACKFILL_ATTEMPTS) !== before;
      expect(settled).toBe(true);
    });
  };

  it('retries on later boots while a book fails, then gives up after MAX_ATTEMPTS passes', async () => {
    for (let pass = 1; pass < MAX_ATTEMPTS; pass++) {
      await failingBoot();
      expect(localStorage.getItem(METADATA_BACKFILL_FLAG)).toBeNull();
      expect(localStorage.getItem(METADATA_BACKFILL_ATTEMPTS)).toBe(String(pass));
      vi.restoreAllMocks();
    }
    await failingBoot();
    expect(localStorage.getItem(METADATA_BACKFILL_FLAG)).toBe('1');
    expect(localStorage.getItem(METADATA_BACKFILL_ATTEMPTS)).toBeNull();
  });

  it('a clean pass after a failed one sets the flag and clears the attempt count', async () => {
    localStorage.setItem(METADATA_BACKFILL_ATTEMPTS, '1');
    vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c } = ctx();
    metadataBackfillTask.run(c as never);
    await vi.waitFor(() => expect(localStorage.getItem(METADATA_BACKFILL_FLAG)).toBe('1'));
    expect(localStorage.getItem(METADATA_BACKFILL_ATTEMPTS)).toBeNull();
  });

  it('runs once on idle and then sets the per-device flag', async () => {
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c } = ctx();
    metadataBackfillTask.run(c as never);
    await vi.waitFor(() => expect(localStorage.getItem(METADATA_BACKFILL_FLAG)).toBe('1'));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does nothing once the flag is set', () => {
    localStorage.setItem(METADATA_BACKFILL_FLAG, '1');
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c, cleanups } = ctx();
    metadataBackfillTask.run(c as never);
    expect(cleanups).toHaveLength(0);
    expect(list).not.toHaveBeenCalled();
  });

  it('a teardown before idle cancels the pass and leaves the flag unset', async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c, cleanups } = ctx();
    metadataBackfillTask.run(c as never);
    cleanups.forEach((fn) => fn());
    await vi.runAllTimersAsync();
    expect(list).not.toHaveBeenCalled();
    expect(localStorage.getItem(METADATA_BACKFILL_FLAG)).toBeNull();
  });
});
