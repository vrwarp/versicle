import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { queryEmbeddingsRepo, type CacheQueryEmbeddingsRow } from './queryEmbeddings';
import { closeConnection } from '../connection';
import { DB_NAME } from '../schema';

function deleteAppDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const mockVector = new Float32Array([0.1, 0.2, 0.3]).buffer;

const row = (query: string): CacheQueryEmbeddingsRow => ({
  key: `gemini-embedding-2|768|${query}`,
  query,
  model: 'gemini-embedding-2',
  dims: 768,
  vector: mockVector,
  createdAt: 123456789,
});

describe('queryEmbeddingsRepo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeConnection();
    await deleteAppDatabase();
    vi.restoreAllMocks();
  });

  it('round-trips query embedding and reports absence as undefined', async () => {
    const key = 'gemini-embedding-2|768|test-query';
    await expect(queryEmbeddingsRepo.get(key)).resolves.toBeUndefined();

    const testRow = row('test-query');
    await queryEmbeddingsRepo.put(testRow);

    const retrieved = await queryEmbeddingsRepo.get(key);
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe(testRow.key);
    expect(retrieved!.query).toBe(testRow.query);
    expect(retrieved!.model).toBe(testRow.model);
    expect(retrieved!.dims).toBe(testRow.dims);
    expect(retrieved!.createdAt).toBe(testRow.createdAt);
    expect(new Float32Array(retrieved!.vector)).toEqual(new Float32Array(mockVector));

    // Delete
    await queryEmbeddingsRepo.delete(key);
    await expect(queryEmbeddingsRepo.get(key)).resolves.toBeUndefined();
  });
});
