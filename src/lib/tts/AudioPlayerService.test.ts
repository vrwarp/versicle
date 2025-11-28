import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { TTSCache } from './TTSCache';
import { AudioElementPlayer } from './AudioElementPlayer';

// Mock dependencies
vi.mock('./providers/WebSpeechProvider');
vi.mock('./TTSCache');
vi.mock('./AudioElementPlayer');
vi.mock('./SyncEngine');

// Mock cloud provider
const mockSynthesize = vi.fn();
const mockCloudProvider = {
  id: 'cloud-test',
  init: vi.fn().mockResolvedValue(undefined),
  getVoices: vi.fn().mockResolvedValue([]),
  synthesize: mockSynthesize,
  stop: vi.fn(),
};

describe('AudioPlayerService', () => {
  let service: AudioPlayerService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    // @ts-ignore
    AudioPlayerService.instance = undefined;

    // Mock TTSCache behavior
    // @ts-ignore
    TTSCache.prototype.generateKey = vi.fn().mockResolvedValue('test-key');
    // @ts-ignore
    TTSCache.prototype.get = vi.fn().mockResolvedValue(null);
    // @ts-ignore
    TTSCache.prototype.put = vi.fn().mockResolvedValue(undefined);

    // Mock AudioElementPlayer behavior
    // @ts-ignore
    AudioElementPlayer.prototype.playBlob = vi.fn().mockResolvedValue(undefined);
    // @ts-ignore
    AudioElementPlayer.prototype.setRate = vi.fn();
    // @ts-ignore
    AudioElementPlayer.prototype.setOnTimeUpdate = vi.fn();
    // @ts-ignore
    AudioElementPlayer.prototype.setOnEnded = vi.fn();
    // @ts-ignore
    AudioElementPlayer.prototype.setOnError = vi.fn();

    service = AudioPlayerService.getInstance();
  });

  it('should buffer next segments when using cloud provider', async () => {
    service.setProvider(mockCloudProvider);

    const queue = [
        { text: 'Sentence 1', cfi: 'cfi1' },
        { text: 'Sentence 2', cfi: 'cfi2' },
        { text: 'Sentence 3', cfi: 'cfi3' },
        { text: 'Sentence 4', cfi: 'cfi4' }
    ];

    service.setQueue(queue);

    // Mock successful synthesis for play
    const mockBlob = new Blob(['audio'], { type: 'audio/mp3' });
    // @ts-ignore
    mockBlob.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    mockSynthesize.mockResolvedValue({
        audio: mockBlob,
        alignment: [],
        isNative: false
    });

    await service.play();

    // Should play the first one
    expect(mockSynthesize).toHaveBeenCalledWith('Sentence 1', expect.any(String), expect.any(Number));

    // Should have buffered the next 2 (Sentence 2 and 3)
    // We expect 3 calls total: 1 for play, 2 for buffering
    // Wait a tick for async buffering to happen
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSynthesize).toHaveBeenCalledTimes(3);
    expect(mockSynthesize).toHaveBeenCalledWith('Sentence 2', expect.any(String), expect.any(Number));
    expect(mockSynthesize).toHaveBeenCalledWith('Sentence 3', expect.any(String), expect.any(Number));
    // Sentence 4 should not be buffered yet
    expect(mockSynthesize).not.toHaveBeenCalledWith('Sentence 4', expect.any(String), expect.any(Number));
  });

  it('should use cache if available', async () => {
      service.setProvider(mockCloudProvider);
      const queue = [{ text: 'Cached Sentence', cfi: 'cfi1' }];
      service.setQueue(queue);

      // Mock cache hit
      // @ts-ignore
      TTSCache.prototype.get.mockResolvedValueOnce({
          audio: new ArrayBuffer(0),
          alignment: [],
          createdAt: Date.now(),
          lastAccessed: Date.now()
      });

      await service.play();

      // Should check cache
      expect(TTSCache.prototype.get).toHaveBeenCalled();
      // Should NOT synthesize
      expect(mockSynthesize).not.toHaveBeenCalled();
      // Should play
      expect(AudioElementPlayer.prototype.playBlob).toHaveBeenCalled();
  });

  it('should not buffer if using WebSpeechProvider', async () => {
      // Default is WebSpeechProvider
      const queue = [
          { text: 'S1', cfi: 'cfi1' },
          { text: 'S2', cfi: 'cfi2' }
      ];
      service.setQueue(queue);

      const mockWebSynthesize = vi.fn();
      // @ts-ignore
      service.provider.synthesize = mockWebSynthesize;

      await service.play();

      expect(mockWebSynthesize).toHaveBeenCalledWith('S1', expect.any(String), expect.any(Number));

      // Should NOT buffer S2
      expect(mockWebSynthesize).not.toHaveBeenCalledWith('S2', expect.any(String), expect.any(Number));
  });
});
