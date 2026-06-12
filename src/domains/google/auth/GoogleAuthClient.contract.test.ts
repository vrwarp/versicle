/**
 * GoogleAuthClient contract suite (Phase 7 §G, PR-A1 entry gate): per-service
 * token isolation, scope-superset cache validation, silent-never-interactive,
 * and the revocation matrix (only explicit disconnect clears state;
 * popup-block/offline/5xx leave everything alone).
 *
 * Absorbs the assertions of the deleted characterization files (test-
 * absorption ledger, README §4 rule 8):
 *  - src/lib/google/AndroidGoogleAuthStrategy.test.ts (cache TTL, login_hint,
 *    platform options, forceRefresh→invalidate, disconnect-clears-cache)
 *  - src/lib/google/GoogleIntegrationManager.test.ts (connect mirrors the
 *    store hint, connect failure does not mirror, token-failure semantics —
 *    REVERSED here per the §G design: no force-disconnect)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuthClient } from './GoogleAuthClient';
import { GoogleAuthRequiredError, GoogleUnknownServiceError } from './errors';
import { GOOGLE_SERVICES, getScopesForService } from './services';
import type { GoogleServiceId } from './services';

type LoginResult = {
  provider: 'google';
  result: {
    responseType: 'online' | 'offline';
    accessToken?: { token: string } | null;
    idToken?: string | null;
  };
};

function onlineResult(token: string, idToken?: string): LoginResult {
  return {
    provider: 'google',
    result: { responseType: 'online', accessToken: { token }, idToken: idToken ?? null },
  };
}

function makeClient(overrides: Partial<ConstructorParameters<typeof GoogleAuthClient>[0]> = {}) {
  const login = vi.fn().mockResolvedValue(onlineResult('token-1', 'id-token-1'));
  const logout = vi.fn().mockResolvedValue(undefined);
  const onConnected = vi.fn();
  const onDisconnected = vi.fn();
  let now = 1_000_000;
  const client = new GoogleAuthClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socialLogin: { login: login as any, logout: logout as any },
    hooks: { onConnected, onDisconnected },
    now: () => now,
    ...overrides,
  });
  return {
    client,
    login,
    logout,
    onConnected,
    onDisconnected,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('GoogleAuthClient contract', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('connect (interactive)', () => {
    it('logs in with the registry scopes and returns the full credential (idToken included)', async () => {
      const { client, login } = makeClient();
      const credential = await client.connect('drive');

      expect(login).toHaveBeenCalledTimes(1);
      expect(login).toHaveBeenCalledWith({
        provider: 'google',
        options: { scopes: [...GOOGLE_SERVICES.drive.scopes] },
      });
      expect(credential.accessToken).toBe('token-1');
      expect(credential.idToken).toBe('id-token-1');
      expect(credential.scopes).toEqual(GOOGLE_SERVICES.drive.scopes);
    });

    it('passes platform options (Android style/autoSelect) and login_hint through', async () => {
      const { client, login } = makeClient({
        platform: { style: 'bottom', autoSelectEnabled: true },
      });
      await client.connect('drive', 'user@example.com');
      // regression: AndroidGoogleAuthStrategy login_hint + platform options
      expect(login).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          scopes: [...GOOGLE_SERVICES.drive.scopes],
          style: 'bottom',
          autoSelectEnabled: true,
          login_hint: 'user@example.com',
        },
      });
    });

    it('falls back to the injected getLoginHint when no explicit hint is given', async () => {
      const { client, login } = makeClient({ getLoginHint: () => 'hint@example.com' });
      await client.connect('drive');
      expect(login.mock.calls[0][0].options.login_hint).toBe('hint@example.com');
    });

    it('mirrors the connection hint via onConnected', async () => {
      const { client, onConnected } = makeClient();
      await client.connect('drive');
      expect(onConnected).toHaveBeenCalledWith('drive');
    });

    it('regression: connect failure surfaces and does NOT mirror the hint', async () => {
      const { client, login, onConnected } = makeClient();
      login.mockRejectedValueOnce(new Error('Popup closed'));
      await expect(client.connect('drive')).rejects.toThrow('Popup closed');
      expect(onConnected).not.toHaveBeenCalled();
    });

    it('regression: offline responseType and missing access token are rejected', async () => {
      const { client, login } = makeClient();
      login.mockResolvedValueOnce({ provider: 'google', result: { responseType: 'offline' } });
      await expect(client.connect('drive')).rejects.toThrow('Offline mode not supported');
      login.mockResolvedValueOnce({
        provider: 'google',
        result: { responseType: 'online', accessToken: null },
      });
      await expect(client.connect('drive')).rejects.toThrow('No access token');
    });

    it('throws GoogleUnknownServiceError locally for unknown service ids', async () => {
      const { client, login } = makeClient();
      await expect(client.connect('calendar' as GoogleServiceId)).rejects.toBeInstanceOf(
        GoogleUnknownServiceError,
      );
      expect(login).not.toHaveBeenCalled();
      expect(() => getScopesForService('nope')).toThrow(GoogleUnknownServiceError);
    });
  });

  describe('getToken (silent — NEVER interactive)', () => {
    it('returns the cached token after connect without calling login again', async () => {
      const { client, login } = makeClient();
      await client.connect('drive');
      // regression: cached token on second call within expiration
      await expect(client.getToken('drive')).resolves.toBe('token-1');
      expect(login).toHaveBeenCalledTimes(1);
    });

    it('throws GoogleAuthRequiredError on an empty cache and never opens UI', async () => {
      const { client, login } = makeClient();
      await expect(client.getToken('drive')).rejects.toBeInstanceOf(GoogleAuthRequiredError);
      expect(login).not.toHaveBeenCalled();
    });

    it('regression: the 50-minute TTL — an expired credential throws (silent), never re-logins', async () => {
      const { client, login, advance } = makeClient();
      await client.connect('drive');
      advance(51 * 60 * 1000);
      await expect(client.getToken('drive')).rejects.toBeInstanceOf(GoogleAuthRequiredError);
      expect(login).toHaveBeenCalledTimes(1);
    });

    it('per-service isolation: a drive credential never serves identity (GG-1)', async () => {
      const { client } = makeClient();
      await client.connect('drive');
      await expect(client.getToken('identity')).rejects.toBeInstanceOf(GoogleAuthRequiredError);
      await expect(client.getToken('drive')).resolves.toBe('token-1');
    });

    it('scope-superset validation: a credential minted with fewer scopes is rejected', async () => {
      const { client } = makeClient();
      await client.connect('drive');
      // Sabotage: shrink the cached scopes (models a future registry scope
      // expansion between mint and use).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credentials = (client as any).credentials as Map<string, { scopes: string[] }>;
      credentials.get('drive')!.scopes = [];
      await expect(client.getToken('drive')).rejects.toBeInstanceOf(GoogleAuthRequiredError);
    });
  });

  describe('getTokenInteractive (user-gesture convenience)', () => {
    it('serves from cache when valid, connects when not', async () => {
      const { client, login } = makeClient();
      await expect(client.getTokenInteractive('drive')).resolves.toBe('token-1');
      expect(login).toHaveBeenCalledTimes(1);
      await expect(client.getTokenInteractive('drive')).resolves.toBe('token-1');
      expect(login).toHaveBeenCalledTimes(1);
    });

    it('regression (forceRefresh): invalidateToken forces the next interactive call to re-login', async () => {
      const { client, login, advance } = makeClient();
      login
        .mockResolvedValueOnce(onlineResult('cached-token'))
        .mockResolvedValueOnce(onlineResult('new-token'));
      await client.connect('drive');
      advance(1);
      client.invalidateToken('drive');
      await expect(client.getTokenInteractive('drive')).resolves.toBe('new-token');
      expect(login).toHaveBeenCalledTimes(2);
    });
  });

  describe('revocation matrix (the GG-2 reversal)', () => {
    it('token failures do NOT clear the connection hint — no force-disconnect', async () => {
      const { client, onDisconnected } = makeClient();
      await client.connect('drive');
      client.invalidateToken('drive');
      await expect(client.getToken('drive')).rejects.toBeInstanceOf(GoogleAuthRequiredError);
      expect(onDisconnected).not.toHaveBeenCalled();
    });

    it('only explicit disconnect clears the hint and the cache', async () => {
      const { client, logout, onDisconnected, login } = makeClient();
      await client.connect('drive');
      await client.disconnect('drive');
      expect(logout).toHaveBeenCalledWith({ provider: 'google' });
      expect(onDisconnected).toHaveBeenCalledWith('drive');
      // regression: disconnect clears the cache — next interactive call re-logins
      await client.getTokenInteractive('drive');
      expect(login).toHaveBeenCalledTimes(2);
    });

    it('disconnect tolerates plugin logout failures (state still cleared)', async () => {
      const { client, logout, onDisconnected } = makeClient();
      logout.mockRejectedValueOnce(new Error('not logged in'));
      await client.connect('drive');
      await expect(client.disconnect('drive')).resolves.toBeUndefined();
      expect(onDisconnected).toHaveBeenCalledWith('drive');
      expect(client.hasCredential('drive')).toBe(false);
    });
  });

  it('hasCredential reflects cache validity', async () => {
    const { client, advance } = makeClient();
    expect(client.hasCredential('drive')).toBe(false);
    await client.connect('drive');
    expect(client.hasCredential('drive')).toBe(true);
    advance(51 * 60 * 1000);
    expect(client.hasCredential('drive')).toBe(false);
  });
});
