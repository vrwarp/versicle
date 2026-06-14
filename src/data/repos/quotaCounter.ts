/**
 * `app_metadata['quota-daily-usage']` repository — the QuotaGovernor's
 * persisted daily (RPD) counter (Phase A). The ONLY IDB touch for the
 * governor: the kernel holds the in-memory RPM/TPM windows itself and reaches
 * persistence through an injected `QuotaStore` port (`@kernel/quota`); the
 * app-layer adapter (`src/app/quota/makeQuotaStore.ts`) maps that port onto
 * this repo.
 *
 * No new store and no DB bump — the value lives under the EXISTING
 * `app_metadata` key-value store as an append-only key (same pattern as
 * `audioSizeBackfillV25`; see src/data/rows/app.ts APP_METADATA_KEYS).
 *
 * Worker-safe like every repo: no store/UI imports; writes go through the
 * navigator.locks write-gate, and every failure funnels through
 * `handleDbError`.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import { APP_METADATA_KEYS, type QuotaDailyUsageRow } from '../rows/app';

const KEY = APP_METADATA_KEYS.quotaDailyUsage;

class QuotaCounterRepo {
  /** Today's persisted daily usage, or undefined when never written. */
  async load(): Promise<QuotaDailyUsageRow | undefined> {
    try {
      const db = await getConnection();
      const value = await db.get('app_metadata', KEY);
      // Narrow the app_metadata envelope to this key's shape (out-of-line key;
      // the value union is widened by AppMetadataValue).
      return value as QuotaDailyUsageRow | undefined;
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Persist today's daily usage (last-write-wins; one row under KEY). */
  async save(usage: QuotaDailyUsageRow): Promise<void> {
    try {
      await write(['app_metadata'], (tx) => {
        tx.objectStore('app_metadata').put(usage, KEY);
      });
    } catch (error) {
      handleDbError(error);
    }
  }
}

export const quotaCounterRepo = new QuotaCounterRepo();
export type { QuotaCounterRepo };
