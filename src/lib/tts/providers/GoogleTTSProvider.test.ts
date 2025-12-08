import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { GoogleTTSProvider } from './GoogleTTSProvider';

describe('GoogleTTSProvider', () => {
  let provider: GoogleTTSProvider;

  beforeEach(() => {
    provider = new GoogleTTSProvider('test-api-key');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set api key if provided', () => {
      const p = new GoogleTTSProvider('key-1');
      // @ts-expect-error - accessing private field
      expect(p.apiKey).toBe('key-1');
    });
  });

  describe('setApiKey', () => {
    it('should update api key', () => {
      provider.setApiKey('new-key');
      // @ts-expect-error - accessing private field
      expect(provider.apiKey).toBe('new-key');
    });
  });

  describe('init', () => {
    it('should return if no api key', async () => {
      const p = new GoogleTTSProvider();
      await p.init();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch voices if api key is present', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          voices: [
            { name: 'en-US-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['en-US'] }
          ]
        })
      });

      await provider.init();

      expect(global.fetch).toHaveBeenCalledWith('https://texttospeech.googleapis.com/v1/voices?key=test-api-key');
      const voices = await provider.getVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0].id).toBe('en-US-Standard-A');
    });

    it('should handle fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error'
      });

      await provider.init();

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('getVoices', () => {
    it('should fetch voices if not already loaded and api key exists', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          voices: [
            { name: 'en-US-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['en-US'] }
          ]
        })
      });

      const voices = await provider.getVoices();
      expect(global.fetch).toHaveBeenCalled();
      expect(voices).toHaveLength(1);
    });

    it('should return cached voices if already loaded', async () => {
       (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          voices: [
            { name: 'en-US-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['en-US'] }
          ]
        })
      });
      await provider.init(); // loads voices
      (global.fetch as Mock).mockClear();

      const voices = await provider.getVoices();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(voices).toHaveLength(1);
    });
  });

  describe('synthesize', () => {
    it('should throw if api key is missing', async () => {
      provider.setApiKey('');
      // @ts-expect-error - forcing null
      provider.apiKey = null;
      await expect(provider.synthesize('text', 'voice-id', 1)).rejects.toThrow('Google Cloud API Key is missing');
    });

    it('should call api and return audio and alignment', async () => {
      const audioContent = 'SGVsbG8='; // "Hello" in base64
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          audioContent: audioContent,
          timepoints: [
            { timeSeconds: 0.1, markName: 'M1' }
          ]
        })
      });

      const result = await provider.synthesize('Hello', 'en-US-Standard-A', 1.0);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=test-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            input: { text: 'Hello' },
            voice: { name: 'en-US-Standard-A', languageCode: 'en-US' },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: 1.0,
            },
            enableTimepointing: ["SSML_MARK"]
          })
        })
      );

      expect(result.audio).toBeInstanceOf(Blob);
      // "Hello" is 5 bytes.
      expect(result.audio.size).toBe(5);
      expect(result.alignment).toHaveLength(1);
      expect(result.alignment![0].timeSeconds).toBe(0.1);
    });

    it('should handle api error', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Some error'),
      });

      await expect(provider.synthesize('text', 'voice-id', 1)).rejects.toThrow('Google TTS Synthesis Error: 500 Some error');
    });
  });
});
