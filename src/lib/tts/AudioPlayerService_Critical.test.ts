import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { MockCloudProvider } from './providers/MockCloudProvider';

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    saveTTSState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue({ queue: [], currentIndex: 0 }),
  }
}));

// Mock LexiconService
vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn().mockReturnValue({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash'),
        })
    }
}));

// Mock TTSCache
vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      generateKey = vi.fn().mockResolvedValue('key');
      get = vi.fn().mockResolvedValue(null);
      put = vi.fn().mockResolvedValue(undefined);
    }
  };
});

describe('AudioPlayerService Critical Sections', () => {
  let service: AudioPlayerService;
  let mockProvider: MockCloudProvider;

  beforeEach(async () => {
    // Reset singleton
    // @ts-expect-error Resetting singleton for testing
    AudioPlayerService.instance = undefined;

    service = AudioPlayerService.getInstance();
    mockProvider = new MockCloudProvider();
    await service.setProvider(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should NOT abort setQueue when play is called immediately after', async () => {
     const { dbService } = await import('../../db/DBService');

    let resolveUpdate: () => void;
    const updatePromise = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
    });

    // Mock updatePlaybackState (called by stopInternal, which is called early in setQueue)
    // This pauses execution of setQueue BEFORE it updates the queue variable.
    vi.mocked(dbService.updatePlaybackState).mockImplementation(async () => {
        await updatePromise;
    });

    const queue: TTSQueueItem[] = [{ text: 'Item 1', cfi: '1' }];

    // 1. Start setQueue (Critical)
    const setQueuePromise = service.setQueue(queue);

    // 2. Start play (Non-Critical)
    // If setQueue was NOT critical, play would abort it here.
    const playPromise = service.play();

    // 3. Release the lock allowing setQueue to proceed
    resolveUpdate!();

    await setQueuePromise;

    // 4. Verify setQueue completed successfully (queue was updated)
    // If it was aborted, queue would be empty (initial state)
    expect(service.getQueue()).toEqual(queue);

    // 5. Finish play
    await playPromise;
    expect(service['status']).toBe('playing');
  });

  it('should still allow setQueue to be aborted by a newer setQueue (if desired?) or wait?', async () => {
      // Logic check:
      // setQueue A (Critical).
      // setQueue B (Critical).
      // B sees A is Critical. Does NOT abort A.
      // B waits for A.
      // A finishes.
      // B runs.
      // Final state: Queue B.

      const { dbService } = await import('../../db/DBService');
      let resolveUpdate: () => void;
      const updatePromise = new Promise<void>((resolve) => { resolveUpdate = resolve; });
      vi.mocked(dbService.updatePlaybackState).mockImplementation(async () => { await updatePromise; });

      const queueA: TTSQueueItem[] = [{ text: 'Item A', cfi: 'A' }];
      const queueB: TTSQueueItem[] = [{ text: 'Item B', cfi: 'B' }];

      const promiseA = service.setQueue(queueA);
      const promiseB = service.setQueue(queueB);

      resolveUpdate!();

      await promiseA;
      await promiseB;

      // Both should have run sequentially.
      // Since A finished first, then B ran.
      // The queue should be B.
      expect(service.getQueue()).toEqual(queueB);
  });
});
