/**
 * Typed GenAI errors (Phase 7 §H; C10 codes GENAI_*).
 */
import { AppError, NetRateLimitedError } from '~types/errors';

/** No API key configured. Message kept verbatim — UI surfaces it. */
export class GenAINotConfiguredError extends AppError {
  constructor() {
    super('GenAI Service not configured (missing API key).', {
      code: 'GENAI_NOT_CONFIGURED',
    });
    this.name = 'GenAINotConfiguredError';
  }
}

/**
 * The model returned out-of-contract output (unparseable JSON, schema
 * breach, out-of-range index, hallucinated ids). Callers mark
 * status:'error' via the existing markAnalysisError machinery — bad model
 * output stops poisoning the synced contentAnalysis map (GG-5).
 */
export class GenAIInvalidResponseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { code: 'GENAI_INVALID_RESPONSE', context, cause });
    this.name = 'GenAIInvalidResponseError';
  }
}

/** HTTP-level failure from the Gemini endpoint (carries the status). */
export class GenAIHttpError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    context?: Record<string, unknown>,
  ) {
    super(message, {
      code: 'GENAI_UNKNOWN',
      context: { status, ...context },
      retryable: status === 429 || status >= 500,
    });
    this.name = 'GenAIHttpError';
  }
}

/**
 * 429 / quota detection for the rotation retry (typed, no string sniffing).
 * Module-local: the rotation loop consumes it via {@link isRetryableForRotation}.
 */
function isResourceExhausted(error: unknown): boolean {
  return error instanceof GenAIHttpError && error.status === 429;
}

/**
 * The model itself is unusable for this key right now — retired, absent from
 * this API version, or gated behind a tier the project is not on. Typed off the
 * HTTP status plus the API's own `status` enum (attached to the error context by
 * GeminiClient), never sniffed from the message text.
 *
 * A 404 is decisive on its own: the endpoint is `/models/<id>:generateContent`,
 * so the only thing that can be Not Found is the model. A 400 is deliberately
 * NOT treated as model-unavailable in general — a malformed prompt or a schema
 * breach 400s identically on every model, and rotating would turn one bad
 * request into a round trip per model. The single model-specific 400 is
 * FAILED_PRECONDITION (model not available for this project/region/tier).
 */
export function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof GenAIHttpError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && error.context?.apiStatus === 'FAILED_PRECONDITION';
}

/**
 * The rotation continue-predicate: keep rotating to the remaining models on a
 * server 429 ({@link isResourceExhausted}), on an unusable model
 * ({@link isModelUnavailable}), OR on a PRE-NETWORK {@link NetRateLimitedError}.
 *
 * The NetRateLimitedError arm is the cooldown-backpressure case — when model A's
 * 429 sets a governor cooldown, model B's gateway acquire throws
 * NetRateLimitedError before any network call; without this, that cooldown would
 * abort rotation to the still-untried models.
 *
 * The isModelUnavailable arm keeps a RETIRED model from taking the rest of the
 * chain down with it. Models shut down on Google's schedule, and a dead one
 * answers 404 rather than 429 — without this arm the loop would rethrow on the
 * spot and strand every model below it, including the high-daily-quota ones
 * that carry the bulk of the day's traffic.
 */
export function isRetryableForRotation(error: unknown): boolean {
  return (
    isResourceExhausted(error) ||
    isModelUnavailable(error) ||
    error instanceof NetRateLimitedError
  );
}

/**
 * A log-safe, structured description of ANY failure the GenAI clients can
 * raise — typed AppErrors (code / HTTP status / quota context), pre-network
 * gateway refusals (NET_RATE_LIMITED, NET_CONSENT_REQUIRED, NET_OFFLINE),
 * caller aborts, and plain network errors alike. It is what the activity log
 * records for a TERMINAL failure, so an exported log can say WHY a request
 * died instead of leaving a request entry with no outcome at all (the
 * Jul–Sep 2026 export had 74 such entries, 26% of all detection attempts).
 */
export interface GenAIFailureDescription {
  error: string;
  name?: string;
  code?: string;
  status?: number;
  apiStatus?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  dailyQuotaExhausted?: boolean;
  quotaIds?: string[];
  /** The governor's refusal reason for a pre-network NET_RATE_LIMITED. */
  reason?: string;
  /** True for a caller-driven abort (AbortSignal) — expected, not actionable. */
  aborted: boolean;
}

export function describeGenAIFailure(error: unknown): GenAIFailureDescription {
  if (error instanceof AppError) {
    const ctx = error.context ?? {};
    const out: GenAIFailureDescription = {
      error: error.message,
      name: error.name,
      code: error.code,
      retryable: error.retryable,
      aborted: false,
    };
    if (typeof ctx.status === 'number') out.status = ctx.status;
    if (typeof ctx.apiStatus === 'string') out.apiStatus = ctx.apiStatus;
    if (typeof ctx.retryAfterMs === 'number') out.retryAfterMs = ctx.retryAfterMs;
    if (typeof ctx.dailyQuotaExhausted === 'boolean') out.dailyQuotaExhausted = ctx.dailyQuotaExhausted;
    if (Array.isArray(ctx.quotaIds)) out.quotaIds = ctx.quotaIds.map(String);
    if (typeof ctx.reason === 'string') out.reason = ctx.reason;
    return out;
  }
  // Duck-typed: a DOMException (AbortError) is not `instanceof Error` in
  // every realm (jsdom, some worker contexts), but always carries name/message.
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    const out: GenAIFailureDescription = {
      error: typeof message === 'string' ? message : String(error),
      aborted: name === 'AbortError',
    };
    if (typeof name === 'string') out.name = name;
    return out;
  }
  return { error: String(error), aborted: false };
}
