/**
 * QuotaGovernor — pure rate/spend bookkeeping for the AI + cloud-TTS egress
 * lanes, keeping the app within each provider's request/token budget. Imports
 * only `~types` so it stays free of any storage or platform dependency.
 *
 * Three budgets are tracked per lane:
 *  - requests-per-minute / tokens-per-minute — sliding 60 s windows held
 *    IN-MEMORY (reset when the process restarts).
 *  - requests-per-day — a persisted daily counter behind an INJECTED
 *    {@link QuotaStore} port, because it must survive restarts; the governor
 *    never touches IndexedDB itself (the app wires the port to a storage repo).
 *
 * Behavior:
 *  - Limits are read FRESH on every `acquire()` from the injected provider —
 *    never snapshotted at construction, never cached — so changing the limits
 *    takes effect on the next acquire.
 *  - The CLOCK is injectable (`now`): the daily reset is a midnight-Pacific
 *    day-string compare against that clock, so the rollover is unit-testable
 *    without waiting for real midnight.
 *  - Foreground preempts background: a background acquire is refused while any
 *    foreground request is in flight, or once background work has spent its
 *    capped fraction of the minute budget, so interactive work is never starved
 *    by automatic prefetch/embedding spend.
 *  - acquire RECORDS the spend, commit RECONCILES the estimate to the actual
 *    cost, release frees the foreground claim. `acquire(estTokens)` checks the
 *    estimate against the budget and, once admitted, records the minute-window
 *    event and bumps + persists the daily counter — so a request that never
 *    calls commit (e.g. an embedding) still counts and still persists.
 *    `commit(actualTokens)` only corrects that already-recorded event's token
 *    cost (estimate→actual) plus the daily token delta; it records no new event
 *    and never bumps the daily request count. `release()` only frees the
 *    foreground claim and never undoes a recorded spend.
 *  - Cooldown: a 429 from the provider feeds `recordCooldown(retryAfterMs)`;
 *    until that cooldown elapses (or once the daily request budget is spent)
 *    acquire throws {@link NetRateLimitedError} before any network call.
 *
 * Cross-device note: the QuotaStore port is the single seam where, later, a sum
 * of spend across the user's other devices can be folded in without changing
 * the governor — it only ever asks the port for "today's usage".
 */
import { NetRateLimitedError } from '~types/errors';
import { ptDayString } from './ptDay';

/** Foreground (interactive) or background (prefetch/auto) egress lane. */
export type Lane = 'fg' | 'bg';

/** Per-lane limits, re-read on every acquire (never cached). */
export interface QuotaLimits {
  /** Requests per rolling minute. */
  rpm: number;
  /** Tokens per rolling minute. */
  tpm: number;
  /** Requests per calendar day (midnight-PT reset). */
  rpd: number;
}

/**
 * The config seam: limits are read fresh on every acquire. Whatever this
 * returns between calls is honored on the next acquire (no caching).
 */
export type QuotaLimitsProvider = (ratePool: string) => QuotaLimits;

/** Injectable clock (ms epoch). Defaults to `Date.now`; tests control it. */
export type NowProvider = () => number;

/**
 * The persisted daily counter, as seen by the governor. `day` is the
 * midnight-PT day string the count belongs to; a different day string on load
 * means the counter has rolled over and resets to zero.
 */
export interface DailyUsage {
  /** Midnight-PT day key, `YYYY-MM-DD` in America/Los_Angeles. */
  day: string;
  /** Requests counted against the day. */
  rpd: number;
  /** Best-effort tokens counted against the day (optional; observability). */
  tpm?: number;
}

/**
 * Persistence port for the daily (RPD) counter. The kernel holds the in-memory
 * RPM/TPM windows itself; only the day-rollover-surviving RPD needs the port.
 * `save` is intentionally fire-and-forget (returns void): a failed persist must
 * never fail an acquire/commit — the 429-backoff cooldown is the safety net.
 */
export interface QuotaStore {
  /** The persisted daily usage, or null when never written (treated as zero). */
  loadDailyUsage(ratePool: string): Promise<DailyUsage | null>;
  /** Persist the daily usage (last-write-wins; fire-and-forget). */
  saveDailyUsage(ratePool: string, usage: DailyUsage): void;
}

/** The SINGLE shared usage shape — what `snapshot()` returns per lane. */
export interface LaneUsage {
  /** Requests in the current rolling minute. */
  rpm: number;
  /** Tokens in the current rolling minute. */
  tpm: number;
  /** Requests counted against today (persisted RPD). */
  rpd: number;
  /** The limits in force at snapshot time (read fresh). */
  limits: QuotaLimits;
}

/** In-memory fallback used until the composition root installs a real store. */
const inMemoryFallback: QuotaStore = (() => {
  const held = new Map<string, DailyUsage>();
  return {
    loadDailyUsage: (ratePool) => Promise.resolve(held.get(ratePool) ?? null),
    saveDailyUsage: (ratePool, usage) => {
      held.set(ratePool, usage);
    },
  };
})();

/**
 * The active store. Module-level so the governor stays store-free; the
 * composition root swaps in the data/-backed adapter via {@link setQuotaStore}.
 */
let store: QuotaStore = inMemoryFallback;

/** Install the persistence port (composition root owns the store edge). */
export function setQuotaStore(s: QuotaStore): void {
  store = s;
}

/** One rolling-window event: when it happened and how many tokens it cost. */
interface WindowEvent {
  at: number;
  tokens: number;
  /**
   * False until the matching {@link QuotaGovernor.commit} reconciles this
   * event's `tokens` from the acquire-time estimate to the actual cost. A
   * never-committed event (every embedding) stays `false` and keeps its
   * estimate — the acquire-time recording is what makes it count.
   */
  committed: boolean;
}

/** Length of the sliding RPM/TPM window. */
const WINDOW_MS = 60_000;

/**
 * The fraction of the per-minute request/token budget background work may
 * consume before it is refused — leaves headroom so foreground work is not
 * starved by automatic background spend.
 */
const BG_FRACTION = 0.5;

interface PoolState {
  events: Record<Lane, WindowEvent[]>;
  fgClaims: number;
  daily: DailyUsage | null;
  cooldownUntil: number;
}

export class QuotaGovernor {
  private readonly pools = new Map<string, PoolState>();

  private getPool(ratePool: string = 'default'): PoolState {
    let p = this.pools.get(ratePool);
    if (!p) {
      p = {
        events: { fg: [], bg: [] },
        fgClaims: 0,
        daily: null,
        cooldownUntil: 0,
      };
      this.pools.set(ratePool, p);
    }
    return p;
  }

  /**
   * @param getLimits Per-lane limits, read FRESH on every acquire (never cached).
   * @param now Injectable clock; defaults to `Date.now` (tests control it).
   */
  constructor(
    private readonly getLimits: QuotaLimitsProvider,
    private readonly now: NowProvider = Date.now,
  ) {}

  /** Drop window events older than 60 s for the given lane in a pool. */
  private prune(ratePool: string, lane: Lane, at: number): void {
    const cutoff = at - WINDOW_MS;
    const p = this.getPool(ratePool);
    const events = p.events[lane];
    let i = 0;
    while (i < events.length && events[i].at < cutoff) i++;
    if (i > 0) events.splice(0, i);
  }

  /** Sum of requests across both lanes inside the current minute window for a pool. */
  private requestsInWindow(ratePool: string, at: number): number {
    this.prune(ratePool, 'fg', at);
    this.prune(ratePool, 'bg', at);
    const p = this.getPool(ratePool);
    return p.events.fg.length + p.events.bg.length;
  }

  /** Sum of tokens across both lanes inside the current minute window for a pool. */
  private tokensInWindow(ratePool: string, at: number): number {
    this.prune(ratePool, 'fg', at);
    this.prune(ratePool, 'bg', at);
    const p = this.getPool(ratePool);
    const sum = (events: WindowEvent[]) => events.reduce((acc, e) => acc + e.tokens, 0);
    return sum(p.events.fg) + sum(p.events.bg);
  }

  /**
   * Load (or roll over) the persisted daily counter for the current PT day for a pool.
   * A stored counter whose `day` differs from today resets to zero — the
   * midnight-PT reset is a day-string compare against the injected clock.
   */
  private async loadDaily(ratePool: string, at: number): Promise<DailyUsage> {
    const today = ptDayString(at);
    const p = this.getPool(ratePool);
    if (p.daily && p.daily.day === today) {
      return p.daily;
    }
    const persisted = await store.loadDailyUsage(ratePool);
    if (persisted && persisted.day === today) {
      p.daily = { ...persisted };
    } else {
      p.daily = { day: today, rpd: 0, tpm: 0 };
    }
    return p.daily;
  }

  /**
   * Admit one request on `lane` in the specified `ratePool`, sized by `estTokens`.
   * Throws {@link NetRateLimitedError} (retryable, pre-network backpressure) when:
   *  - a cooldown from a prior 429 is still active,
   *  - the persisted RPD for today is exhausted, or
   *  - the rolling RPM/TPM minute budget cannot fit the request
   *    (background lanes are additionally capped at the bg fraction and refused
   *    while a foreground claim is in flight — fg preempts bg).
   *
   * Limits are read FRESH here (never cached). On success a foreground claim is
   * held until the matching {@link release}, AND the spend is RECORDED here (the
   * rolling per-minute window event + the persisted daily request/token count):
   * this is the single recorder, so a request that never commits (e.g. an
   * embedding, whose client has no governor) still counts toward every budget
   * and still persists via the store. {@link commit} only reconciles the
   * recorded estimate to the actual cost.
   */
  async acquire(lane: Lane, estTokens: number, ratePool: string = 'default'): Promise<void> {
    const at = this.now();
    const limits = this.getLimits(ratePool);
    const p = this.getPool(ratePool);

    if (p.cooldownUntil > at) {
      throw new NetRateLimitedError(p.cooldownUntil - at, {
        lane,
        reason: 'cooldown',
        ratePool,
      });
    }

    const daily = await this.loadDaily(ratePool, at);
    if (daily.rpd >= limits.rpd) {
      throw new NetRateLimitedError(this.msUntilNextPtDay(at), {
        lane,
        reason: 'rpd-exhausted',
        rpd: daily.rpd,
        limit: limits.rpd,
        ratePool,
      });
    }

    // fg preempts bg: never admit background work while foreground is claiming,
    // and cap background spend at the bg fraction of the minute budget. The caps
    // floor to >=1 (Math.max(1, …)) so a free-tier rpm/tpm of 1 still admits at
    // least one bg request instead of flooring the bg fraction to zero.
    if (lane === 'bg') {
      if (p.fgClaims > 0) {
        throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'fg-preempt', ratePool });
      }
      const bgRequestCap = Math.max(1, Math.floor(limits.rpm * BG_FRACTION));
      const bgTokenCap = Math.max(1, Math.floor(limits.tpm * BG_FRACTION));
      this.prune(ratePool, 'bg', at);
      const bgTokens = p.events.bg.reduce((acc, e) => acc + e.tokens, 0);
      if (p.events.bg.length >= bgRequestCap || bgTokens + estTokens > bgTokenCap) {
        throw new NetRateLimitedError(WINDOW_MS, {
          lane,
          reason: 'bg-fraction-exhausted',
          ratePool,
        });
      }
    }

    if (this.requestsInWindow(ratePool, at) >= limits.rpm) {
      throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'rpm-exhausted', ratePool });
    }
    if (this.tokensInWindow(ratePool, at) + estTokens > limits.tpm) {
      throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'tpm-exhausted', ratePool });
    }

    if (lane === 'fg') {
      p.fgClaims += 1;
    }

    // RECORD the spend at admission (the single recorder). Push the rolling
    // RPM/TPM window event sized by the estimate (commit reconciles it to the
    // actual later, if it commits at all), then bump + persist the daily RPD/TPM.
    // A never-committing request (every embedding) is counted purely here.
    const est = Math.max(0, estTokens);
    p.events[lane].push({ at, tokens: est, committed: false });
    this.prune(ratePool, lane, at);

    daily.rpd += 1;
    daily.tpm = (daily.tpm ?? 0) + est;
    store.saveDailyUsage(ratePool, { ...daily });
  }

  /**
   * RECONCILE a completed request's estimate to its actual token cost. The spend
   * was already RECORDED by {@link acquire} (the window event + the daily
   * RPD/TPM), so commit ONLY rewrites the oldest still-uncommitted event on
   * `lane` from its estimate to `actualTokens` and reconciles the daily.tpm by
   * the (actual − estimate) delta. It pushes NO new event, bumps NO RPD, and
   * does NOT release the foreground claim (the gateway is the single release
   * owner). A no-op when there is no uncommitted event (already reconciled, or a
   * never-acquired call). Optional per request — an embedding never commits and
   * simply keeps its acquire-time estimate.
   *
   * Attribution is FIFO (oldest-uncommitted-first) rather than per-request — the
   * QuotaScheduler/commit signature stays lane-only — so under concurrent
   * in-flight requests the token reconcile may mis-attribute by event; this is
   * observability-only (admission correctness is fully preserved by recording at
   * acquire) and never causes over/under-admission.
   */
  commit(lane: Lane, actualTokens: number, ratePool: string = 'default'): void {
    const at = this.now();
    this.prune(ratePool, lane, at);
    const p = this.getPool(ratePool);
    const event = p.events[lane].find((e) => !e.committed);
    if (!event) return;

    const actual = Math.max(0, actualTokens);
    const delta = actual - event.tokens;
    event.tokens = actual;
    event.committed = true;

    const today = ptDayString(at);
    if (p.daily && p.daily.day === today) {
      p.daily.tpm = Math.max(0, (p.daily.tpm ?? 0) + delta);
      store.saveDailyUsage(ratePool, { ...p.daily });
    }
  }

  /**
   * Release a foreground claim WITHOUT touching the windows or daily — for the
   * failure path where an {@link acquire} succeeded but the request never ran.
   * It NEVER undoes the acquire-recorded window/daily event (the attempt still
   * counts — matching free-tier reality). Idempotent (clamped at zero). bg
   * acquisitions hold no claim and are a no-op here.
   */
  release(lane: Lane, ratePool: string = 'default'): void {
    if (lane === 'fg') {
      const p = this.getPool(ratePool);
      p.fgClaims = Math.max(0, p.fgClaims - 1);
    }
  }

  /**
   * Record a 429 (or equivalent) backpressure signal: refuse acquires until
   * `retryAfterMs` from now. The next acquire throws {@link NetRateLimitedError}
   * with the remaining cooldown.
   */
  recordCooldown(retryAfterMs: number, ratePool: string = 'default'): void {
    const until = this.now() + Math.max(0, retryAfterMs);
    const p = this.getPool(ratePool);
    if (until > p.cooldownUntil) {
      p.cooldownUntil = until;
    }
  }

  /** Milliseconds from `at` to the next midnight-PT day boundary. */
  private msUntilNextPtDay(at: number): number {
    // Walk forward to the first ms whose PT day differs, then snap to the
    // start of that minute is unnecessary precision — a coarse bound suffices
    // for the retryAfter hint. Probe by adding hours until the day flips.
    const today = ptDayString(at);
    for (let h = 1; h <= 26; h++) {
      const probe = at + h * 3_600_000;
      if (ptDayString(probe) !== today) {
        return h * 3_600_000;
      }
    }
    return 24 * 3_600_000;
  }

  /** Current per-lane usage (the shared {@link LaneUsage} shape) for a pool. */
  snapshot(ratePool: string = 'default'): Record<Lane, LaneUsage> {
    const at = this.now();
    const limits = this.getLimits(ratePool);
    const p = this.getPool(ratePool);
    const today = ptDayString(at);
    const rpd = p.daily && p.daily.day === today ? p.daily.rpd : 0;
    const lane = (l: Lane): LaneUsage => {
      this.prune(ratePool, l, at);
      return {
        rpm: p.events[l].length,
        tpm: p.events[l].reduce((acc, e) => acc + e.tokens, 0),
        rpd,
        limits,
      };
    };
    return { fg: lane('fg'), bg: lane('bg') };
  }
}
