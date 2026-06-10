import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiperProvider } from './PiperProvider';
import { piperGenerate } from './piper-utils';

vi.mock('./piper-utils', () => ({
    piperGenerate: vi.fn(),
    isModelPersisted: vi.fn(),
    deleteCachedModel: vi.fn(),
    fetchWithBackoff: vi.fn(),
    cacheModel: vi.fn(),
    stitchWavs: vi.fn(),
}));

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
  "zh_CN-huayan-medium": {
      key: "zh_CN-huayan-medium",
      name: "huayan",
      language: { code: "zh_CN" },
      quality: "medium",
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
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockVoicesJson
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should filter voices to only include single speaker en_US and zh_CN voices', async () => {
        await provider.init();
        const voices = await provider.getVoices();

        // Should include ryan
        expect(voices.find(v => v.id === 'piper:en_US-ryan-high')).toBeDefined();

        // Should include huayan (zh_CN)
        expect(voices.find(v => v.id === 'piper:zh_CN-huayan-medium')).toBeDefined();

        // Should NOT include kareem (wrong language)
        expect(voices.find(v => v.id.includes('kareem'))).toBeUndefined();

        // Should NOT include libritts (too many speakers)
        expect(voices.find(v => v.id.includes('libritts'))).toBeUndefined();

        // Should NOT include alan (en_GB - strictly following en_US request)
        expect(voices.find(v => v.id.includes('alan'))).toBeUndefined();
    });

    describe('regression: speed policy — synthesis always at 1.0', () => {
        it('should run WASM inference with identical arguments regardless of playback speed', async () => {
            await provider.init();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (piperGenerate as any).mockResolvedValue({ file: new Blob(['wav'], { type: 'audio/wav' }) });

            // @ts-expect-error - accessing protected
            await provider.fetchAudioData('Hello world.', { voiceId: 'piper:en_US-ryan-high', speed: 1.0 });
            // @ts-expect-error - accessing protected
            await provider.fetchAudioData('Hello world.', { voiceId: 'piper:en_US-ryan-high', speed: 2.5 });

            expect(piperGenerate).toHaveBeenCalledTimes(2);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const calls = (piperGenerate as any).mock.calls;
            // All args except the trailing progress callback must be identical:
            // the playback speed is applied at the audio sink, never at synthesis.
            expect(calls[0].slice(0, 8)).toEqual(calls[1].slice(0, 8));
        });
    });
});
