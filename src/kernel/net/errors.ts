/**
 * Typed errors thrown by the NetworkGateway (Phase 7 §I). Codes are members
 * of the append-only C10 union (~types/errors). Callers branch on
 * `instanceof` or `code` — never message substrings.
 */
import { AppError, type AppErrorOptions } from '~types/errors';

// The rate-limit backpressure error thrown when a request is rejected before it
// hits the network (the provider's budget is spent) is `NetRateLimitedError`,
// and it lives in `~types/errors`, NOT here. Its throw site is the quota
// governor under `kernel/quota`, and kernel modules may import only `~types`,
// never a sibling kernel module like `kernel/net` — so it cannot live here and
// be reached from there. Consumers import it directly from `~types/errors`. The
// gateway surfaces it alongside the NET_* errors below once it enforces the
// throttle.

/** Base class for gateway policy failures. */
export class NetworkGatewayError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { code: 'NET_UNKNOWN', ...options });
    this.name = 'NetworkGatewayError';
  }
}

/** The destination id is not in the registry (programming error). */
export class UnknownDestinationError extends NetworkGatewayError {
  constructor(destinationId: string) {
    super(`Unknown egress destination "${destinationId}" — add it to kernel/net/destinations.ts.`, {
      code: 'NET_UNKNOWN_DESTINATION',
      context: { destinationId },
    });
    this.name = 'UnknownDestinationError';
  }
}

/** The request URL's host is not allowed for the destination. */
export class HostNotAllowedError extends NetworkGatewayError {
  constructor(destinationId: string, host: string) {
    super(`Host "${host}" is not allowed for egress destination "${destinationId}".`, {
      code: 'NET_HOST_NOT_ALLOWED',
      context: { destinationId, host },
    });
    this.name = 'HostNotAllowedError';
  }
}

/**
 * The destination requires consent that has not been granted. UI consumes
 * this as the consent prompt trigger.
 */
export class NetConsentRequiredError extends NetworkGatewayError {
  constructor(destinationId: string, context: Record<string, unknown> = {}) {
    super(`Consent required for egress destination "${destinationId}".`, {
      code: 'NET_CONSENT_REQUIRED',
      context: { destinationId, ...context },
    });
    this.name = 'NetConsentRequiredError';
  }
}

/** The per-destination timeout elapsed and the request was aborted. */
export class NetTimeoutError extends NetworkGatewayError {
  constructor(destinationId: string, timeoutMs: number) {
    super(`Egress to "${destinationId}" timed out after ${timeoutMs}ms.`, {
      code: 'NET_TIMEOUT',
      context: { destinationId, timeoutMs },
      retryable: true,
    });
    this.name = 'NetTimeoutError';
  }
}

/** The browser reports offline and the destination's policy is to fail fast. */
export class NetOfflineError extends NetworkGatewayError {
  constructor(destinationId: string) {
    super(`Offline: egress to "${destinationId}" is unavailable.`, {
      code: 'NET_OFFLINE',
      context: { destinationId },
      retryable: true,
    });
    this.name = 'NetOfflineError';
  }
}

/**
 * Parse a 429 response's `Retry-After` (delta-seconds) header into milliseconds,
 * falling back to `defaultMs` when the header is missing, unparseable, or
 * negative. The fallback is a PARAMETER so this one helper can serve callers
 * with different defaults (each keeps its own named constant) rather than baking
 * one in. Imports nothing internal (`Response` is a DOM global), so kernel
 * modules can use it without violating the import rule.
 */
export function retryAfterMs(response: Response, defaultMs: number): number {
  const header = response.headers.get('Retry-After');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : defaultMs;
}
