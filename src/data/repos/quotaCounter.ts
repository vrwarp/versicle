/**
 * Persists the rate limiter's daily request count for outbound AI API calls,
 * so the per-day cap survives reloads and is shared across this app's tabs.
 * Stored as a single `quota-daily-usage` record in the `app_metadata`
 * key-value store (no dedicated store, no DB version bump). The limiter keeps
 * the short-window (per-minute request/token) counters in memory and reaches
 * disk only through this one record — the per-minute windows are never
 * persisted.
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
