/**
 * Typed Google-auth errors (Phase 7 §G; C10 codes GOOGLE_*). These replace
 * the `error.message.includes('is not connected')` substring taxonomy that
 * was scattered across the Drive scanner and boot tasks (GG-7).
 */
import { AppError } from '~types/errors';

/**
 * A silent token acquisition needs user interaction (no cached credential,
 * expired credential, or insufficient scopes). Background flows catch this
 * and surface a reconnect affordance — they must NEVER open login UI (GG-2).
 */
export class GoogleAuthRequiredError extends AppError {
  constructor(serviceId: string, reason: 'no-credential' | 'expired' | 'insufficient-scopes') {
    super(`Google ${serviceId} access requires sign-in (${reason}).`, {
      code: 'GOOGLE_AUTH_REQUIRED',
      context: { serviceId, reason },
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
