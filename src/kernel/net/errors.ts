/**
 * Typed errors thrown by the NetworkGateway (Phase 7 §I). Codes are members
 * of the append-only C10 union (~types/errors). Callers branch on
 * `instanceof` or `code` — never message substrings.
 */
import { AppError, type AppErrorOptions } from '~types/errors';

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
