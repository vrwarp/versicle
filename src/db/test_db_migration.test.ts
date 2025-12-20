import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { initDB } from './db';
import type { TTSContent, BookMetadata } from '../types/db';
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
    // Seed book and TTS content
    const db = await initDB();
    await db.put('books', { id: testBookId, title: 'Test Book', author: 'Tester', addedAt: Date.now() } as BookMetadata);
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
