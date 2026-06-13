import { egress } from '@kernel/net';
import { BaseCloudProvider } from './BaseCloudProvider';
import { toTTSErrorPayload } from './types';
import type { TTSOptions, TTSVoice, SpeechSegment } from './types';
import type { AudioSink } from '../engine/AudioSink';
import type { TTSCache } from '../TTSCache';
import { PiperRuntime, fetchWithBackoff, stitchWavs } from './PiperRuntime';
import { TextSegmenter } from '../TextSegmenter';

const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
const VOICES_CATALOG_URL = `${HF_BASE}voices.json`;

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

function splitLongSentence(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let currentText = text;

    while (currentText.length > maxLen) {
        let splitIndex = -1;

        // 1. Clause Boundary Scan
        const clauseRegex = /[,;:—–，；：、。！？]/g;
        let match;
        const searchChunk = currentText.substring(0, maxLen);
        while ((match = clauseRegex.exec(searchChunk)) !== null) {
            if (match[0].length === 0) {
                clauseRegex.lastIndex++;
                continue;
            }

            splitIndex = match.index + 1; // Inclusive of punctuation
        }

        // 2. Lexical Boundary Scan
        if (splitIndex === -1) {
            splitIndex = currentText.lastIndexOf(' ', maxLen);
        }

        // 3. Pathological Hard Split
        if (splitIndex <= 0) {
            splitIndex = maxLen;
        }

        chunks.push(currentText.substring(0, splitIndex).trim());
        currentText = currentText.substring(splitIndex).trim();
    }

    if (currentText) {
        chunks.push(currentText);
    }

    return chunks;
}

export class PiperProvider extends BaseCloudProvider {
  id = 'piper';
  private voiceMap: Map<string, { modelUrl: string; configUrl: string; speakerId?: number }> = new Map();
  private segmenter: TextSegmenter;
  private readonly runtime: PiperRuntime;

  /**
   * @param runtime The Piper WASM runtime (worker + model store). Injectable so the
   *   provider contract suite drives a fake; defaults to the production runtime on
   *   the vendored same-origin `/piper/**` assets (5a-PR3).
   */
  constructor(locale?: string, audioSink?: AudioSink, cache?: TTSCache, runtime?: PiperRuntime) {
    super(audioSink, cache);
    this.segmenter = new TextSegmenter(locale);
    this.runtime = runtime ?? new PiperRuntime();
  }

  setLocale(locale: string) {
    this.segmenter = new TextSegmenter(locale);
  }

  /**
   * Voice catalog with offline support (5a-PR3):
   *  1. The HuggingFace voices.json is cached stale-while-revalidate in the model
   *     cache — a cached catalog is served immediately and refreshed in the
   *     background for the next init.
   *  2. If NO catalog is reachable (offline with a cold catalog cache), locally
   *     downloaded voices are enumerated from the model store, so a downloaded
   *     voice is always listed and synthesizable — `fetchAudioData` can no longer
   *     throw 'Voice not found' for it.
   */
  async init(): Promise<void> {
    try {
      const catalog = await this.loadVoicesCatalog();
      if (catalog) {
        this.applyCatalog(catalog);
        return;
      }
      this.voices = await this.enumerateDownloadedVoices();
    } catch (e) {
      console.error('Failed to init Piper provider', e);
    }
  }

  /** Cached-first (stale-while-revalidate), network fallback, null when offline. */
  private async loadVoicesCatalog(): Promise<Record<string, PiperVoiceInfo> | null> {
    const cached = await this.runtime.cacheMatch(VOICES_CATALOG_URL);
    if (cached) {
      // Serve stale now; refresh in the background.
      void this.refreshVoicesCatalog().catch(() => { /* offline refresh is fine */ });
      try {
        return await cached.clone().json();
      } catch {
        // Corrupt cache entry — fall through to the network.
      }
    }
    try {
      return await this.refreshVoicesCatalog();
    } catch {
      return null;
    }
  }

  private async refreshVoicesCatalog(): Promise<Record<string, PiperVoiceInfo>> {
    // 'hf-piper-catalog' is offline:'cache-fallback' — NET_OFFLINE rejects here
    // and loadVoicesCatalog() serves the Cache API copy (the caller contract).
    const response = await egress('hf-piper-catalog', VOICES_CATALOG_URL);
    if (!response.ok) throw new Error('Failed to fetch Piper voices list');
    const text = await response.text();
    await this.runtime.cachePut(VOICES_CATALOG_URL, new Response(text, {
      headers: { 'Content-Type': 'application/json' },
    })).catch(() => { /* best-effort catalog cache */ });
    return JSON.parse(text);
  }

  private applyCatalog(data: Record<string, PiperVoiceInfo>): void {
    const voices: TTSVoice[] = [];

    for (const [key, info] of Object.entries(data)) {
      // Filter for high quality en_US voices (single speaker preferred)
      // This avoids listing hundreds of voices and focuses on the best ones like Ryan.
      if (!key.startsWith('en_US') && !key.startsWith('zh_CN')) continue;
      if (info.num_speakers > 1) continue;

      const fileKeys = Object.keys(info.files);
      const onnxFile = fileKeys.find(f => f.endsWith('.onnx'));
      const jsonFile = fileKeys.find(f => f.endsWith('.onnx.json'));

      if (!onnxFile || !jsonFile) continue;

      const voiceId = `piper:${key}`;
      const name = `${info.name} - ${info.quality}`;

      this.voiceMap.set(voiceId, {
        modelUrl: HF_BASE + onnxFile,
        configUrl: HF_BASE + jsonFile,
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
  }

  /**
   * Offline fallback: rebuild voice entries from the downloaded models in the
   * Cache API store (keys are the legacy HuggingFace URLs ending
   * `…/{family}/{lang}/{name}/{quality}/{lang}-{name}-{quality}.onnx`).
   */
  private async enumerateDownloadedVoices(): Promise<TTSVoice[]> {
    const modelUrls = await this.runtime.listDownloadedModelUrls();
    const voices: TTSVoice[] = [];

    for (const modelUrl of modelUrls) {
      const fileName = modelUrl.split('/').pop() ?? '';
      const key = fileName.replace(/\.onnx$/, '');
      if (!key) continue;

      const voiceId = `piper:${key}`;
      if (this.voiceMap.has(voiceId)) continue;

      const [langCode, name = key, quality = ''] = key.split('-');
      this.voiceMap.set(voiceId, {
        modelUrl,
        configUrl: `${modelUrl}.json`,
        speakerId: 0,
      });
      voices.push({
        id: voiceId,
        name: quality ? `${name} - ${quality} (downloaded)` : `${name} (downloaded)`,
        lang: (langCode || 'en').replace('_', '-'),
        provider: 'piper',
      });
    }

    return voices;
  }

  async isVoiceDownloaded(voiceId: string): Promise<boolean> {
    const voiceInfo = this.voiceMap.get(voiceId);
    if (!voiceInfo) return false;
    return this.runtime.isModelDownloaded(voiceInfo.modelUrl);
  }

  async deleteVoice(voiceId: string): Promise<void> {
    const voiceInfo = this.voiceMap.get(voiceId);
    if (!voiceInfo) return;

    // Awaited delete (the old fire-and-forget cache delete raced re-downloads).
    await this.runtime.deleteModel(voiceInfo.modelUrl, voiceInfo.configUrl);
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

    const { modelUrl, configUrl } = voiceInfo;

    try {
      // Phase 2 Hardening: Transactional Download (keeper, preserved verbatim)
      // 1. Download files to memory first (Staging)
      this.emit({ type: 'download-progress', percent: 10, status: 'Downloading Model...', voiceId });
      const [modelBlob, configBlob] = await Promise.all([
        fetchWithBackoff(modelUrl),
        fetchWithBackoff(configUrl)
      ]);

      this.emit({ type: 'download-progress', percent: 50, status: 'Verifying...', voiceId });

      // 2. Commit to Cache — awaited (the old write was fire-and-forget).
      await this.runtime.saveModel(modelUrl, modelBlob);
      await this.runtime.saveModel(configUrl, configBlob);

      // 3. Integrity Check (Test Load): empty input triggers a model load.
      await this.runtime.generate({
        text: "",
        modelUrl,
        configUrl,
        speakerId: voiceInfo.speakerId,
      });

      this.emit({ type: 'download-progress', percent: 100, status: 'Ready', voiceId });
    } catch (e) {
      console.error("Voice download failed:", e);
      // Rollback: clear any partial cache
      await this.runtime.deleteModel(modelUrl, configUrl).catch(() => {});

      this.emit({ type: 'error', error: toTTSErrorPayload(e) });
      this.emit({ type: 'download-progress', percent: 0, status: 'Failed', voiceId });
      throw e;
    }
  }

  override dispose(): void {
    this.runtime.dispose();
    super.dispose();
  }

  protected async fetchAudioData(text: string, options: TTSOptions): Promise<SpeechSegment> {
    const voiceInfo = this.voiceMap.get(options.voiceId);
    if (!voiceInfo) {
      throw new Error(`Voice ${options.voiceId} not found`);
    }

    const { modelUrl, configUrl } = voiceInfo;

    // Phase 3 Hardening: Input Sanitization
    // Split long requests to prevent worker crashes
    // Chinese characters are semantically denser; use smaller chunks to prevent OOM
    const isCJK = /[一-鿿]/.test(text);
    const MAX_CHARS = isCJK ? 100 : 500;

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
         if (!segment.trim()) continue;

         // Double-check length; if a single sentence is huge, we must split it.
         // This is a safety fallback if TextSegmenter returns a giant chunk.
         const subSegments = splitLongSentence(segment, MAX_CHARS);

         for (const subSegment of subSegments) {
            const result = await this.runtime.generate({
                text: subSegment,
                modelUrl,
                configUrl,
                speakerId: voiceInfo.speakerId,
                onProgress: (progress) => {
                    // Weighted progress: (completed segments + current segment progress) / total segments
                    const currentSegmentProgress = progress / 100;
                    const totalProgress = ((completedSegments + currentSegmentProgress) / totalSegments) * 100;
                    this.emit({ type: 'download-progress', percent: Math.round(totalProgress), status: 'Downloading...', voiceId: options.voiceId });
                }
            });
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
      audio: audioBlob
    };
  }
}
