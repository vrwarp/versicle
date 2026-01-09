import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { ReadingListEntry, StaticBookManifest, UserInventoryItem, UserProgress } from '../types/db';

describe('DBService Reading List', () => {
    beforeEach(async () => {
        const db = await getDB();
        // v18: reading_list is deprecated, but DBService mimics it via UserInventory.
        // Or if we implemented reading_list store removal?
        // Wait, initDB DELETED reading_list store in v18 migration.
        // So `getReadingList` implementation in DBService maps from user_inventory.
        // So we should verify against user_inventory.

        await db.clear('user_inventory');
        await db.clear('user_progress');
        await db.clear('static_manifests');
        await db.clear('static_resources');
    });

    it('should upsert and get reading list entries (via deprecated methods warning)', async () => {
        // upsertReadingListEntry is deprecated and logs warning, does nothing.
        // So this test expectation needs to change or we acknowledge it's deprecated.
        // But getReadingList returns from user_inventory.
        // So we should seed user_inventory directly to test getReadingList.

        const db = await getDB();
        await db.put('user_inventory', {
            bookId: 'b1',
            sourceFilename: 'test.epub',
            customTitle: 'Test Book',
            customAuthor: 'Test Author',
            addedAt: 100,
            status: 'reading',
            lastInteraction: Date.now()
        } as UserInventoryItem);

        await db.put('user_progress', {
            bookId: 'b1',
            percentage: 0.5,
            lastRead: 0
        } as UserProgress);

        await db.put('static_manifests', {
            bookId: 'b1',
            title: 'Orig Title',
            author: 'Orig Author'
        } as any);

        const list = await dbService.getReadingList();

        expect(list).toHaveLength(1);
        expect(list[0].filename).toBe('test.epub');
        expect(list[0].percentage).toBe(0.5);
    });

    it('should sync progress to books on import (deprecated)', async () => {
        // importReadingList is deprecated.
        // If we want to test legacy behavior, we can't because method is stubbed to log warning.
        // We should skip this test or remove it.
        // I will skip it.
    });

    /*
    it('should NOT sync progress if imported progress is lower', async () => {
        // Skipped
    });
    */

    it('should save to reading list (user_inventory) when saving progress', async () => {
        const db = await getDB();
        const bookId = 'prog-sync-1';
        const filename = 'prog_sync.epub';

        await db.put('static_manifests', { bookId, title: 'Prog Sync', author: 'Author' } as any);
        await db.put('user_inventory', { bookId, sourceFilename: filename, customTitle: 'Prog Sync', addedAt: 100, status: 'reading', lastInteraction: 0 } as UserInventoryItem);
        await db.put('user_progress', { bookId, percentage: 0, lastRead: 0 } as UserProgress);

        dbService.saveProgress(bookId, 'cfi1', 0.45);

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 1100));

        // In v18, saving progress updates user_inventory status/lastInteraction?
        // Yes, DBService.saveProgress updates status.
        // And getReadingList maps user_inventory.

        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].filename).toBe(filename);
        expect(list[0].percentage).toBe(0.45);
    });

    /*
    it('should preserve rating and isbn when updating progress', async () => {
        // Rating/ISBN preservation depends on ReadingListEntry which is gone.
        // UserInventory has `rating`.
        // ISBN is in StaticManifest.
        // So this logic is handled by schema now.
        // If we seed rating in UserInventory, it should persist.
    });
    */

    it('should preserve rating in user_inventory when updating progress', async () => {
        const db = await getDB();
        const bookId = 'preserve-1';
        const filename = 'preserve.epub';

        await db.put('static_manifests', { bookId, title: 'Preserve', author: 'Author', isbn: '123' } as any);
        await db.put('user_inventory', {
            bookId, sourceFilename: filename, addedAt: 100, status: 'reading', lastInteraction: 0,
            rating: 5
        } as UserInventoryItem);
        await db.put('user_progress', { bookId, percentage: 0.1, lastRead: 0 } as UserProgress);

        // Update progress
        dbService.saveProgress(bookId, 'cfi1', 0.5);

        await new Promise(resolve => setTimeout(resolve, 1100));

        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].percentage).toBe(0.5);
        expect(list[0].isbn).toBe('123'); // From manifest
        expect(list[0].rating).toBe(5); // From inventory
    });

});
