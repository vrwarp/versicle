import { dbService } from '../../db/DBService';
import type { CachedSegment } from '../../types/db';
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
   * @param text - The text content.
   * @param voiceId - The ID of the voice used.
   * @param speed - The playback speed.
   * @param pitch - The pitch setting (default 1.0).
   * @param lexiconHash - Hash of the current lexicon rules (default '').
   * @returns A Promise that resolves to the hex string hash key.
   */
  async generateKey(text: string, voiceId: string, speed: number, pitch: number = 1.0, lexiconHash: string = ''): Promise<string> {
    const data = `${text}|${voiceId}|${speed}|${pitch}|${lexiconHash}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Retrieves a cached segment if it exists and updates its last accessed time.
   *
   * @param key - The cache key.
   * @returns A Promise that resolves to the CachedSegment or undefined if not found.
   */
  async get(key: string): Promise<CachedSegment | undefined> {
    return await dbService.getCachedSegment(key);
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
    await dbService.cacheSegment(key, audio, alignment);
  }
}
