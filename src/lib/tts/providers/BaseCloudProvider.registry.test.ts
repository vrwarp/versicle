import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseCloudProvider } from './BaseCloudProvider';
import { FakeAudioSink } from '../engine/FakeAudioSink';
import type { TTSCache } from '../TTSCache';
import type { TTSOptions, SpeechSegment } from './types';

// Injected fakes instead of module mocks (vi.mock is banned in providers/ since
// 5a-PR2): the sink and cache go in through the BaseCloudProvider constructor.
const mockGet = vi.fn();
const mockPut = vi.fn();
const mockGenerateKey = vi.fn((text) => Promise.resolve(`key-${text}`));
const spyCache = { get: mockGet, put: mockPut, generateKey: mockGenerateKey } as unknown as TTSCache;

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

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestProvider(new FakeAudioSink(), spyCache);
  });

  afterEach(() => {
      vi.clearAllMocks();
  });

  it('should deduplicate concurrent requests for the same text', async () => {
    const text = 'concurrent test';
    const options: TTSOptions = { voiceId: 'v1', speed: 1.0 };
    const mockAudioBlob = new Blob(['audio'], { type: 'audio/mp3' });
    const mockResult: SpeechSegment = { audio: mockAudioBlob };

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
      expect(provider.requestRegistrySize).toBe(0);
  });
});

describe('regression: speed policy — speed-independent cache, rate at the sink', () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestProvider(new FakeAudioSink(), spyCache);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates the cache key without the playback speed', async () => {
    mockGet.mockResolvedValue({ audio: new ArrayBuffer(0), alignment: [] });

    await provider.getOrFetchPublic('same text', { voiceId: 'v1', speed: 1.0 });
    await provider.getOrFetchPublic('same text', { voiceId: 'v1', speed: 2.0 });

    // The key is derived from text + voice only — never the speed.
    expect(mockGenerateKey).toHaveBeenNthCalledWith(1, 'same text', 'v1');
    expect(mockGenerateKey).toHaveBeenNthCalledWith(2, 'same text', 'v1');
    // Same text + voice at different speeds resolves to the same cache entry.
    expect(mockGet.mock.calls[0][0]).toBe(mockGet.mock.calls[1][0]);
  });

  it('deduplicates concurrent requests for the same text across different speeds', async () => {
    mockGet.mockResolvedValue(undefined); // Cache miss
    const mockResult: SpeechSegment = { audio: new Blob(["audio"], { type: "audio/mp3" }) };
    provider.fetchAudioDataMock.mockResolvedValue(mockResult);

    const [r1, r2] = await Promise.all([
      provider.getOrFetchPublic('dedupe across speeds', { voiceId: 'v1', speed: 1.0 }),
      provider.getOrFetchPublic('dedupe across speeds', { voiceId: 'v1', speed: 1.5 }),
    ]);

    expect(provider.fetchAudioDataMock).toHaveBeenCalledTimes(1);
    expect(r1).toBe(mockResult);
    expect(r2).toBe(mockResult);
  });

  it('applies the playback rate at the sink AFTER the source is loaded', async () => {
    mockGet.mockResolvedValue({ audio: new ArrayBuffer(4) });

    const sink = new FakeAudioSink();
    const order: string[] = [];
    const origPlayBlob = sink.playBlob.bind(sink);
    sink.playBlob = async (blob: Blob) => { order.push('playBlob'); return origPlayBlob(blob); };
    const origSetRate = sink.setRate.bind(sink);
    sink.setRate = (rate: number) => { order.push(`setRate:${rate}`); origSetRate(rate); };

    const sinkProvider = new TestProvider(sink, spyCache);
    await sinkProvider.play('rated text', { voiceId: 'v1', speed: 1.5 });

    // Synthesis is always 1.0; the user's speed reaches the sink as a playback rate,
    // applied after src assignment so the media load algorithm cannot reset it.
    expect(order).toEqual(['playBlob', 'setRate:1.5']);
    expect(sink.rate).toBe(1.5);
  });
});

describe('regression: cached alignment survives the cache-read path', () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestProvider(new FakeAudioSink(), spyCache);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces alignment from the cached row', async () => {
    const timepoints = [{ timeSeconds: 0.25, charIndex: 5, type: 'word' }];
    mockGet.mockResolvedValue({ audio: new ArrayBuffer(4), alignment: timepoints });

    const result = await provider.getOrFetchPublic('aligned text', { voiceId: 'v1', speed: 1.0 });
    expect(result.alignment).toEqual(timepoints);
    expect(provider.fetchAudioDataMock).not.toHaveBeenCalled();
  });
});
