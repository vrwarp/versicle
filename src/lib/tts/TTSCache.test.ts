import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSCache } from './TTSCache';
import { audioCache } from '@data/repos/audioCache';

vi.mock('@data/repos/audioCache', () => ({
  audioCache: {
    getSegment: vi.fn(),
    putSegment: vi.fn(),
  },
}));

describe('TTSCache', () => {
  let cache: TTSCache;

  beforeEach(() => {
    cache = new TTSCache();
    vi.clearAllMocks();
  });

  describe('generateKey', () => {
    it('should generate a consistent hash', async () => {
      const key1 = await cache.generateKey('Hello', 'voice1');
      const key2 = await cache.generateKey('Hello', 'voice1');
      expect(key1).toBe(key2);
      expect(key1).toBeTruthy();
    });

    it('should generate different hashes for different inputs', async () => {
      const key1 = await cache.generateKey('Hello', 'voice1');
      const key2 = await cache.generateKey('World', 'voice1');
      expect(key1).not.toBe(key2);
    });

    it('golden key: byte-identical to the pre-5a (text|voiceId|pitch=1) format', async () => {
      // Phase 5a deleted the vestigial always-defaulted `pitch` parameter. The hash
      // input keeps the legacy `|1` slot so EXISTING cache entries still hit. This is
      // the precomputed SHA-256 of 'Hello|voice1|1' — if this assertion fails, every
      // user's audio cache silently misses. Do not "clean up" the trailing slot.
      const key = await cache.generateKey('Hello', 'voice1');
      expect(key).toBe('758d1a70e61d76508db4543b0e9d498e0e93c0c14e511559c9c1261c2bdeb10e');
    });
  });

  describe('regression: speed policy — speed-independent cache key', () => {
    it('takes no speed input: same text+voice always maps to the same entry', async () => {
      // The signature is (text, voiceId) — playback speed is applied at the
      // audio sink, so it must never fragment the audio cache.
      const key1 = await cache.generateKey('Hello', 'voice1');
      const key2 = await cache.generateKey('Hello', 'voice1');
      expect(key1).toBe(key2);
    });
  });

  describe('get', () => {
    it('should return undefined if key not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioCache.getSegment as any).mockResolvedValue(undefined);
      const result = await cache.get('some-key');
      expect(result).toBeUndefined();
      expect(audioCache.getSegment).toHaveBeenCalledWith('some-key');
    });

    it('should return segment', async () => {
      const mockSegment = {
        key: 'some-key',
        audio: new ArrayBuffer(0),
        createdAt: 1000,
        lastAccessed: 1000,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioCache.getSegment as any).mockResolvedValue(mockSegment);

      const result = await cache.get('some-key');
      expect(result).toBe(mockSegment);
    });
  });

  describe('put', () => {
    it('should store segment in db', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        await cache.put(key, audio);

        expect(audioCache.putSegment).toHaveBeenCalledWith(key, audio, undefined);
    });

    it('should store alignment if provided', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        const alignment = [{ timeSeconds: 0, charIndex: 0 }];
        await cache.put(key, audio, alignment);

        expect(audioCache.putSegment).toHaveBeenCalledWith(key, audio, alignment);
    });
  });
});
