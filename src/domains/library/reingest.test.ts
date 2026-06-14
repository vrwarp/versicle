/**
 * Re-ingest wave pins (Phase 7 §E / PR-L6): the stamp-based detection
 * matrix, the NFKD restamp fast path, idle resumability via stamps, the R4
 * old-row-retention failure path, and the no-binary skip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runReingestWave,
  rowsAreNfkdInvariant,
  derivedContentSane,
  type ReingestWaveDeps,
} from './reingest';
import type { CacheTtsPreparationRow } from '@data/rows/cache';
import type { ChapterMapping } from './import/extract';

const row = (
  bookId: string,
  texts: string[],
  extractionVersion?: number,
): CacheTtsPreparationRow => ({
  id: `${bookId}-ch1`,
  bookId,
  sectionId: 'ch1.xhtml',
  sentences: texts.map((text, i) => ({ text, cfi: `epubcfi(/6/2!/4/${i})` })),
  extractionVersion,
});

const mapping = (sentenceCount: number): ChapterMapping => ({
  syntheticToc: [],
  sections: [],
  ttsContentBatches:
    sentenceCount === 0
      ? []
      : [row('x', Array.from({ length: sentenceCount }, (_, i) => `s${i}`), 3)],
  tableBatches: [],
  searchSections: [],
  totalChars: sentenceCount * 10,
});

function makeDeps(overrides: Partial<ReingestWaveDeps> = {}): ReingestWaveDeps & {
  restamp: ReturnType<typeof vi.fn>;
  reingest: ReturnType<typeof vi.fn>;
} {
  return {
    listVersions: vi.fn(async () => new Map<string, number>()),
    listRows: vi.fn(async () => []),
    restamp: vi.fn(async () => undefined),
    hasLocalBinary: vi.fn(async () => true),
    reingest: vi.fn(async () => undefined),
    yieldToHost: () => Promise.resolve(),
    ...overrides,
  } as ReingestWaveDeps & { restamp: ReturnType<typeof vi.fn>; reingest: ReturnType<typeof vi.fn> };
}

describe('rowsAreNfkdInvariant', () => {
  it('accepts pure-ASCII and pre-composed-free text', () => {
    expect(rowsAreNfkdInvariant([row('b', ['plain ascii.', 'more text']) ])).toBe(true);
  });

  it('rejects text containing decomposable characters (é, ﬁ)', () => {
    expect(rowsAreNfkdInvariant([row('b', ['café society'])])).toBe(false);
    expect(rowsAreNfkdInvariant([row('b', ['the ﬁrst'])])).toBe(false);
  });
});

describe('derivedContentSane (the R4 self-check)', () => {
  const oldRows = [row('b', ['a', 'b', 'c', 'd'], 1)];

  it('accepts comparable extraction sizes', () => {
    expect(derivedContentSane(oldRows, mapping(4))).toBe(true);
    expect(derivedContentSane(oldRows, mapping(2))).toBe(true); // ≥50% floor
  });

  it('rejects collapsed extractions (old rows retained)', () => {
    expect(derivedContentSane(oldRows, mapping(0))).toBe(false);
    expect(derivedContentSane(oldRows, mapping(1))).toBe(false);
  });

  it('accepts anything when there was nothing to lose', () => {
    expect(derivedContentSane([], mapping(0))).toBe(true);
  });
});

describe('runReingestWave', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('detection matrix: restamps invariant v1, reingests drifted v1 + v2, skips v3', async () => {
    const deps = makeDeps({
      listVersions: vi.fn(
        async () =>
          new Map([
            ['v1-ascii', 1], // implicit v1, NFKD-invariant → restamp fast path
            ['v1-drifted', 1], // v1 with decomposable chars → reingest
            ['v2-book', 2], // raw-at-rest convergence → reingest
            ['v3-book', 3], // current → untouched
          ]),
      ),
      listRows: vi.fn(async (bookId: string) =>
        bookId === 'v1-ascii' ? [row(bookId, ['plain ascii'])] : [row(bookId, ['café'])],
      ),
    });

    const report = await runReingestWave(deps);

    expect(report.restamped).toEqual(['v1-ascii']);
    expect(deps.restamp).toHaveBeenCalledWith('v1-ascii', 2);
    // Drifted v1 first (the user-visible fix), then v2 convergence.
    expect(report.reingested).toEqual(['v1-drifted', 'v2-book']);
    expect(deps.reingest).not.toHaveBeenCalledWith('v3-book');
    expect(deps.reingest).not.toHaveBeenCalledWith('v1-ascii');
  });

  it('skips offloaded/ghost books (no binary — they heal on restore/import)', async () => {
    const deps = makeDeps({
      listVersions: vi.fn(async () => new Map([['offloaded', 2]])),
      hasLocalBinary: vi.fn(async () => false),
    });

    const report = await runReingestWave(deps);
    expect(report.skipped).toEqual(['offloaded']);
    expect(deps.reingest).not.toHaveBeenCalled();
  });

  it('a failed re-extract is reported and never blocks the rest of the wave (R4)', async () => {
    const deps = makeDeps({
      listVersions: vi.fn(async () => new Map([['bad', 2], ['good', 2]])),
      reingest: vi.fn(async (bookId: string) => {
        if (bookId === 'bad') throw new Error('verification failed');
      }),
    });

    const report = await runReingestWave(deps);
    expect(report.failed).toEqual(['bad']);
    expect(report.reingested).toEqual(['good']);
  });

  it('is resumable: the stamp is the durable marker, so a second wave has nothing to do', async () => {
    // Simulate a persistent stamp table mutated by restamp/reingest.
    const versions = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const deps = makeDeps({
      listVersions: vi.fn(async () => new Map(versions)),
      listRows: vi.fn(async () => [row('a', ['ascii only'])]),
      restamp: vi.fn(async (bookId: string, version: number) => {
        versions.set(bookId, version);
      }),
      reingest: vi.fn(async (bookId: string) => {
        versions.set(bookId, 3);
      }),
    });

    const first = await runReingestWave(deps);
    expect(first.restamped).toEqual(['a']);
    expect(first.reingested).toEqual(['b']);

    // Second wave: 'b' is stamped v3 (done); 'a' is v2 → only convergence work remains.
    const second = await runReingestWave(deps);
    expect(second.restamped).toEqual([]);
    expect(second.reingested).toEqual(['a']);

    const third = await runReingestWave(deps);
    expect(third.restamped).toEqual([]);
    expect(third.reingested).toEqual([]);
  });

  it('the defer/shutdown check stops between books without losing completed work', async () => {
    let processed = 0;
    const deps = makeDeps({
      listVersions: vi.fn(async () => new Map([['a', 2], ['b', 2], ['c', 2]])),
      reingest: vi.fn(async () => {
        processed += 1;
      }),
      shouldContinue: () => processed < 1,
    });

    const report = await runReingestWave(deps);
    expect(report.reingested).toEqual(['a']);
    expect(deps.reingest).toHaveBeenCalledTimes(1);
  });
});
