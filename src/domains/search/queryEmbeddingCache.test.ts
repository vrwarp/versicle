/**
 * QueryEmbeddingCache suite: in-flight dedup, failed-compute eviction, and the
 * exact bytes written to the persistent query-embedding cache.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { queryEmbeddingsRepo } from '@data/repos/queryEmbeddings';
import { QueryEmbeddingCache } from './queryEmbeddingCache';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QueryEmbeddingCache', () => {
  it('shares one in-flight compute between identical keys', async () => {
    const cache = new QueryEmbeddingCache();
    const compute = vi.fn().mockResolvedValue(new Float32Array([1, 2]));
    const [a, b] = await Promise.all([
      cache.getOrCompute('k', compute),
      cache.getOrCompute('k', compute),
    ]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('evicts a rejected compute so a retry recomputes', async () => {
    const cache = new QueryEmbeddingCache();
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Float32Array([3]));
    await expect(cache.getOrCompute('k', compute)).rejects.toThrow('boom');
    await expect(cache.getOrCompute('k', compute)).resolves.toEqual(new Float32Array([3]));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  describe('regression: persisted vector bytes', () => {
    it('persists only the view bytes when the vector is a subarray of a larger buffer', async () => {
      vi.spyOn(queryEmbeddingsRepo, 'get').mockResolvedValue(undefined);
      const put = vi.spyOn(queryEmbeddingsRepo, 'put').mockResolvedValue(undefined);
      const backing = new Float32Array([9, 9, 1, 2, 3, 9]);
      const view = backing.subarray(2, 5);

      const cache = new QueryEmbeddingCache();
      await cache.getOrCompute('k', async () => view, { query: ' Foo ', model: 'm', dims: 3 });

      expect(put).toHaveBeenCalledTimes(1);
      const row = put.mock.calls[0][0];
      expect(row.key).toBe('m|3|foo');
      expect(Array.from(new Float32Array(row.vector))).toEqual([1, 2, 3]);
    });

    it('serves a persisted vector without calling compute', async () => {
      const stored = new Float32Array([4, 5]);
      vi.spyOn(queryEmbeddingsRepo, 'get').mockResolvedValue({
        key: 'm|2|bar',
        query: 'bar',
        model: 'm',
        dims: 2,
        vector: stored.buffer as ArrayBuffer,
        createdAt: 0,
      });
      const compute = vi.fn();
      const cache = new QueryEmbeddingCache();
      const out = await cache.getOrCompute('k', compute, { query: 'Bar', model: 'm', dims: 2 });
      expect(compute).not.toHaveBeenCalled();
      expect(Array.from(out)).toEqual([4, 5]);
    });
  });
});
