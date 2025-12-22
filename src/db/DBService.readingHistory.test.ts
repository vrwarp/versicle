import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbService } from './DBService';

// Mock getDB
const mockDB = {
    get: vi.fn(),
    put: vi.fn(),
    transaction: vi.fn(),
    getAll: vi.fn(),
};

vi.mock('./db', () => ({
    getDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// Mock cfi-utils
vi.mock('../lib/cfi-utils', () => ({
    mergeCfiRanges: vi.fn((ranges, newRange) => {
        // Simple mock implementation
        if (newRange) return [...ranges, newRange];
        return ranges;
    }),
}));

// Mock Logger
vi.mock('../lib/logger', () => ({
    Logger: {
        error: vi.fn(),
    }
}));

describe('DBService Reading History', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getReadingHistory', () => {
        it('returns reading history ranges', async () => {
            const ranges = ['range1', 'range2'];
            mockDB.get.mockResolvedValue({ readRanges: ranges });

            const result = await dbService.getReadingHistory('book1');
            expect(result).toEqual(ranges);
            expect(mockDB.get).toHaveBeenCalledWith('reading_history', 'book1');
        });

        it('returns empty array if no history found', async () => {
            mockDB.get.mockResolvedValue(undefined);

            const result = await dbService.getReadingHistory('book1');
            expect(result).toEqual([]);
        });

        it('handles corrupted history entry (missing readRanges)', async () => {
            mockDB.get.mockResolvedValue({ someOtherProp: 'test' });

            const result = await dbService.getReadingHistory('book1');
            expect(result).toBeUndefined();
        });

        it('handles database errors gracefully', async () => {
             mockDB.get.mockRejectedValue(new Error('DB Connection Failed'));
             const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

             await expect(dbService.getReadingHistory('book1')).rejects.toThrow('An unexpected database error occurred');
             consoleSpy.mockRestore();
        });
    });

    describe('updateReadingHistory', () => {
        it('merges new range and updates DB', async () => {
            const bookId = 'book1';
            const newRange = 'range3';
            const existingRanges = ['range1', 'range2'];

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ readRanges: existingRanges }),
                    put: vi.fn().mockResolvedValue(undefined),
                }),
                done: Promise.resolve(),
            };
            mockDB.transaction.mockReturnValue(mockTx);

            await dbService.updateReadingHistory(bookId, newRange, 'page');

            expect(mockDB.transaction).toHaveBeenCalledWith('reading_history', 'readwrite');
            const putArg = mockTx.objectStore().put.mock.calls[0][0];
            expect(putArg.bookId).toBe(bookId);
            expect(putArg.readRanges).toEqual(['range1', 'range2', 'range3']);
            expect(putArg.lastUpdated).toBeDefined();
            expect(putArg.sessions).toHaveLength(1);
            expect(putArg.sessions[0].type).toBe('page');
        });

        it('creates new entry if none exists', async () => {
            const bookId = 'book1';
            const newRange = 'range1';

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue(undefined),
                    put: vi.fn().mockResolvedValue(undefined),
                }),
                done: Promise.resolve(),
            };
            mockDB.transaction.mockReturnValue(mockTx);

            await dbService.updateReadingHistory(bookId, newRange, 'page');

            const putArg = mockTx.objectStore().put.mock.calls[0][0];
            expect(putArg.bookId).toBe(bookId);
            expect(putArg.readRanges).toEqual(['range1']);
        });

        it('coalesces scroll events within 5 minutes', async () => {
            const bookId = 'book1';
            const initialRange = 'range1';
            const updatedRange = 'range2';

            const now = Date.now();
            const existingSession = {
                cfiRange: initialRange,
                timestamp: now - 1000, // 1 sec ago
                type: 'scroll',
                label: 'Chapter 1'
            };

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        readRanges: [],
                        sessions: [existingSession]
                    }),
                    put: vi.fn().mockResolvedValue(undefined),
                }),
                done: Promise.resolve(),
            };
            mockDB.transaction.mockReturnValue(mockTx);

            await dbService.updateReadingHistory(bookId, updatedRange, 'scroll', 'Chapter 1');

            const putArg = mockTx.objectStore().put.mock.calls[0][0];

            // Should still have 1 session, but updated
            expect(putArg.sessions).toHaveLength(1);
            expect(putArg.sessions[0].cfiRange).toBe(updatedRange);
            expect(putArg.sessions[0].type).toBe('scroll');
        });

        it('does NOT coalesce TTS events', async () => {
            const bookId = 'book1';
            const initialRange = 'range1';
            const updatedRange = 'range2';

            const now = Date.now();
            const existingSession = {
                cfiRange: initialRange,
                timestamp: now - 1000,
                type: 'tts',
                label: 'Sentence 1'
            };

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        readRanges: [],
                        sessions: [existingSession]
                    }),
                    put: vi.fn().mockResolvedValue(undefined),
                }),
                done: Promise.resolve(),
            };
            mockDB.transaction.mockReturnValue(mockTx);

            await dbService.updateReadingHistory(bookId, updatedRange, 'tts', 'Sentence 2');

            const putArg = mockTx.objectStore().put.mock.calls[0][0];

            // Should have 2 sessions
            expect(putArg.sessions).toHaveLength(2);
        });

        it('throws error when transaction fails', async () => {
            const rejected = Promise.reject(new Error('Transaction Failed'));
            rejected.catch(() => {}); // Prevent unhandled rejection warning

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ readRanges: [] }),
                }),
                done: rejected,
            };
            mockDB.transaction.mockReturnValue(mockTx);

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(dbService.updateReadingHistory('book1', 'range1', 'page')).rejects.toThrow('An unexpected database error occurred');
            consoleSpy.mockRestore();
        });
    });
});
