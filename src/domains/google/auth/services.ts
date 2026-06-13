/**
 * Google service registry (Phase 7 §G) — which OAuth scopes each "service"
 * (drive, identity) needs. Replaces src/lib/google/config.ts; unlike its
 * predecessor, `getScopesForService` THROWS on unknown ids instead of
 * silently logging in with no scopes (GG-6).
 */
import { GoogleUnknownServiceError } from './errors';

export type GoogleServiceId = 'drive' | 'identity';

export interface GoogleServiceConfig {
  id: GoogleServiceId;
  name: string;
  scopes: readonly string[];
}

export const GOOGLE_SERVICES: Record<GoogleServiceId, GoogleServiceConfig> = {
  drive: {
    id: 'drive',
    name: 'Google Drive',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  identity: {
    id: 'identity',
    name: 'Sign In',
    scopes: ['email', 'profile', 'openid'],
  },
};

/** Options bag passed to the @capgo SocialLogin plugin. */
export interface GoogleLoginOptions {
  scopes: string[];
  style?: 'bottom' | 'standard';
  autoSelectEnabled?: boolean;
  login_hint?: string;
}

export function getScopesForService(serviceId: string): readonly string[] {
  const config = GOOGLE_SERVICES[serviceId as GoogleServiceId];
  if (!config) throw new GoogleUnknownServiceError(serviceId);
  return config.scopes;
}
