/**
 * Structured quota signals parsed from a Gemini API 429 error body.
 *
 * The free-tier limiter answers a spent budget with a `RESOURCE_EXHAUSTED`
 * body whose `details[]` carry two machine-readable records the message
 * text only paraphrases:
 *
 *  - `google.rpc.QuotaFailure` → `violations[].quotaId`, e.g.
 *    `GenerateRequestsPerDayPerProjectPerModel-FreeTier` (a DAILY budget that
 *    resets at midnight Pacific) vs `…PerMinute…` (a rolling minute window);
 *  - `google.rpc.RetryInfo` → `retryDelay` (a proto Duration such as `"18s"`).
 *
 * Both clients (chat + embedding) feed these to the quota governor so a
 * daily exhaustion cools the pool down until the next Pacific day instead of
 * the 30-second default, and a per-minute exhaustion waits exactly as long
 * as the server asked. The message-text fallbacks exist because the details
 * array is not guaranteed on every deployment.
 */

export interface QuotaSignals {
  /** Server-suggested wait before retrying, in ms (undefined when absent). */
  retryAfterMs?: number;
  /** True when a violation names a per-day quota (resets at midnight PT). */
  dailyQuotaExhausted: boolean;
  /** The quota ids named by the violations (diagnostics; may be empty). */
  quotaIds: string[];
}

interface ErrorDetail {
  '@type'?: string;
  retryDelay?: string | { seconds?: number | string; nanos?: number };
  violations?: { quotaId?: string; quotaMetric?: string }[];
}

interface ErrorBody {
  error?: { message?: string; details?: ErrorDetail[] };
}

/** Parse a proto Duration (`"18s"`, `"18.95s"`, or `{seconds, nanos}`) to ms. */
function durationToMs(value: ErrorDetail['retryDelay']): number | undefined {
  if (typeof value === 'string') {
    const m = /^\s*(\d+(?:\.\d+)?)\s*s\s*$/.exec(value);
    if (!m) return undefined;
    return Math.ceil(Number(m[1]) * 1000);
  }
  if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? 0);
    const nanos = Number(value.nanos ?? 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return undefined;
    return Math.ceil(seconds * 1000 + nanos / 1_000_000);
  }
  return undefined;
}

/** Parse the quota records out of a (possibly empty or malformed) error body. */
export function parseQuotaSignals(body: unknown): QuotaSignals {
  const signals: QuotaSignals = { dailyQuotaExhausted: false, quotaIds: [] };
  const error = (body as ErrorBody | null)?.error;
  if (!error || typeof error !== 'object') return signals;

  for (const detail of Array.isArray(error.details) ? error.details : []) {
    if (!detail || typeof detail !== 'object') continue;
    const type = String(detail['@type'] ?? '');
    if (type.endsWith('google.rpc.RetryInfo')) {
      const ms = durationToMs(detail.retryDelay);
      if (ms !== undefined) signals.retryAfterMs = ms;
    } else if (type.endsWith('google.rpc.QuotaFailure')) {
      for (const violation of Array.isArray(detail.violations) ? detail.violations : []) {
        const id = violation?.quotaId;
        if (typeof id === 'string' && id !== '') signals.quotaIds.push(id);
      }
    }
  }

  signals.dailyQuotaExhausted = signals.quotaIds.some((id) => /perday/i.test(id));

  const message = typeof error.message === 'string' ? error.message : '';
  if (signals.retryAfterMs === undefined) {
    // "Please retry in 18.95s." — the message-text paraphrase of RetryInfo.
    const m = /retry in\s+(\d+(?:\.\d+)?)\s*s\b/i.exec(message);
    if (m) signals.retryAfterMs = Math.ceil(Number(m[1]) * 1000);
  }
  if (!signals.dailyQuotaExhausted && /\bper[\s_-]?day\b/i.test(message)) {
    signals.dailyQuotaExhausted = true;
  }
  return signals;
}
