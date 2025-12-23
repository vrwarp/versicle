import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, TTSVoice, SpeechSegment } from './types';
import { piperGenerate, isModelPersisted, deleteCachedModel, fetchWithBackoff, cacheModel, stitchWavs } from './piper-utils';
import { TextSegmenter } from '../TextSegmenter';

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
  private segmenter: TextSegmenter;

  constructor() {
    super();
    this.segmenter = new TextSegmenter();
  }

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
    return isModelPersisted(modelUrl);
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
      // Phase 2 Hardening: Transactional Download
      // 1. Download files to memory first (Staging)
      this.emit({ type: 'download-progress', percent: 10, status: 'Downloading Model...', voiceId });
      const [modelBlob, configBlob] = await Promise.all([
        fetchWithBackoff(modelUrl),
        fetchWithBackoff(modelConfigUrl)
      ]);

      this.emit({ type: 'download-progress', percent: 50, status: 'Verifying...', voiceId });

      // 2. Commit to Cache
      cacheModel(modelUrl, modelBlob);
      cacheModel(modelConfigUrl, configBlob);

      // 3. Integrity Check (Test Load)
      await piperGenerate(
        PIPER_ASSETS_BASE + 'piper_phonemize.js',
        PIPER_ASSETS_BASE + 'piper_phonemize.wasm',
        PIPER_ASSETS_BASE + 'piper_phonemize.data',
        PIPER_ASSETS_BASE + 'piper_worker.js',
        modelUrl,
        modelConfigUrl,
        voiceInfo.speakerId,
        "", // Empty input to trigger load
        () => {
             // Ignoring progress from worker during verification as we already have blobs
        }
      );

      this.emit({ type: 'download-progress', percent: 100, status: 'Ready', voiceId });
    } catch (e) {
      console.error("Voice download failed:", e);
      // Rollback: clear any partial cache
      deleteCachedModel(modelUrl, modelConfigUrl);

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

    // Phase 3 Hardening: Input Sanitization
    // Split long requests to prevent worker crashes
    const MAX_CHARS = 500;

    let segments: string[] = [];
    if (text.length > MAX_CHARS) {
       // Use TextSegmenter to split safely
       const sentences = this.segmenter.segment(text);
       let currentChunk = "";
       for (const sentence of sentences) {
           if (currentChunk.length + sentence.text.length > MAX_CHARS) {
               if (currentChunk) segments.push(currentChunk);
               currentChunk = sentence.text;
           } else {
               currentChunk += sentence.text;
           }
       }
       if (currentChunk) segments.push(currentChunk);
    } else {
        segments = [text];
    }

    const audioBlobs: Blob[] = [];

    // Process segments sequentially
    let completedSegments = 0;
    const totalSegments = segments.length;

    for (const segment of segments) {
         if (options.signal?.aborted) throw new Error('Aborted');
         if (!segment.trim()) continue;

         // Double-check length; if a single sentence is huge, we must split it hard.
         // This is a safety fallback if TextSegmenter returns a giant chunk.
         const subSegments = segment.length > MAX_CHARS ? segment.match(new RegExp(`.{1,${MAX_CHARS}}`, 'g')) || [segment] : [segment];

         for (const subSegment of subSegments) {
            if (options.signal?.aborted) throw new Error('Aborted');
            const result = await piperGenerate(
                PIPER_ASSETS_BASE + 'piper_phonemize.js',
                PIPER_ASSETS_BASE + 'piper_phonemize.wasm',
                PIPER_ASSETS_BASE + 'piper_phonemize.data',
                PIPER_ASSETS_BASE + 'piper_worker.js',
                modelUrl,
                modelConfigUrl,
                voiceInfo.speakerId,
                subSegment,
                (progress) => {
                    // Weighted progress: (completed segments + current segment progress) / total segments
                    const currentSegmentProgress = progress / 100;
                    const totalProgress = ((completedSegments + currentSegmentProgress) / totalSegments) * 100;
                    this.emit({ type: 'download-progress', percent: Math.round(totalProgress), status: 'Downloading...', voiceId: options.voiceId });
                }
            );
            audioBlobs.push(result.file);
         }
         completedSegments++;
    }

    // Stitch blobs if needed
    let audioBlob: Blob;
    if (audioBlobs.length === 1) {
        audioBlob = audioBlobs[0];
    } else {
        audioBlob = await stitchWavs(audioBlobs);
    }

    return {
      audio: audioBlob,
      isNative: false
    };
  }
}
