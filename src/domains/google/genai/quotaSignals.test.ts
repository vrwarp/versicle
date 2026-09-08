import { describe, expect, it } from 'vitest';
import { parseQuotaSignals } from './quotaSignals';

/** A captured free-tier daily-quota 429 body shape (Gemini API, RESOURCE_EXHAUSTED). */
const DAILY_BODY = {
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details.\n' +
      '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash\n' +
      'Please retry in 18.95s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaDimensions: { location: 'global', model: 'gemini-3.5-flash' },
            quotaValue: '20',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '18s' },
    ],
  },
};

describe('parseQuotaSignals', () => {
  it('reads the daily quota id and the RetryInfo delay from the details array', () => {
    const signals = parseQuotaSignals(DAILY_BODY);
    expect(signals.dailyQuotaExhausted).toBe(true);
    expect(signals.retryAfterMs).toBe(18_000);
    expect(signals.quotaIds).toEqual(['GenerateRequestsPerDayPerProjectPerModel-FreeTier']);
  });

  it('a per-minute violation is NOT a daily exhaustion', () => {
    const body = structuredClone(DAILY_BODY);
    body.error.details[0].violations![0].quotaId =
      'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';
    const signals = parseQuotaSignals(body);
    expect(signals.dailyQuotaExhausted).toBe(false);
    expect(signals.retryAfterMs).toBe(18_000);
  });

  it('falls back to the "Please retry in Ns" message text when RetryInfo is absent', () => {
    const body = { error: { message: 'Resource exhausted. Please retry in 34.79s.' } };
    expect(parseQuotaSignals(body).retryAfterMs).toBe(34_790);
  });

  it('accepts the {seconds, nanos} Duration object form', () => {
    const body = {
      error: {
        details: [
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: { seconds: 2, nanos: 500_000_000 } },
        ],
      },
    };
    expect(parseQuotaSignals(body).retryAfterMs).toBe(2_500);
  });

  it('detects a daily exhaustion phrased only in the message text', () => {
    const body = { error: { message: 'Quota exceeded: requests per day for this project.' } };
    expect(parseQuotaSignals(body).dailyQuotaExhausted).toBe(true);
  });

  it('tolerates empty, malformed and non-object bodies', () => {
    for (const body of [undefined, null, {}, 'nope', { error: null }, { error: { details: 'x' } }]) {
      expect(parseQuotaSignals(body)).toEqual({ dailyQuotaExhausted: false, quotaIds: [] });
    }
  });
});
