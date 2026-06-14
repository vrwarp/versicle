/**
 * embeddingBackfill suite (Increment E2 gates): drives the PURE
 * runEmbeddingBackfill core with injected fakes (no real store/IDB/governor).
 *
 * Pins the privacy + admission guardrails:
 *  (1) opt-in OFF  → no-op (never enqueues);
 *  (2) opt-in ON but THIS device idle (stale lastActive) → no-op;
 *  (3) opt-in ON + active → enqueues ONLY loaded-but-unread books, each with
 *      { interactive:false, lane:'bg' }; NO call ever has interactive:true;
 *  (4) respects the cross-device bg quota: remaining<=0 enqueues nothing;
 *      headroom enqueues until exhausted;
 *  (5) a per-book NetRateLimitedError stops the trickle without throwing.
 */
import { describe, it, expect, vi } from 'vitest';
import { runEmbeddingBackfill, type EmbeddingBackfillDeps } from './embeddingBackfill';
import { NetRateLimitedError } from '~types/errors';
import type { DeviceInfo, DeviceProfile } from '~types/device';
import type { QuotaLimits } from '@kernel/quota';

const PROFILE: DeviceProfile = {
  theme: 'light',
  fontSize: 16,
  ttsVoiceURI: null,
  ttsRate: 1,
  ttsPitch: 1,
};

const NOW = 1_700_000_000_000;
const LIMITS: QuotaLimits = { rpm: 100, tpm: 30_000, rpd: 1000 };

function selfDevice(lastActive: number): DeviceInfo {
  return {
    id: 'self',
    name: 'Self',
    platform: 'web',
    browser: 'Chrome',
    model: 'Desktop',
    userAgent: 'test',
    appVersion: '1.0.0',
    lastActive,
    created: NOW,
    profile: PROFILE,
  };
}

interface CapturedEnqueue {
  bookId: string;
  opts: { interactive: false; lane: 'bg' };
}

/**
 * Build deps + an enqueue capture. `overrides` tunes each case; sensible
 * defaults model an active device with two loaded-but-unread books and ample
 * quota.
 */
function makeDeps(overrides: Partial<EmbeddingBackfillDeps> = {}) {
  const enqueued: CapturedEnqueue[] = [];
  const progress: Record<string, number | null> = { b1: 0, b2: 0 };
  const local: Record<string, boolean> = { b1: true, b2: true };
  const deps: EmbeddingBackfillDeps = {
    isOptInEnabled: () => true,
    isClientConfigured: () => true,
    getDevices: () => ({ self: selfDevice(NOW) }),
    selfId: 'self',
    now: () => NOW,
    listBooks: () => ['b1', 'b2'],
    getProgress: (bookId) => progress[bookId] ?? null,
    hasLocalBinary: async (bookId) => local[bookId] ?? false,
    getBgLimits: () => LIMITS,
    getBgUsedRpd: () => 0,
    enqueue: vi.fn(async (bookId, opts) => {
      enqueued.push({ bookId, opts });
    }),
    shouldContinue: () => true,
    ...overrides,
  };
  return { deps, enqueued };
}

describe('runEmbeddingBackfill (E2)', () => {
  it('opt-in OFF: no-ops (never enqueues)', async () => {
    const { deps, enqueued } = makeDeps({ isOptInEnabled: () => false });
    await runEmbeddingBackfill(deps);
    expect(enqueued).toHaveLength(0);
  });

  it('client unconfigured: no-ops', async () => {
    const { deps, enqueued } = makeDeps({ isClientConfigured: () => false });
    await runEmbeddingBackfill(deps);
    expect(enqueued).toHaveLength(0);
  });

  it('opt-in ON but THIS device idle (stale lastActive): no-ops (active-device gate)', async () => {
    const { deps, enqueued } = makeDeps({
      // lastActive is far outside the 10-min window → idle.
      getDevices: () => ({ self: selfDevice(NOW - 60 * 60 * 1000) }),
    });
    await runEmbeddingBackfill(deps);
    expect(enqueued).toHaveLength(0);
  });

  it('opt-in ON + active: enqueues only loaded-but-unread, each { interactive:false, lane:"bg" }', async () => {
    // b1 loaded+unread, b2 loaded but READ (skip), b3 unread but NOT loaded (skip).
    const { deps, enqueued } = makeDeps({
      listBooks: () => ['b1', 'b2', 'b3'],
      getProgress: (id) => ({ b1: 0, b2: 0.8, b3: 0 })[id] ?? null,
      hasLocalBinary: async (id) => ({ b1: true, b2: true, b3: false })[id] ?? false,
    });
    await runEmbeddingBackfill(deps);

    expect(enqueued.map((e) => e.bookId)).toEqual(['b1']);
    for (const call of enqueued) {
      expect(call.opts).toEqual({ interactive: false, lane: 'bg' });
      // The §8.4.1 invariant: a bg path is NEVER interactive:true.
      expect(call.opts.interactive).not.toBe(true);
    }
  });

  it('respects the bg quota: a fully-consumed cross-device ceiling enqueues nothing', async () => {
    const { deps, enqueued } = makeDeps({
      // The A6 reduced ceiling minus today's bg spend leaves no headroom.
      getBgLimits: () => ({ ...LIMITS, rpd: 200 }),
      getBgUsedRpd: () => 200,
    });
    await runEmbeddingBackfill(deps);
    expect(enqueued).toHaveLength(0);
  });

  it('respects the bg quota: stops once the cross-device ceiling is reached mid-trickle', async () => {
    // Headroom for ONE book: the second iteration's pre-flight sees remaining<=0.
    let used = 199;
    const captured: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      getBgLimits: () => ({ ...LIMITS, rpd: 200 }),
      getBgUsedRpd: () => used,
      enqueue: async (bookId) => {
        captured.push(bookId);
        used += 1; // each enqueue spends one bg request
      },
    });
    await runEmbeddingBackfill(deps);
    expect(captured).toEqual(['b1']);
  });

  it('a per-book NetRateLimitedError stops the trickle without throwing', async () => {
    const captured: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      enqueue: async (bookId) => {
        if (bookId === 'b1') throw new NetRateLimitedError(1000, { lane: 'bg' });
        captured.push(bookId);
      },
    });
    await expect(runEmbeddingBackfill(deps)).resolves.toBeUndefined();
    // b1 backpressured → trickle stopped; b2 never attempted.
    expect(captured).toHaveLength(0);
  });

  it('shouldContinue() going false (opt-in flipped off mid-pass) halts the trickle', async () => {
    let live = true;
    const captured: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      shouldContinue: () => live,
      enqueue: async (bookId) => {
        captured.push(bookId);
        live = false; // user toggled the opt-in off after the first book
      },
    });
    await runEmbeddingBackfill(deps);
    expect(captured).toEqual(['b1']);
  });
});
