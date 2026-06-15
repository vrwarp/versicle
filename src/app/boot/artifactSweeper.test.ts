/**
 * artifactSweeper suite (Artifact Lane Phase D cloud TTL/quota GC): drives the
 * PURE runArtifactSweep core with injected fakes.
 *
 * Pins (see GUARDRAILS):
 *  - invokes sweepArtifacts with the configured ttlMs/now/budget;
 *  - a SILENT no-op when getBackend() returns null (no backend → no throw);
 *  - a thrown sweepArtifacts is best-effort (logged + swallowed, no throw).
 *
 * Policy is driven entirely against the mock; the real cloud delete/sweep
 * round-trip stays CI-PENDING (syncBackendContract.emulator.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runArtifactSweep,
  ARTIFACT_TTL_MS,
  type ArtifactSweepDeps,
} from './artifactSweeper';
import type { SyncBackend } from '@domains/sync';

const WORKSPACE = 'ws-1';
const NOW = 1_700_000_000_000;
const BUDGET = 256 * 1024 * 1024;

/** A fake backend exposing only sweepArtifacts (the rest is unused here). */
function fakeBackend(
  sweep: SyncBackend['sweepArtifacts'] = vi.fn(async () => ({ headsDeleted: 0, blobsDeleted: 0 })),
): SyncBackend {
  return { uid: 'uid-1', sweepArtifacts: sweep } as unknown as SyncBackend;
}

function makeDeps(overrides: Partial<ArtifactSweepDeps> = {}): ArtifactSweepDeps {
  return {
    getBackend: () => ({ backend: fakeBackend(), workspaceId: WORKSPACE }),
    ttlMs: ARTIFACT_TTL_MS,
    now: () => NOW,
    budgetBytes: BUDGET,
    ...overrides,
  };
}

describe('runArtifactSweep (Phase D)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('invokes sweepArtifacts with the configured ttlMs/now/budget', async () => {
    const sweep = vi.fn(async () => ({ headsDeleted: 2, blobsDeleted: 2 }));
    const backend = fakeBackend(sweep);
    await runArtifactSweep(makeDeps({ getBackend: () => ({ backend, workspaceId: WORKSPACE }) }));

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith(WORKSPACE, {
      ttlMs: ARTIFACT_TTL_MS,
      now: NOW,
      budgetBytes: BUDGET,
    });
  });

  it('is a silent no-op when getBackend() returns null', async () => {
    const sweep = vi.fn(async () => ({ headsDeleted: 0, blobsDeleted: 0 }));
    // Ensure the null path never reaches a backend call.
    await expect(
      runArtifactSweep(makeDeps({ getBackend: () => null })),
    ).resolves.toBeUndefined();
    expect(sweep).not.toHaveBeenCalled();
  });

  it('swallows a thrown sweepArtifacts (best-effort, no throw)', async () => {
    const sweep = vi.fn(async () => {
      throw new Error('transient cloud error');
    });
    const backend = fakeBackend(sweep);
    await expect(
      runArtifactSweep(makeDeps({ getBackend: () => ({ backend, workspaceId: WORKSPACE }) })),
    ).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
