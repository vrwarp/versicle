/**
 * quotaCounter repo contract (Phase A): round-trip of the persisted daily
 * (RPD) counter under the existing `app_metadata` KV store, and absence
 * semantics (an unwritten key reads as undefined). Real-IDB round-trip via the
 * data harness — no hand-rolled vi.mock for the repo (program rule 4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { quotaCounterRepo } from './quotaCounter';
import type { QuotaDailyUsageRow } from '../rows/app';
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

const usage = (overrides: Partial<QuotaDailyUsageRow> = {}): QuotaDailyUsageRow => ({
  day: '2026-06-13',
  rpd: 7,
  tpm: 1234,
  ...overrides,
});

describe('quotaCounterRepo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  it('reports an absent key as undefined', async () => {
    await expect(quotaCounterRepo.load()).resolves.toBeUndefined();
  });

  it('round-trips a daily usage row (save then load)', async () => {
    await quotaCounterRepo.save(usage());
    await expect(quotaCounterRepo.load()).resolves.toEqual(usage());
  });

  it('last-write-wins on the single daily key', async () => {
    await quotaCounterRepo.save(usage({ rpd: 1 }));
    await quotaCounterRepo.save(usage({ rpd: 42, tpm: 9999 }));
    await expect(quotaCounterRepo.load()).resolves.toMatchObject({ rpd: 42, tpm: 9999 });
  });

  it('persists rows without the optional tpm field', async () => {
    const row: QuotaDailyUsageRow = { day: '2026-06-13', rpd: 3 };
    await quotaCounterRepo.save(row);
    await expect(quotaCounterRepo.load()).resolves.toEqual(row);
  });
});
