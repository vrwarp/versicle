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
  publishOwnSpend?: (usage: DailyUsage) => void,
): QuotaStore {
  return {
    loadDailyUsage: async (): Promise<DailyUsage | null> => {
      const row = await repo.load();
      return row ?? null;
    },
    saveDailyUsage: (usage: DailyUsage): void => {
      void repo.save(usage).catch(() => {});
      // Mirror this device's own daily spend onto its synced device record so
      // other devices can keep the shared per-project Gemini quota correct.
      // Fire-and-forget, never throws — same contract as the repo write.
      publishOwnSpend?.(usage);
    },
  };
}
