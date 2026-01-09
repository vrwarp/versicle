import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { initDB } from './db';
import type { TTSContent, StaticBookManifest, UserInventoryItem, UserProgress } from '../types/db';
import 'fake-indexeddb/auto';

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

  beforeEach(async () => {
    // Reset DB
    const db = await initDB();
    const objectStoreNames = db.objectStoreNames;
    const storeNames = Array.from(objectStoreNames);
    if (storeNames.length > 0) {
        // IDB transaction requires at least one store name
        const tx = db.transaction(storeNames, 'readwrite');
        for (const storeName of storeNames) {
           await tx.objectStore(storeName).clear();
        }
        await tx.done;
    }
  });

  it('should save and retrieve TTS content', async () => {
    await dbService.saveTTSContent(testTTSContent);
    const retrieved = await dbService.getTTSContent(testBookId, testSectionId);
    expect(retrieved).toEqual(testTTSContent);
  });

  it('should delete TTS content when book is deleted', async () => {
    // Seed book and TTS content using new v18 schema directly or helper
    const db = await initDB();
    // Seeding DB manually to match v18 structure
    await db.put('static_manifests', {
        bookId: testBookId, title: 'Test Book', author: 'Tester', schemaVersion: 1, fileHash: 'abc', fileSize: 0, totalChars: 0
    } as StaticBookManifest);

    await db.put('user_inventory', {
        bookId: testBookId, addedAt: Date.now(), status: 'unread', tags: [], lastInteraction: Date.now()
    } as UserInventoryItem);

    await db.put('user_progress', {
        bookId: testBookId, percentage: 0, lastRead: 0, completedRanges: []
    } as UserProgress);

    // Save TTS content (uses cache_tts_preparation)
    await dbService.saveTTSContent(testTTSContent);

    // Verify seeded
    const contentBefore = await dbService.getTTSContent(testBookId, testSectionId);
    expect(contentBefore).toBeDefined();

    // Delete book
    await dbService.deleteBook(testBookId);

    // Verify deletion
    const contentAfter = await dbService.getTTSContent(testBookId, testSectionId);
    expect(contentAfter).toBeUndefined();

    const bookAfter = await dbService.getBookMetadata(testBookId);
    expect(bookAfter).toBeUndefined();
  });
});
