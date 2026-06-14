/**
 * Composition-root adapter (Phase A): maps the kernel's injected
 * {@link QuotaStore} port onto the data-layer {@link QuotaCounterRepo}. This is
 * the single edge where `data/` meets `kernel/quota`, which keeps the kernel
 * store-free (`kernel-imports-nothing` at error/0 — the governor never imports
 * `data/`).
 *
 * Lives under `app/` because `app/` is the composition root: a domain may not
 * own a store edge (`domains-no-store`), but the composition root may. Wired at
 * boot via `setQuotaStore(makeQuotaStore(quotaCounterRepo))`
 * (src/app/google/wireGoogle.ts).
 *
 * `saveDailyUsage` is fire-and-forget by the port's contract (returns void): a
 * failed persist must never fail an acquire/commit — the 429-backoff cooldown
 * is the safety net. The repo already funnels its own failures through
 * `handleDbError`, so the swallowed rejection here is a last-resort guard.
 */
import type { DailyUsage, QuotaStore } from '@kernel/quota';
import type { QuotaCounterRepo } from '@data/repos/quotaCounter';

export function makeQuotaStore(repo: QuotaCounterRepo): QuotaStore {
  return {
    loadDailyUsage: async (): Promise<DailyUsage | null> => {
      const row = await repo.load();
      return row ?? null;
    },
    saveDailyUsage: (usage: DailyUsage): void => {
      void repo.save(usage).catch(() => {});
    },
  };
}
