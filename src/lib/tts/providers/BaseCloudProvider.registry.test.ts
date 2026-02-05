import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseCloudProvider } from './BaseCloudProvider';
import { CostEstimator } from '../CostEstimator';
import type { TTSOptions, SpeechSegment } from './types';
import type { IAudioPlayer } from '../IAudioPlayer';

// Mock dependencies
vi.mock('../CostEstimator', () => {
  const mockTrack = vi.fn();
  return {
    CostEstimator: {
      getInstance: () => ({
        track: mockTrack
      })
    },
    useCostStore: {
        getState: () => ({ resetSession: vi.fn() })
    }
  };
});

// Mock TTSCache
const mockGet = vi.fn();
const mockPut = vi.fn();
const mockGenerateKey = vi.fn((text) => Promise.resolve(`key-${text}`));

vi.mock('../TTSCache', () => {
  return {
    TTSCache: class {
      get = mockGet;
      put = mockPut;
      generateKey = mockGenerateKey;
    }
  };
});

// Create a mock AudioPlayer
const createMockAudioPlayer = (): IAudioPlayer => ({
    playBlob: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    setRate: vi.fn(),
    getDuration: vi.fn().mockReturnValue(0),
    setOnTimeUpdate: vi.fn(),
    setOnEnded: vi.fn(),
    setOnError: vi.fn(),
});

// Concrete implementation of BaseCloudProvider for testing
class TestProvider extends BaseCloudProvider {
  id = 'test-provider';

  // Expose protected method for testing
  public async getOrFetchPublic(text: string, options: TTSOptions): Promise<SpeechSegment> {
      return this.getOrFetch(text, options);
  }

  init = vi.fn().mockResolvedValue(undefined);

  // Use a separate mock property to track calls
  public fetchAudioDataMock = vi.fn();

  protected async fetchAudioData(text: string, options: TTSOptions): Promise<SpeechSegment> {
      const result = this.fetchAudioDataMock(text, options);
      return result;
  }

  // Expose registry for verification
  get requestRegistrySize() {
      return this.requestRegistry.size;
  }
}

describe('BaseCloudProvider Request Registry', () => {
  let provider: TestProvider;
  let mockAudioPlayer: IAudioPlayer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trackSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioPlayer = createMockAudioPlayer();
    provider = new TestProvider(mockAudioPlayer);
    trackSpy = CostEstimator.getInstance().track;
  });

  afterEach(() => {
      vi.clearAllMocks();
  });

  it('should deduplicate concurrent requests for the same text', async () => {
    const text = 'concurrent test';
    const options: TTSOptions = { voiceId: 'v1', speed: 1.0 };
    const mockAudioBlob = new Blob(['audio'], { type: 'audio/mp3' });
    const mockResult: SpeechSegment = { audio: mockAudioBlob, isNative: false };

    // Setup fetch to take some time
    let resolveFetch: (value: SpeechSegment) => void;
    const fetchPromise = new Promise<SpeechSegment>((resolve) => {
      resolveFetch = resolve;
    });

    // Configure the mock on the provider
    provider.fetchAudioDataMock.mockReturnValue(fetchPromise);
    mockGet.mockResolvedValue(undefined); // Cache miss

    // Initiate two concurrent requests
    const p1 = provider.getOrFetchPublic(text, options);
    const p2 = provider.getOrFetchPublic(text, options);

    // Yield to event loop to allow async generatorKey and cache.get to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    // Verify only one fetch was initiated
    expect(provider.fetchAudioDataMock).toHaveBeenCalledTimes(1);

    // Verify cost tracking was called once
    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy).toHaveBeenCalledWith(text);

    // Verify registry has 1 entry
    expect(provider.requestRegistrySize).toBe(1);

    // Resolve the fetch
    resolveFetch!(mockResult);

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both requests should return the same result
    expect(r1).toBe(mockResult);
    expect(r2).toBe(mockResult);

    // Registry should be empty after resolution
    expect(provider.requestRegistrySize).toBe(0);

    // Cache should be updated
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('should cleanup registry even if fetch fails', async () => {
      const text = 'fail test';
      const options: TTSOptions = { voiceId: 'v1', speed: 1.0 };

      mockGet.mockResolvedValue(undefined);

      const error = new Error('Network error');
      provider.fetchAudioDataMock.mockRejectedValue(error);

      try {
          const p = provider.getOrFetchPublic(text, options);
          // Attach no-op catch to prevent unhandled rejection warning during timeout
          p.catch(() => {});

          await new Promise(resolve => setTimeout(resolve, 0));
          await p;
      } catch (e) {
          expect(e).toBe(error);
      }

      // Registry should be empty
      expect(provider.requestRegistrySize).toBe(0);

      // Cache put should not have been called
      expect(mockPut).not.toHaveBeenCalled();
  });

  it('should return cached result if available and not fetch', async () => {
      const text = 'cached test';
      const options: TTSOptions = { voiceId: 'v1', speed: 1.0 };

      mockGet.mockResolvedValue({ audio: new ArrayBuffer(0), alignment: [] });

      const p = provider.getOrFetchPublic(text, options);
      await new Promise(resolve => setTimeout(resolve, 0));
      await p;

      expect(provider.fetchAudioDataMock).not.toHaveBeenCalled();
      expect(trackSpy).not.toHaveBeenCalled();
      expect(provider.requestRegistrySize).toBe(0);
  });
});
