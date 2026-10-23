import { describe, expect, it } from 'vitest';
import type { QuotaCounterRepo } from '@data/repos/quotaCounter';
import type { QuotaDailyUsageRow } from '@data/rows/app';
import { makeQuotaStore } from './makeQuotaStore';

/** In-memory repo whose load/save yield to the microtask queue, like real IDB. */
function makeFakeRepo(initial?: QuotaDailyUsageRow) {
  let row: QuotaDailyUsageRow | undefined = initial;
  const repo = {
    async load() {
      await Promise.resolve();
      return row ? structuredClone(row) : undefined;
    },
    async save(next: QuotaDailyUsageRow) {
      await Promise.resolve();
      row = structuredClone(next);
    },
  } as unknown as QuotaCounterRepo;
  return { repo, current: () => row };
}

describe('makeQuotaStore', () => {
  it('loads a pool, falling back to the legacy flat row for the default pool', async () => {
    const { repo } = makeFakeRepo({ day: '2026-01-01', rpd: 4, tpm: 9 });
    const store = makeQuotaStore(repo);
    expect(await store.loadDailyUsage('default')).toEqual({ day: '2026-01-01', rpd: 4, tpm: 9 });
    expect(await store.loadDailyUsage('other')).toEqual({ day: '2026-01-01', rpd: 0, tpm: 0 });
  });

  describe('regression: concurrent saves for different pools', () => {
    it('keeps every pool update instead of losing one to a stale read', async () => {
      const { repo, current } = makeFakeRepo();
      const store = makeQuotaStore(repo);

      store.saveDailyUsage('default', { day: '2026-01-01', rpd: 1, tpm: 10 });
      store.saveDailyUsage('gemini-embedding-2', { day: '2026-01-01', rpd: 2, tpm: 20 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(current()?.pools).toEqual({
        default: { rpd: 1, tpm: 10 },
        'gemini-embedding-2': { rpd: 2, tpm: 20 },
      });
      expect(current()?.rpd).toBe(1);
    });

    it('still persists later saves after an earlier one failed', async () => {
      const { repo, current } = makeFakeRepo();
      let fail = true;
      const realSave = repo.save.bind(repo);
      repo.save = async (next) => {
        if (fail) {
          fail = false;
          throw new Error('quota exceeded');
        }
        await realSave(next);
      };
      const store = makeQuotaStore(repo);

      store.saveDailyUsage('default', { day: '2026-01-01', rpd: 1, tpm: 1 });
      store.saveDailyUsage('default', { day: '2026-01-01', rpd: 2, tpm: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(current()?.pools?.default).toEqual({ rpd: 2, tpm: 2 });
    });
  });

  it('publishes own spend on every save', () => {
    const { repo } = makeFakeRepo();
    const published: Array<[string, number]> = [];
    const store = makeQuotaStore(repo, (pool, usage) => published.push([pool, usage.rpd]));
    store.saveDailyUsage('p', { day: '2026-01-01', rpd: 3, tpm: 0 });
    expect(published).toEqual([['p', 3]]);
  });
});
