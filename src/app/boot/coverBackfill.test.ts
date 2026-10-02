/**
 * Cover backfill — the one-time recovery of covers for books imported
 * before the malformed-EPUB hardening (plan §5, decision §9.3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StaticManifestRow } from '@data/rows/static';
import { bookContent } from '@data/repos/bookContent';
import { COVER_BACKFILL_FLAG, coverBackfillTask, runCoverBackfill, type CoverBackfillDeps } from './coverBackfill';

const row = (bookId: string, coverBlob?: Blob | ArrayBuffer): StaticManifestRow =>
  ({ bookId, title: bookId, author: 'a', fileHash: 'h', fileSize: 1, totalChars: 1, schemaVersion: 1, coverBlob }) as StaticManifestRow;

const cover = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

function deps(over: Partial<CoverBackfillDeps> = {}): CoverBackfillDeps & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    listManifests: async () => [
      row('has-blob', new Blob([new Uint8Array([9])])),
      row('has-buffer', new Uint8Array([9]).buffer),
      row('needs-cover'),
      row('offloaded'),
      row('no-cover-in-book'),
      row('broken'),
    ],
    getBookFile: async (id) => (id === 'offloaded' ? undefined : new Blob([id])),
    extractCover: async (file) => {
      const id = await file.text();
      if (id === 'broken') throw new Error('corrupt epub');
      return id === 'no-cover-in-book' ? {} : { coverBlob: cover, coverPalette: [1] };
    },
    saveCover: async (r) => {
      saved.push(r.bookId);
    },
    shouldContinue: () => true,
    ...over,
  };
}

describe('runCoverBackfill', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('extracts covers only for local books without one and reports counts', async () => {
    const d = deps();
    const result = await runCoverBackfill(d);
    expect(d.saved).toEqual(['needs-cover']);
    expect(result).toEqual({ scanned: 3, found: 1, failed: 1 });
  });

  it('treats an empty stored cover as missing', async () => {
    const d = deps({ listManifests: async () => [row('needs-cover', new ArrayBuffer(0))] });
    await runCoverBackfill(d);
    expect(d.saved).toEqual(['needs-cover']);
  });

  it('stops when told to', async () => {
    const d = deps({ shouldContinue: () => false });
    expect(await runCoverBackfill(d)).toEqual({ scanned: 0, found: 0, failed: 0 });
    expect(d.saved).toEqual([]);
  });
});

describe('coverBackfillTask', () => {
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
    localStorage.removeItem(COVER_BACKFILL_FLAG);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.removeItem(COVER_BACKFILL_FLAG);
  });

  it('runs once on idle and then sets the per-device flag', async () => {
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c } = ctx();
    coverBackfillTask.run(c as never);
    await vi.waitFor(() => expect(localStorage.getItem(COVER_BACKFILL_FLAG)).toBe('1'));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does nothing once the flag is set', () => {
    localStorage.setItem(COVER_BACKFILL_FLAG, '1');
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c, cleanups } = ctx();
    coverBackfillTask.run(c as never);
    expect(cleanups).toHaveLength(0);
    expect(list).not.toHaveBeenCalled();
  });

  it('a teardown before idle cancels the pass and leaves the flag unset', async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(bookContent, 'listManifests').mockResolvedValue([]);
    const { ctx: c, cleanups } = ctx();
    coverBackfillTask.run(c as never);
    cleanups.forEach((fn) => fn());
    await vi.runAllTimersAsync();
    expect(list).not.toHaveBeenCalled();
    expect(localStorage.getItem(COVER_BACKFILL_FLAG)).toBeNull();
  });
});
