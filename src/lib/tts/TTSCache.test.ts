import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSCache } from './TTSCache';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
  dbService: {
    getCachedSegment: vi.fn(),
    cacheSegment: vi.fn(),
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
      const key1 = await cache.generateKey('Hello', 'voice1', 1.0);
      const key2 = await cache.generateKey('Hello', 'voice1', 1.0);
      expect(key1).toBe(key2);
      expect(key1).toBeTruthy();
    });

    it('should generate different hashes for different inputs', async () => {
      const key1 = await cache.generateKey('Hello', 'voice1', 1.0);
      const key2 = await cache.generateKey('World', 'voice1', 1.0);
      expect(key1).not.toBe(key2);
    });

    it('should include pitch in hash', async () => {
      const key1 = await cache.generateKey('Hello', 'voice1', 1.0, 1.0);
      const key2 = await cache.generateKey('Hello', 'voice1', 1.0, 1.2);
      expect(key1).not.toBe(key2);
    });
  });

  describe('get', () => {
    it('should return undefined if key not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dbService.getCachedSegment as any).mockResolvedValue(undefined);
      const result = await cache.get('some-key');
      expect(result).toBeUndefined();
      expect(dbService.getCachedSegment).toHaveBeenCalledWith('some-key');
    });

    it('should return segment', async () => {
      const mockSegment = {
        key: 'some-key',
        audio: new ArrayBuffer(0),
        createdAt: 1000,
        lastAccessed: 1000,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dbService.getCachedSegment as any).mockResolvedValue(mockSegment);

      const result = await cache.get('some-key');
      expect(result).toBe(mockSegment);
    });
  });

  describe('put', () => {
    it('should store segment in db', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        await cache.put(key, audio);

        expect(dbService.cacheSegment).toHaveBeenCalledWith(key, audio, undefined);
    });

    it('should store alignment if provided', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        const alignment = [{ timeSeconds: 0, charIndex: 0 }];
        await cache.put(key, audio, alignment);

        expect(dbService.cacheSegment).toHaveBeenCalledWith(key, audio, alignment);
    });
  });
});
