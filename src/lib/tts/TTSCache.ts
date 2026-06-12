import { audioCache } from '@data/repos/audioCache';
import type { CacheAudioBlob } from '~types/cache';
import type { Timepoint } from './providers/types';

/**
 * Handles caching of synthesized audio segments to IndexedDB.
 * Reduces API costs and latency for repeated playback.
 */
export class TTSCache {
  /**
   * Generates a deterministic key for the cache based on synthesis parameters.
   * Uses SHA-256 hashing.
   *
   * The key is deliberately speed-independent: audio is always synthesized at 1.0
   * and the playback rate is applied at the audio sink, so one cached blob serves
   * every playback speed. (Entries written by older builds included the speed in
   * the key; those simply miss and are regenerated — the cache is regenerable.)
   *
   * The trailing `|1` is the retired `pitch` parameter's slot: the param was always
   * defaulted (vestige noted at Phase 5a), so it was removed from the signature with
   * the hash input kept byte-identical — existing cache entries keep hitting. The
   * golden-key regression test (TTSCache.test.ts) pins this.
   *
   * @param text - The text content.
   * @param voiceId - The ID of the voice used.
   * @returns A Promise that resolves to the hex string hash key.
   */
  async generateKey(text: string, voiceId: string): Promise<string> {
    const data = `${text}|${voiceId}|1`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Retrieves a cached segment if it exists and updates its last accessed time
   * (debounced inside the repo).
   *
   * @param key - The cache key.
   * @returns A Promise that resolves to the CacheAudioBlob row or undefined if not found.
   */
  async get(key: string): Promise<CacheAudioBlob | undefined> {
    return await audioCache.getSegment(key);
  }

  /**
   * Stores a new audio segment in the cache.
   *
   * @param key - The cache key.
   * @param audio - The audio data as an ArrayBuffer.
   * @param alignment - Optional alignment/timepoint data.
   * @returns A Promise that resolves when the segment is stored.
   */
  async put(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
    await audioCache.putSegment(key, audio, alignment);
  }
}
