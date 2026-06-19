/**
 * Composition-root adapter: maps the kernel's injected {@link QuotaStore} port
 * onto the data-layer {@link QuotaCounterRepo}. This is the single edge where
 * `data/` meets `kernel/quota`, which keeps the rate-limit governor store-free —
 * the governor never imports `data/`. Lives under `app/` because that is the
 * composition root (a domain may not own a store edge, but the composition root
 * may). Wired at boot via `setQuotaStore(makeQuotaStore(quotaCounterRepo))`.
 *
 * `saveDailyUsage` is fire-and-forget by the port's contract (returns void): a
 * failed persist must never fail an acquire/commit — the 429-backoff cooldown
 * is the safety net. The repo already funnels its own failures through
 * `handleDbError`, so the swallowed rejection here is a last-resort guard.
 *
 * `saveDailyUsage` is also the single chokepoint where the governor reports
 * "today's usage", so it additionally publishes THIS device's own daily spend
 * onto its synced device record (via the optional `publishOwnSpend` hook). Other
 * devices read that record to keep the shared per-project Gemini quota correct
 * across the device mesh. `loadDailyUsage` is unchanged — it still returns only
 * this device's persisted counter; the cross-device total is applied as a
 * limits reduction in the wiring layer, NOT folded into this device's own usage,
 * which would double-count on the next commit/persist.
 *
 * (design: plan/shared-ai-cache-design.md)
 */
import type { DailyUsage, QuotaStore } from '@kernel/quota';
import type { QuotaCounterRepo } from '@data/repos/quotaCounter';

export function makeQuotaStore(
  repo: QuotaCounterRepo,
  publishOwnSpend?: (ratePool: string, usage: DailyUsage) => void,
): QuotaStore {
  return {
    loadDailyUsage: async (ratePool: string): Promise<DailyUsage | null> => {
      const row = await repo.load();
      if (!row) return null;

      if (row.pools && row.pools[ratePool]) {
        return {
          day: row.day,
          rpd: row.pools[ratePool].rpd,
          tpm: row.pools[ratePool].tpm,
        };
      }

      // Backward compatibility fallback for the default pool
      if (ratePool === 'default') {
        return {
          day: row.day,
          rpd: row.rpd ?? 0,
          tpm: row.tpm ?? 0,
        };
      }

      return {
        day: row.day,
        rpd: 0,
        tpm: 0,
      };
    },
    saveDailyUsage: (ratePool: string, usage: DailyUsage): void => {
      const persist = async () => {
        const row = (await repo.load()) ?? { day: usage.day, pools: {} };
        const activeRow = row.day === usage.day ? row : { day: usage.day, pools: {} };

        activeRow.pools = activeRow.pools || {};
        activeRow.pools[ratePool] = { rpd: usage.rpd, tpm: usage.tpm };

        if (ratePool === 'default') {
          activeRow.rpd = usage.rpd;
          activeRow.tpm = usage.tpm;
        }

        await repo.save(activeRow);
      };

      void persist().catch(() => {});
      // Mirror this device's own daily spend onto its synced device record so
      // other devices can keep the shared per-project Gemini quota correct.
      // Fire-and-forget, never throws — same contract as the repo write.
      publishOwnSpend?.(ratePool, usage);
    },
  };
}
