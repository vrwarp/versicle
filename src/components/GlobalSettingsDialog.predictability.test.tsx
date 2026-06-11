import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { GlobalSettingsDialog } from './GlobalSettingsDialog';
import { useUIStore } from '@store/useUIStore';
import { useTTSStore } from '@store/useTTSStore';
import { CheckpointService } from '@lib/sync/CheckpointService';
import { renderWithStores, storeSeed, makeTTSVoice } from '@test/harness';

// Harness migration (Phase 0): this file used to vi.mock NINE store modules
// plus the Modal primitive to render one dialog (the worst mock pile in the
// suite — see plan/overhaul/analysis/testing-verification.md §9). It now
// renders against the real stores via renderWithStores; the only test
// controls are the two async seams the regression needs to keep pending
// (checkVoiceDownloaded via a store action override, listCheckpoints via a
// plain spy on the real service).

type Checkpoints = Awaited<ReturnType<typeof CheckpointService.listCheckpoints>>;

describe('GlobalSettingsDialog Predictability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not throw or cause unmounted state updates when promises resolve after unmount', async () => {
    let voiceResolver: ((ready: boolean) => void) | undefined;
    let checkpointsResolver: ((list: Checkpoints) => void) | undefined;

    const checkVoiceDownloaded = vi.fn(
      () => new Promise<boolean>(r => { voiceResolver = r; })
    );
    vi.spyOn(CheckpointService, 'listCheckpoints').mockImplementation(
      () => new Promise<Checkpoints>(r => { checkpointsResolver = r; })
    );

    const { unmount } = renderWithStores(<GlobalSettingsDialog />, {
      seeds: [
        storeSeed(useUIStore, { isGlobalSettingsOpen: true }),
        storeSeed(useTTSStore, {
          providerId: 'piper',
          voice: makeTTSVoice({ id: 'voice1', provider: 'piper' }),
          checkVoiceDownloaded,
        }),
      ],
    });

    // The pending async work must have been kicked off before unmount for
    // the regression to be meaningful.
    expect(checkVoiceDownloaded).toHaveBeenCalled();

    // Component unmounts while promises are still pending
    unmount();

    // Promises resolve after unmount
    let errorCaught = false;
    try {
      await act(async () => {
        if (voiceResolver) voiceResolver(true);
        if (checkpointsResolver) checkpointsResolver([]);
      });
    } catch {
      errorCaught = true;
    }

    // We expect NO errors to be thrown when resolving promises for an unmounted component with the ignore flag fix.
    expect(errorCaught).toBe(false);
  });
});
