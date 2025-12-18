import { describe, it, expect, beforeEach } from 'vitest';
import { dbService } from './DBService';
import { getDB } from './db';
import type { ReadingListEntry } from '../types/db';

describe('DBService Reading List', () => {
    beforeEach(async () => {
        const db = await getDB();
        await db.clear('reading_list');
        await db.clear('books');
        await db.clear('files');
    });

    it('should upsert and get reading list entries', async () => {
        const entry: ReadingListEntry = {
            filename: 'test.epub',
            title: 'Test Book',
            author: 'Test Author',
            percentage: 0.5,
            lastUpdated: Date.now(),
            status: 'currently-reading'
        };

        await dbService.upsertReadingListEntry(entry);
        const list = await dbService.getReadingList();

        expect(list).toHaveLength(1);
        expect(list[0]).toEqual(entry);

        // Update
        entry.percentage = 0.8;
        await dbService.upsertReadingListEntry(entry);
        const list2 = await dbService.getReadingList();
        expect(list2[0].percentage).toBe(0.8);
    });

    it('should sync progress to books on import', async () => {
        const db = await getDB();

        // Setup existing book
        const bookId = 'book-1';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = {
            id: bookId,
            filename: 'sync_test.epub',
            title: 'Sync Test',
            author: 'Author',
            addedAt: 100,
            isOffloaded: false,
            fileHash: 'h',
            fileSize: 10,
            syntheticToc: [],
            totalChars: 0,
            progress: 0.1,
            description: ''
        };
        await db.put('books', book);

        // Import entry with higher progress
        const entries: ReadingListEntry[] = [{
            filename: 'sync_test.epub',
            title: 'Sync Test',
            author: 'Author',
            percentage: 0.9,
            lastUpdated: Date.now(),
            status: 'currently-reading'
        }];

        await dbService.importReadingList(entries);

        const updatedBook = await db.get('books', bookId);
        expect(updatedBook?.progress).toBe(0.9);
    });

    it('should NOT sync progress if imported progress is lower', async () => {
        const db = await getDB();

        const bookId = 'book-2';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = {
            id: bookId,
            filename: 'lower_test.epub',
            title: 'Lower Test',
            author: 'Author',
            addedAt: 100,
            isOffloaded: false,
            fileHash: 'h',
            fileSize: 10,
            syntheticToc: [],
            totalChars: 0,
            progress: 0.8,
            description: ''
        };
        await db.put('books', book);

        const entries: ReadingListEntry[] = [{
            filename: 'lower_test.epub',
            title: 'Lower Test',
            author: 'Author',
            percentage: 0.5,
            lastUpdated: Date.now(),
            status: 'currently-reading'
        }];

        await dbService.importReadingList(entries);

        const updatedBook = await db.get('books', bookId);
        expect(updatedBook?.progress).toBe(0.8);
    });

    it('should save to reading list when saving progress', async () => {
        const db = await getDB();
        const bookId = 'prog-sync-1';
        const filename = 'prog_sync.epub';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = {
            id: bookId,
            filename: filename,
            title: 'Prog Sync',
            author: 'Author',
            addedAt: 100,
            isOffloaded: false,
            fileHash: 'h',
            fileSize: 10,
            syntheticToc: [],
            totalChars: 0,
            description: ''
        };
        await db.put('books', book);

        dbService.saveProgress(bookId, 'cfi1', 0.45);

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 1100));

        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].filename).toBe(filename);
        expect(list[0].percentage).toBe(0.45);
        expect(list[0].title).toBe('Prog Sync');
    });

    it('should preserve rating and isbn when updating progress', async () => {
        const db = await getDB();
        const bookId = 'preserve-1';
        const filename = 'preserve.epub';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = {
            id: bookId,
            filename: filename,
            title: 'Preserve',
            author: 'Author',
            addedAt: 100,
            isOffloaded: false,
            fileHash: 'h',
            fileSize: 10,
            syntheticToc: [],
            totalChars: 0,
            description: ''
        };
        await db.put('books', book);

        // Pre-existing entry with rating/isbn
        const entry: ReadingListEntry = {
            filename: filename,
            title: 'Preserve',
            author: 'Author',
            isbn: '123',
            rating: 5,
            percentage: 0.1,
            lastUpdated: 0,
            status: 'currently-reading'
        };
        await db.put('reading_list', entry);

        // Update progress
        dbService.saveProgress(bookId, 'cfi1', 0.5);

        await new Promise(resolve => setTimeout(resolve, 1100));

        const list = await dbService.getReadingList();
        expect(list).toHaveLength(1);
        expect(list[0].percentage).toBe(0.5);
        expect(list[0].isbn).toBe('123');
        expect(list[0].rating).toBe(5);
    });

});
