import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { StaticBookManifest, UserInventoryItem, UserProgress } from '../types/db';

describe('DBService Reading List', () => {
    beforeEach(async () => {
        const db = await getDB();
        await db.clear('user_inventory');
        await db.clear('user_progress');
        await db.clear('static_manifests');
        await db.clear('static_resources');
        await db.clear('user_reading_list');
    });

    it('should upsert reading list entries (syncing with inventory)', async () => {
        const db = await getDB();

        // Seed Inventory
        await db.put('user_inventory', {
            bookId: 'b1', sourceFilename: 'test.epub', customTitle: 'Old Title', addedAt: 100, status: 'unread', lastInteraction: 100, tags: []
        } as UserInventoryItem);
        await db.put('user_progress', { bookId: 'b1', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

        // Upsert Reading List
        await dbService.upsertReadingListEntry({
            filename: 'test.epub',
            title: 'New Title',
            author: 'New Author',
            percentage: 0.5,
            lastUpdated: 200,
            status: 'currently-reading',
            rating: 4
        });

        // 1. Verify Entry in user_reading_list
        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe('New Title');

        // 2. Verify Sync to Inventory
        const inv = await db.get('user_inventory', 'b1');
        expect(inv?.customTitle).toBe('New Title'); // Synced
        expect(inv?.rating).toBe(4); // Synced

        // 3. Verify Sync to Progress
        const prog = await db.get('user_progress', 'b1');
        expect(prog?.percentage).toBe(0.5); // Synced (highest)
    });

    it('should handle "Ghost Books" (Reading List only)', async () => {
        const db = await getDB();
        const filename = 'ghost.epub';

        await dbService.upsertReadingListEntry({
            filename,
            title: 'Ghost Book',
            author: 'Ghost',
            percentage: 0.8,
            lastUpdated: 100,
            status: 'read'
        });

        // 1. Verify Entry in user_reading_list
        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe('Ghost Book');

        // 2. Verify NOT in Library (getLibrary)
        const library = await dbService.getLibrary();
        expect(library).toHaveLength(0); // Should be empty

        // 3. Verify NOT in user_inventory directly
        const inv = await db.getAll('user_inventory');
        expect(inv).toHaveLength(0);
    });

    it('should delete reading list entry WITHOUT deleting library book', async () => {
        const db = await getDB();

        // Seed Inventory + Reading List
        await db.put('user_inventory', { bookId: 'b1', sourceFilename: 'keep.epub', addedAt: 100, status: 'reading', lastInteraction: 100, tags: [] } as UserInventoryItem);
        await db.put('static_manifests', { bookId: 'b1', title: 'Keep', author: 'Me', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0 } as StaticBookManifest);
        await db.put('user_reading_list', { filename: 'keep.epub', title: 'Keep', author: 'Me', percentage: 0.5, lastUpdated: 100, status: 'reading' });

        // Delete from Reading List
        await dbService.deleteReadingListEntry('keep.epub');

        // 1. Verify Reading List Empty
        const list = await dbService.getReadingList();
        expect(list).toHaveLength(0);

        // 2. Verify Library Still Exists
        const lib = await dbService.getLibrary();
        expect(lib).toHaveLength(1);
        expect(lib[0].id).toBe('b1');
    });

    it('should sync progress FROM Library TO Reading List (Live Sync)', async () => {
        const db = await getDB();
        const bookId = 'live-sync-1';
        const filename = 'live.epub';

        await db.put('static_manifests', { bookId, title: 'Live', author: 'Sync', schemaVersion: 1, fileHash: 'h', fileSize: 0, totalChars: 0, isbn: '999' } as StaticBookManifest);
        await db.put('user_inventory', { bookId, sourceFilename: filename, addedAt: 100, status: 'reading', lastInteraction: 100, tags: [] } as UserInventoryItem);
        await db.put('user_progress', { bookId, percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

        // Simulate reading
        dbService.saveProgress(bookId, 'cfi', 0.15);

        await new Promise(resolve => setTimeout(resolve, 1100));

        // Verify Reading List Created/Updated
        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].filename).toBe(filename);
        expect(list[0].percentage).toBe(0.15);
        expect(list[0].isbn).toBe('999'); // Should pick up ISBN from manifest
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

        await db.put('static_manifests', {
            bookId, title: 'Preserve', author: 'Author', isbn: '123',
            schemaVersion: 1, fileHash: 'hash', fileSize: 0, totalChars: 0
        } as StaticBookManifest);
        await db.put('user_inventory', {
            bookId, sourceFilename: filename, addedAt: 100, status: 'reading', lastInteraction: 0,
            rating: 5, tags: []
        } as UserInventoryItem);
        await db.put('user_progress', {
            bookId, percentage: 0.1, lastRead: 0, completedRanges: []
        } as UserProgress);

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
