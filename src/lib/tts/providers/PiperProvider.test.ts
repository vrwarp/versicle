/**
 * PiperProvider unit suite (rewritten at 5a-PR3): the module-global piper-utils
 * died with the vendoring — the provider now drives an injectable PiperRuntime,
 * so this suite injects {@link FakePiperRuntime} instead of vi.mock (banned in
 * providers/). Covers voice filtering, the stale-while-revalidate catalog, the
 * OFFLINE voices enumeration (catalog unreachable + downloaded model ⇒ voice
 * listed and synthesizable), the transactional download, and the speed policy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiperProvider } from './PiperProvider';
import { FakePiperRuntime } from './FakePiperRuntime';
import { FakeAudioSink } from '../engine/FakeAudioSink';
import { InMemoryTTSCache } from './describeProviderContract';

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';

// Mock data representing a subset of voices.json
const mockVoicesJson = {
  "ar_JO-kareem-low": {
      key: "ar_JO-kareem-low",
      name: "kareem",
      language: { code: "ar_JO" },
      quality: "low",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "ar/ar_JO/kareem/low/ar_JO-kareem-low.onnx": {}, "ar/ar_JO/kareem/low/ar_JO-kareem-low.onnx.json": {} }
  },
  "zh_CN-huayan-medium": {
      key: "zh_CN-huayan-medium",
      name: "huayan",
      language: { code: "zh_CN" },
      quality: "medium",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx": {}, "zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json": {} }
  },
  "en_US-ryan-high": {
      key: "en_US-ryan-high",
      name: "ryan",
      language: { code: "en_US" },
      quality: "high",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "en/en_US/ryan/high/en_US-ryan-high.onnx": {}, "en/en_US/ryan/high/en_US-ryan-high.onnx.json": {} }
  },
  "en_US-libritts-high": {
      key: "en_US-libritts-high",
      name: "libritts",
      language: { code: "en_US" },
      quality: "high",
      num_speakers: 904,
      speaker_id_map: { "p1": 0, "p2": 1 },
      files: { "en/en_US/libritts/high/en_US-libritts-high.onnx": {}, "en/en_US/libritts/high/en_US-libritts-high.onnx.json": {} }
  },
  "en_GB-alan-medium": {
      key: "en_GB-alan-medium",
      name: "alan",
      language: { code: "en_GB" },
      quality: "medium",
      num_speakers: 1,
      speaker_id_map: {},
      files: { "en/en_GB/alan/medium/en_GB-alan-medium.onnx": {}, "en/en_GB/alan/medium/en_GB-alan-medium.onnx.json": {} }
  }
};

describe('PiperProvider', () => {
    let provider: PiperProvider;
    let runtime: FakePiperRuntime;

    function makeProvider(): PiperProvider {
        runtime = new FakePiperRuntime();
        return new PiperProvider('en', new FakeAudioSink(), new InMemoryTTSCache(), runtime.asRuntime());
    }

    beforeEach(() => {
        provider = makeProvider();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(mockVoicesJson),
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

    describe('offline catalog (5a-PR3)', () => {
        it('serves the catalog stale-while-revalidate from the cache when the network is down', async () => {
            runtime.catalogJson = mockVoicesJson;
            global.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));

            await provider.init();
            const voices = await provider.getVoices();

            expect(voices.find(v => v.id === 'piper:en_US-ryan-high')).toBeDefined();
        });

        it('caches a fresh catalog for the next offline init', async () => {
            await provider.init();
            expect(runtime.catalogJson).toEqual(mockVoicesJson);
        });

        it('OFFLINE + cold catalog: downloaded voices are enumerated from the model cache and stay synthesizable', async () => {
            const modelUrl = `${HF_BASE}en/en_US/ryan/high/en_US-ryan-high.onnx`;
            runtime.downloadedModelUrls = [modelUrl];
            global.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));

            await provider.init();
            const voices = await provider.getVoices();

            const voice = voices.find(v => v.id === 'piper:en_US-ryan-high');
            expect(voice).toBeDefined();
            expect(voice!.lang).toBe('en-US');

            // …and 'Voice not found' can no longer hit a downloaded voice:
            // @ts-expect-error - accessing protected
            const segment = await provider.fetchAudioData('Hello offline.', { voiceId: 'piper:en_US-ryan-high', speed: 1.0 });
            expect(segment.audio).toBeInstanceOf(Blob);
            expect(runtime.generated[0]).toMatchObject({ modelUrl, configUrl: `${modelUrl}.json` });
        });
    });

    describe('transactional download (keeper) + awaited deletes (D17)', () => {
        it('stages, commits (awaited), then verifies with a model load', async () => {
            await provider.init();
            // Stage fetches return blobs
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: async () => new Blob(['model-bytes']),
            });

            await provider.downloadVoice('piper:en_US-ryan-high');

            const modelUrl = `${HF_BASE}en/en_US/ryan/high/en_US-ryan-high.onnx`;
            expect(runtime.savedModels.has(modelUrl)).toBe(true);
            expect(runtime.savedModels.has(`${modelUrl}.json`)).toBe(true);
            // Verification load ran through the runtime with empty input.
            expect(runtime.generated.at(-1)).toMatchObject({ text: '', modelUrl });
        });

        it('rolls back the cache when verification fails', async () => {
            await provider.init();
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: async () => new Blob(['model-bytes']),
            });
            vi.spyOn(console, 'error').mockImplementation(() => {});
            runtime.failNextGenerate = new Error('corrupt model');

            await expect(provider.downloadVoice('piper:en_US-ryan-high')).rejects.toThrow('corrupt model');

            const modelUrl = `${HF_BASE}en/en_US/ryan/high/en_US-ryan-high.onnx`;
            expect(runtime.deletedModels).toContainEqual([modelUrl, `${modelUrl}.json`]);
            expect(runtime.savedModels.has(modelUrl)).toBe(false);
        });

        it('deleteVoice awaits the cache delete', async () => {
            await provider.init();
            await provider.deleteVoice('piper:en_US-ryan-high');
            const modelUrl = `${HF_BASE}en/en_US/ryan/high/en_US-ryan-high.onnx`;
            expect(runtime.deletedModels).toContainEqual([modelUrl, `${modelUrl}.json`]);
        });
    });

    it('dispose() tears the runtime down with the provider', async () => {
        provider.dispose();
        expect(runtime.disposed).toBe(true);
    });

    describe('regression: speed policy — synthesis always at 1.0', () => {
        it('issues identical generate requests regardless of playback speed (no speed field exists)', async () => {
            await provider.init();

            // @ts-expect-error - accessing protected
            await provider.fetchAudioData('Hello world.', { voiceId: 'piper:en_US-ryan-high', speed: 1.0 });
            // @ts-expect-error - accessing protected
            await provider.fetchAudioData('Hello world.', { voiceId: 'piper:en_US-ryan-high', speed: 2.5 });

            expect(runtime.generated.length).toBe(2);
            const [first, second] = runtime.generated;
            // All request fields except the progress callback must be identical:
            // the playback speed is applied at the audio sink, never at synthesis —
            // and the request type has no speed field at all, by construction.
            const strip = (req: typeof first) => {
                const { onProgress, ...rest } = req;
                void onProgress;
                return rest;
            };
            expect(strip(first)).toEqual(strip(second));
            expect(JSON.stringify(strip(first))).not.toContain('2.5');
        });
    });
});
