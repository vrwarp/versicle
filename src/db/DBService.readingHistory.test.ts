import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dbService } from './DBService';
import { initDB } from './db';
import type { UserJourneyStep, UserProgress } from '../types/db';
import 'fake-indexeddb/auto';

// Mock mergeCfiRanges to ensure it works in this environment
vi.mock('../lib/cfi-utils', () => ({
    mergeCfiRanges: (existing: string[], newRange: string) => {
        // Simple mock: deduplicate and concat
        return [...new Set([...existing, newRange])];
    }
}));

describe('DBService Reading History', () => {
    beforeEach(async () => {
        const db = await initDB();
        // Clear v18 stores related to history
        await db.clear('user_progress');
        await db.clear('user_journey');
        await db.clear('user_inventory');
    });

    describe('getReadingHistory', () => {
        it('returns reading history ranges', async () => {
            const ranges = ['range1', 'range2'];
            const db = await initDB();

            // Populate user_journey instead of user_progress
            // because getReadingHistory reads from user_journey
            await Promise.all(ranges.map((range, i) =>
                db.add('user_journey', {
                    bookId: 'book1',
                    cfiRange: range,
                    startTimestamp: Date.now() + i,
                    endTimestamp: Date.now() + i,
                    duration: 0,
                    type: 'scroll'
                } as UserJourneyStep)
            ));

            const result = await dbService.getReadingHistory('book1');
            expect(result).toEqual(ranges);
        });

        it('returns empty array if no history', async () => {
            const result = await dbService.getReadingHistory('unknown');
            expect(result).toEqual([]);
        });
    });

    describe('updateReadingHistory', () => {
        it('logs new range to user_journey', async () => {
            const bookId = 'book1';
            const newRange = 'epubcfi(/6/2!/4/2/1:10,/4/2/1:20)';

            await dbService.updateReadingHistory(bookId, newRange, 'scroll');

            const db = await initDB();
            const journey = await db.getAllFromIndex('user_journey', 'by_bookId', bookId);

            expect(journey).toHaveLength(1);
            expect(journey[0].cfiRange).toBe(newRange);
            expect(journey[0].type).toBe('visual'); // scroll maps to visual in DBService
        });

        it('does not impact user_progress directly', async () => {
            const bookId = 'book-prog-test';
            const range = 'range1';

            // DBService.updateReadingHistory should NOT write to user_progress
            await dbService.updateReadingHistory(bookId, range, 'scroll');

            const db = await initDB();
            const prog = await db.get('user_progress', bookId);

            // It should be undefined unless initialized elsewhere
            expect(prog).toBeUndefined();
        });
    });
});
