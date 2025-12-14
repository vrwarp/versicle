import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiperProvider } from './PiperProvider';

// Mock data representing a subset of voices.json
const mockVoicesJson = {
  "ar_JO-kareem-low": {
      key: "ar_JO-kareem-low",
      name: "kareem",
      language: { code: "ar_JO" },
      quality: "low",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "f.onnx": {}, "f.onnx.json": {} }
  },
  "en_US-ryan-high": {
      key: "en_US-ryan-high",
      name: "ryan",
      language: { code: "en_US" },
      quality: "high",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "f.onnx": {}, "f.onnx.json": {} }
  },
  "en_US-libritts-high": {
      key: "en_US-libritts-high",
      name: "libritts",
      language: { code: "en_US" },
      quality: "high",
      num_speakers: 904,
      speaker_id_map: { "p1": 0, "p2": 1 },
      files: { "f.onnx": {}, "f.onnx.json": {} }
  },
  "en_GB-alan-medium": {
      key: "en_GB-alan-medium",
      name: "alan",
      language: { code: "en_GB" },
      quality: "medium",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "f.onnx": {}, "f.onnx.json": {} }
  }
};

describe('PiperProvider Voice Filtering', () => {
    let provider: PiperProvider;

    beforeEach(() => {
        provider = new PiperProvider();
        // @ts-expect-error Mocking global fetch
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockVoicesJson
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should filter voices to only include single speaker en_US voices', async () => {
        await provider.init();
        const voices = await provider.getVoices();

        // Should include ryan
        expect(voices.find(v => v.id === 'piper:en_US-ryan-high')).toBeDefined();

        // Should NOT include kareem (wrong language)
        expect(voices.find(v => v.id.includes('kareem'))).toBeUndefined();

        // Should NOT include libritts (too many speakers)
        expect(voices.find(v => v.id.includes('libritts'))).toBeUndefined();

        // Should NOT include alan (en_GB - strictly following en_US request)
        expect(voices.find(v => v.id.includes('alan'))).toBeUndefined();
    });
});
