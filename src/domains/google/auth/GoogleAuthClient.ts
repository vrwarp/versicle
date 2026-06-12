/**
 * GoogleAuthClient (Phase 7 §G) — ONE class wrapping @capgo SocialLogin.
 *
 * Replaces the GoogleIntegrationManager + Web/Android strategy pair (the two
 * strategies were ~95% identical with signature drift — GG-6; platform
 * differences are constructor options now). Each design point reverses a
 * verified critical:
 *
 *  - Per-service token map with scope-superset validation on cache hits
 *    (GG-1: one accessToken/expiration instance pair served ALL scopes).
 *  - Strict interactive/silent split (GG-2): `connect()` may open UI;
 *    `getToken()` NEVER does — it throws typed GoogleAuthRequiredError so
 *    background flows show a reconnect affordance instead of popping blocked
 *    login UI or force-disconnecting.
 *  - NO auto-disconnect on token errors (the old manager force-disconnected
 *    on ANY failure, GG-2/GG-7): persisted connection state is cleared only
 *    by explicit `disconnect()` — popup-block/offline/5xx leave it alone.
 *    The persisted `connectedServices` list is demoted to a "has connected
 *    before" HINT (reconnect-vs-first-connect copy), never an authorization
 *    claim.
 *  - Login hint injected via `getLoginHint` (severs the lib→sync-store
 *    import, GG-12); `connect()` returns the FULL credential including
 *    idToken so auth-helper can consume `connect('identity')` instead of its
 *    parallel SocialLogin.login path (GG-13).
 *
 * No store imports (domains-no-store is at error): connection-state mirrors
 * are injected `hooks`, wired at the composition root
 * (src/app/google/wireGoogle.ts).
 */
import { SocialLogin } from '@capgo/capacitor-social-login';
import { GoogleAuthRequiredError } from './errors';
import { getScopesForService, type GoogleLoginOptions, type GoogleServiceId } from './services';

export interface GoogleCredential {
  accessToken: string;
  /** Present when the provider returns one (Firebase sign-in consumes it). */
  idToken?: string;
  expiresAt: number;
  scopes: readonly string[];
}

/**
 * Google access tokens live 3600s; refresh 10 minutes early (the constant
 * the strategies used since the beginning).
 */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface GoogleAuthClientOptions {
  /** Android passes { style: 'bottom', autoSelectEnabled: true }; web {}. */
  platform?: Pick<GoogleLoginOptions, 'style' | 'autoSelectEnabled'>;
  /** Injected at the composition root (e.g. the Firebase account email). */
  getLoginHint?: () => string | undefined;
  /** Connection-state mirrors (store-backed adapters injected by app/). */
  hooks?: {
    onConnected?: (serviceId: GoogleServiceId) => void;
    onDisconnected?: (serviceId: GoogleServiceId) => void;
  };
  /** Test seam; defaults to the real plugin. */
  socialLogin?: Pick<typeof SocialLogin, 'login' | 'logout'>;
  /** Test seam; defaults to Date.now. */
  now?: () => number;
}

function scopesSuperset(have: readonly string[], need: readonly string[]): boolean {
  const haveSet = new Set(have);
  return need.every((scope) => haveSet.has(scope));
}

export class GoogleAuthClient {
  private readonly credentials = new Map<GoogleServiceId, GoogleCredential>();
  private readonly social: Pick<typeof SocialLogin, 'login' | 'logout'>;
  private readonly now: () => number;

  constructor(private readonly opts: GoogleAuthClientOptions = {}) {
    this.social = opts.socialLogin ?? SocialLogin;
    this.now = opts.now ?? Date.now;
  }

  /**
   * INTERACTIVE connect: may open login UI (call from a user gesture).
   * Returns the full credential (idToken included when available) and
   * records the "has connected before" hint via the injected hook.
   * Failures are rethrown untouched — interactive surfaces show them.
   */
  async connect(serviceId: GoogleServiceId, loginHint?: string): Promise<GoogleCredential> {
    const scopes = getScopesForService(serviceId);
    const options: GoogleLoginOptions = {
      scopes: [...scopes],
      ...this.opts.platform,
    };
    const hint = loginHint ?? this.opts.getLoginHint?.();
    if (hint) options.login_hint = hint;

    const result = await this.social.login({ provider: 'google', options });

    if (result.result.responseType === 'offline') {
      throw new Error('Offline mode not supported');
    }
    const accessToken = result.result.accessToken?.token;
    if (!accessToken) {
      throw new Error('No access token returned from Google sign-in');
    }

    const credential: GoogleCredential = {
      accessToken,
      idToken: result.result.idToken ?? undefined,
      expiresAt: this.now() + TOKEN_TTL_MS,
      scopes,
    };
    this.credentials.set(serviceId, credential);
    this.opts.hooks?.onConnected?.(serviceId);
    return credential;
  }

  /**
   * SILENT token: never opens UI. Throws GoogleAuthRequiredError when the
   * cache is empty, expired, or scope-insufficient — callers decide whether
   * to surface a reconnect affordance or escalate to connect().
   */
  async getToken(serviceId: GoogleServiceId): Promise<string> {
    const need = getScopesForService(serviceId);
    const credential = this.credentials.get(serviceId);
    if (!credential) throw new GoogleAuthRequiredError(serviceId, 'no-credential');
    if (this.now() >= credential.expiresAt) {
      this.credentials.delete(serviceId);
      throw new GoogleAuthRequiredError(serviceId, 'expired');
    }
    if (!scopesSuperset(credential.scopes, need)) {
      throw new GoogleAuthRequiredError(serviceId, 'insufficient-scopes');
    }
    return credential.accessToken;
  }

  /**
   * Convenience for user-gesture call sites: silent token when cached,
   * interactive connect otherwise (today's popup-on-demand UX, made
   * explicit). Background flows must use getToken().
   */
  async getTokenInteractive(serviceId: GoogleServiceId): Promise<string> {
    try {
      return await this.getToken(serviceId);
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) {
        return (await this.connect(serviceId)).accessToken;
      }
      throw error;
    }
  }

  /**
   * Drop the cached credential WITHOUT touching persisted connection state
   * (e.g. the server rejected the token with 401 — the next silent call
   * throws GoogleAuthRequiredError; the next interactive call re-connects).
   */
  invalidateToken(serviceId: GoogleServiceId): void {
    this.credentials.delete(serviceId);
  }

  /** True when a non-expired credential is cached (UI "connected" signal). */
  hasCredential(serviceId: GoogleServiceId): boolean {
    const credential = this.credentials.get(serviceId);
    return credential !== undefined && this.now() < credential.expiresAt;
  }

  /**
   * EXPLICIT disconnect — the only path that clears persisted connection
   * state (via the injected hook). Plugin logout failures are tolerated
   * (already logged out, plugin not initialized, …).
   */
  async disconnect(serviceId: GoogleServiceId): Promise<void> {
    if (this.credentials.has(serviceId)) {
      try {
        await this.social.logout({ provider: 'google' });
      } catch (e) {
        console.warn('Failed to logout from SocialLogin', e);
      }
    }
    this.credentials.delete(serviceId);
    this.opts.hooks?.onDisconnected?.(serviceId);
  }
}
