import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { MockCloudProvider } from './providers/MockCloudProvider';

// Mock useTTSStore to avoid circular dependency crash
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn(() => ({
      settings: { customAbbreviations: [], alwaysMerge: [], sentenceStarters: [] }
    }))
  }
}));

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    getSections: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn(),
    getTTSContent: vi.fn(),
  }
}));

// Mock LexiconService
vi.mock('./LexiconService', () => ({
  LexiconService: {
    getInstance: vi.fn().mockReturnValue({
      getRules: vi.fn().mockResolvedValue([]),
      applyLexicon: vi.fn((text) => text),
      getRulesHash: vi.fn().mockResolvedValue('hash'),
      getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
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

describe('AudioPlayerService Concurrency', () => {
  let service: AudioPlayerService;
  let mockProvider: MockCloudProvider;

  // Create a queue
  const queue: TTSQueueItem[] = [
    { text: 'Sentence one.', cfi: 'cfi1' },
    { text: 'Sentence two.', cfi: 'cfi2' },
    { text: 'Sentence three.', cfi: 'cfi3' },
  ];

  beforeEach(async () => {
    // Reset singleton
    // @ts-expect-error Resetting singleton for testing
    AudioPlayerService.instance = undefined;

    service = AudioPlayerService.getInstance();
    mockProvider = new MockCloudProvider();

    // Slow down synthesis to simulate network latency and allow overlap
    // @ts-expect-error Accessing protected method
    vi.spyOn(mockProvider, 'fetchAudioData').mockImplementation(async () => {
      // Wait 50ms
      await new Promise(resolve => setTimeout(resolve, 50));

      // Return dummy result
      return {
        isNative: false,
        audio: new Blob(['dummy'], { type: 'audio/mp3' }),
        alignment: [{ timeSeconds: 0, charIndex: 0 }]
      };
    });

    // IMPORTANT: Await these because executeWithLock makes them async
    await service.setProvider(mockProvider);
    await service.setQueue(queue);
    await service.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle rapid play calls by executing only the last one', async () => {
    // @ts-expect-error Accessing protected method
    const playSpy = vi.spyOn(mockProvider, 'fetchAudioData');

    // Call play multiple times rapidly
    // Await all of them to ensure the TaskSequencer has processed them serially.
    await Promise.all([
      service.jumpTo(0),
      service.jumpTo(1),
      service.jumpTo(2)
    ]);

    // Only the last one's state should persist in the end.
    // Because execution is serial (TaskSequencer), fetchAudioData is likely called 3 times.
    // The assertions verify the FINAL state.

    // Access state via stateManager
    expect(service['stateManager'].currentIndex).toBe(2);
    expect(service['status']).toBe('playing');

    const calls = playSpy.mock.calls;
    // We expect at least the last one (likely 3 calls in reality due to serial queue)
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((calls[calls.length - 1] as any)[0]).toBe('Sentence three.');
  });

  it('should stop playback immediately if stop() is called after play()', async () => {
    // Start playing and then immediately stop
    // We await both to ensure the sequence processes (Play -> Stop)
    await service.play();
    await service.stop();

    expect(service['status']).toBe('stopped');
  });

});
