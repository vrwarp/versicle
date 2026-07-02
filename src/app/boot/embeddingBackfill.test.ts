/**
 * embeddingBackfill suite (Increment E2 gates): drives the PURE
 * runEmbeddingBackfill core with injected fakes (no real store/IDB/governor).
 *
 * Pins the privacy + admission guardrails:
 *  (1) opt-in OFF  → no-op (never enqueues);
 *  (2) opt-in ON but THIS device idle (stale lastActive) → no-op;
 *  (3) opt-in ON + active → enqueues EVERY locally-present book (the
 *      background lane covers the whole on-device library), each with
 *      { interactive:false, lane:'bg' }; NO call ever has interactive:true;
 *  (4) respects the cross-device bg quota: remaining<=0 enqueues nothing;
 *      headroom enqueues until exhausted;
 *  (5) a per-book NetRateLimitedError stops the trickle without throwing and
 *      signals a 'retry' outcome (the boot task re-runs after 90 s);
 *  (6) a per-book generic failure skips the book, continues, and signals
 *      'retry' so the failed book gets another pass.
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
 * defaults model an active device with two locally-present books and ample
 * quota.
 */
function makeDeps(overrides: Partial<EmbeddingBackfillDeps> = {}) {
  const enqueued: CapturedEnqueue[] = [];
  const local: Record<string, boolean> = { b1: true, b2: true };
  const deps: EmbeddingBackfillDeps = {
    isOptInEnabled: () => true,
    isClientConfigured: () => true,
    getDevices: () => ({ self: selfDevice(NOW) }),
    selfId: 'self',
    now: () => NOW,
    listBooks: () => ['b1', 'b2'],
    hasLocalBinary: async (bookId) => local[bookId] ?? false,
    getBgLimits: () => LIMITS,
    getBgUsedRpd: () => 0,
    enqueue: vi.fn(async (bookId, opts) => {
      enqueued.push({ bookId, opts });
    }),
    // Artifact Lane B-6: the shared-cache consult defaults to a MISS so the
    // existing cases (which exercise the embed lane) are unchanged. The H-1
    // suite overrides probeArtifact to a HIT.
    probeArtifact: async () => false,
    hydrateFromArtifact: async () => false,
    shouldContinue: () => true,
    ...overrides,
  };
  return { deps, enqueued };
}

describe('runEmbeddingBackfill (E2)', () => {
  it('opt-in OFF: no-ops (never enqueues)', async () => {
    const { deps, enqueued } = makeDeps({ isOptInEnabled: () => false });
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');
    expect(enqueued).toHaveLength(0);
  });

  it('client unconfigured: no-ops', async () => {
    const { deps, enqueued } = makeDeps({ isClientConfigured: () => false });
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');
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

  it('opt-in ON + active: enqueues EVERY locally-present book (read or unread), each { interactive:false, lane:"bg" }', async () => {
    // b1 and b2 present locally (b2 fully read — still indexed: the background
    // lane covers ALL books on device); b3 NOT present locally (skip).
    const { deps, enqueued } = makeDeps({
      listBooks: () => ['b1', 'b2', 'b3'],
      hasLocalBinary: async (id) => ({ b1: true, b2: true, b3: false })[id] ?? false,
    });
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');

    expect(enqueued.map((e) => e.bookId)).toEqual(['b1', 'b2']);
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
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');
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
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');
    expect(captured).toEqual(['b1']);
  });

  it('a per-book NetRateLimitedError stops the trickle without throwing and signals retry', async () => {
    const captured: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      enqueue: async (bookId) => {
        if (bookId === 'b1') throw new NetRateLimitedError(1000, { lane: 'bg' });
        captured.push(bookId);
      },
    });
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('retry');
    // b1 backpressured → trickle stopped; b2 never attempted.
    expect(captured).toHaveLength(0);
  });

  it('a per-book generic failure skips that book, continues, and signals retry', async () => {
    const captured: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      enqueue: async (bookId) => {
        if (bookId === 'b1') throw new Error('transient extract failure');
        captured.push(bookId);
      },
    });
    // The pass finishes the remaining books but reports 'retry' so the failed
    // book gets another attempt after the delay.
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('retry');
    expect(captured).toEqual(['b2']);
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
    await expect(runEmbeddingBackfill(deps)).resolves.toBe('complete');
    expect(captured).toEqual(['b1']);
  });
});

describe('runEmbeddingBackfill shared-AI-cache consult (Artifact Lane H-1)', () => {
  it('a SATURATED-quota run (remaining<=0) STILL hydrates a probe-HIT book and never enqueues/spends', async () => {
    // The consult is hoisted ABOVE the A6 gate, so even with zero RPD headroom a
    // peer-embedded (probe-hit) book hydrates quota-free. This is the exact case
    // a downstream-of-gate consult (the H-1 bug) would skip.
    const probed: string[] = [];
    const hydrated: string[] = [];
    let bgRpdQueried = false;
    const { deps, enqueued } = makeDeps({
      listBooks: () => ['b1'],
      // Quota fully consumed: bgLimits.rpd - bgUsedRpd <= 0.
      getBgLimits: () => ({ ...LIMITS, rpd: 100 }),
      getBgUsedRpd: () => {
        bgRpdQueried = true;
        return 100;
      },
      probeArtifact: async (bookId) => {
        probed.push(bookId);
        return true;
      },
      hydrateFromArtifact: async (bookId) => {
        hydrated.push(bookId);
        return true;
      },
    });

    await runEmbeddingBackfill(deps);

    // The book was hydrated quota-free…
    expect(probed).toEqual(['b1']);
    expect(hydrated).toEqual(['b1']);
    // …and NEVER enqueued (no embed → no acquire → no embedSpend). The RPD
    // pre-flight was never even reached for this book (continue before the gate).
    expect(enqueued).toHaveLength(0);
    expect(bgRpdQueried).toBe(false);
  });

  it('a probe-MISS book under remaining<=0 is skipped (the gate still bites the embed lane)', async () => {
    const { deps, enqueued } = makeDeps({
      listBooks: () => ['b1'],
      getBgLimits: () => ({ ...LIMITS, rpd: 100 }),
      getBgUsedRpd: () => 100,
      probeArtifact: async () => false, // miss → falls through to the A6 gate
    });
    await runEmbeddingBackfill(deps);
    expect(enqueued).toHaveLength(0); // remaining<=0 → never enqueued
  });

  it('a probe-HIT whose hydrate FAILS falls through to the embed lane (with headroom)', async () => {
    const { deps, enqueued } = makeDeps({
      listBooks: () => ['b1'],
      probeArtifact: async () => true,
      hydrateFromArtifact: async () => false, // partial/failed hydrate
    });
    await runEmbeddingBackfill(deps);
    // Hydrate failed → fell through to embed (ample default quota).
    expect(enqueued.map((e) => e.bookId)).toEqual(['b1']);
  });

  it('a probe is consulted ONLY after the local-binary filter (never probes an offloaded book)', async () => {
    const probed: string[] = [];
    const { deps } = makeDeps({
      listBooks: () => ['b1', 'b2'],
      hasLocalBinary: async (id) => ({ b1: false, b2: true })[id] ?? false, // b1 offloaded
      probeArtifact: async (bookId) => {
        probed.push(bookId);
        return false;
      },
    });
    await runEmbeddingBackfill(deps);
    // b1 was filtered out (no local binary) BEFORE the consult; only b2 is probed.
    expect(probed).toEqual(['b2']);
  });
});
