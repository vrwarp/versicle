import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { MockCloudProvider } from './providers/MockCloudProvider';
import type { TTSOptions } from './providers/types';

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

describe('AudioPlayerService Cancellation', () => {
  let service: AudioPlayerService;
  let mockProvider: MockCloudProvider;

  const queue: TTSQueueItem[] = [
      { text: 'Sentence one.', cfi: 'cfi1' },
      { text: 'Sentence two.', cfi: 'cfi2' },
  ];

  beforeEach(async () => {
    // @ts-expect-error Resetting singleton for testing
    AudioPlayerService.instance = undefined;

    service = AudioPlayerService.getInstance();
    mockProvider = new MockCloudProvider();

    // Mock fetchAudioData to handle signal and be slow
    // @ts-expect-error Accessing protected method
    vi.spyOn(mockProvider, 'fetchAudioData').mockImplementation(async (text: string, options: TTSOptions) => {
        return new Promise((resolve, reject) => {
             const timer = setTimeout(() => {
                 resolve({
                     isNative: false,
                     audio: new Blob(['dummy'], { type: 'audio/mp3' }),
                     alignment: [{ timeSeconds: 0, charIndex: 0 }]
                 });
             }, 500); // 500ms delay

             if (options.signal) {
                 if (options.signal.aborted) {
                     clearTimeout(timer);
                     const err = new Error('Aborted');
                     err.name = 'AbortError';
                     reject(err);
                     return;
                 }
                 options.signal.addEventListener('abort', () => {
                     clearTimeout(timer);
                     const err = new Error('Aborted');
                     err.name = 'AbortError';
                     reject(err);
                 });
             }
        });
    });

    await service.setProvider(mockProvider);
    await service.setQueue(queue);
    await service.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should abort current fetch when stop() is called', async () => {
    // Start play. fetchAudioData takes 500ms.
    const playPromise = service.play();

    // Check status is loading or playing
    // Wait a tick
    await new Promise(r => setTimeout(r, 0));
    expect(service['status']).toBe('loading');

    // Call stop immediately (e.g. after 50ms)
    await new Promise(r => setTimeout(r, 50));
    const start = Date.now();
    const stopPromise = service.stop();

    // Wait for both
    await Promise.all([playPromise, stopPromise]);
    const duration = Date.now() - start;

    // Status should be stopped
    expect(service['status']).toBe('stopped');

    // Should be fast (less than remaining 450ms)
    expect(duration).toBeLessThan(400);
  });

  it('should abort current fetch when next() is called', async () => {
      // Start play
      service.play();
      await new Promise(r => setTimeout(r, 50));

      // Call next
      service.next();

      // Wait a bit
      await new Promise(r => setTimeout(r, 100));

      // Should be playing next item (index 1)
      expect(service['currentIndex']).toBe(1);
      // The first play should have been aborted, so we moved to next and started playing it.
      // (The second play will also wait 500ms because of mock, but that's fine).
  });
});
