/**
 * QuotaGovernor (Phase A) — pure kernel rate/spend math for the GenAI + cloud
 * TTS egress lanes. L0: imports ONLY `~types` (kernel-imports-nothing/error).
 *
 * Three windows per lane:
 *  - RPM / TPM — sliding 60 s buckets held IN-MEMORY (process-lifetime).
 *  - RPD       — a persisted daily counter behind an INJECTED {@link QuotaStore}
 *    port (the kernel never touches IndexedDB; the app composition root maps
 *    the port onto a data/ repo — keeps the kernel store-free).
 *
 * Design points (each one a plan/decision constraint):
 *  - GG-8: limits are read FRESH per `acquire()` from the injected config
 *    provider — never snapshotted at construction, never cached. Mutating the
 *    provider between calls takes effect on the next acquire.
 *  - The CLOCK is injectable (`now`): the midnight-PT RPD reset is a
 *    day-string compare against the injected clock, so the reset is
 *    unit-testable without touching the wall clock.
 *  - fg preempts bg: background acquisitions are refused once a foreground
 *    claim is in flight OR the bg fraction of the RPM/TPM budget is spent, so
 *    interactive work is never starved by background spend (decision §3.6).
 *  - acquire RECORDS the spend; commit RECONCILES estimate→actual; release
 *    frees the fg claim only. `acquire(estTokens)` admits against the estimate
 *    AND, once admitted, records the rolling RPM/TPM window event plus bumps +
 *    persists the daily RPD — so a request that never commits (e.g. an
 *    embedding, which has no governor commit) STILL counts and still publishes
 *    via the store. `commit(actualTokens)` only reconciles that already-recorded
 *    event's token cost (est→actual) + the daily.tpm delta; it records no new
 *    event and never bumps RPD. `release()` frees the fg claim only and never
 *    undoes the acquire-recorded window/daily event.
 *  - cooldown: a 429 feeds `recordCooldown(retryAfterMs)`; acquire throws
 *    {@link NetRateLimitedError} (pre-network backpressure) while a cooldown is
 *    active or the RPD is exhausted.
 *
 * Cross-device note: the QuotaStore port is the single seam where a later
 * multi-device embedSpend sum slots in (A6) with ZERO kernel change — the
 * governor only ever asks the port for "today's usage".
 */
import { NetRateLimitedError } from '~types/errors';

/** Foreground (interactive) or background (prefetch/auto) egress lane. */
export type Lane = 'fg' | 'bg';

/** Per-lane limits, read fresh per acquire (GG-8). */
export interface QuotaLimits {
  /** Requests per rolling minute. */
  rpm: number;
  /** Tokens per rolling minute. */
  tpm: number;
  /** Requests per calendar day (midnight-PT reset). */
  rpd: number;
}

/**
 * The config seam: limits read fresh on every acquire. Mutating what this
 * returns between calls is honored on the next acquire (GG-8 — no caching).
 */
export type QuotaLimitsProvider = () => QuotaLimits;

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
  loadDailyUsage(): Promise<DailyUsage | null>;
  /** Persist the daily usage (last-write-wins; fire-and-forget). */
  saveDailyUsage(usage: DailyUsage): void;
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
  let held: DailyUsage | null = null;
  return {
    loadDailyUsage: () => Promise.resolve(held),
    saveDailyUsage: (usage) => {
      held = usage;
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
 * The fraction of the RPM/TPM minute budget background work may consume before
 * it is refused — leaves headroom for foreground (decision §3.6, fg preempts).
 */
const BG_FRACTION = 0.5;

/** Pad an integer to two digits for the day string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The midnight-PT day key (`YYYY-MM-DD` in America/Los_Angeles) for an epoch.
 * Uses `Intl` formatting so DST is handled by the runtime rather than a
 * hand-rolled offset (the off-by-one/DST hazard the plan calls out).
 */
function ptDayString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // en-CA already yields YYYY-MM-DD, but assemble defensively so locale data
  // changes cannot reorder the key.
  return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
}

export class QuotaGovernor {
  /** Sliding per-lane request/token events (pruned to the 60 s window). */
  private readonly events: Record<Lane, WindowEvent[]> = { fg: [], bg: [] };

  /** In-flight foreground acquisitions (bg is refused while > 0). */
  private fgClaims = 0;

  /** Cached daily counter; refreshed from the store on day rollover. */
  private daily: DailyUsage | null = null;

  /** Epoch (ms) until which acquire is refused after a 429 (0 = none). */
  private cooldownUntil = 0;

  /**
   * @param getLimits Per-lane limits, read FRESH on every acquire (GG-8).
   * @param now Injectable clock; defaults to `Date.now` (tests control it).
   */
  constructor(
    private readonly getLimits: QuotaLimitsProvider,
    private readonly now: NowProvider = Date.now,
  ) {}

  /** Drop window events older than 60 s for the given lane. */
  private prune(lane: Lane, at: number): void {
    const cutoff = at - WINDOW_MS;
    const events = this.events[lane];
    let i = 0;
    while (i < events.length && events[i].at < cutoff) i++;
    if (i > 0) events.splice(0, i);
  }

  /** Sum of requests across both lanes inside the current minute window. */
  private requestsInWindow(at: number): number {
    this.prune('fg', at);
    this.prune('bg', at);
    return this.events.fg.length + this.events.bg.length;
  }

  /** Sum of tokens across both lanes inside the current minute window. */
  private tokensInWindow(at: number): number {
    this.prune('fg', at);
    this.prune('bg', at);
    const sum = (events: WindowEvent[]) => events.reduce((acc, e) => acc + e.tokens, 0);
    return sum(this.events.fg) + sum(this.events.bg);
  }

  /**
   * Load (or roll over) the persisted daily counter for the current PT day.
   * A stored counter whose `day` differs from today resets to zero — the
   * midnight-PT reset is a day-string compare against the injected clock.
   */
  private async loadDaily(at: number): Promise<DailyUsage> {
    const today = ptDayString(at);
    if (this.daily && this.daily.day === today) {
      return this.daily;
    }
    const persisted = await store.loadDailyUsage();
    if (persisted && persisted.day === today) {
      this.daily = { ...persisted };
    } else {
      this.daily = { day: today, rpd: 0, tpm: 0 };
    }
    return this.daily;
  }

  /**
   * Admit one request on `lane`, sized by `estTokens`. Throws
   * {@link NetRateLimitedError} (retryable, pre-network backpressure) when:
   *  - a cooldown from a prior 429 is still active,
   *  - the persisted RPD for today is exhausted, or
   *  - the rolling RPM/TPM minute budget cannot fit the request
   *    (background lanes are additionally capped at the bg fraction and refused
   *    while a foreground claim is in flight — fg preempts bg).
   *
   * Limits are read FRESH here (GG-8). On success a foreground claim is held
   * until the matching {@link commit}/{@link release}, AND the spend is RECORDED
   * here (the rolling RPM/TPM window event + the persisted daily RPD/TPM): this
   * is the single recorder, so a request that never commits (every embedding —
   * the embedding client has no governor) still counts toward RPM/TPM/RPD and
   * still persists+publishes via the store. {@link commit} only reconciles the
   * recorded estimate to the actual cost.
   */
  async acquire(lane: Lane, estTokens: number): Promise<void> {
    const at = this.now();
    const limits = this.getLimits();

    if (this.cooldownUntil > at) {
      throw new NetRateLimitedError(this.cooldownUntil - at, {
        lane,
        reason: 'cooldown',
      });
    }

    const daily = await this.loadDaily(at);
    if (daily.rpd >= limits.rpd) {
      throw new NetRateLimitedError(this.msUntilNextPtDay(at), {
        lane,
        reason: 'rpd-exhausted',
        rpd: daily.rpd,
        limit: limits.rpd,
      });
    }

    // fg preempts bg: never admit background work while foreground is claiming,
    // and cap background spend at the bg fraction of the minute budget. The caps
    // floor to >=1 (Math.max(1, …)) so a free-tier rpm/tpm of 1 still admits at
    // least one bg request instead of flooring the bg fraction to zero.
    if (lane === 'bg') {
      if (this.fgClaims > 0) {
        throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'fg-preempt' });
      }
      const bgRequestCap = Math.max(1, Math.floor(limits.rpm * BG_FRACTION));
      const bgTokenCap = Math.max(1, Math.floor(limits.tpm * BG_FRACTION));
      this.prune('bg', at);
      const bgTokens = this.events.bg.reduce((acc, e) => acc + e.tokens, 0);
      if (this.events.bg.length >= bgRequestCap || bgTokens + estTokens > bgTokenCap) {
        throw new NetRateLimitedError(WINDOW_MS, {
          lane,
          reason: 'bg-fraction-exhausted',
        });
      }
    }

    if (this.requestsInWindow(at) >= limits.rpm) {
      throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'rpm-exhausted' });
    }
    if (this.tokensInWindow(at) + estTokens > limits.tpm) {
      throw new NetRateLimitedError(WINDOW_MS, { lane, reason: 'tpm-exhausted' });
    }

    if (lane === 'fg') {
      this.fgClaims += 1;
    }

    // RECORD the spend at admission (the single recorder). Push the rolling
    // RPM/TPM window event sized by the estimate (commit reconciles it to the
    // actual later, if it commits at all), then bump + persist the daily RPD/TPM.
    // A never-committing request (every embedding) is counted purely here.
    const est = Math.max(0, estTokens);
    this.events[lane].push({ at, tokens: est, committed: false });
    this.prune(lane, at);

    daily.rpd += 1;
    daily.tpm = (daily.tpm ?? 0) + est;
    store.saveDailyUsage({ ...daily });
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
  commit(lane: Lane, actualTokens: number): void {
    const at = this.now();
    this.prune(lane, at);
    const event = this.events[lane].find((e) => !e.committed);
    if (!event) return;

    const actual = Math.max(0, actualTokens);
    const delta = actual - event.tokens;
    event.tokens = actual;
    event.committed = true;

    const today = ptDayString(at);
    if (this.daily && this.daily.day === today) {
      this.daily.tpm = Math.max(0, (this.daily.tpm ?? 0) + delta);
      store.saveDailyUsage({ ...this.daily });
    }
  }

  /**
   * Release a foreground claim WITHOUT touching the windows or daily — for the
   * failure path where an {@link acquire} succeeded but the request never ran.
   * It NEVER undoes the acquire-recorded window/daily event (the attempt still
   * counts — matching free-tier reality). Idempotent (clamped at zero). bg
   * acquisitions hold no claim and are a no-op here.
   */
  release(lane: Lane): void {
    if (lane === 'fg') {
      this.fgClaims = Math.max(0, this.fgClaims - 1);
    }
  }

  /**
   * Record a 429 (or equivalent) backpressure signal: refuse acquires until
   * `retryAfterMs` from now. The next acquire throws {@link NetRateLimitedError}
   * with the remaining cooldown.
   */
  recordCooldown(retryAfterMs: number): void {
    const until = this.now() + Math.max(0, retryAfterMs);
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
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

  /** Current per-lane usage (the shared {@link LaneUsage} shape). */
  snapshot(): Record<Lane, LaneUsage> {
    const at = this.now();
    const limits = this.getLimits();
    const today = ptDayString(at);
    const rpd = this.daily && this.daily.day === today ? this.daily.rpd : 0;
    const lane = (l: Lane): LaneUsage => {
      this.prune(l, at);
      return {
        rpm: this.events[l].length,
        tpm: this.events[l].reduce((acc, e) => acc + e.tokens, 0),
        rpd,
        limits,
      };
    };
    return { fg: lane('fg'), bg: lane('bg') };
  }
}
