/**
 * QuotaGovernor behavioral spec (Phase A; kernel co-located test convention,
 * mirrors src/kernel/net/NetworkGateway.test.ts). The clock and the
 * persistence port are both injected so every time-dependent assertion is
 * deterministic — no real `Date.now`, no real IndexedDB.
 *
 * Covers: sliding RPM/TPM windows; persisted-RPD reset at midnight PT via a
 * QuotaStore test double; fg-preempts-bg; estimate→commit reconcile;
 * cooldown-on-429 honoring retryAfterMs; acquire throws NetRateLimitedError
 * (code NET_RATE_LIMITED, retryable true) when the RPD is exhausted; and the
 * GG-8 fresh-limits invariant (mutating the provider between calls takes
 * effect on the very next acquire).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetRateLimitedError } from '~types/errors';
import {
  QuotaGovernor,
  setQuotaStore,
  type DailyUsage,
  type QuotaLimits,
  type QuotaStore,
} from './QuotaGovernor';

/** Generous defaults so a test only constrains the limit it is exercising. */
const LOOSE: QuotaLimits = { rpm: 1000, tpm: 1_000_000, rpd: 1000 };

/** A controllable clock. */
function makeClock(start: number): { now: () => number; set: (t: number) => void; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    set: (next) => {
      t = next;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** A QuotaStore test double recording saves and serving a seeded load value. */
function makeStoreDouble(initial: DailyUsage | null = null): {
  store: QuotaStore;
  saved: DailyUsage[];
  setLoad: (u: DailyUsage | null) => void;
} {
  let loadValue = initial;
  const saved: DailyUsage[] = [];
  return {
    store: {
      loadDailyUsage: (_ratePool) => Promise.resolve(loadValue),
      saveDailyUsage: (_ratePool, u) => {
        saved.push(u);
        loadValue = u;
      },
    },
    saved,
    setLoad: (u) => {
      loadValue = u;
    },
  };
}

// Mid-day PT epoch (well clear of the midnight boundary either way).
const NOON_PT_2026_06_13 = Date.UTC(2026, 5, 13, 19, 0, 0); // 12:00 PDT (UTC-7)

afterEach(() => {
  // Restore the module-level fallback so suites don't leak the double.
  setQuotaStore(makeStoreDouble().store);
});

describe('QuotaGovernor', () => {
  let clock: ReturnType<typeof makeClock>;
  let limits: QuotaLimits;

  beforeEach(() => {
    clock = makeClock(NOON_PT_2026_06_13);
    limits = { ...LOOSE };
    setQuotaStore(makeStoreDouble().store);
  });

  const newGovernor = () => new QuotaGovernor(() => limits, clock.now);

  describe('sliding RPM/TPM windows', () => {
    it('refuses a request once the rolling RPM budget is full, and admits again after the window slides', async () => {
      limits = { ...LOOSE, rpm: 2 };
      const g = newGovernor();

      await g.acquire('fg', 1);
      g.commit('fg', 1);
      await g.acquire('fg', 1);
      g.commit('fg', 1);

      await expect(g.acquire('fg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);

      // Slide the whole 60s window past the two committed events.
      clock.advance(60_001);
      await expect(g.acquire('fg', 1)).resolves.toBeUndefined();
    });

    it('refuses when the estimate would overflow the rolling TPM budget', async () => {
      limits = { ...LOOSE, tpm: 100 };
      const g = newGovernor();

      await g.acquire('fg', 60);
      g.commit('fg', 60);

      // 60 already spent; an estimate of 50 would exceed the budget.
      await expect(g.acquire('fg', 50)).rejects.toBeInstanceOf(NetRateLimitedError);
      // A request that fits under the buffered ceiling (80) is admitted.
      await expect(g.acquire('fg', 20)).resolves.toBeUndefined();
    });

    it('keeps a 20% TPM safety buffer: admits only up to 80% of the configured limit', async () => {
      limits = { ...LOOSE, tpm: 100 };
      const g = newGovernor();

      // 80 tokens = exactly the buffered ceiling (floor(100 * 0.8)) — admitted.
      await expect(g.acquire('fg', 80)).resolves.toBeUndefined();
      // One more token would cross the 80% ceiling even though the configured
      // limit (100) still has room — refused (the 20% buffer).
      await expect(g.acquire('fg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);
    });
  });

  describe('fg preempts bg', () => {
    it('refuses background acquisitions while a foreground claim is in flight', async () => {
      const g = newGovernor();

      await g.acquire('fg', 1); // claim held until release (the gateway's finally)

      await expect(g.acquire('bg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);

      g.release('fg'); // the gateway frees the claim (commit no longer releases)
      await expect(g.acquire('bg', 1)).resolves.toBeUndefined();
    });

    it('caps background spend at the bg fraction of the minute budget', async () => {
      // rpm 10 → bg request cap = floor(10 * 0.5) = 5.
      limits = { ...LOOSE, rpm: 10 };
      const g = newGovernor();

      for (let i = 0; i < 5; i++) {
        await g.acquire('bg', 1);
        g.commit('bg', 1);
      }
      await expect(g.acquire('bg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);
    });
  });

  describe('acquire records the spend; commit reconciles estimate → actual', () => {
    it('records the estimate at acquire then commit reconciles it to the ACTUAL cost (exactly one event)', async () => {
      limits = { ...LOOSE, tpm: 100 };
      const g = newGovernor();

      await g.acquire('fg', 10); // admitted on (and recorded as) a 10-token estimate
      expect(g.snapshot().fg.tpm).toBe(10); // recorded at acquire, before any commit
      expect(g.snapshot().fg.rpm).toBe(1); // exactly one window event
      g.commit('fg', 80); // reconcile the recorded event 10 → 80

      // 80 now spent; an estimate of 30 would exceed 100.
      await expect(g.acquire('fg', 30)).rejects.toBeInstanceOf(NetRateLimitedError);
      // Still exactly one (fg) event, now carrying the actual cost.
      expect(g.snapshot().fg.tpm).toBe(80);
      expect(g.snapshot().fg.rpm).toBe(1);
    });

    it('persists the daily RPD at ACQUIRE (the count reflects admissions, not commits)', async () => {
      const double = makeStoreDouble();
      setQuotaStore(double.store);
      const g = newGovernor();

      await g.acquire('fg', 1);
      g.commit('fg', 1);
      await g.acquire('fg', 1);
      g.commit('fg', 1);

      expect(double.saved.at(-1)).toMatchObject({ rpd: 2 });
    });

    it('an acquire with NO commit still counts toward RPM/TPM/RPD and persists (the embedding-egress regression)', async () => {
      const double = makeStoreDouble();
      setQuotaStore(double.store);
      const g = newGovernor();

      // Emulate an embedding egress: acquire + the gateway's finally release,
      // but NO governor commit (the embedding client has no governor wired).
      await g.acquire('fg', 7);
      g.release('fg');

      const snap = g.snapshot().fg;
      expect(snap.rpm).toBe(1); // counted in the rolling RPM window
      expect(snap.tpm).toBe(7); // counted in the rolling TPM window (the estimate)
      expect(snap.rpd).toBe(1); // counted against the daily RPD
      // …and persisted+published through the store (the A6 saveDailyUsage).
      expect(double.saved.at(-1)).toMatchObject({ rpd: 1, tpm: 7 });
    });

    it('commit does NOT double-record RPD/window (one acquire + one commit ⇒ rpd 1, one event)', async () => {
      const double = makeStoreDouble();
      setQuotaStore(double.store);
      const g = newGovernor();

      await g.acquire('fg', 5);
      g.commit('fg', 12);

      const snap = g.snapshot().fg;
      expect(snap.rpm).toBe(1); // exactly one event (acquire recorded, commit reconciled)
      expect(snap.tpm).toBe(12); // reconciled to the actual, not 5 + 12
      expect(snap.rpd).toBe(1); // bumped once (at acquire), NOT again at commit
      expect(double.saved.at(-1)).toMatchObject({ rpd: 1, tpm: 12 });
    });

    it('release does NOT undo the recorded spend (the attempt still counts; the fg claim frees so bg is admitted)', async () => {
      const double = makeStoreDouble();
      setQuotaStore(double.store);
      const g = newGovernor();

      await g.acquire('fg', 3);
      g.release('fg'); // the gateway frees the claim — but the spend stays recorded

      expect(g.snapshot().fg.rpd).toBe(1); // the attempt still counts (free-tier reality)
      expect(double.saved.at(-1)).toMatchObject({ rpd: 1 });
      // The fg claim was freed, so a bg acquire is now admitted (no fg-preempt).
      await expect(g.acquire('bg', 1)).resolves.toBeUndefined();
    });

    it('admits at least one bg request even when rpm=1 (the bg cap floors to >=1)', async () => {
      // floor(1 * 0.5) = 0 would refuse ALL bg; Math.max(1, …) admits one.
      limits = { ...LOOSE, rpm: 1, tpm: 1 };
      const g = newGovernor();

      await expect(g.acquire('bg', 1)).resolves.toBeUndefined();
    });
  });

  describe('persisted RPD + midnight-PT reset', () => {
    it('counts a persisted RPD from today and refuses once it is exhausted', async () => {
      limits = { ...LOOSE, rpd: 3 };
      const today = '2026-06-13';
      const double = makeStoreDouble({ day: today, rpd: 3 });
      setQuotaStore(double.store);
      const g = newGovernor();

      const err = await g.acquire('fg', 1).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetRateLimitedError);
      expect((err as NetRateLimitedError).code).toBe('NET_RATE_LIMITED');
      expect((err as NetRateLimitedError).retryable).toBe(true);
      expect((err as NetRateLimitedError).context).toMatchObject({ reason: 'rpd-exhausted' });
    });

    it('treats a persisted RPD stamped with a PRIOR PT day as zero (rollover)', async () => {
      limits = { ...LOOSE, rpd: 3 };
      // Stored under yesterday — must NOT count against today's budget.
      const double = makeStoreDouble({ day: '2026-06-12', rpd: 3 });
      setQuotaStore(double.store);
      const g = newGovernor();

      await expect(g.acquire('fg', 1)).resolves.toBeUndefined();
      g.commit('fg', 1);
      // Today's fresh counter started at 0 and is now 1.
      expect(double.saved.at(-1)).toMatchObject({ day: '2026-06-13', rpd: 1 });
    });

    it('rolls the in-memory counter over when the clock crosses midnight PT', async () => {
      limits = { ...LOOSE, rpd: 5 };
      const double = makeStoreDouble();
      setQuotaStore(double.store);
      const g = newGovernor();

      await g.acquire('fg', 1);
      g.commit('fg', 1);
      expect(double.saved.at(-1)).toMatchObject({ day: '2026-06-13', rpd: 1 });

      // Jump to the next PT day (well past midnight PT).
      clock.set(Date.UTC(2026, 5, 14, 19, 0, 0));
      await g.acquire('fg', 1);
      g.commit('fg', 1);
      expect(double.saved.at(-1)).toMatchObject({ day: '2026-06-14', rpd: 1 });
    });
  });

  describe('cooldown on 429', () => {
    it('refuses acquires while a recorded cooldown is active, then admits once it elapses', async () => {
      const g = newGovernor();

      g.recordCooldown(5_000);

      const err = await g.acquire('fg', 1).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetRateLimitedError);
      expect((err as NetRateLimitedError).context).toMatchObject({
        reason: 'cooldown',
        retryAfterMs: 5_000,
      });

      // Still inside the cooldown.
      clock.advance(4_999);
      await expect(g.acquire('fg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);

      // Cooldown elapsed.
      clock.advance(2);
      await expect(g.acquire('fg', 1)).resolves.toBeUndefined();
    });
  });

  describe('GG-8: limits read FRESH per acquire', () => {
    it('honors a limit mutated between acquires on the very next call', async () => {
      limits = { ...LOOSE, rpm: 1 };
      const g = newGovernor();

      await g.acquire('fg', 1);
      g.commit('fg', 1);
      // rpm=1 is now spent.
      await expect(g.acquire('fg', 1)).rejects.toBeInstanceOf(NetRateLimitedError);

      // Raise the limit on the provider — no reconstruction, no cached config.
      limits = { ...LOOSE, rpm: 5 };
      await expect(g.acquire('fg', 1)).resolves.toBeUndefined();
    });
  });

  describe('snapshot', () => {
    it('returns the shared LaneUsage shape with fresh limits per lane', async () => {
      limits = { ...LOOSE, rpm: 7, tpm: 70, rpd: 700 };
      const g = newGovernor();

      await g.acquire('fg', 5);
      g.commit('fg', 5);

      const snap = g.snapshot();
      expect(snap.fg).toMatchObject({ rpm: 1, tpm: 5, rpd: 1 });
      expect(snap.fg.limits).toEqual({ rpm: 7, tpm: 70, rpd: 700 });
      expect(snap.bg).toMatchObject({ rpm: 0, tpm: 0 });
    });
  });
});
