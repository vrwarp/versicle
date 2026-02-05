import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { LemonFoxProvider } from './LemonFoxProvider';
import type { TTSOptions } from './types';
import type { IAudioPlayer } from '../IAudioPlayer';

vi.mock('../AudioElementPlayer');
vi.mock('../TTSCache');
vi.mock('../CostEstimator');

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

describe('LemonFoxProvider', () => {
  let provider: LemonFoxProvider;
  let mockAudioPlayer: IAudioPlayer;

  beforeEach(() => {
    mockAudioPlayer = createMockAudioPlayer();
    provider = new LemonFoxProvider(mockAudioPlayer, 'test-api-key');
    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set api key if provided', () => {
      const p = new LemonFoxProvider(mockAudioPlayer, 'key-1');
      // @ts-expect-error - accessing private field for test
      expect(p.apiKey).toBe('key-1');
    });

    it('should not set api key if not provided', () => {
      const p = new LemonFoxProvider(mockAudioPlayer);
      // @ts-expect-error - accessing private field for test
      expect(p.apiKey).toBeNull();
    });
  });

  describe('setApiKey', () => {
    it('should update api key', () => {
      provider.setApiKey('new-key');
      // @ts-expect-error - accessing private field for test
      expect(provider.apiKey).toBe('new-key');
    });
  });

  describe('init', () => {
    it('should do nothing', async () => {
      await expect(provider.init()).resolves.toBeUndefined();
    });
  });

  describe('getVoices', () => {
    it('should return static list of voices', async () => {
      const voices = await provider.getVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].provider).toBe('lemonfox');
      expect(voices.find(v => v.id === 'heart')).toBeDefined();
    });
  });

  describe('fetchAudioData', () => {
    const options: TTSOptions = { voiceId: 'heart', speed: 1.0 };

    it('should throw if api key is missing', async () => {
      provider.setApiKey('');
      // @ts-expect-error - forcing null for test
      provider.apiKey = null;
      // @ts-expect-error - protected
      await expect(provider.fetchAudioData('text', options)).rejects.toThrow('LemonFox API Key missing');
    });

    it('should call lemonfox api and return audio', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mp3' });
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      // @ts-expect-error - protected
      const result = await provider.fetchAudioData('Hello world', options);

      expect(global.fetch).toHaveBeenCalledWith('https://api.lemonfox.ai/v1/audio/speech', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          input: 'Hello world',
          voice: 'heart',
          speed: 1.0,
          response_format: 'mp3'
        })
      }));

      expect(result).toEqual({
        audio: mockBlob,
        isNative: false,
        alignment: undefined
      });
    });

    it('should handle api error', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });
      // @ts-expect-error - protected
      await expect(provider.fetchAudioData('text', options)).rejects.toThrow('TTS API Error: 401 Unauthorized');
    });
  });
});
