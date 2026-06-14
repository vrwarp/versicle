/**
 * Per-book AI consent policy suite (Phase 7 §H / PR-N3): the resolver the
 * NetworkGateway consent gate consults for gemini egress, plus the
 * end-to-end deny path through the gateway.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAiConsentResolver } from './aiConsent';
import {
  egress,
  setConsentResolver,
  NetConsentRequiredError,
  findDestination,
} from '@kernel/net';

const gemini = findDestination('gemini')!;

function makeResolver(consent: Record<string, boolean>, analyzed: string[] = []) {
  return makeAiConsentResolver({
    getConsent: (bookId) => consent[bookId],
    hasAnalysisRecords: (bookId) => analyzed.includes(bookId),
  });
}

describe('makeAiConsentResolver', () => {
  it('explicit denial wins: aiConsent[bookId] === false denies', () => {
    expect(makeResolver({ b1: false })(gemini, { bookId: 'b1' })).toBe(false);
  });

  it('explicit grant wins over everything', () => {
    expect(makeResolver({ b1: true })(gemini, { bookId: 'b1' })).toBe(true);
  });

  it('grandfathering: already-analyzed books are allowed without an explicit bit', () => {
    expect(makeResolver({}, ['b2'])(gemini, { bookId: 'b2' })).toBe(true);
  });

  it('default-deny (P9, observe-mode exited): unknown books without records are DENIED — the prompt is the affordance', () => {
    expect(makeResolver({})(gemini, { bookId: 'new-book' })).toBe(false);
  });

  it('legacy posture: calls without a bookId are allowed (smart TOC/link surfaces)', () => {
    expect(makeResolver({ b1: false })(gemini, {})).toBe(true);
  });

  it('interactive calls are always allowed', () => {
    expect(makeResolver({ b1: false })(gemini, { bookId: 'b1', interactive: true })).toBe(true);
  });
});

describe('gateway integration: no Gemini egress without consent', () => {
  afterEach(() => {
    setConsentResolver(null);
    vi.unstubAllGlobals();
  });

  it('a denied book never reaches fetch — NET_CONSENT_REQUIRED is thrown first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    setConsentResolver(makeResolver({ 'denied-book': false }));
    await expect(
      egress(
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent',
        { method: 'POST' },
        { consent: { bookId: 'denied-book' } },
      ),
    ).rejects.toBeInstanceOf(NetConsentRequiredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a granted book proceeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    setConsentResolver(makeResolver({ 'ok-book': true }));
    const res = await egress(
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent',
      { method: 'POST' },
      { consent: { bookId: 'ok-book' } },
    );
    expect(res.status).toBe(200);
  });
});
