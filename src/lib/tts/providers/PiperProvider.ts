import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, TTSVoice, SpeechSegment } from './types';
import { piperGenerate, isModelCached, deleteCachedModel } from './piper-utils';

const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
const PIPER_ASSETS_BASE = "/piper/";

interface PiperVoiceInfo {
  key: string;
  name: string;
  language: {
    code: string;
    family: string;
    region: string;
    name_native: string;
    name_english: string;
  };
  quality: string;
  num_speakers: number;
  speaker_id_map: Record<string, number>;
  files: Record<string, { size_bytes: number; md5_digest: string }>;
}

export class PiperProvider extends BaseCloudProvider {
  id = 'piper';
  private voiceMap: Map<string, { modelPath: string; configPath: string; speakerId?: number }> = new Map();

  async init(): Promise<void> {
    try {
      const response = await fetch(`${HF_BASE}voices.json`);
      if (!response.ok) throw new Error('Failed to fetch Piper voices list');
      const data: Record<string, PiperVoiceInfo> = await response.json();

      const voices: TTSVoice[] = [];

      for (const [key, info] of Object.entries(data)) {
        // Filter for high quality en_US voices (single speaker preferred)
        // This avoids listing hundreds of voices and focuses on the best ones like Ryan.
        if (!key.startsWith('en_US')) continue;
        if (info.num_speakers > 1) continue;

        const fileKeys = Object.keys(info.files);
        const onnxFile = fileKeys.find(f => f.endsWith('.onnx'));
        const jsonFile = fileKeys.find(f => f.endsWith('.onnx.json'));

        if (!onnxFile || !jsonFile) continue;

        const voiceId = `piper:${key}`;
        const name = `${info.name} - ${info.quality}`;

        this.voiceMap.set(voiceId, {
          modelPath: onnxFile,
          configPath: jsonFile,
          speakerId: 0
        });

        voices.push({
          id: voiceId,
          name: name,
          lang: info.language.code,
          provider: 'piper'
        });
      }

      this.voices = voices;
    } catch (e) {
      console.error('Failed to init Piper provider', e);
    }
  }

  async isVoiceDownloaded(voiceId: string): Promise<boolean> {
    const voiceInfo = this.voiceMap.get(voiceId);
    if (!voiceInfo) return false;
    const modelUrl = HF_BASE + voiceInfo.modelPath;
    return isModelCached(modelUrl);
  }

  async deleteVoice(voiceId: string): Promise<void> {
    const voiceInfo = this.voiceMap.get(voiceId);
    if (!voiceInfo) return;

    const modelUrl = HF_BASE + voiceInfo.modelPath;
    const modelConfigUrl = HF_BASE + voiceInfo.configPath;

    deleteCachedModel(modelUrl, modelConfigUrl);
    this.emit({ type: 'download-progress', percent: 0, status: 'Not Downloaded', voiceId });
  }

  async downloadVoice(voiceId: string): Promise<void> {
    const voiceInfo = this.voiceMap.get(voiceId);
    if (!voiceInfo) throw new Error(`Voice ${voiceId} not found`);

    if (await this.isVoiceDownloaded(voiceId)) {
      this.emit({ type: 'download-progress', percent: 100, status: 'Ready', voiceId });
      return;
    }

    this.emit({ type: 'download-progress', percent: 0, status: 'Starting download...', voiceId });

    const modelUrl = HF_BASE + voiceInfo.modelPath;
    const modelConfigUrl = HF_BASE + voiceInfo.configPath;

    try {
      await piperGenerate(
        PIPER_ASSETS_BASE + 'piper_phonemize.js',
        PIPER_ASSETS_BASE + 'piper_phonemize.wasm',
        PIPER_ASSETS_BASE + 'piper_phonemize.data',
        PIPER_ASSETS_BASE + 'piper_worker.js',
        modelUrl,
        modelConfigUrl,
        voiceInfo.speakerId,
        "",
        (progress) => {
          this.emit({ type: 'download-progress', percent: progress, status: 'Downloading...', voiceId });
        }
      );
      this.emit({ type: 'download-progress', percent: 100, status: 'Ready', voiceId });
    } catch (e) {
      this.emit({ type: 'error', error: e });
      this.emit({ type: 'download-progress', percent: 0, status: 'Failed', voiceId });
      throw e;
    }
  }

  protected async fetchAudioData(text: string, options: TTSOptions): Promise<SpeechSegment> {
    const voiceInfo = this.voiceMap.get(options.voiceId);
    if (!voiceInfo) {
      throw new Error(`Voice ${options.voiceId} not found`);
    }

    const modelUrl = HF_BASE + voiceInfo.modelPath;
    const modelConfigUrl = HF_BASE + voiceInfo.configPath;

    const result = await piperGenerate(
      PIPER_ASSETS_BASE + 'piper_phonemize.js',
      PIPER_ASSETS_BASE + 'piper_phonemize.wasm',
      PIPER_ASSETS_BASE + 'piper_phonemize.data',
      PIPER_ASSETS_BASE + 'piper_worker.js',
      modelUrl,
      modelConfigUrl,
      voiceInfo.speakerId,
      text,
      (progress) => {
        this.emit({ type: 'download-progress', percent: progress, status: 'Downloading...', voiceId: options.voiceId });
      }
    );

    const audioBlob = await fetch(result.file).then(r => r.blob());

    return {
      audio: audioBlob,
      isNative: false
    };
  }
}
