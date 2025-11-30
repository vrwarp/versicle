import { getDB } from '../../db/db';
import type { CachedSegment } from '../../types/db';
import type { Timepoint } from './providers/types';

export class TTSCache {
  /**
   * Generates a deterministic key for the cache.
   * SHA-256(text + voiceId + speed + pitch + lexiconHash)
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
   * Retrieves a cached segment if it exists.
   * Also updates lastAccessed.
   */
  async get(key: string): Promise<CachedSegment | undefined> {
    const db = await getDB();
    const segment = await db.get('tts_cache', key);

    if (segment) {
      // Update lastAccessed asynchronously
      segment.lastAccessed = Date.now();
      db.put('tts_cache', segment);
    }

    return segment;
  }

  /**
   * Stores a segment in the cache.
   */
  async put(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
    const db = await getDB();
    const segment: CachedSegment = {
      key,
      audio,
      alignment,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };
    await db.put('tts_cache', segment);

    // Optional: Prune cache if too large (can be done later or in a separate job)
  }
}
