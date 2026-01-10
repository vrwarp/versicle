import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { StaticBookManifest, UserInventoryItem, UserProgress, StaticResource, StaticStructure } from '../types/db';

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
        await db.clear('user_reading_list');
    });

    it('should upsert reading list entries', async () => {
        const db = await getDB();

        // Seed initial data
        await db.put('user_inventory', {
            bookId: 'b1',
            sourceFilename: 'test.epub',
            customTitle: 'Old Title',
            customAuthor: 'Old Author',
            addedAt: 100,
            status: 'unread',
            lastInteraction: 100,
            tags: []
        } as UserInventoryItem);

        await db.put('user_progress', {
            bookId: 'b1',
            percentage: 0,
            lastRead: 0,
            completedRanges: []
        } as UserProgress);

        await db.put('static_manifests', {
            bookId: 'b1',
            title: 'Orig Title',
            author: 'Orig Author',
            schemaVersion: 1,
            fileHash: 'hash',
            fileSize: 100,
            totalChars: 1000
        } as StaticBookManifest);

        // Perform upsert
        await dbService.upsertReadingListEntry({
            filename: 'test.epub',
            title: 'New Title',
            author: 'New Author',
            percentage: 0.5,
            lastUpdated: 200,
            status: 'currently-reading',
            rating: 4
        });

        // Verify user_inventory updated
        const inv = await db.get('user_inventory', 'b1');
        expect(inv?.customTitle).toBe('New Title');
        expect(inv?.customAuthor).toBe('New Author');
        expect(inv?.status).toBe('reading');
        expect(inv?.rating).toBe(4);
        expect(inv?.lastInteraction).toBe(200);

        // Verify user_progress updated
        const prog = await db.get('user_progress', 'b1');
        expect(prog?.percentage).toBe(0.5);
        expect(prog?.lastRead).toBe(200);

        // Verify getReadingList reflects changes
        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe('New Title');
        expect(list[0].status).toBe('currently-reading');
    });

    it('should delete reading list entry', async () => {
        const db = await getDB();

        await db.put('user_inventory', {
            bookId: 'del-1', sourceFilename: 'del.epub', addedAt: 100, status: 'unread', lastInteraction: 100, tags: []
        } as UserInventoryItem);
        await db.put('static_manifests', {
            bookId: 'del-1', title: 'Del', author: 'Auth', schemaVersion: 1, fileHash: 'h', fileSize: 1, totalChars: 1
        } as StaticBookManifest);
        // Need store dependent tables to ensure no crash
        await db.put('user_progress', { bookId: 'del-1', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);
        await db.put('static_resources', { bookId: 'del-1', epubBlob: new Blob([]) } as StaticResource);
        await db.put('static_structure', { bookId: 'del-1', toc: [], spineItems: [] } as StaticStructure);

        // Populate reading list
        await db.put('user_reading_list', {
            filename: 'del.epub',
            title: 'Del',
            author: 'Auth',
            percentage: 0,
            lastUpdated: 100
        });

        await dbService.deleteReadingListEntry('del.epub');

        const inv = await db.get('user_inventory', 'del-1');
        // Decoupled architecture: Deleting reading list entry should NOT delete the book
        expect(inv).toBeDefined();

        const rl = await db.get('user_reading_list', 'del.epub');
        expect(rl).toBeUndefined();
    });

    it('should import reading list (batch upsert)', async () => {
        const db = await getDB();

        // Seed
        await db.put('user_inventory', {
            bookId: 'imp-1', sourceFilename: 'imp1.epub', addedAt: 100, status: 'unread', lastInteraction: 100, tags: []
        } as UserInventoryItem);
         await db.put('static_manifests', {
            bookId: 'imp-1', title: 'Imp 1', author: 'Auth', schemaVersion: 1, fileHash: 'h', fileSize: 1, totalChars: 1
        } as StaticBookManifest);
        await db.put('user_progress', { bookId: 'imp-1', percentage: 0, lastRead: 0, completedRanges: [] } as UserProgress);

        await dbService.importReadingList([{
            filename: 'imp1.epub',
            title: 'Imported Title',
            author: 'Imported Author',
            percentage: 0.8,
            lastUpdated: 300,
            status: 'read',
            rating: 5
        }]);

        const inv = await db.get('user_inventory', 'imp-1');
        expect(inv?.customTitle).toBe('Imported Title');
        expect(inv?.status).toBe('completed');

        const prog = await db.get('user_progress', 'imp-1');
        expect(prog?.percentage).toBe(0.8);
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

        await db.put('static_manifests', {
            bookId, title: 'Prog Sync', author: 'Author',
            schemaVersion: 1, fileHash: 'hash', fileSize: 0, totalChars: 0
        } as StaticBookManifest);
        await db.put('user_inventory', {
            bookId, sourceFilename: filename, customTitle: 'Prog Sync', addedAt: 100, status: 'reading', lastInteraction: 0,
            tags: []
        } as UserInventoryItem);
        await db.put('user_progress', {
            bookId, percentage: 0, lastRead: 0, completedRanges: []
        } as UserProgress);

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
