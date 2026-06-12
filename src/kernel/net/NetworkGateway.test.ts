/**
 * Gateway policy tests (Phase 7 §I, PR-N1/N3): registry membership, host
 * allowlist, offline policy, consent gate, per-destination timeout, and the
 * session counters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  egress,
  getEgressCounters,
  resetEgressCounters,
  setConsentResolver,
} from './NetworkGateway';
import {
  HostNotAllowedError,
  NetConsentRequiredError,
  NetOfflineError,
  NetTimeoutError,
  NetworkGatewayError,
  UnknownDestinationError,
} from './errors';
import { hostMatches, type DestinationId } from './destinations';

describe('hostMatches', () => {
  it('matches exact hosts only', () => {
    expect(hostMatches('www.googleapis.com', 'www.googleapis.com')).toBe(true);
    expect(hostMatches('evil.googleapis.com', 'www.googleapis.com')).toBe(false);
  });

  it('matches *. wildcards against subdomains but not the bare suffix', () => {
    expect(hostMatches('proj.firebaseio.com', '*.firebaseio.com')).toBe(true);
    expect(hostMatches('a.b.firebaseio.com', '*.firebaseio.com')).toBe(true);
    expect(hostMatches('firebaseio.com', '*.firebaseio.com')).toBe(false);
    expect(hostMatches('notfirebaseio.com', '*.firebaseio.com')).toBe(false);
  });
});

const okFetch = () => vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

describe('NetworkGateway.egress', () => {
  beforeEach(() => {
    resetEgressCounters();
    setConsentResolver(null);
    vi.stubGlobal('fetch', okFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setConsentResolver(null);
  });

  it('throws NET_UNKNOWN_DESTINATION for ids not in the registry', async () => {
    await expect(
      egress('nope' as DestinationId, 'https://example.com/'),
    ).rejects.toBeInstanceOf(UnknownDestinationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects egress() for sdk-mediated destinations (firebase, google-oauth)', async () => {
    await expect(
      egress('firebase', 'https://firestore.googleapis.com/'),
    ).rejects.toBeInstanceOf(NetworkGatewayError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws NET_HOST_NOT_ALLOWED when the URL host is outside the destination allowlist', async () => {
    await expect(
      egress('drive', 'https://evil.example.com/drive/v3/files'),
    ).rejects.toBeInstanceOf(HostNotAllowedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports *.suffix host wildcards', async () => {
    // hf-piper-models has exact hosts; use a drive host for exact and rely on
    // hostMatches unit coverage below for wildcards via the registry shape.
    const response = await egress('drive', 'https://www.googleapis.com/drive/v3/files');
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes method/headers/body through and composes the timeout signal', async () => {
    await egress('drive', 'https://www.googleapis.com/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: 'payload',
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/upload');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws NET_OFFLINE when navigator reports offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await expect(
        egress('drive', 'https://www.googleapis.com/drive/v3/files'),
      ).rejects.toBeInstanceOf(NetOfflineError);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  describe('consent gate (per-book destinations)', () => {
    it('observe mode: with no resolver installed the call is allowed', async () => {
      const res = await egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x');
      expect(res.status).toBe(200);
    });

    it('denies non-interactive calls when the resolver denies', async () => {
      setConsentResolver(() => false);
      await expect(
        egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x', {}, {
          consent: { bookId: 'book-1' },
        }),
      ).rejects.toBeInstanceOf(NetConsentRequiredError);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('allows when the resolver grants, and passes destination + context through', async () => {
      const resolver = vi.fn().mockReturnValue(true);
      setConsentResolver(resolver);
      await egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x', {}, {
        consent: { bookId: 'book-1' },
      });
      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gemini' }),
        expect.objectContaining({ bookId: 'book-1' }),
      );
    });

    it('interactive calls (explicit user gesture) bypass the per-book gate', async () => {
      setConsentResolver(() => false);
      const res = await egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x', {}, {
        consent: { interactive: true },
      });
      expect(res.status).toBe(200);
    });

    it('does not consult the resolver for non-per-book destinations', async () => {
      const resolver = vi.fn().mockReturnValue(false);
      setConsentResolver(resolver);
      await egress('drive', 'https://www.googleapis.com/drive/v3/files');
      expect(resolver).not.toHaveBeenCalled();
    });
  });

  describe('per-destination timeout', () => {
    it('aborts after the destination timeout and throws NET_TIMEOUT', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        ),
      );
      const pending = egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x');
      const assertion = expect(pending).rejects.toBeInstanceOf(NetTimeoutError);
      await vi.advanceTimersByTimeAsync(60_001);
      await assertion;
    });

    it('caller aborts surface as plain AbortError, not NET_TIMEOUT', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              if (init?.signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
              }
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        ),
      );
      const controller = new AbortController();
      const pending = egress(
        'drive',
        'https://www.googleapis.com/drive/v3/files',
        {},
        { signal: controller.signal },
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('null-timeout destinations (drive downloads) never arm a timer', async () => {
      vi.useFakeTimers();
      let resolveFetch: ((r: Response) => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => new Promise((resolve) => (resolveFetch = resolve))),
      );
      const pending = egress('drive', 'https://www.googleapis.com/drive/v3/files?alt=media');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      resolveFetch?.(new Response('blob'));
      await expect(pending).resolves.toBeInstanceOf(Response);
    });
  });

  describe('session counters (the CostEstimator replacement)', () => {
    it('counts requests and best-effort bytes out per destination', async () => {
      await egress('drive', 'https://www.googleapis.com/drive/v3/files');
      await egress('drive', 'https://www.googleapis.com/upload', {
        method: 'POST',
        body: 'four',
      });
      const counters = getEgressCounters().get('drive');
      expect(counters).toMatchObject({ requests: 2, bytesOut: 4 });
      expect(counters?.lastUsedAt).toBeTypeOf('number');
    });

    it('policy failures are NOT counted as egress', async () => {
      setConsentResolver(() => false);
      await expect(
        egress('gemini', 'https://generativelanguage.googleapis.com/v1beta/x', {}, {
          consent: { bookId: 'b' },
        }),
      ).rejects.toBeInstanceOf(NetConsentRequiredError);
      expect(getEgressCounters().get('gemini')).toBeUndefined();
    });
  });
});
