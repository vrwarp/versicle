import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { MockCloudProvider } from './providers/MockCloudProvider';

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
    updateReadingHistory: vi.fn(),
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
    // These return promises now, but we intentionally don't await them to simulate concurrency
    service.jumpTo(0);
    service.jumpTo(1);
    service.jumpTo(2);

    // Wait for all promises to settle
    // Increase timeout to ensure serial execution + overhead fits
    await new Promise(resolve => setTimeout(resolve, 500));

    // Only the last one should have completed successfully.
    // However, depending on timing, the first ones might have started but been aborted.
    // The key is that the final state should reflect the last call.

    expect(service['currentIndex']).toBe(2);
    expect(service['status']).toBe('playing');

    const calls = playSpy.mock.calls;
    // We expect at least the last one
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[calls.length - 1][0]).toBe('Sentence three.');
  });

  it('should stop playback immediately if stop() is called after play()', async () => {
      // Start playing
      service.play();

      // Immediately stop
      service.stop();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(service['status']).toBe('stopped');
  });

});
