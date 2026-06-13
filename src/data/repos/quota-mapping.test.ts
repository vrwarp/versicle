/**
 * Quota → StorageFullError mapping at the repo boundary.
 *
 * Absorbed from src/db/db-quota.test.ts in the P3-8 carve (test-absorption
 * ledger, plan/overhaul/README.md §4 rule 8): the spy moves from DBService's
 * private getDB onto the data layer's getConnection — handleDbError
 * (src/data/errors.ts) must map a QuotaExceededError raised by ANY repo
 * operation to the typed StorageFullError the UI surfaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bookContent } from './bookContent';
import { getConnection } from '../connection';
import { StorageFullError } from '~types/errors';

vi.mock('../connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connection')>();
  return {
    ...actual,
    getConnection: vi.fn(actual.getConnection),
  };
});

describe('regression: QuotaExceededError mapping (absorbed from db/db-quota.test.ts)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws StorageFullError when IndexedDB quota is exceeded (DOMException QuotaExceededError)', async () => {
    vi.mocked(getConnection).mockImplementationOnce(async () => ({
      transaction: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    await expect(bookContent.getManifestBundle('123')).rejects.toThrow(StorageFullError);
  });

  it('throws StorageFullError when IndexedDB quota is exceeded (Error name QuotaExceededError)', async () => {
    vi.mocked(getConnection).mockImplementationOnce(async () => ({
      transaction: () => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    await expect(bookContent.getManifestBundle('123')).rejects.toThrow(StorageFullError);
  });
});
