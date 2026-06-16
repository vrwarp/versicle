/**
 * NetworkGateway — the ONE production egress point (Phase 7 §I; C9/C12).
 *
 * `egress(destinationId, url, init?, opts?)` applies the destination's
 * registry policy before any bytes leave the device:
 *
 *  1. registry membership (`NET_UNKNOWN_DESTINATION`) + `via: 'gateway'`
 *  2. host allowlist (`NET_HOST_NOT_ALLOWED`)
 *  3. offline policy (`NET_OFFLINE`)
 *  4. consent gate (`NET_CONSENT_REQUIRED`) — per-book destinations require
 *     either `consent.interactive` (a user gesture drove this exact call) or
 *     the injected resolver's grant. The resolver is wired at the
 *     composition root (app/) to the synced per-book `aiConsent` map with
 *     contentAnalysis grandfathering; kernel/ itself never reads state.
 *     OBSERVE MODE: with no resolver registered the gate allows and the
 *     gateway only counts — enforcement arrives with the resolver (program
 *     observe-then-enforce rule).
 *  5. per-destination AbortController timeout (`NET_TIMEOUT`), composed with
 *     the caller's own AbortSignal.
 *
 * It also keeps per-destination session counters (requests/bytes out — the
 * deleted CostEstimator's replacement; surfaced by P8's settings "Network
 * activity" panel).
 *
 * Raw `fetch`/XHR outside src/kernel/net is a lint error (eslint.config.js);
 * same-origin fetches use ./local.ts.
 */
import {
  findDestination,
  hostMatches,
  type DestinationId,
  type EgressDestination,
} from './destinations';
import {
  HostNotAllowedError,
  NetConsentRequiredError,
  NetOfflineError,
  NetTimeoutError,
  NetworkGatewayError,
  UnknownDestinationError,
} from './errors';

/** Consent context attached by the call site. */
interface EgressConsentContext {
  /** The book whose content/derived data this call would transmit. */
  bookId?: string;
  /** True when an explicit user gesture drove this exact call. */
  interactive?: boolean;
}

export interface EgressOptions {
  /** Caller cancellation; composed with the per-destination timeout. */
  signal?: AbortSignal;
  consent?: EgressConsentContext;
  /**
   * Which throttle lane this call belongs to. Foreground (`'fg'`, interactive)
   * preempts background (`'bg'`, prefetch/auto) so user-driven work is never
   * starved by automatic spend. Only consulted for rate-limited destinations;
   * ignored otherwise. When set it OVERRIDES the destination's default lane
   * (`destination.rateLimit.lane`) — e.g. a background embedding can be routed
   * onto the bg lane even though the gemini destination defaults to `'fg'`.
   */
  lane?: 'fg' | 'bg';
  /**
   * A coarse pre-flight token estimate for the governor's admission window
   * (reconciled to the real cost by the CLIENT's commit, which reads the parsed
   * response body the gateway never touches). Defaults to 0.
   */
  estTokens?: number;
}

export type ConsentResolver = (
  destination: EgressDestination,
  consent: EgressConsentContext,
) => boolean;

let consentResolver: ConsentResolver | null = null;

/**
 * Install the consent resolver (composition root only — app/ wires it to the
 * per-book aiConsent preferences). Pass null to remove (tests).
 */
export function setConsentResolver(resolver: ConsentResolver | null): void {
  consentResolver = resolver;
}

/**
 * The throttle seam the gateway consults before sending to a rate-limited
 * destination, so requests can be backpressured (delayed/rejected) when the
 * provider's per-minute/per-day budget is spent. Declared structurally HERE
 * rather than imported from the quota module so this layer keeps its rule of
 * importing nothing internal (the same dependency inversion used for
 * {@link ConsentResolver}). The composition root installs the QuotaGovernor
 * (which implements `acquire`/`release`) via {@link setQuotaScheduler}. The
 * split is deliberate: `acquire` + the once-per-egress `release` happen at the
 * gateway because they must run before any bytes leave and cannot be bypassed,
 * while reconciling the actual token cost and recording 429 cooldowns stay a
 * caller step because they need the parsed response body the gateway never reads.
 */
export interface QuotaScheduler {
  /**
   * Admit one request on `lane`, sized by `estTokens`. Rejects with
   * `NetRateLimitedError` (pre-network backpressure) when the request cannot be
   * admitted. On admission the governor RECORDS the spend; a foreground claim is
   * held until the matching {@link release} (the gateway frees it exactly once
   * per egress in its finally — on success, on a resolved non-2xx, or on a
   * throw).
   */
  acquire(lane: 'fg' | 'bg', estTokens: number): Promise<void>;
  /** Release a foreground claim. The gateway calls this exactly once per egress
   *  (its finally) — on a 200, a resolved 429/500, or a throw. Idempotent. */
  release(lane: 'fg' | 'bg'): void;
}

let quotaScheduler: QuotaScheduler | null = null;

/**
 * Install the quota scheduler (composition root only — app/ wires it to the
 * shared QuotaGovernor). Pass null to remove (tests). OBSERVE MODE: with no
 * scheduler installed the gateway applies no throttle and only counts —
 * enforcement arrives with the scheduler (mirrors the consent observe-mode).
 */
export function setQuotaScheduler(scheduler: QuotaScheduler | null): void {
  quotaScheduler = scheduler;
}

export interface EgressCounters {
  requests: number;
  /** Best-effort request payload bytes (string/Blob/ArrayBuffer bodies). */
  bytesOut: number;
  lastUsedAt: number | null;
}

const counters = new Map<DestinationId, EgressCounters>();

/** Per-destination session counters (read-only snapshot). */
export function getEgressCounters(): ReadonlyMap<DestinationId, Readonly<EgressCounters>> {
  return counters;
}

/** Reset counters (tests). */
export function resetEgressCounters(): void {
  counters.clear();
}

function estimateBodyBytes(body: BodyInit | null | undefined): number {
  if (body == null) return 0;
  if (typeof body === 'string') {
    // Cheap UTF-8 upper-ish bound without allocating an encoder per call.
    return body.length;
  }
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return body.toString().length;
  return 0;
}

function recordEgress(id: DestinationId, bytes: number): void {
  const entry = counters.get(id) ?? { requests: 0, bytesOut: 0, lastUsedAt: null };
  entry.requests += 1;
  entry.bytesOut += bytes;
  entry.lastUsedAt = Date.now();
  counters.set(id, entry);
}

function assertHostAllowed(destination: EgressDestination, url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new HostNotAllowedError(destination.id, String(url));
  }
  if (!destination.hosts.some((pattern) => hostMatches(host, pattern))) {
    throw new HostNotAllowedError(destination.id, host);
  }
}

function checkConsent(destination: EgressDestination, consent: EgressConsentContext): void {
  if (destination.consent !== 'per-book') return;
  if (consent.interactive === true) return;
  // Observe mode until the composition root installs the resolver.
  if (consentResolver === null) return;
  if (!consentResolver(destination, consent)) {
    throw new NetConsentRequiredError(destination.id, { bookId: consent.bookId });
  }
}

/**
 * Policy-checked fetch. Throws typed `AppError`s (codes NET_*) for policy
 * failures; network-level failures propagate as the platform's own errors
 * (TypeError) exactly like raw fetch, so existing retry logic keeps working.
 */
export async function egress(
  destinationId: DestinationId,
  url: string,
  init: RequestInit = {},
  opts: EgressOptions = {},
): Promise<Response> {
  const destination = findDestination(destinationId);
  if (!destination) throw new UnknownDestinationError(destinationId);
  if (destination.via !== 'gateway') {
    throw new NetworkGatewayError(
      `Destination "${destinationId}" is SDK-mediated; its hosts feed the CSP but calls cannot route through egress().`,
      { context: { destinationId } },
    );
  }

  assertHostAllowed(destination, url);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Both offline policies fail fast here; 'cache-fallback' documents the
    // CALLER's contract to serve its cache on NET_OFFLINE.
    throw new NetOfflineError(destinationId);
  }

  checkConsent(destination, opts.consent ?? {});

  // Throttle check for rate-limited destinations: the injected scheduler is
  // awaited BEFORE recordEgress/fetch, so a request that exceeds the provider's
  // budget throws NetRateLimitedError before any bytes leave and is NOT counted
  // as egress (matching the consent gate, where policy failures are not counted).
  // With no scheduler installed there is no throttle (count-only mode). On
  // admission the gateway holds a foreground claim that it releases EXACTLY ONCE
  // per egress in the finally below — on a 200, a resolved 429/500, or a throw;
  // the client's later cost-reconcile step never releases. A per-call lane
  // overrides the destination default, so a request tagged bg on an otherwise
  // fg destination acquires/releases on the bg lane (and so is subject to
  // foreground-preemption and the bg-fraction cap). Destinations with no
  // rateLimit stay ungoverned.
  const rateLane = destination.rateLimit ? (opts.lane ?? destination.rateLimit.lane) : undefined;
  if (rateLane && quotaScheduler) {
    await quotaScheduler.acquire(rateLane, opts.estTokens ?? 0);
  }

  recordEgress(destinationId, estimateBodyBytes(init.body));

  // Compose caller signal(s) with the per-destination timeout.
  const controller = new AbortController();
  const abortUpstream = (reason?: unknown) => controller.abort(reason);
  const upstreamSignals = [init.signal, opts.signal].filter(
    (s): s is AbortSignal => s != null,
  );
  for (const s of upstreamSignals) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener('abort', () => abortUpstream(s.reason), { once: true });
  }

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (destination.timeoutMs !== null) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, destination.timeoutMs);
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new NetTimeoutError(destinationId, destination.timeoutMs ?? 0);
    }
    throw error;
  } finally {
    // The gateway is the SINGLE owner of the claim release (try/finally, exactly
    // ONCE per egress) — it fires on EVERY completion: a 200, a resolved non-2xx
    // (429/500), or a throw. The governor already recorded the spend at acquire
    // (so the attempt counts toward the budget regardless of outcome); releasing
    // here only frees the foreground claim that holds off background work.
    // release() is idempotent (clamped at zero) so the once-per-egress call
    // cannot drive the foreground-claim count negative.
    if (rateLane && quotaScheduler) {
      quotaScheduler.release(rateLane);
    }
    clearTimeout(timer);
  }
}

/** The egress function type — the injection seam clients take. */
export type EgressFn = typeof egress;
