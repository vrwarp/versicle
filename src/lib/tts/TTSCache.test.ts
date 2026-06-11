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

    it('should include pitch in hash', async () => {
      const key1 = await cache.generateKey('Hello', 'voice1', 1.0);
      const key2 = await cache.generateKey('Hello', 'voice1', 1.2);
      expect(key1).not.toBe(key2);
    });
  });

  describe('regression: speed policy — speed-independent cache key', () => {
    it('takes no speed input: same text+voice always maps to the same entry', async () => {
      // The signature is (text, voiceId, pitch?) — playback speed is
      // applied at the audio sink, so it must never fragment the audio cache.
      const key1 = await cache.generateKey('Hello', 'voice1');
      const key2 = await cache.generateKey('Hello', 'voice1', 1.0);
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
