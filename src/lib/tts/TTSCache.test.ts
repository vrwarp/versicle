import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSCache } from './TTSCache';
import * as dbModule from '../../db/db';

vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

describe('TTSCache', () => {
  let cache: TTSCache;
  const mockDb = {
    get: vi.fn(),
    put: vi.fn(),
  };

  beforeEach(() => {
    cache = new TTSCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(dbModule.getDB).mockResolvedValue(mockDb as any);
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
      mockDb.get.mockResolvedValue(undefined);
      const result = await cache.get('some-key');
      expect(result).toBeUndefined();
      expect(mockDb.get).toHaveBeenCalledWith('tts_cache', 'some-key');
    });

    it('should return segment and update lastAccessed if found', async () => {
      const mockSegment = {
        key: 'some-key',
        audio: new ArrayBuffer(0),
        createdAt: 1000,
        lastAccessed: 1000,
      };
      mockDb.get.mockResolvedValue(mockSegment);

      const result = await cache.get('some-key');
      expect(result).toBe(mockSegment);
      expect(mockDb.put).toHaveBeenCalledWith('tts_cache', expect.objectContaining({
          ...mockSegment,
          lastAccessed: expect.any(Number)
      }));
      // Verify lastAccessed was updated (should be greater than original)
      const updatedSegment = mockDb.put.mock.calls[0][1];
      expect(updatedSegment.lastAccessed).toBeGreaterThan(1000);
    });
  });

  describe('put', () => {
    it('should store segment in db', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        await cache.put(key, audio);

        expect(mockDb.put).toHaveBeenCalledWith('tts_cache', expect.objectContaining({
            key,
            audio,
            createdAt: expect.any(Number),
            lastAccessed: expect.any(Number)
        }));
    });

    it('should store alignment if provided', async () => {
        const key = 'new-key';
        const audio = new ArrayBuffer(10);
        const alignment = [{ timeSeconds: 0, charIndex: 0 }];
        await cache.put(key, audio, alignment);

        expect(mockDb.put).toHaveBeenCalledWith('tts_cache', expect.objectContaining({
            key,
            audio,
            alignment
        }));
    });
  });
});
