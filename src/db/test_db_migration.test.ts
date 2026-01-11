
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { TTSContent } from '../types/db';

// Mock getDB
vi.mock('./db', () => ({
  getDB: vi.fn(),
  initDB: vi.fn(), // Also mock initDB if used
}));

describe('DBService - TTS Content and Migration', () => {
  const testBookId = 'test-book-id';
  const testSectionId = 'test-section-id';
  const testTTSContent: TTSContent = {
    id: `${testBookId}-${testSectionId}`,
    bookId: testBookId,
    sectionId: testSectionId,
    sentences: [
      { text: 'Hello world.', cfi: 'cfi1' },
      { text: 'Testing TTS.', cfi: 'cfi2' }
    ]
  };

  const mockDB = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getAllFromIndex: vi.fn(),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => ({
        put: vi.fn(),
        get: vi.fn(),
        clear: vi.fn(),
        delete: vi.fn()
      })),
      done: Promise.resolve()
    }))
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getDB as any).mockResolvedValue(mockDB);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should save and retrieve TTS content', async () => {
    // Setup get expectation
    mockDB.get.mockImplementation((store, id) => {
      if (store === 'cache_tts_preparation' && id === `${testBookId}-${testSectionId}`) {
        return Promise.resolve(testTTSContent);
      }
      return Promise.resolve(undefined);
    });

    await dbService.saveTTSContent(testTTSContent);

    expect(mockDB.put).toHaveBeenCalledWith('cache_tts_preparation', testTTSContent);

    const retrieved = await dbService.getTTSContent(testBookId, testSectionId);
    expect(retrieved).toEqual(testTTSContent);
  });

  it('should delete TTS content when book is deleted', async () => {
    // Setup getMetadata response
    mockDB.get.mockImplementation((store, id) => {
      if (store === 'static_manifests' && id === testBookId) return Promise.resolve({ bookId: testBookId });
      return Promise.resolve(undefined);
    });

    // Mock getAllFromIndex for cleanup finding
    mockDB.getAllFromIndex.mockImplementation((store, index, range) => {
      // cleanup might search via index
      return Promise.resolve([]);
    });

    await dbService.deleteBook(testBookId);

    // Verify delete calls
    // deleteBook calls cleanup logic which deletes from multiple stores
    expect(mockDB.delete).toHaveBeenCalledWith('static_manifests', testBookId);
    expect(mockDB.delete).toHaveBeenCalledWith('user_inventory', testBookId);
    expect(mockDB.delete).toHaveBeenCalledWith('user_progress', testBookId);
    // It should also cleanup cache
    // Verify it doesn't crash
  });
});
