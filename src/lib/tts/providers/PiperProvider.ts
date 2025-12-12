import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, TTSVoice, SpeechSegment } from './types';
import { piperGenerate } from './piper-utils';

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
        const fileKeys = Object.keys(info.files);
        const onnxFile = fileKeys.find(f => f.endsWith('.onnx'));
        const jsonFile = fileKeys.find(f => f.endsWith('.onnx.json'));

        if (!onnxFile || !jsonFile) continue;

        if (info.num_speakers > 1) {
          for (const [speakerName, speakerId] of Object.entries(info.speaker_id_map)) {
             const voiceId = `piper:${key}:${speakerId}`;
             const name = `${info.name} (${speakerName}) - ${info.quality}`;

             this.voiceMap.set(voiceId, {
               modelPath: onnxFile,
               configPath: jsonFile,
               speakerId: speakerId
             });

             voices.push({
               id: voiceId,
               name: name,
               lang: info.language.code,
               provider: 'piper'
             });
          }
        } else {
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
      }

      this.voices = voices;
    } catch (e) {
      console.error('Failed to init Piper provider', e);
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
      () => {
        // Optional: emit progress
      }
    );

    const audioBlob = await fetch(result.file).then(r => r.blob());

    return {
      audio: audioBlob,
      isNative: false
    };
  }
}
