/**
 * Typed Google-auth errors (Phase 7 §G; C10 codes GOOGLE_*). These replace
 * the `error.message.includes('is not connected')` substring taxonomy that
 * was scattered across the Drive scanner and boot tasks (GG-7).
 */
import { AppError } from '~types/errors';

/**
 * A token acquisition needs (more) user interaction: no cached credential,
 * expired credential, insufficient scopes, or an interactive connect that
 * failed to produce one ('connect-failed' — popup blocked/closed, plugin not
 * initialized; the raw failure rides along as `cause`). Background flows catch
 * this and surface a reconnect affordance — they must NEVER open login UI
 * (GG-2); interactive flows use it to say "reconnect Google Drive" instead of
 * a generic failure.
 */
export class GoogleAuthRequiredError extends AppError {
  constructor(
    serviceId: string,
    reason: 'no-credential' | 'expired' | 'insufficient-scopes' | 'connect-failed',
    cause?: unknown,
  ) {
    super(`Google ${serviceId} access requires sign-in (${reason}).`, {
      code: 'GOOGLE_AUTH_REQUIRED',
      context: { serviceId, reason },
      cause,
    });
    this.name = 'GoogleAuthRequiredError';
  }
}

/** Unknown service id — fails locally instead of at Google's server (GG-6). */
export class GoogleUnknownServiceError extends AppError {
  constructor(serviceId: string) {
    super(`Unknown Google service "${serviceId}" — add it to GOOGLE_SERVICES.`, {
      code: 'GOOGLE_UNKNOWN_SERVICE',
      context: { serviceId },
    });
    this.name = 'GoogleUnknownServiceError';
  }
}
