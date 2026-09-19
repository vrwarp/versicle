/**
 * The free-tier defaults table mirrors the AI Studio rate-limit dashboard, and
 * the governor enforces whatever is in it: a pool that is missing gets the far
 * looser `default` ceiling and overruns the model's real free tier, while a
 * pool carrying a stale figure either strands quota or collects 429s. This
 * suite pins the rows the dashboard refresh added or moved.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_QUOTA_LIMITS } from './useGenAIStore';

const UNMETERED_REQUESTS = 999_999;
const UNMETERED_TOKENS = 999_999_999;

describe('DEFAULT_QUOTA_LIMITS', () => {
  it('meters the newly listed text-out models at the frontier ceiling', () => {
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.8-flash']).toEqual({ rpm: 5, tpm: 250_000, rpd: 20 });
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.7-flash']).toEqual({ rpm: 5, tpm: 250_000, rpd: 20 });
  });

  it('meters the Transcribe pair separately: the batch endpoint is capped, the live one is not', () => {
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.5-transcribe']).toEqual({ rpm: 3, tpm: 10_000, rpd: 25 });
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.5-transcribe-live']).toEqual({
      rpm: UNMETERED_REQUESTS,
      tpm: 20_000,
      rpd: UNMETERED_REQUESTS,
    });
  });

  it('gives both 3.8 Live endpoints the Live API shape (unmetered requests, 65K TPM)', () => {
    for (const pool of ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']) {
      expect(DEFAULT_QUOTA_LIMITS[pool]).toEqual({
        rpm: UNMETERED_REQUESTS,
        tpm: 65_000,
        rpd: UNMETERED_REQUESTS,
      });
    }
  });

  it('seeds the other new dashboard rows', () => {
    expect(DEFAULT_QUOTA_LIMITS['gemini-robotics-er-2-preview']).toEqual({
      rpm: 5,
      tpm: 250_000,
      rpd: 20,
    });
    // A zero free-tier allowance stays literal zero: acquire backpressures
    // pre-network instead of spending a round trip to collect a 429.
    expect(DEFAULT_QUOTA_LIMITS['gemini-omni-1.1-flash']).toEqual({ rpm: 0, tpm: 0, rpd: 0 });
  });

  it('keys grounding-tool pools off their model pool and carries their own daily cap', () => {
    // The grounding tables are metered per TOOL, not per model request: RPM/TPM
    // read "—" (unmetered) and only the daily bucket is real — 0 for the models
    // the free tier does not ground at all.
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.5-transcribe-map-grounding']).toEqual({
      rpm: UNMETERED_REQUESTS,
      tpm: UNMETERED_TOKENS,
      rpd: 500,
    });
    expect(DEFAULT_QUOTA_LIMITS['gemini-3.8-flash-map-grounding']).toEqual({
      rpm: UNMETERED_REQUESTS,
      tpm: UNMETERED_TOKENS,
      rpd: 0,
    });
    expect(DEFAULT_QUOTA_LIMITS['gemini-3-search-grounding']).toEqual({
      rpm: UNMETERED_REQUESTS,
      tpm: UNMETERED_TOKENS,
      rpd: 0,
    });
  });
});
