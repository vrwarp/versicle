import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Mock the Capacitor plugin
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: {
    getSupportedVoices: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn(),
  },
}));

describe('CapacitorTTSProvider', () => {
  let provider: CapacitorTTSProvider;

  beforeEach(() => {
    provider = new CapacitorTTSProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init', () => {
      it('should pre-fetch voices', async () => {
          // @ts-ignore
          vi.mocked(TextToSpeech.getSupportedVoices).mockResolvedValue({ voices: [] });
          await provider.init();
          expect(TextToSpeech.getSupportedVoices).toHaveBeenCalled();
      });
  });

  describe('getVoices', () => {
    it('should return mapped voices on success', async () => {
      const mockVoices = {
        voices: [
          { voiceURI: 'voice1', name: 'Voice One', lang: 'en-US', default: true },
          { voiceURI: 'voice2', name: 'Voice Two', lang: 'es-ES', default: false },
        ],
      };
      // @ts-ignore - vitest mock typing
      vi.mocked(TextToSpeech.getSupportedVoices).mockResolvedValue(mockVoices);

      const voices = await provider.getVoices();

      expect(TextToSpeech.getSupportedVoices).toHaveBeenCalled();
      expect(voices).toEqual([
        { id: 'voice1', name: 'Voice One', lang: 'en-US', provider: 'local' },
        { id: 'voice2', name: 'Voice Two', lang: 'es-ES', provider: 'local' },
      ]);
    });

    it('should return empty array on failure', async () => {
      // @ts-ignore
      vi.mocked(TextToSpeech.getSupportedVoices).mockRejectedValue(new Error('Native error'));

      const voices = await provider.getVoices();

      expect(voices).toEqual([]);
    });
  });

  describe('synthesize', () => {
    it('should use the correct language from the selected voice', async () => {
        // Setup voices
        const mockVoices = {
          voices: [
            { voiceURI: 'voice-es', name: 'Spanish Voice', lang: 'es-ES', default: false },
          ],
        };
        // @ts-ignore
        vi.mocked(TextToSpeech.getSupportedVoices).mockResolvedValue(mockVoices);
        await provider.getVoices(); // Populate cache

        // @ts-ignore
        vi.mocked(TextToSpeech.speak).mockResolvedValue(undefined);

        const text = 'Hola';
        const voiceId = 'voice-es';
        const speed = 1.0;

        await provider.synthesize(text, voiceId, speed);

        expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
          text,
          lang: 'es-ES',
          rate: speed,
        }));
      });

    it('should default to en-US if voice not found', async () => {
      // @ts-ignore
      vi.mocked(TextToSpeech.speak).mockResolvedValue(undefined);

      const text = 'Hello';
      const voiceId = 'unknown-voice';
      const speed = 1.0;

      await provider.synthesize(text, voiceId, speed);

      expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        lang: 'en-US',
      }));
    });

    it('should call TextToSpeech.speak with correct params', async () => {
      // @ts-ignore
      vi.mocked(TextToSpeech.speak).mockResolvedValue(undefined);

      const text = 'Hello world';
      const voiceId = 'voice1';
      const speed = 1.2;

      const result = await provider.synthesize(text, voiceId, speed);

      expect(TextToSpeech.speak).toHaveBeenCalledWith({
        text,
        lang: 'en-US',
        rate: speed,
        category: 'playback',
        queueStrategy: 1,
      });
      expect(result).toEqual({ isNative: true });
    });

    it('should throw if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(provider.synthesize('test', 'voice1', 1, controller.signal))
        .rejects.toThrow('Aborted');

      expect(TextToSpeech.speak).not.toHaveBeenCalled();
    });
  });

  describe('playback controls', () => {
    it('stop should call TextToSpeech.stop', async () => {
      // @ts-ignore
      vi.mocked(TextToSpeech.stop).mockResolvedValue(undefined);
      await provider.stop();
      expect(TextToSpeech.stop).toHaveBeenCalled();
    });

    it('pause should call TextToSpeech.stop', async () => {
        // @ts-ignore
        vi.mocked(TextToSpeech.stop).mockResolvedValue(undefined);
        await provider.pause();
        expect(TextToSpeech.stop).toHaveBeenCalled();
    });
  });
});
