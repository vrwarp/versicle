import { describe, it, expect } from 'vitest';
import { ReadingHistoryReconciler } from './ReadingHistoryReconciler';
import type { ReadingHistoryEntry } from '../types/db';

describe('ReadingHistoryReconciler', () => {
    it('should resolve undefined if entry is undefined', () => {
        expect(ReadingHistoryReconciler.resolveStartLocation(undefined)).toBeUndefined();
    });

    it('should fallback to legacy spatial range if sessions are missing', () => {
        const entry: ReadingHistoryEntry = {
            bookId: 'test',
            readRanges: ['epubcfi(/6/6!/4/2,/1:0,/1:100)'],
            sessions: [],
            lastUpdated: Date.now()
        };

        const result = ReadingHistoryReconciler.resolveStartLocation(entry);
        // Expect end of range (legacy)
        expect(result).toBe('epubcfi(/6/6!/4/2/1:100)');
    });

    it('should prefer the last chronological session if available', () => {
        const entry: ReadingHistoryEntry = {
            bookId: 'test',
            readRanges: ['epubcfi(/6/6!/4/2,/1:0,/1:100)'],
            sessions: [
                { cfiRange: 'epubcfi(/6/6!/4/2,/1:200,/1:10)', timestamp: 1000, type: 'page' },
                { cfiRange: 'epubcfi(/6/6!/4/2,/1:300,/1:10)', timestamp: 2000, type: 'page' } // Most recent
            ],
            lastUpdated: 2000
        };

        const result = ReadingHistoryReconciler.resolveStartLocation(entry);
        // Expect start of last session
        expect(result).toBe('epubcfi(/6/6!/4/2/1:300)');
    });
});
