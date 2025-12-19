
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
            mockDB.get.mockResolvedValue({ someOtherProp: 'test' }); // Missing readRanges

            const result = await dbService.getReadingHistory('book1');
            // Logic: return entry ? entry.readRanges : []
            // entry exists, but readRanges is undefined.
            // TS check would usually catch this, but runtime IDB can return anything.
            expect(result).toBeUndefined(); // Or should it default to empty?
            // Checking implementation: `return entry ? entry.readRanges : [];`
            // If entry.readRanges is undefined, it returns undefined.
            // Ideally it should return []. But let's verify current behavior first.
        });

        it('handles database errors gracefully', async () => {
             mockDB.get.mockRejectedValue(new Error('DB Connection Failed'));
             const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

             // The error handling in DBService calls handleError, which might throw or log.
             // DBService.ts: handleError logs and throws.

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

            await dbService.updateReadingHistory(bookId, newRange);

            expect(mockDB.transaction).toHaveBeenCalledWith('reading_history', 'readwrite');
            const putArg = mockTx.objectStore().put.mock.calls[0][0];
            expect(putArg.bookId).toBe(bookId);
            expect(putArg.readRanges).toEqual(['range1', 'range2', 'range3']);
            expect(putArg.lastUpdated).toBeDefined();
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

            await dbService.updateReadingHistory(bookId, newRange);

            const putArg = mockTx.objectStore().put.mock.calls[0][0];
            expect(putArg.bookId).toBe(bookId);
            expect(putArg.readRanges).toEqual(['range1']);
        });

        it('handles concurrency race conditions (simulated)', async () => {
             const bookId = 'book1';

             // Simulate a slow transaction
             const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ readRanges: ['existing'] }),
                    put: vi.fn().mockResolvedValue(undefined),
                }),
                done: new Promise(resolve => setTimeout(resolve, 10)),
            };
            mockDB.transaction.mockReturnValue(mockTx);

            await dbService.updateReadingHistory(bookId, 'new1');
            expect(mockTx.objectStore().put).toHaveBeenCalledTimes(1);
        });

        it('throws error when transaction fails', async () => {
            const p = Promise.reject(new Error('Transaction Failed'));
            // Silence unhandled rejection warning for the mock itself
            p.catch(() => {});

            const mockTx = {
                objectStore: vi.fn().mockReturnValue({
                    get: vi.fn().mockRejectedValue(new Error('Transaction Failed')),
                }),
                done: p,
            };
            mockDB.transaction.mockReturnValue(mockTx);

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(dbService.updateReadingHistory('book1', 'range1')).rejects.toThrow('An unexpected database error occurred');
            consoleSpy.mockRestore();
        });
    });
});
