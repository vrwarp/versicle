import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  orchestrator: null as null | { repairUploadMissing: (...args: unknown[]) => Promise<unknown> },
}));

vi.mock('../createSync', () => ({
  peekSyncOrchestrator: () => h.orchestrator,
}));

import { repairCloudCopy } from './repair';

describe('repairCloudCopy', () => {
  it('refuses when sync is not running on this device', async () => {
    h.orchestrator = null;

    await expect(repairCloudCopy()).resolves.toStrictEqual({
      ok: false,
      error: 'Sync is not running on this device.',
      ms: 0,
    });
  });

  it('delegates to the live orchestrator and returns its result untouched', async () => {
    const result = { ok: true, uploaded: true, bytes: 12, clientsBehind: [], cloudPendingBefore: null, cloudPendingAfter: null, ms: 3 };
    const calls: unknown[][] = [];
    h.orchestrator = {
      repairUploadMissing: async (...args) => {
        calls.push(args);
        return result;
      },
    };

    await expect(repairCloudCopy()).resolves.toBe(result);
    expect(calls).toStrictEqual([[]]);
  });
});
